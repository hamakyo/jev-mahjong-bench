import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TournamentEvent } from "../live/events.js";
import { createLiveEventBatch } from "../live/projector.js";
import { SnapshotStore } from "../live/snapshot.js";
import type { TournamentGameResult } from "../types.js";
import {
  REPLAY_CHECKPOINT_INTERVAL,
  REPLAY_SCHEMA_VERSION,
  type ReplayCheckpointReason,
  type ReplayCheckpointRecord,
  type ReplayEventRecord,
  type ReplayGameIndexEntry,
  type ReplayIndex,
  type ReplayManifest,
} from "./schema.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function innerMjaiType(event: TournamentEvent): string | undefined {
  if (event.type !== "mjai" || !event.event || typeof event.event !== "object" || Array.isArray(event.event)) return undefined;
  const type = (event.event as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

function replayLine(record: ReplayEventRecord): string {
  return JSON.stringify(record) + "\n";
}

export interface ReplayFinalizeOptions {
  status: "complete" | "failed";
  configSha256?: string;
  results?: TournamentGameResult[];
  error?: string;
}

export class ReplayRecorder {
  readonly streamId: string;
  readonly output: string;
  readonly snapshots: SnapshotStore;
  private readonly records: ReplayEventRecord[] = [];
  private readonly checkpoints = new Map<number, ReplayCheckpointRecord>();
  private readonly games: ReplayGameIndexEntry[] = [];
  private readonly persistedCheckpointSequences = new Set<number>();
  private byteOffset = 0;
  private finalized = false;
  private finalizing: Promise<void> | undefined;
  private storageInitialized = false;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private persistenceFailure: unknown;

  constructor(output: string, streamId: string = randomUUID()) {
    this.output = resolve(output);
    this.streamId = streamId;
    this.snapshots = new SnapshotStore(streamId);
  }

  get eventCount(): number {
    return this.records.length;
  }

  get eventRecords(): readonly ReplayEventRecord[] {
    return this.records;
  }

  record(event: TournamentEvent): void {
    if (this.finalized) throw new Error("replay recorder is already finalized");
    const sequence = this.records.length + 1;
    const record: ReplayEventRecord = {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      sequence,
      event: clone(event),
    };
    const line = replayLine(record);
    const startOffset = this.byteOffset;
    this.byteOffset += Buffer.byteLength(line);
    this.records.push(record);
    this.snapshots.apply(createLiveEventBatch(this.streamId, sequence, String(sequence), record.event));
    this.updateIndex(record.event, sequence, startOffset, this.byteOffset);

    if (sequence % REPLAY_CHECKPOINT_INTERVAL === 0) this.saveCheckpoint(sequence, "interval", this.byteOffset);
    const innerType = innerMjaiType(record.event);
    if (innerType === "start_kyoku") this.saveCheckpoint(sequence, "start_kyoku", this.byteOffset);
    if (innerType === "end_kyoku") this.saveCheckpoint(sequence, "end_kyoku", this.byteOffset);
    if (record.event.type === "game:end") this.saveCheckpoint(sequence, "game-end", this.byteOffset);

    const checkpoint = this.checkpoints.get(sequence);
    const checkpointLine = checkpoint && !this.persistedCheckpointSequences.has(sequence)
      ? JSON.stringify(checkpoint) + "\n"
      : undefined;
    if (checkpoint) this.persistedCheckpointSequences.add(sequence);
    const directory = join(this.output, "replay");
    const shouldInitialize = !this.storageInitialized;
    this.storageInitialized = true;
    const index = this.buildIndex();
    const manifest = this.buildManifest({ status: "running" });
    this.enqueuePersistence(async () => {
      if (shouldInitialize) {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "events.jsonl"), "", "utf8");
        await writeFile(join(directory, "checkpoints.jsonl"), "", "utf8");
      }
      await appendFile(join(directory, "events.jsonl"), line, "utf8");
      if (checkpointLine) await appendFile(join(directory, "checkpoints.jsonl"), checkpointLine, "utf8");
      await atomicWrite(join(directory, "index.json"), JSON.stringify(index, null, 2) + "\n");
      await atomicWrite(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    });
  }

  async finalize(options: ReplayFinalizeOptions): Promise<void> {
    if (this.finalized) return;
    if (this.finalizing) return this.finalizing;
    const operation = this.writeFinal(options);
    this.finalizing = operation;
    try {
      await operation;
      this.finalized = true;
    } finally {
      if (this.finalizing === operation) this.finalizing = undefined;
    }
  }

  async flush(): Promise<void> {
    await this.persistenceQueue;
    if (this.persistenceFailure) {
      throw this.persistenceFailure instanceof Error
        ? this.persistenceFailure
        : new Error(String(this.persistenceFailure));
    }
  }

  private enqueuePersistence(task: () => Promise<void>): void {
    this.persistenceQueue = this.persistenceQueue.then(async () => {
      if (this.persistenceFailure) return;
      try {
        await task();
      } catch (error) {
        this.persistenceFailure = error;
      }
    });
  }

  private saveCheckpoint(sequence: number, reason: ReplayCheckpointReason, byteOffset: number): void {
    this.checkpoints.set(sequence, {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      sequence,
      reason,
      byteOffset,
      snapshot: this.snapshots.checkpoint(),
    });
  }

  private buildIndex(): ReplayIndex {
    return {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      revision: this.records.length,
      eventCount: this.records.length,
      checkpoints: [...this.checkpoints.values()].map(({ sequence, reason, byteOffset }) => ({ sequence, reason, byteOffset })),
      games: clone(this.games),
    };
  }

  private buildManifest(options: ReplayFinalizeOptions | { status: "running" }): ReplayManifest {
    const resultByGame = new Map(("results" in options ? options.results ?? [] : []).map((result) => [result.gameId, result]));
    return {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      revision: this.records.length,
      status: options.status,
      streamId: this.streamId,
      eventCount: this.records.length,
      checkpointInterval: REPLAY_CHECKPOINT_INTERVAL,
      ...( "configSha256" in options && options.configSha256 ? { configSha256: options.configSha256 } : {}),
      games: this.games.map((game) => {
        const result = resultByGame.get(game.gameId);
        return {
          gameId: game.gameId,
          seed: result?.seed ?? game.seed ?? 0,
          pairId: result?.pairId ?? game.pairId ?? "",
          rotationIndex: result?.rotationIndex ?? game.rotationIndex ?? 0,
          ...(result ? {
            result: {
              scores: [...result.scores],
              ranks: [...result.ranks],
              handCount: result.handCount,
              errorCount: result.errorCount,
            },
          } : {}),
        };
      }),
      ...( "error" in options && options.error ? { error: options.error } : {}),
    };
  }

  private async writeFinal(options: ReplayFinalizeOptions): Promise<void> {
    const directory = join(this.output, "replay");
    await mkdir(directory, { recursive: true });
    // The append queue may have observed a transient I/O error.  The final
    // files are rebuilt from the in-memory records, so a retry can still
    // publish a failed/complete manifest after that error has cleared.
    try {
      await this.persistenceQueue;
    } finally {
      this.persistenceFailure = undefined;
    }
    const index = this.buildIndex();
    const manifest = this.buildManifest(options);
    await atomicWrite(join(directory, "events.jsonl"), this.records.map(replayLine).join(""));
    await atomicWrite(
      join(directory, "checkpoints.jsonl"),
      [...this.checkpoints.values()].map((checkpoint) => JSON.stringify(checkpoint) + "\n").join(""),
    );
    await atomicWrite(join(directory, "index.json"), JSON.stringify(index, null, 2) + "\n");
    await atomicWrite(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  }

  private updateIndex(event: TournamentEvent, sequence: number, startOffset: number, endOffset: number): void {
    if (event.type === "game:start") {
      this.games.push({
        gameId: event.gameId ?? "",
        seed: event.seed,
        ...(event.pairId !== undefined ? { pairId: event.pairId } : {}),
        ...(event.rotationIndex !== undefined ? { rotationIndex: event.rotationIndex } : {}),
        startSequence: sequence,
        startByteOffset: startOffset,
        hands: [],
      });
      return;
    }
    const game = this.games.at(-1);
    if (!game || (event.gameId && game.gameId !== event.gameId)) return;
    if (event.type === "game:end") {
      game.endSequence = sequence;
      game.endByteOffset = endOffset;
      return;
    }
    const innerType = innerMjaiType(event);
    if (innerType === "start_kyoku") {
      game.hands.push({
        handIndex: game.hands.length,
        startSequence: sequence,
        startByteOffset: startOffset,
      });
    } else if (innerType === "end_kyoku") {
      const hand = game.hands.at(-1);
      if (hand) {
        hand.endSequence = sequence;
        hand.endByteOffset = endOffset;
      }
    }
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
