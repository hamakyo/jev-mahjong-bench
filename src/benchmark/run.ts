import { performance } from "node:perf_hooks";
import type { MahjongAgent } from "../agents/agent.js";
import type { DecisionRecord, DecisionSample } from "../types.js";
import { ProviderRequestError, type ProviderCallRecord } from "../providers/types.js";

function isProviderCallRecord(value: unknown): value is ProviderCallRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const call = value as Record<string, unknown>;
  return typeof call.providerId === "string"
    && typeof call.modelId === "string"
    && typeof call.model === "string"
    && typeof call.endpointFamily === "string"
    && typeof call.canonicalInputBytes === "number"
    && typeof call.latencyMs === "number"
    && call.logicalCallCount === 1
    && typeof call.httpAttemptCount === "number"
    && typeof call.retryCount === "number";
}

function providerCallsFromError(error: unknown): ProviderCallRecord[] | undefined {
  if (error instanceof ProviderRequestError) return [structuredClone(error.providerCall)];
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const raw = error as Record<string, unknown>;
  if (isProviderCallRecord(raw.providerCall)) return [structuredClone(raw.providerCall)];

  // Hybrid failures are ordinary Errors, but their metadata contains the
  // call records for the providers that actually ran for this decision.
  const metadata = raw.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const hybrid = (metadata as Record<string, unknown>).hybrid;
  if (!hybrid || typeof hybrid !== "object" || Array.isArray(hybrid)) return undefined;
  const calls: ProviderCallRecord[] = [];
  for (const provider of ["jev", "gpt"] as const) {
    const record = (hybrid as Record<string, unknown>)[provider];
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const providerCalls = (record as Record<string, unknown>).providerCalls;
    if (!Array.isArray(providerCalls)) continue;
    for (const call of providerCalls) if (isProviderCallRecord(call)) calls.push(structuredClone(call));
  }
  return calls.length ? calls : undefined;
}

async function decideOne(agent: MahjongAgent, sample: DecisionSample): Promise<DecisionRecord> {
  const started = performance.now();
  try {
    const d = await agent.decide(sample);
    const providerCalls = d.providerCalls?.map((call) => structuredClone(call));
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
      ...(d.normalizedUsage ? { normalizedUsage: d.normalizedUsage } : {}),
      ...(providerCalls ? { providerCalls } : {}),
      ...(providerCalls?.[0] ? { canonicalInputBytes: providerCalls[0].canonicalInputBytes } : {}),
      ...(d.metadata ? { metadata: d.metadata } : {}),
    };
  } catch (error) {
    const providerCalls = providerCallsFromError(error);
    const usage = providerCalls?.flatMap((call) => call.usage ? [call.usage] : [])[0];
    return {
      agentId: agent.id,
      sampleId: sample.id,
      ...(sample.referenceAction ? { referenceAction: sample.referenceAction, isMatch: false } : {}),
      isLegal: false,
      latencyMs: performance.now() - started,
      ...(providerCalls ? { providerCalls } : {}),
      ...(providerCalls?.[0] ? { canonicalInputBytes: providerCalls[0].canonicalInputBytes } : {}),
      ...(typeof usage?.inputTokens === "number" ? { inputTokens: usage.inputTokens } : {}),
      ...(typeof usage?.outputTokens === "number" ? { outputTokens: usage.outputTokens } : {}),
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
