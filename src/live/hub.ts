import { randomUUID } from "node:crypto";
import type {
  DebugLiveEvent,
  LiveEventBatch,
  LiveMode,
  PublicLiveEvent,
  SequencedLiveEvent,
  TournamentEvent,
} from "./events.js";
import { createLiveEventBatch } from "./projector.js";

export interface LiveResetEvent {
  type: "reset";
  streamId: string;
  lastEventId: number;
  oldestEventId: number;
  reason: "history-unavailable";
}

export interface LiveSubscriber {
  send(event: SequencedLiveEvent<PublicLiveEvent | DebugLiveEvent>): boolean;
  reset(event: LiveResetEvent): boolean;
  close?(): void;
}

export interface LiveEventHubOptions {
  streamId?: string;
  bufferSize?: number;
  now?: () => string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Synchronous, non-blocking event fanout for the tournament observer path. */
export class LiveEventHub {
  readonly streamId: string;
  readonly bufferSize: number;
  private readonly now: () => string;
  private nextId = 1;
  private readonly buffer: LiveEventBatch[] = [];
  private readonly subscribers = new Map<LiveSubscriber, LiveMode>();

  constructor(options: LiveEventHubOptions = {}) {
    this.streamId = options.streamId ?? randomUUID();
    this.bufferSize = options.bufferSize ?? 4_096;
    if (!Number.isInteger(this.bufferSize) || this.bufferSize < 1) {
      throw new Error("live event bufferSize must be a positive integer");
    }
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get lastEventId(): number {
    return this.nextId - 1;
  }

  get oldestEventId(): number {
    return this.buffer[0]?.id ?? this.nextId;
  }

  /** Emit never awaits a subscriber or lets subscriber errors reach the game. */
  emit(event: TournamentEvent): LiveEventBatch {
    const batch = createLiveEventBatch(this.streamId, this.nextId, this.now(), event);
    this.nextId += 1;
    this.buffer.push(batch);
    while (this.buffer.length > this.bufferSize) this.buffer.shift();

    for (const [subscriber, mode] of [...this.subscribers.entries()]) {
      const sequence = this.sequence(batch, mode);
      try {
        if (!subscriber.send(sequence)) this.remove(subscriber, true);
      } catch {
        this.remove(subscriber, true);
      }
    }
    return clone(batch);
  }

  /**
   * Subscribe and replay the buffered suffix.  The subscriber is registered
   * before replay so a re-entrant emit cannot create a gap.
   */
  subscribe(mode: LiveMode, after: number | undefined, subscriber: LiveSubscriber): () => void {
    this.subscribers.set(subscriber, mode);
    const oldest = this.oldestEventId;
    const last = this.lastEventId;
    if (after !== undefined && after < oldest - 1) {
      try {
        if (!subscriber.reset({
          type: "reset",
          streamId: this.streamId,
          lastEventId: last,
          oldestEventId: oldest,
          reason: "history-unavailable",
        })) this.remove(subscriber, true);
      } catch {
        this.remove(subscriber, true);
      }
      return () => this.remove(subscriber, false);
    }
    const start = after === undefined ? last + 1 : after + 1;
    for (const batch of this.buffer) {
      if (batch.id < start || !this.subscribers.has(subscriber)) continue;
      try {
        if (!subscriber.send(this.sequence(batch, mode))) {
          this.remove(subscriber, true);
          break;
        }
      } catch {
        this.remove(subscriber, true);
        break;
      }
    }
    return () => this.remove(subscriber, false);
  }

  history(after?: number): SequencedLiveEvent<PublicLiveEvent | DebugLiveEvent>[] {
    const start = after === undefined ? this.oldestEventId : after + 1;
    return this.buffer
      .filter((batch) => batch.id >= start)
      .map((batch) => this.sequence(batch, "debug"));
  }

  private sequence(batch: LiveEventBatch, mode: LiveMode): SequencedLiveEvent<PublicLiveEvent | DebugLiveEvent> {
    return {
      streamId: batch.streamId,
      id: batch.id,
      emittedAt: batch.emittedAt,
      event: clone(mode === "spectator" ? batch.publicEvent : batch.debugEvent),
    };
  }

  private remove(subscriber: LiveSubscriber, close: boolean): void {
    if (!this.subscribers.delete(subscriber)) return;
    if (close) {
      try { subscriber.close?.(); } catch { /* an uncooperative client is isolated */ }
    }
  }
}
