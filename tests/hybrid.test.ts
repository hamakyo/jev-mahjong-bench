import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { evaluateHybridSweep, writeHybridSweep } from "../src/benchmark/hybrid-sweep.js";
import { hybridGameDecision, runHybridDecision, validateHybridThreshold } from "../src/agents/hybrid.js";
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
});
