import type { MahjongAgent } from "./agent.js";
import { GptAgent } from "./gpt.js";
import { DEFAULT_HYBRID_THRESHOLD, HybridAgent, parseHybridAgentSpec } from "./hybrid.js";
import { JevAgent } from "./jev.js";
import { MortalAgent, type MortalConfig } from "./mortal.js";
import { RandomAgent } from "./random.js";

export interface AgentFactoryOptions {
  mortalConfig?: MortalConfig;
  hybridThreshold?: number;
}

export function createAgents(names: string[], seed: number, options: AgentFactoryOptions = {}): MahjongAgent[] {
  return names.map((raw) => {
    const name = raw.trim();
    const hybrid = parseHybridAgentSpec(name);
    if (hybrid) return new HybridAgent(hybrid.threshold ?? options.hybridThreshold ?? DEFAULT_HYBRID_THRESHOLD);
    if (name === "jev") return new JevAgent();
    if (name === "gpt") return new GptAgent();
    if (name === "random") return new RandomAgent(seed);
    if (name === "mortal") {
      if (!options.mortalConfig) throw new Error("Mortal agent requires --mortal-config");
      return new MortalAgent(options.mortalConfig);
    }
    throw new Error(`Unknown agent "${name}". Expected: jev, gpt, hybrid, mortal, random`);
  });
}
