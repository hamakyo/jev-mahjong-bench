import type { MahjongAgent } from "./agent.js";
import { GptAgent } from "./gpt.js";
import { JevAgent } from "./jev.js";
import { RandomAgent } from "./random.js";

export function createAgents(names: string[], seed: number): MahjongAgent[] {
  return names.map((raw) => {
    const name = raw.trim();
    if (name === "jev") return new JevAgent();
    if (name === "gpt") return new GptAgent();
    if (name === "random") return new RandomAgent(seed);
    throw new Error(`Unknown agent "${name}". Expected: jev, gpt, random`);
  });
}
