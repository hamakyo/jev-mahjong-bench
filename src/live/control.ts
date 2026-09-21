import type { ControlPhase, ControlState, ControlSnapshot } from "./control-types.js";

export { type ControlPhase, type ControlState, type ControlSnapshot } from "./control-types.js";

export class ControlConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "ControlConflictError";
  }
}

export class ControlClosedError extends Error {
  constructor(message = "execution control is closed") {
    super(message);
    this.name = "ControlClosedError";
  }
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * A small phase gate used by the live runner. It only blocks at explicit
 * tournament boundaries; provider requests are never interrupted by pause.
 */
export class TournamentControl {
  private state: ControlState = "running";
  private pauseRequested = false;
  private currentStep: ControlPhase | null = null;
  private nextStep: ControlPhase | null = "game-start";
  private stepNumber = 0;
  private closed = false;
  private readonly waiters = new Set<Waiter>();

  getSnapshot(): ControlSnapshot {
    return {
      state: this.state,
      pauseRequested: this.pauseRequested,
      currentStep: this.currentStep,
      nextStep: this.nextStep,
      stepNumber: this.stepNumber,
    };
  }

  pause(): ControlSnapshot {
    this.ensureOpen();
    if (this.state === "finished" || this.state === "failed") return this.getSnapshot();
    this.pauseRequested = true;
    this.notify();
    return this.getSnapshot();
  }

  resume(): ControlSnapshot {
    this.ensureOpen();
    if (this.state === "paused") {
      this.pauseRequested = false;
      this.state = "running";
      this.notify();
    } else if (this.state === "running") {
      this.pauseRequested = false;
    }
    return this.getSnapshot();
  }

  step(): ControlSnapshot {
    this.ensureOpen();
    if (this.state !== "paused") {
      throw new ControlConflictError("step is accepted only while paused");
    }
    this.pauseRequested = false;
    this.state = "stepping";
    this.notify();
    return this.getSnapshot();
  }

  /**
   * Wait until a phase is permitted, then mark it as the current phase.
   * Call completePhase exactly once after the phase's safe boundary.
   */
  async enter(phase: ControlPhase): Promise<void> {
    this.ensureOpen();
    this.nextStep = phase;
    if (this.state === "running" && this.pauseRequested) {
      this.state = "paused";
      this.pauseRequested = false;
    }
    if (this.state === "paused") await this.waitUntilResumed();
    this.ensureOpen();
    if (this.state === "failed" || this.state === "finished") {
      throw new ControlClosedError("execution control is " + this.state);
    }
    this.currentStep = phase;
    this.nextStep = phase;
    this.stepNumber += 1;
  }

  completePhase(phase: ControlPhase, nextStep: ControlPhase | null): void {
    if (this.closed) return;
    this.currentStep = phase;
    this.nextStep = nextStep;
    if (this.state === "stepping" || this.pauseRequested) {
      this.state = "paused";
      this.pauseRequested = false;
    }
  }

  finish(): ControlSnapshot {
    if (this.closed) return this.getSnapshot();
    this.state = "finished";
    this.pauseRequested = false;
    this.nextStep = null;
    this.notify();
    return this.getSnapshot();
  }

  fail(): ControlSnapshot {
    if (this.closed) return this.getSnapshot();
    this.state = "failed";
    this.pauseRequested = false;
    this.nextStep = null;
    this.notify(new ControlClosedError("execution control failed"));
    return this.getSnapshot();
  }

  close(error = new ControlClosedError()): void {
    if (this.closed) return;
    this.closed = true;
    this.state = "failed";
    this.pauseRequested = false;
    this.nextStep = null;
    this.notify(error);
  }

  private ensureOpen(): void {
    if (this.closed) throw new ControlClosedError();
  }

  private waitUntilResumed(): Promise<void> {
    if (this.state !== "paused") return Promise.resolve();
    return new Promise<void>((resolvePromise, reject) => {
      this.waiters.add({ resolve: resolvePromise, reject });
    });
  }

  private notify(error?: Error): void {
    if (this.state === "paused" && !error) return;
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const waiter of waiters) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }
}
