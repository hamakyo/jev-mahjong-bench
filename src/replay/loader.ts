import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  ReplayCheckpointRecord,
  ReplayEventRecord,
  ReplayIndex,
  ReplayManifest,
} from "./schema.js";

function parseLines<T>(text: string): T[] {
  const lines = text.split("\n");
  const hasCompleteFinalLine = lines.at(-1) === "";
  if (hasCompleteFinalLine) lines.pop();
  return lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as T];
    } catch (error) {
      if (!hasCompleteFinalLine && index === lines.length - 1) return [];
      throw error;
    }
  });
}

interface RawReplayFiles {
  manifest: ReplayManifest;
  index: ReplayIndex;
  events: ReplayEventRecord[];
  checkpoints: ReplayCheckpointRecord[];
}

function replayRevision(value: { revision?: unknown; eventCount: number }): number {
  return typeof value.revision === "number" && Number.isSafeInteger(value.revision)
    ? value.revision
    : value.eventCount;
}

function normalizedIndex(index: ReplayIndex, eventCount: number): ReplayIndex {
  const games = index.games
    .filter((game) => game.startSequence <= eventCount)
    .map((game) => {
      const { endSequence, endByteOffset, hands, ...base } = game;
      const normalizedHands = hands
        .filter((hand) => hand.startSequence <= eventCount)
        .map((hand) => {
          const { endSequence: handEnd, endByteOffset: handEndOffset, ...handBase } = hand;
          return {
            ...handBase,
            ...(handEnd !== undefined && handEnd <= eventCount ? { endSequence: handEnd, ...(handEndOffset !== undefined ? { endByteOffset: handEndOffset } : {}) } : {}),
          };
        });
      return {
        ...base,
        hands: normalizedHands,
        ...(endSequence !== undefined && endSequence <= eventCount ? { endSequence, ...(endByteOffset !== undefined ? { endByteOffset } : {}) } : {}),
      };
    });
  return {
    ...index,
    revision: eventCount,
    eventCount,
    checkpoints: index.checkpoints.filter((checkpoint) => checkpoint.sequence <= eventCount),
    games,
  };
}

function normalizedManifest(manifest: ReplayManifest, index: ReplayIndex, eventCount: number): ReplayManifest {
  const gameIds = new Set(index.games.map((game) => game.gameId));
  return {
    ...manifest,
    revision: eventCount,
    eventCount,
    games: manifest.games.filter((game) => gameIds.has(game.gameId)),
  };
}

async function readReplayFiles(directory: string): Promise<RawReplayFiles> {
  const [manifestText, indexText, eventsText, checkpointsText] = await Promise.all([
    readFile(join(directory, "manifest.json"), "utf8"),
    readFile(join(directory, "index.json"), "utf8"),
    readFile(join(directory, "events.jsonl"), "utf8"),
    readFile(join(directory, "checkpoints.jsonl"), "utf8"),
  ]);
  return {
    manifest: JSON.parse(manifestText) as ReplayManifest,
    index: JSON.parse(indexText) as ReplayIndex,
    events: parseLines<ReplayEventRecord>(eventsText),
    checkpoints: parseLines<ReplayCheckpointRecord>(checkpointsText),
  };
}

function validateReplayShape(files: RawReplayFiles): void {
  if (files.manifest.schemaVersion !== 1 || files.index.schemaVersion !== 1) throw new Error("unsupported replay schema version");
  if (files.manifest.status !== "running" && files.manifest.status !== "complete" && files.manifest.status !== "failed") {
    throw new Error("unsupported replay status");
  }
  if (files.manifest.eventCount < 0 || files.index.eventCount < 0) {
    throw new Error("replay event count must not be negative");
  }
  if (files.manifest.status !== "running" && (files.manifest.eventCount !== files.events.length || files.index.eventCount !== files.events.length)) {
    throw new Error("replay event count mismatch");
  }
}

export interface ReplayData {
  root: string;
  manifest: ReplayManifest;
  index: ReplayIndex;
  events: ReplayEventRecord[];
  checkpoints: ReplayCheckpointRecord[];
}

export async function loadReplay(input: string): Promise<ReplayData> {
  const root = resolve(input);
  const directory = join(root, "replay");
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const files = await readReplayFiles(directory);
    validateReplayShape(files);
    const manifestRevision = replayRevision(files.manifest);
    const indexRevision = replayRevision(files.index);
    if (manifestRevision !== indexRevision) {
      if (attempt + 1 < maxAttempts) {
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 10));
        continue;
      }
      throw new Error("replay manifest/index revision mismatch");
    }
    const eventCount = Math.min(files.manifest.eventCount, files.index.eventCount, files.events.length);
    if (eventCount < 0 || files.events.slice(0, eventCount).some((event, position) => event.sequence !== position + 1)) {
      throw new Error("replay event count mismatch");
    }
    const index = normalizedIndex(files.index, eventCount);
    const manifest = normalizedManifest(files.manifest, index, eventCount);
    return {
      root,
      manifest,
      index,
      events: files.events.slice(0, eventCount),
      checkpoints: files.checkpoints.filter((checkpoint) => checkpoint.sequence <= eventCount),
    };
  }
  throw new Error("replay changed while it was being loaded");
}
