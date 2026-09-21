export type ControlState = "running" | "paused" | "stepping" | "finished" | "failed";

export type ControlPhase =
  | "game-start"
  | "decision-batch"
  | "environment-step"
  | "game-end"
  | "tournament-end";

export interface ControlSnapshot {
  state: ControlState;
  pauseRequested: boolean;
  currentStep: ControlPhase | null;
  nextStep: ControlPhase | null;
  stepNumber: number;
}
