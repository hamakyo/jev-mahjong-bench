import type { AgentSummary, DecisionRecord } from "../types.js";
import type { ProviderCallRecord } from "../providers/types.js";
import { costPerDecisionUsd, type PricingSnapshot } from "../providers/pricing.js";

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
function percentile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  const a = s[lo] ?? 0, b = s[hi] ?? a;
  return lo === hi ? a : a + (b - a) * (i - lo);
}
function ece(records: DecisionRecord[], bins = 10): number | undefined {
  const rs = records.filter((r): r is DecisionRecord & { confidence: number; isMatch: boolean } =>
    typeof r.confidence === "number" && typeof r.isMatch === "boolean");
  if (!rs.length) return undefined;
  let total = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const low = bin / bins, high = (bin + 1) / bins;
    const group = rs.filter((r) => {
      const c = Math.max(0, Math.min(1, r.confidence));
      return bin === bins - 1 ? c >= low && c <= high : c >= low && c < high;
    });
    if (!group.length) continue;
    total += (group.length / rs.length) *
      Math.abs(mean(group.map((r) => r.isMatch ? 1 : 0)) - mean(group.map((r) => r.confidence)));
  }
  return total;
}
function brier(records: DecisionRecord[]): number | undefined {
  const scores: number[] = [];
  for (const r of records) {
    if (!r.referenceAction || !r.probabilities) continue;
    const entries = Object.entries(r.probabilities);
    if (!entries.length) continue;
    let s = entries.reduce((acc, [a, p]) => acc + (p - (a === r.referenceAction ? 1 : 0)) ** 2, 0);
    if (!(r.referenceAction in r.probabilities)) s += 1;
    scores.push(s);
  }
  return scores.length ? mean(scores) : undefined;
}

export function summarize(agentId: string, records: DecisionRecord[], pricing?: PricingSnapshot): AgentSummary {
  const successes = records.filter((r) => !r.error).length;
  const refs = records.filter((r) => typeof r.referenceAction === "string");
  const matches = refs.filter((r) => r.isMatch === true).length;
  const conf = records.flatMap((r) => typeof r.confidence === "number" ? [r.confidence] : []);
  const out: AgentSummary = {
    agentId,
    decisions: records.length,
    successes,
    successRate: records.length ? successes / records.length : 0,
    legalActionRate: records.length ? records.filter((r) => r.isLegal).length / records.length : 0,
    referenceCount: refs.length,
    exactMatches: matches,
    meanLatencyMs: mean(records.map((r) => r.latencyMs)),
    p50LatencyMs: percentile(records.map((r) => r.latencyMs), 0.5),
    p95LatencyMs: percentile(records.map((r) => r.latencyMs), 0.95),
    inputTokens: records.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
    outputTokens: records.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
  };
  const providerCalls: ProviderCallRecord[] = records.flatMap((record) => record.providerCalls ?? []);
  if (providerCalls.length) {
    const usageReported = providerCalls.filter((call) => call.usage !== undefined);
    const sumField = (field: "inputTokens" | "outputTokens" | "totalTokens" | "cachedInputTokens" | "reasoningTokens"): number | undefined => {
      const values = providerCalls.flatMap((call) => typeof call.usage?.[field] === "number" ? [call.usage[field]!] : []);
      return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
    };
    const input = sumField("inputTokens");
    const output = sumField("outputTokens");
    const total = sumField("totalTokens");
    const cached = sumField("cachedInputTokens");
    const reasoning = sumField("reasoningTokens");
    const providerLatencies = providerCalls.map((call) => call.latencyMs);
    const canonicalBytes = providerCalls.map((call) => call.canonicalInputBytes);
    out.providerDecisionCount = providerCalls.length;
    out.modelDecisionCount = providerCalls.reduce((sum, call) => sum + call.logicalCallCount, 0);
    out.usageReportedDecisionCount = usageReported.length;
    out.latencyP50Ms = percentile(providerLatencies, 0.5);
    out.latencyP95Ms = percentile(providerLatencies, 0.95);
    if (records.length) out.canonicalInputBytesPerDecision = canonicalBytes.reduce((sum, value) => sum + value, 0) / records.length;
    if (pricing) {
      const cost = costPerDecisionUsd(providerCalls, pricing, records.length);
      if (cost !== undefined) out.costPerDecisionUsd = cost;
    }
    if (input !== undefined) {
      out.inputTokens = input;
      if (records.length) out.inputTokensPerDecision = input / records.length;
    }
    if (output !== undefined) {
      out.outputTokens = output;
      if (records.length) out.outputTokensPerDecision = output / records.length;
    }
    if (total !== undefined) {
      out.totalTokens = total;
      if (records.length) out.totalTokensPerDecision = total / records.length;
    }
    if (cached !== undefined) {
      out.cachedInputTokens = cached;
      if (records.length) out.cachedInputTokensPerDecision = cached / records.length;
    }
    if (reasoning !== undefined) {
      out.reasoningTokens = reasoning;
      if (records.length) out.reasoningTokensPerDecision = reasoning / records.length;
    }
  }
  if (refs.length) out.exactMatchRate = matches / refs.length;
  if (conf.length) out.averageConfidence = mean(conf);
  const calibration = ece(records); if (calibration !== undefined) out.referenceEce = calibration;
  const bs = brier(records); if (bs !== undefined) out.brierScore = bs;
  return out;
}
