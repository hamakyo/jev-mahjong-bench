import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
  private byteOffset = 0;
  private finalized = false;

  constructor(output: string, streamId = randomUUID()) {
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

    if (sequence % REPLAY_CHECKPOINT_INTERVAL === 0) {
      this.saveCheckpoint(sequence, "interval", startOffset);
    }
    const innerType = innerMjaiType(record.event);
    if (innerType === "start_kyoku") this.saveCheckpoint(sequence, "start_kyoku", startOffset);
    if (innerType === "end_kyoku") this.saveCheckpoint(sequence, "end_kyoku", startOffset);
    if (record.event.type === "game:end") this.saveCheckpoint(sequence, "game-end", startOffset);
  }

  async finalize(options: ReplayFinalizeOptions): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    const directory = join(this.output, "replay");
    await mkdir(directory, { recursive: true });
    const index: ReplayIndex = {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      eventCount: this.records.length,
      checkpoints: [...this.checkpoints.values()].map(({ sequence, reason, byteOffset }) => ({ sequence, reason, byteOffset })),
      games: clone(this.games),
    };
    const resultByGame = new Map((options.results ?? []).map((result) => [result.gameId, result]));
    const manifest: ReplayManifest = {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      status: options.status,
      streamId: this.streamId,
      eventCount: this.records.length,
      checkpointInterval: REPLAY_CHECKPOINT_INTERVAL,
      ...(options.configSha256 ? { configSha256: options.configSha256 } : {}),
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
      ...(options.error ? { error: options.error } : {}),
    };
    await writeFile(join(directory, "events.jsonl"), this.records.map(replayLine).join(""), "utf8");
    await writeFile(
      join(directory, "checkpoints.jsonl"),
      [...this.checkpoints.values()].map((checkpoint) => JSON.stringify(checkpoint) + "\n").join(""),
      "utf8",
    );
    await writeFile(join(directory, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
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

  private updateIndex(event: TournamentEvent, sequence: number, startOffset: number, endOffset: number): void {
    if (event.type === "game:start") {
      this.games.push({
        gameId: event.gameId ?? "",
        seed: event.seed,
        pairId: event.pairId,
        rotationIndex: event.rotationIndex,
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
