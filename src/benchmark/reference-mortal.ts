import { resolve } from "node:path";
import { loadDataset } from "./dataset.js";
import { writeSamples } from "./dataset-tools.js";
import { MortalAgent, loadMortalConfig } from "../agents/mortal.js";
import { canonicalJson } from "../mjai/tiles.js";
import type { DecisionSample, ReferencePolicy } from "../types.js";

function samePolicy(a: ReferencePolicy | undefined, b: ReferencePolicy): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export async function addMortalReferences(input: string, output: string, configPath: string): Promise<{ samples: number; policy: ReferencePolicy }> {
  const inputPath = resolve(input);
  const outputPath = resolve(output);
  if (inputPath === outputPath) throw new Error("reference:mortal requires a different output path so the input remains unchanged");
  const [samples, config] = await Promise.all([loadDataset(inputPath), loadMortalConfig(resolve(configPath))]);
  const agent = new MortalAgent(config);
  try {
    const policy = await agent.policy();
    const derived: DecisionSample[] = [];
    for (const sample of samples) {
      const decision = await agent.decide(sample);
      if (sample.referenceAction !== undefined) {
        if (!sample.referenceMetadata || !samePolicy(sample.referenceMetadata, policy)) {
          throw new Error(`sample ${sample.id} already has a different reference policy`);
        }
        if (sample.referenceAction !== decision.action) {
          throw new Error(`sample ${sample.id} has an existing Mortal reference that differs from the new result`);
        }
      }
      derived.push({
        ...sample,
        referenceAction: decision.action,
        referenceMetadata: policy,
      });
    }
    await writeSamples(outputPath, derived);
    return { samples: derived.length, policy };
  } finally {
    await agent.close?.();
  }
}
