import type { MahjongAgent } from "./agent.js";
import type { AgentDecision, DecisionSample } from "../types.js";

function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class RandomAgent implements MahjongAgent {
  readonly id = "random";
  constructor(private readonly seed = 42) {}

  async decide(sample: DecisionSample): Promise<AgentDecision> {
    const index = hash32(`${this.seed}:${sample.id}`) % sample.legalActions.length;
    const action = sample.legalActions[index];
    if (!action) throw new Error("No legal action available");
    const p = 1 / sample.legalActions.length;
    return {
      action,
      probabilities: Object.fromEntries(sample.legalActions.map((x) => [x, p])),
      confidence: p,
    };
  }
}
