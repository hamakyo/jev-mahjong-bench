import { describe, expect, it } from "vitest";
import { summarize } from "../src/benchmark/metrics.js";
import type { DecisionRecord } from "../src/types.js";

describe("summarize", () => {
  it("calculates core metrics", () => {
    const records: DecisionRecord[] = [
      { agentId:"x", sampleId:"a", action:"1m", referenceAction:"1m", isLegal:true, isMatch:true, latencyMs:10, confidence:0.8, probabilities:{"1m":0.8,"2m":0.2}, inputTokens:100, outputTokens:2 },
      { agentId:"x", sampleId:"b", action:"1m", referenceAction:"2m", isLegal:true, isMatch:false, latencyMs:30, confidence:0.6, probabilities:{"1m":0.6,"2m":0.4}, inputTokens:120, outputTokens:2 }
    ];
    const s = summarize("x", records);
    expect(s.successRate).toBe(1);
    expect(s.exactMatchRate).toBe(0.5);
    expect(s.meanLatencyMs).toBe(20);
    expect(s.p50LatencyMs).toBe(20);
    expect(s.inputTokens).toBe(220);
    expect(s.brierScore).toBeCloseTo(0.4);
    expect(s.referenceEce).toBeDefined();
  });

  it("counts errors as failures", () => {
    const s = summarize("x", [{ agentId:"x", sampleId:"a", referenceAction:"1m", isLegal:false, isMatch:false, latencyMs:50, error:"boom" }]);
    expect(s.successRate).toBe(0);
    expect(s.exactMatchRate).toBe(0);
  });

  it("uses decision count, not provider call count, for provider averages", () => {
    const providerCall = {
      providerId: "openai",
      modelId: "demo",
      model: "demo",
      endpointFamily: "test",
      canonicalInputBytes: 100,
      latencyMs: 1,
      logicalCallCount: 1 as const,
      httpAttemptCount: 1,
      retryCount: 0,
      usage: { inputTokens: 100, outputTokens: 10 },
    };
    const records: DecisionRecord[] = [
      { agentId: "hybrid", sampleId: "a", action: "x", isLegal: true, latencyMs: 1, providerCalls: [providerCall] },
      { agentId: "hybrid", sampleId: "b", action: "x", isLegal: true, latencyMs: 1 },
    ];
    const summary = summarize("hybrid", records);
    expect(summary.inputTokensPerDecision).toBe(50);
    expect(summary.outputTokensPerDecision).toBe(5);
    expect(summary.canonicalInputBytesPerDecision).toBe(50);
  });
});
