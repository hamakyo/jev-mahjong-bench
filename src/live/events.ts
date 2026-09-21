import type {
  GameObservation,
  TournamentGameResult,
} from "../types.js";

export const LIVE_SCHEMA_VERSION = 1 as const;

export interface LiveEventBase {
  schemaVersion: typeof LIVE_SCHEMA_VERSION;
  gameId?: string;
  pairId?: string;
  rotationIndex?: number;
  handIndex?: number;
  turnIndex?: number;
  player?: number;
  agentId?: string;
}

export interface LiveDecisionDiagnostics {
  confidence?: number;
  probabilities?: Record<string, number>;
  providerMetadata?: Record<string, unknown>;
  hybridTrace?: {
    threshold: number;
    escalated: boolean;
    escalationReason?: string;
    finalSource: string;
  };
}

export interface TournamentSettingsSnapshot {
  mode: string;
  rule: string;
  seed: number;
  seatPolicy: "rotate" | "fixed";
  requestedSeats: string[];
  timeoutMs: number;
  pairedRuns: number | null;
}

export interface TournamentStartEvent extends LiveEventBase {
  type: "tournament:start";
  totalGames: number;
  settings: TournamentSettingsSnapshot;
  schedule: Array<{
    index: number;
    gameId: string;
    seed: number;
    baseSeed: number;
    pairId: string;
    rotationIndex: number;
    seats: string[];
  }>;
}

export interface TournamentProgressEvent extends LiveEventBase {
  type: "tournament:progress";
  completedGames: number;
  totalGames: number;
  gameId?: string;
}

export interface GameStartEvent extends LiveEventBase {
  type: "game:start";
  seed: number;
  baseSeed: number;
  seats: string[];
  gameIndex: number;
  totalGames: number;
}

export interface MjaiEvent extends LiveEventBase {
  type: "mjai";
  source: "bridge";
  event: unknown;
}

export interface DecisionStartEvent extends LiveEventBase {
  type: "decision:start";
  observation: Pick<GameObservation, "state" | "legalActions" | "newEvents">;
}

export interface DecisionEndEvent extends LiveEventBase {
  type: "decision:end";
  requestedActionId?: string;
  appliedActionId: string;
  requestedAction?: Record<string, unknown>;
  appliedAction: Record<string, unknown>;
  isLegal: boolean;
  fallbackReason?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  retryCount: number;
  error?: string;
  diagnostics?: LiveDecisionDiagnostics;
  metadata?: Record<string, unknown>;
}

export interface GameEndEvent extends LiveEventBase {
  type: "game:end";
  seed: number;
  baseSeed: number;
  seats: string[];
  scores: number[];
  ranks: number[];
  handCount: number;
  errorCount: number;
  result: TournamentGameResult;
}

export interface TournamentEndEvent extends LiveEventBase {
  type: "tournament:end";
  completedGames: number;
  totalGames: number;
  errorCount: number;
}

export interface TournamentErrorEvent extends LiveEventBase {
  type: "tournament:error";
  message: string;
  errorName?: string;
  completedGames: number;
  totalGames: number;
}

export type TournamentEvent =
  | TournamentStartEvent
  | TournamentProgressEvent
  | GameStartEvent
  | MjaiEvent
  | DecisionStartEvent
  | DecisionEndEvent
  | GameEndEvent
  | TournamentEndEvent
  | TournamentErrorEvent;

export interface PublicTournamentStartEvent extends LiveEventBase {
  type: "tournament:start";
  totalGames: number;
  settings: TournamentSettingsSnapshot;
}

export interface PublicTournamentProgressEvent extends LiveEventBase {
  type: "tournament:progress";
  completedGames: number;
  totalGames: number;
}

export interface PublicGameStartEvent extends LiveEventBase {
  type: "game:start";
  seed: number;
  baseSeed: number;
  seats: string[];
  gameIndex: number;
  totalGames: number;
}

export interface PublicMjaiEvent extends LiveEventBase {
  type: "mjai";
  source: "bridge";
  event: Record<string, unknown>;
}

export interface PublicDecisionStartEvent extends LiveEventBase {
  type: "decision:start";
}

export interface PublicDecisionEndEvent extends LiveEventBase {
  type: "decision:end";
  appliedActionId: string;
  actionType: string;
}

export interface PublicGameEndEvent extends LiveEventBase {
  type: "game:end";
  scores: number[];
  ranks: number[];
  handCount: number;
  errorCount: number;
}

export interface PublicTournamentEndEvent extends LiveEventBase {
  type: "tournament:end";
  completedGames: number;
  totalGames: number;
  errorCount: number;
}

export interface PublicTournamentErrorEvent extends LiveEventBase {
  type: "tournament:error";
  message: string;
  completedGames: number;
  totalGames: number;
}

export type PublicLiveEvent =
  | PublicTournamentStartEvent
  | PublicTournamentProgressEvent
  | PublicGameStartEvent
  | PublicMjaiEvent
  | PublicDecisionStartEvent
  | PublicDecisionEndEvent
  | PublicGameEndEvent
  | PublicTournamentEndEvent
  | PublicTournamentErrorEvent;

export interface DebugTournamentStartEvent extends TournamentStartEvent {}
export interface DebugTournamentProgressEvent extends TournamentProgressEvent {}
export interface DebugGameStartEvent extends GameStartEvent {}
export interface DebugMjaiEvent extends MjaiEvent {
  event: unknown;
}
export interface DebugDecisionStartEvent extends DecisionStartEvent {}
export interface DebugDecisionEndEvent extends DecisionEndEvent {}
export interface DebugGameEndEvent extends GameEndEvent {}
export interface DebugTournamentEndEvent extends TournamentEndEvent {}
export interface DebugTournamentErrorEvent extends TournamentErrorEvent {}

export type DebugLiveEvent =
  | DebugTournamentStartEvent
  | DebugTournamentProgressEvent
  | DebugGameStartEvent
  | DebugMjaiEvent
  | DebugDecisionStartEvent
  | DebugDecisionEndEvent
  | DebugGameEndEvent
  | DebugTournamentEndEvent
  | DebugTournamentErrorEvent;

export interface SequencedLiveEvent<TEvent extends PublicLiveEvent | DebugLiveEvent = PublicLiveEvent | DebugLiveEvent> {
  streamId: string;
  id: number;
  emittedAt: string;
  event: TEvent;
}

export interface LiveEventBatch {
  streamId: string;
  id: number;
  emittedAt: string;
  publicEvent: PublicLiveEvent;
  debugEvent: DebugLiveEvent;
}

export type LiveMode = "spectator" | "debug";

export interface LiveGameActionView {
  id: string;
  type: string;
  mjai: Record<string, unknown>;
}
