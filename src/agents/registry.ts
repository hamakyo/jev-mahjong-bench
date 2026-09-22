import type { MahjongAgent } from "./agent.js";
import { DEFAULT_HYBRID_THRESHOLD, HybridAgent, parseHybridAgentSpec } from "./hybrid.js";
import { JevAgent } from "./jev.js";
import { MortalAgent, type MortalConfig } from "./mortal.js";
import { RandomAgent } from "./random.js";
import { GenericLlmAgent } from "./llm.js";
import { createModelRegistry, ModelRegistry } from "../providers/registry.js";
import { createProvider } from "../providers/index.js";

export interface AgentFactoryOptions {
  mortalConfig?: MortalConfig;
  hybridThreshold?: number;
  hybridFallbackModel?: string;
  modelRegistry?: ModelRegistry;
}

export function createAgents(names: string[], seed: number, options: AgentFactoryOptions = {}): MahjongAgent[] {
  const registry = options.modelRegistry ?? createModelRegistry();
  const fallbackModelId = options.hybridFallbackModel ?? "gpt";
  return names.map((raw) => {
    const name = raw.trim();
    const hybrid = parseHybridAgentSpec(name);
    if (hybrid) {
      const fallbackModel = registry.resolve(fallbackModelId);
      const fallback = new GenericLlmAgent(createProvider(fallbackModel), fallbackModel);
      return new HybridAgent(hybrid.threshold ?? options.hybridThreshold ?? DEFAULT_HYBRID_THRESHOLD, undefined, fallback);
    }
    if (name === "jev") return new JevAgent();
    if (name === "random") return new RandomAgent(seed);
    if (name === "mortal") {
      if (!options.mortalConfig) throw new Error("Mortal agent requires --mortal-config");
      return new MortalAgent(options.mortalConfig);
    }
    if (name === "gpt" || registry.has(name)) {
      const model = registry.resolve(name);
      return new GenericLlmAgent(createProvider(model), model, name === "gpt" ? `gpt:${model.model}` : undefined);
    }
    throw new Error(`Unknown agent "${name}". Expected: jev, gpt, hybrid, mortal, random, or a registered model ID`);
  });
}
