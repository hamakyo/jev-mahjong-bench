import type { TournamentEvent } from "../live/events.js";
import type { SnapshotCheckpoint } from "../live/snapshot.js";

export const REPLAY_SCHEMA_VERSION = 1 as const;
export const REPLAY_CHECKPOINT_INTERVAL = 128;

export interface ReplayEventRecord {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  sequence: number;
  event: TournamentEvent;
}

export type ReplayCheckpointReason =
  | "interval"
  | "start_kyoku"
  | "end_kyoku"
  | "game-end";

export interface ReplayCheckpointRecord {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  sequence: number;
  reason: ReplayCheckpointReason;
  byteOffset: number;
  snapshot: SnapshotCheckpoint;
}

export interface ReplayGameIndexEntry {
  gameId: string;
  seed?: number;
  pairId?: string;
  rotationIndex?: number;
  startSequence: number;
  endSequence?: number;
  startByteOffset: number;
  endByteOffset?: number;
  hands: ReplayHandIndexEntry[];
}

export interface ReplayHandIndexEntry {
  handIndex: number;
  startSequence: number;
  endSequence?: number;
  startByteOffset: number;
  endByteOffset?: number;
}

export interface ReplayIndex {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  eventCount: number;
  checkpoints: Array<Pick<ReplayCheckpointRecord, "sequence" | "reason" | "byteOffset">>;
  games: ReplayGameIndexEntry[];
}

export interface ReplayManifest {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  status: "complete" | "failed";
  streamId: string;
  eventCount: number;
  checkpointInterval: number;
  configSha256?: string;
  games: Array<{
    gameId: string;
    seed: number;
    pairId: string;
    rotationIndex: number;
    result?: {
      scores: number[];
      ranks: number[];
      handCount: number;
      errorCount: number;
    };
  }>;
  error?: string;
}
