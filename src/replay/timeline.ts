import { createLiveEventBatch } from "../live/projector.js";
import { SnapshotStore, type LiveSnapshot } from "../live/snapshot.js";
import type { LiveMode, SequencedLiveEvent, PublicLiveEvent, DebugLiveEvent } from "../live/events.js";
import type { ReplayCheckpointRecord } from "./schema.js";
import type { ReplayData } from "./loader.js";
import {
  buildReplayNavigationIndex,
  createReplaySelection,
  debugDetailsForDecision,
  selectReplayDecision,
  type ReplayNavigationIndex,
  type ReplaySelection,
  type ReplaySelectionResult,
} from "./navigation.js";

export interface ReplaySnapshotResult {
  cursor: number;
  snapshot: LiveSnapshot;
  checkpointSequence: number;
  appliedDeltaCount: number;
  selection: ReplaySelection;
  selectionDebug?: ReplaySelectionResult["debug"];
}

export class ReplayTimeline {
  readonly data: ReplayData;
  readonly navigationIndex: ReplayNavigationIndex;
  private readonly sortedCheckpoints: ReplayCheckpointRecord[];
  private lastAppliedDeltaCount = 0;

  constructor(data: ReplayData) {
    this.data = data;
    this.sortedCheckpoints = [...data.checkpoints].sort((left, right) => left.sequence - right.sequence);
    this.navigationIndex = buildReplayNavigationIndex(data.events, data.index);
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

  snapshot(cursor: number, mode: LiveMode = "spectator", decisionIndex?: number): ReplaySnapshotResult {
    const requestedCursor = Math.max(0, Math.min(this.eventCount, Math.floor(cursor)));
    const requestedDecision = decisionIndex === undefined
      ? undefined
      : this.navigationIndex.decisions[decisionIndex];
    if (decisionIndex !== undefined && !requestedDecision) throw new Error("decision index is out of range");
    const selected = selectReplayDecision(this.navigationIndex, requestedCursor, decisionIndex);
    const target = Math.max(0, Math.min(this.eventCount, Math.floor(decisionIndex === undefined ? requestedCursor : selected?.snapshotSequence ?? requestedCursor)));
    const selectionResult = createReplaySelection(this.navigationIndex, target, selected?.index);
    const checkpoint = this.latestCheckpoint(target);
    const store = new SnapshotStore(this.data.manifest.streamId);
    const restored = checkpoint ? store.restore(checkpoint.snapshot) : false;
    const base = restored && checkpoint ? checkpoint.sequence : 0;
    for (const record of this.data.events.slice(base, target)) {
      store.apply(createLiveEventBatch(this.data.manifest.streamId, record.sequence, String(record.sequence), record.event));
    }
    this.lastAppliedDeltaCount = target - base;
    return {
      cursor: target,
      snapshot: store.getSnapshot(mode),
      checkpointSequence: base,
      appliedDeltaCount: this.lastAppliedDeltaCount,
      selection: selectionResult.selection,
      ...(mode === "debug" && selected
        ? { selectionDebug: debugDetailsForDecision(this.data.events, selected) }
        : {}),
    };
  }

  snapshotFor(options: {
    cursor?: number;
    decisionIndex?: number;
    mode?: LiveMode;
  }): ReplaySnapshotResult {
    return this.snapshot(options.cursor ?? 0, options.mode ?? "spectator", options.decisionIndex);
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
