import type { MahjongAgent } from "./agent.js";
import { GptAgent } from "./gpt.js";
import { JevAgent } from "./jev.js";
import { MortalAgent, type MortalConfig } from "./mortal.js";
import { RandomAgent } from "./random.js";

export function createAgents(names: string[], seed: number, mortalConfig?: MortalConfig): MahjongAgent[] {
  return names.map((raw) => {
    const name = raw.trim();
    if (name === "jev") return new JevAgent();
    if (name === "gpt") return new GptAgent();
    if (name === "random") return new RandomAgent(seed);
    if (name === "mortal") {
      if (!mortalConfig) throw new Error("Mortal agent requires --mortal-config");
      return new MortalAgent(mortalConfig);
    }
    throw new Error(`Unknown agent "${name}". Expected: jev, gpt, mortal, random`);
  });
}
