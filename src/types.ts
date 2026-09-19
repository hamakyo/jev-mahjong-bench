export type TileEncoding = "mpsz";

export type DatasetPlatform = "tenhou" | "majsoul";

export interface SampleProvenance {
  platform: DatasetPlatform;
  /** SHA-256(platform + game id), never the raw game id. */
  gameIdHash: string;
  handIndex: number;
  eventIndex: number;
  seat: number;
}

export interface ReferencePolicy {
  name: string;
  version?: string;
  modelSha256?: string;
  config?: Record<string, unknown>;
}

export interface MahjongState {
  round: string;
  seat?: string;
  honba?: number;
  scores?: number[] | Record<string, number>;
  hand: string[];
  drawnTile?: string;
  doraIndicators?: string[];
  discards?: Record<string, string[]>;
  melds?: Record<string, string[]>;
  riichi?: Record<string, boolean>;
  tileEncoding?: TileEncoding;
  /** Visible MJAI events; importers serialize these as canonical JSONL strings. */
  mjaiEvents?: MjaiEvent[];
  extra?: Record<string, unknown>;
}

export type MjaiEvent = string | Record<string, unknown>;

export interface DecisionSample {
  id: string;
  state: MahjongState;
  legalActions: string[];
  /** The action played in the source replay, when the sample came from a replay. */
  observedAction?: string;
  referenceAction?: string;
  provenance?: SampleProvenance;
  referenceMetadata?: ReferencePolicy;
  source?: string;
  tags?: string[];
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentDecision {
  action: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  usage?: TokenUsage;
  metadata?: Record<string, unknown>;
}

export interface DecisionRecord {
  agentId: string;
  sampleId: string;
  action?: string;
  referenceAction?: string;
  isLegal: boolean;
  isMatch?: boolean;
  latencyMs: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  inputTokens?: number;
  outputTokens?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export type GameActionType =
  | "dahai"
  | "chi"
  | "pon"
  | "daiminkan"
  | "ankan"
  | "kakan"
  | "kan"
  | "reach"
  | "riichi"
  | "hora"
  | "ron"
  | "tsumo"
  | "kyushukyuhai"
  | "ryukyoku"
  | "kita"
  | "none";

export interface GameAction {
  /** SHA-256 of the canonical MJAI object. */
  id: string;
  type: GameActionType;
  mjai: Record<string, unknown>;
}

/** Model input for a complete-game decision.  Unlike discard benchmarks, the
 * action id is only an identifier: type and MJAI are part of the choice. */
export interface GameDecisionInput {
  id: string;
  state: MahjongState;
  legalActions: GameAction[];
}

export interface GameObservation {
  player: number;
  /** The suffix added since this seat's previous observation. */
  newEvents: string[];
  /** The cumulative visible MJAI history for this seat. */
  events: string[];
  state: MahjongState;
  legalActions: GameAction[];
  gameId: string;
  handIndex: number;
  turnIndex: number;
}

export interface GameAgent {
  readonly id: string;
  act(observation: GameObservation, signal?: AbortSignal): Promise<string>;
  cancel?(): void;
  close?(): Promise<void>;
}

export interface GameDecisionRecord {
  gameId: string;
  handIndex: number;
  turnIndex: number;
  player: number;
  agentId: string;
  requestedActionId?: string;
  appliedActionId: string;
  requestedAction?: Record<string, unknown>;
  appliedAction: Record<string, unknown>;
  isLegal: boolean;
  fallbackReason?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface ConfidenceInterval {
  estimate: number;
  lower: number;
  upper: number;
  level: number;
  sampleCount: number;
  standardDeviation?: number;
  standardError?: number;
  successes?: number;
  trials?: number;
  method?: "student-t" | "normal" | "wilson";
}

export interface SeatGameResult {
  gameId: string;
  seed: number;
  pairId: string;
  baseSeed: number;
  rotationIndex: number;
  agentId: string;
  seat: number;
  score: number;
  rank: number;
  handCount: number;
  wins: number;
  dealIns: number;
  riichi: number;
  calls: number;
  decisions: number;
  legalDecisions: number;
  fallbackCount: number;
  errorCount: number;
  latenciesMs: number[];
  inputTokens: number;
  outputTokens: number;
  rawEventCounts: Record<string, number>;
}

export interface TournamentGameResult {
  gameId: string;
  seed: number;
  baseSeed: number;
  pairId: string;
  rotationIndex: number;
  seats: string[];
  scores: number[];
  ranks: number[];
  handCount: number;
  eventCounts: Record<string, number>;
  players: SeatGameResult[];
  errorCount: number;
}

export interface TournamentAgentSummary {
  agentId: string;
  games: number;
  hands: number;
  decisions: number;
  legalDecisions: number;
  meanScore: number;
  meanRank: number;
  firstRate: number;
  fourthRate: number;
  winRate: number;
  dealInRate: number;
  riichiRate: number;
  callRate: number;
  decisionsPerGame: number;
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  inputTokensPerGame: number;
  outputTokensPerGame: number;
  inputTokensPerDecision: number;
  outputTokensPerDecision: number;
  fallbackCount: number;
  errorCount: number;
  fallbackRate: number;
  errorRate: number;
  scoreInterval?: ConfidenceInterval;
  rankInterval?: ConfidenceInterval;
  firstRateInterval?: ConfidenceInterval;
  fourthRateInterval?: ConfidenceInterval;
  winRateInterval?: ConfidenceInterval;
  dealInRateInterval?: ConfidenceInterval;
  riichiRateInterval?: ConfidenceInterval;
  callRateInterval?: ConfidenceInterval;
}

export interface PairwiseComparison {
  leftAgentId: string;
  rightAgentId: string;
  pairs: number;
  meanScoreDifference: number;
  meanRankDifference: number;
  scoreDifferenceInterval?: ConfidenceInterval;
  rankDifferenceInterval?: ConfidenceInterval;
}

export interface AgentSummary {
  agentId: string;
  decisions: number;
  successes: number;
  successRate: number;
  legalActionRate: number;
  referenceCount: number;
  exactMatches: number;
  exactMatchRate?: number;
  meanLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  averageConfidence?: number;
  referenceEce?: number;
  brierScore?: number;
  inputTokens: number;
  outputTokens: number;
}
