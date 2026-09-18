import { performance } from "node:perf_hooks";
import type { MahjongAgent } from "../agents/agent.js";
import type { DecisionRecord, DecisionSample } from "../types.js";

async function decideOne(agent: MahjongAgent, sample: DecisionSample): Promise<DecisionRecord> {
  const started = performance.now();
  try {
    const d = await agent.decide(sample);
    return {
      agentId: agent.id,
      sampleId: sample.id,
      action: d.action,
      ...(sample.referenceAction ? { referenceAction: sample.referenceAction } : {}),
      isLegal: sample.legalActions.includes(d.action),
      ...(sample.referenceAction ? { isMatch: d.action === sample.referenceAction } : {}),
      latencyMs: performance.now() - started,
      ...(typeof d.confidence === "number" ? { confidence: d.confidence } : {}),
      ...(d.probabilities ? { probabilities: d.probabilities } : {}),
      ...(typeof d.usage?.inputTokens === "number" ? { inputTokens: d.usage.inputTokens } : {}),
      ...(typeof d.usage?.outputTokens === "number" ? { outputTokens: d.usage.outputTokens } : {}),
    };
  } catch (error) {
    return {
      agentId: agent.id,
      sampleId: sample.id,
      ...(sample.referenceAction ? { referenceAction: sample.referenceAction, isMatch: false } : {}),
      isLegal: false,
      latencyMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runAgent(agent: MahjongAgent, samples: DecisionSample[], concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  const records = new Array<DecisionRecord>(samples.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= samples.length) return;
      const sample = samples[i];
      if (!sample) return;
      records[i] = await decideOne(agent, sample);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, samples.length) }, () => worker()));
  return records;
}
