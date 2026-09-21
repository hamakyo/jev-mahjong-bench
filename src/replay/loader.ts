import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  ReplayCheckpointRecord,
  ReplayEventRecord,
  ReplayIndex,
  ReplayManifest,
} from "./schema.js";

function parseLines<T>(text: string): T[] {
  return text.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as T);
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
  const [manifestText, indexText, eventsText, checkpointsText] = await Promise.all([
    readFile(join(directory, "manifest.json"), "utf8"),
    readFile(join(directory, "index.json"), "utf8"),
    readFile(join(directory, "events.jsonl"), "utf8"),
    readFile(join(directory, "checkpoints.jsonl"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as ReplayManifest;
  const index = JSON.parse(indexText) as ReplayIndex;
  const events = parseLines<ReplayEventRecord>(eventsText);
  const checkpoints = parseLines<ReplayCheckpointRecord>(checkpointsText);
  if (manifest.schemaVersion !== 1 || index.schemaVersion !== 1) throw new Error("unsupported replay schema version");
  if (manifest.eventCount !== events.length || index.eventCount !== events.length) {
    throw new Error("replay event count mismatch");
  }
  return { root, manifest, index, events, checkpoints };
}
