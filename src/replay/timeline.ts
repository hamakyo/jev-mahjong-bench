import { createLiveEventBatch } from "../live/projector.js";
import { SnapshotStore, type LiveSnapshot } from "../live/snapshot.js";
import type { LiveMode, SequencedLiveEvent, PublicLiveEvent, DebugLiveEvent } from "../live/events.js";
import type { ReplayCheckpointRecord, ReplayEventRecord } from "./schema.js";
import type { ReplayData } from "./loader.js";

export interface ReplaySnapshotResult {
  cursor: number;
  snapshot: LiveSnapshot;
  checkpointSequence: number;
  appliedDeltaCount: number;
}

export class ReplayTimeline {
  readonly data: ReplayData;
  private readonly sortedCheckpoints: ReplayCheckpointRecord[];
  private lastAppliedDeltaCount = 0;

  constructor(data: ReplayData) {
    this.data = data;
    this.sortedCheckpoints = [...data.checkpoints].sort((left, right) => left.sequence - right.sequence);
  }

  get eventCount(): number {
    return this.data.events.length;
  }

  get appliedDeltaCount(): number {
    return this.lastAppliedDeltaCount;
  }

  events(from = 1, to = this.eventCount, mode: LiveMode = "spectator"): SequencedLiveEvent<PublicLiveEvent | DebugLiveEvent>[] {
    const start = Math.max(1, Math.floor(from));
    const end = Math.min(this.eventCount, Math.floor(to));
    if (end < start) return [];
    return this.data.events
      .slice(start - 1, end)
      .map((record) => {
        const batch = createLiveEventBatch(this.data.manifest.streamId, record.sequence, String(record.sequence), record.event);
        return {
          streamId: batch.streamId,
          id: batch.id,
          emittedAt: batch.emittedAt,
          event: structuredClone(mode === "spectator" ? batch.publicEvent : batch.debugEvent),
        };
      });
  }

  snapshot(cursor: number, mode: LiveMode = "spectator"): ReplaySnapshotResult {
    const target = Math.max(0, Math.min(this.eventCount, Math.floor(cursor)));
    const checkpoint = this.latestCheckpoint(target);
    const store = new SnapshotStore(this.data.manifest.streamId);
    const base = checkpoint?.sequence ?? 0;
    if (checkpoint) store.restore(checkpoint.snapshot);
    for (const record of this.data.events.slice(base, target)) {
      store.apply(createLiveEventBatch(this.data.manifest.streamId, record.sequence, String(record.sequence), record.event));
    }
    this.lastAppliedDeltaCount = target - base;
    return {
      cursor: target,
      snapshot: store.getSnapshot(mode),
      checkpointSequence: base,
      appliedDeltaCount: this.lastAppliedDeltaCount,
    };
  }

  private latestCheckpoint(cursor: number): ReplayCheckpointRecord | undefined {
    let low = 0;
    let high = this.sortedCheckpoints.length - 1;
    let result: ReplayCheckpointRecord | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const checkpoint = this.sortedCheckpoints[middle]!;
      if (checkpoint.sequence <= cursor) {
        result = checkpoint;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return result;
  }
}
