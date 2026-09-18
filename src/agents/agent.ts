import type { AgentDecision, DecisionSample } from "../types.js";

export interface MahjongAgent {
  readonly id: string;
  decide(sample: DecisionSample): Promise<AgentDecision>;
  close?(): Promise<void>;
}
