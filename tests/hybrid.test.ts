import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  collectHybridCalls,
  evaluateHybridSweep,
  evaluateHybridThresholds,
  readHybridSweepCache,
  writeHybridSweep,
} from "../src/benchmark/hybrid-sweep.js";
import { hybridGameDecision, parseHybridAgentSpec, runHybridDecision, validateHybridThreshold } from "../src/agents/hybrid.js";
import type { AgentDecision, DecisionSample, GameAction, GameDecisionInput } from "../src/types.js";

const sample: DecisionSample = {
  id: "sample",
  state: { round: "E1", hand: ["1m"] },
  legalActions: ["a", "b"],
  referenceAction: "b",
};

function decision(action: string, confidence?: number, inputTokens = 1, outputTokens = 1): AgentDecision {
  return {
    action,
    ...(confidence === undefined ? {} : { confidence }),
    usage: { inputTokens, outputTokens },
  };
}

describe("Hybrid decision", () => {
  it("parses explicit threshold agent names and keeps legacy hybrid spelling", () => {
    expect(parseHybridAgentSpec("hybrid")).toMatchObject({ explicitThreshold: false });
    expect(parseHybridAgentSpec("hybrid@0.30")).toMatchObject({ threshold: 0.3, explicitThreshold: true });
    expect(() => parseHybridAgentSpec("hybrid@1.1")).toThrow();
    expect(() => parseHybridAgentSpec("hybrid@not-a-number")).toThrow();
  });

  it("accepts only finite thresholds in the closed interval", () => {
    expect(validateHybridThreshold(0)).toBe(0);
    expect(validateHybridThreshold(1)).toBe(1);
    expect(() => validateHybridThreshold(-0.01)).toThrow();
    expect(() => validateHybridThreshold(Number.NaN)).toThrow();
    expect(() => validateHybridThreshold(1.01)).toThrow();
  });

  it("keeps Jev when confidence equals the threshold", async () => {
    let gptCalls = 0;
    const result = await runHybridDecision(sample, sample.legalActions, 0.75, {
      jev: async () => decision("a", 0.75),
      gpt: async () => { gptCalls += 1; return decision("b"); },
    });
    expect(result.action).toBe("a");
    expect(gptCalls).toBe(0);
    expect(result.metadata).toMatchObject({ hybrid: { escalated: false, finalSource: "jev", finalAction: "a" } });
  });

  it("exposes provider probabilities through the live trace only", async () => {
    let trace: unknown;
    const result = await runHybridDecision(sample, sample.legalActions, 0.75, {
      jev: async () => ({ ...decision("a", 0.9), probabilities: { a: 0.9, b: 0.1 } }),
      gpt: async () => decision("b"),
    }, undefined, (value) => { trace = value; });
    expect(trace).toMatchObject({ jev: { probabilities: { a: 0.9, b: 0.1 } }, finalSource: "jev" });
    expect(result.metadata?.hybrid).not.toHaveProperty("jev.probabilities");
  });

  it("escalates low, missing, non-finite, and illegal Jev decisions", async () => {
    for (const jev of [
      decision("a", 0.74),
      decision("a"),
      decision("a", Number.NaN),
      decision("illegal", 0.99),
    ]) {
      let gptCalls = 0;
      const result = await runHybridDecision(sample, sample.legalActions, 0.75, {
        jev: async () => jev,
        gpt: async () => { gptCalls += 1; return decision("b"); },
      });
      expect(result.action).toBe("b");
      expect(gptCalls).toBe(1);
      expect(result.metadata).toMatchObject({ hybrid: { escalated: true, finalSource: "gpt", finalAction: "b" } });
    }
  });

  it("falls back to a legal Jev action and sums usage when GPT fails", async () => {
    const result = await runHybridDecision(sample, sample.legalActions, 0.75, {
      jev: async () => decision("a", 0.1, 10, 2),
      gpt: async () => { throw new Error("GPT unavailable"); },
    });
    expect(result.action).toBe("a");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(result.metadata).toMatchObject({
      hybrid: { finalSource: "jev-fallback", gpt: { error: "GPT unavailable" } },
    });
  });

  it("preserves GPT retry metadata through a Jev fallback", async () => {
    const error = Object.assign(new Error("rate limited"), {
      metadata: { attempts: 3, retryCount: 2, totalBackoffMs: 500, statuses: [429, 429, 429] },
    });
    const result = await runHybridDecision(sample, sample.legalActions, 0.75, {
      jev: async () => decision("a", 0.1),
      gpt: async () => { throw error; },
    });
    expect(result.metadata).toMatchObject({
      hybrid: { finalSource: "jev-fallback", gpt: { metadata: error.metadata } },
    });
  });

  it("preserves both provider records when Hybrid fails completely", async () => {
    const gptError = Object.assign(new Error("rate limited"), {
      metadata: { attempts: 3, retryCount: 2, totalBackoffMs: 500, statuses: [503, 503, 503] },
    });
    const result = runHybridDecision(sample, sample.legalActions, 0.75, {
      jev: async () => decision("illegal", 0.9),
      gpt: async () => { throw gptError; },
    });
    await expect(result).rejects.toMatchObject({
      message: "Hybrid decision failed: rate limited",
      metadata: {
        hybrid: {
          finalSource: "error",
          jev: { action: "illegal" },
          gpt: { metadata: gptError.metadata, error: "rate limited" },
        },
      },
    });
  });

  it("preserves retry metadata when GPT aborts during Hybrid", async () => {
    const controller = new AbortController();
    const gptError = Object.assign(new Error("agent call aborted"), {
      name: "AbortError",
      metadata: { attempts: 2, retryCount: 1, totalBackoffMs: 500, statuses: [503, 503] },
    });
    const result = runHybridDecision(sample, sample.legalActions, 0.75, {
      jev: async () => decision("illegal", 0.9),
      gpt: async () => {
        controller.abort();
        throw gptError;
      },
    }, controller.signal);
    await expect(result).rejects.toMatchObject({
      name: "AbortError",
      message: "agent call aborted",
      metadata: { hybrid: { finalSource: "error", gpt: { metadata: gptError.metadata } } },
    });
  });

  it("rejects an aborted GPT call instead of returning a fallback", async () => {
    const controller = new AbortController();
    const promise = runHybridDecision(sample, sample.legalActions, 0.75, {
      jev: async () => decision("a", 0.1),
      gpt: async (_input, signal) => new Promise<AgentDecision>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        controller.abort();
      }),
    }, controller.signal);
    await expect(promise).rejects.toThrow(/aborted/);
  });

  it("passes one complete-game input and signal to both providers", async () => {
    const action: GameAction = { id: "a", type: "dahai", mjai: { type: "dahai", actor: 0, pai: "1m" } };
    const input: GameDecisionInput = { id: "game/0/0", state: sample.state, legalActions: [action] };
    let jevInput: GameDecisionInput | undefined;
    let gptInput: GameDecisionInput | undefined;
    let jevSignal: AbortSignal | undefined;
    let gptSignal: AbortSignal | undefined;
    const controller = new AbortController();
    await expect(hybridGameDecision(input, 0.75, {
      jev: { decide: async (value, signal) => { jevInput = value; jevSignal = signal; return decision("a", 0.1); } },
      gpt: { decide: async (value, signal) => { gptInput = value; gptSignal = signal; return decision("a"); } },
    }, controller.signal)).resolves.toMatchObject({ action: "a" });
    expect(jevInput).toBe(input);
    expect(gptInput).toBe(input);
    expect(jevSignal).toBe(controller.signal);
    expect(gptSignal).toBe(controller.signal);
  });
});

describe("Hybrid threshold sweep", () => {
  it("calls both providers once per sample and reuses both responses across thresholds", async () => {
    const samples = [
      { ...sample, id: "low" },
      { ...sample, id: "high" },
      { ...sample, id: "missing" },
    ];
    let jevCalls = 0;
    let gptCalls = 0;
    const result = await evaluateHybridSweep(samples, [0.5, 0.75], {
      jev: { decide: async (value) => {
        jevCalls += 1;
        if (value.id === "low") return decision("a", 0.5);
        if (value.id === "high") return decision("a", 0.8);
        return decision("a", Number.NaN);
      } },
      gpt: { decide: async () => {
        gptCalls += 1;
        return decision("b", undefined, 5, 2);
      } },
    });
    expect(jevCalls).toBe(samples.length);
    expect(gptCalls).toBe(samples.length);
    expect(result.gptBaseline).toMatchObject({
      samples: samples.length,
      referenceSamples: samples.length,
      agreementRate: 1,
      inputTokens: 15,
      outputTokens: 6,
    });
    expect(result.usage).toMatchObject({ sampleCount: 3, jevCalls: 3, gptCalls: 3, inputTokens: 18, outputTokens: 9 });
    expect(result.thresholdResults[0]).toMatchObject({ threshold: 0.5, escalated: 1 });
    expect(result.thresholdResults[1]).toMatchObject({ threshold: 0.75, escalated: 2 });
    expect(result.thresholdResults[0]).toMatchObject({ inputTokens: 8, outputTokens: 5 });
    expect(result.thresholdResults[1]).toMatchObject({ inputTokens: 13, outputTokens: 7 });
    expect(result.rawDecisions[0]?.thresholds["0.5"]).toMatchObject({ finalSource: "jev", finalAction: "a" });
    expect(result.rawDecisions[0]?.thresholds["0.75"]).toMatchObject({ finalSource: "gpt", finalAction: "b" });

    const out = await mkdtemp(join(tmpdir(), "jev-hybrid-sweep-"));
    await writeHybridSweep(out, result);
    expect(JSON.parse(await readFile(join(out, "hybrid-sweep.json"), "utf8")).agreementLabel).toBe("Reference agreement");
    expect(await readFile(join(out, "hybrid-sweep.md"), "utf8")).toContain("Hybrid threshold sweep");
    expect((await readFile(join(out, "decisions.jsonl"), "utf8")).trim().split("\n")).toHaveLength(3);
  });

  it("separates provider collection from cache-only threshold evaluation", async () => {
    const samples = [
      { ...sample, id: "cache-a" },
      { ...sample, id: "cache-b" },
    ];
    let jevCalls = 0;
    let gptCalls = 0;
    const cache = await collectHybridCalls(samples, {
      jev: { decide: async () => { jevCalls += 1; return decision("a", 0.5, 4, 2); } },
      gpt: { decide: async () => { gptCalls += 1; return decision("b", undefined, 8, 3); } },
    }, {
      models: {
        jev: { model: "jev-test", reasoningEffort: "default" },
        gpt: { model: "gpt-test", reasoningEffort: "low" },
      },
    });
    expect(jevCalls).toBe(2);
    expect(gptCalls).toBe(2);
    const result = evaluateHybridThresholds(samples, cache, [0.5, 0.75], {
      models: {
        jev: { model: "jev-test", reasoningEffort: "default" },
        gpt: { model: "gpt-test", reasoningEffort: "low" },
      },
    });
    expect(jevCalls).toBe(2);
    expect(gptCalls).toBe(2);
    expect(result.thresholdResults[0]).toMatchObject({
      finalSourceCounts: { jev: 2, gpt: 0, "jev-fallback": 0, error: 0 },
      jevInputTokens: 8,
      gptInputTokens: 0,
      totalTokens: 12,
    });
    expect(result.thresholdResults[1]).toMatchObject({
      finalSourceCounts: { jev: 0, gpt: 2, "jev-fallback": 0, error: 0 },
      jevInputTokens: 8,
      gptInputTokens: 16,
      totalTokens: 34,
    });
    expect(result.usage.physical).toMatchObject({ jevCalls: 2, gptCalls: 2, inputTokens: 24, outputTokens: 10 });
    expect(result.usage.estimatedByThreshold["0.5"]).toMatchObject({ jevCalls: 2, gptCalls: 0 });
    expect(result.cache?.calls).toHaveLength(2);

    const out = await mkdtemp(join(tmpdir(), "jev-hybrid-cache-"));
    await writeHybridSweep(out, result);
    const loaded = await readHybridSweepCache(join(out, "provider-calls.jsonl"));
    expect(loaded.datasetSha256).toBe(cache.datasetSha256);
    expect(loaded.calls[0]?.jev.confidence).toBe(0.5);
    expect(() => evaluateHybridThresholds(samples.map((item) => ({ ...item, legalActions: ["a", "b", "c"] })), cache, [0.5])).toThrow(/legal actions hash mismatch/);
    expect(() => evaluateHybridThresholds(samples, cache, [0.5], { datasetSha256: "wrong" })).toThrow(/dataset SHA-256 mismatch/);

    const rowWithChangedJevModel = {
      ...cache,
      calls: cache.calls.map((row, index) => index === 1
        ? { ...row, models: { ...row.models, jev: { ...row.models.jev, model: "jev-other" } } }
        : row),
    };
    expect(() => evaluateHybridThresholds(samples, rowWithChangedJevModel, [0.5])).toThrow(/row cache-b Jev model settings mismatch/);

    const rowWithChangedGptReasoning = {
      ...cache,
      calls: cache.calls.map((row, index) => index === 1
        ? { ...row, gptReasoningEffort: "high" }
        : row),
    };
    expect(() => evaluateHybridThresholds(samples, rowWithChangedGptReasoning, [0.5])).toThrow(/row cache-b GPT model aliases mismatch/);
  });

  it("separates valid Jev confidence distribution buckets and invalid categories", async () => {
    const confidences: Array<number | undefined> = [0, 0.1, 0.25, 0.5, 0.75, 1, undefined, Number.NaN, -0.1, 1.1];
    const samples = confidences.map((_, index) => ({ ...sample, id: `distribution-${index}` }));
    const cache = await collectHybridCalls(samples, {
      jev: { decide: async (value) => {
        const index = Number(value.id.split("-").at(-1));
        if (index === 9) return decision("illegal", confidences[index]!);
        const confidence = confidences[index!];
        return confidence === undefined ? decision("a") : decision("a", confidence);
      } },
      gpt: { decide: async () => decision("b") },
    });
    const result = evaluateHybridThresholds(samples, cache, [0.5]);
    expect(result.confidenceDistribution).toMatchObject({
      min: 0,
      median: 0.375,
      max: 1,
      validConfidenceCount: 6,
      missingConfidenceCount: 1,
      nonFiniteConfidenceCount: 1,
      outOfRangeConfidenceCount: 2,
      illegalJevActionCount: 1,
    });
    expect(result.confidenceDistribution.histogram["0.0-0.1"]).toBe(1);
    expect(result.confidenceDistribution.histogram["0.1-0.2"]).toBe(1);
    expect(Object.values(result.confidenceDistribution.histogram).reduce((sum, value) => sum + value, 0)).toBe(6);
  });
});
