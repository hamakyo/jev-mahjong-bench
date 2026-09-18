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
  extra?: Record<string, unknown>;
}

export interface DecisionSample {
  id: string;
  state: MahjongState;
  legalActions: string[];
  referenceAction?: string;
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
  error?: string;
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
