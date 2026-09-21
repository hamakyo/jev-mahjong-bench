import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseDecisionSample } from "../src/benchmark/dataset.js";
import { splitDataset, writeSamples } from "../src/benchmark/dataset-tools.js";

describe("parseDecisionSample", () => {
  it("accepts a valid sample", () => {
    const s = parseDecisionSample({ id: "x", state: { round: "E1", hand: ["1m"] }, legalActions: ["1m"], referenceAction: "1m" });
    expect(s.referenceAction).toBe("1m");
  });
  it("rejects an illegal reference", () => {
    expect(() => parseDecisionSample({ id: "x", state: { round: "E1", hand: ["1m"] }, legalActions: ["1m"], referenceAction: "2m" }))
      .toThrow(/referenceAction must be a legal action/);
  });
  it("rejects duplicate legal actions", () => {
    expect(() => parseDecisionSample({ id: "x", state: { round: "E1", hand: ["1m"] }, legalActions: ["1m", "1m"] }))
      .toThrow(/must not contain duplicates/);
  });

  it("accepts replay provenance and observed red discard", () => {
    const s = parseDecisionSample({
      id: "replay-1",
      state: {
        round: "E1",
        seat: "E",
        hand: ["0m", "5p"],
        tileEncoding: "mpsz",
        mjaiEvents: ["{\"type\":\"tsumo\"}"],
      },
      legalActions: ["0m", "5p"],
      observedAction: "0m",
      provenance: {
        platform: "tenhou",
        gameIdHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        handIndex: 0,
        eventIndex: 1,
        seat: 0,
      },
    });
    expect(s.observedAction).toBe("0m");
    expect(s.provenance?.platform).toBe("tenhou");
  });

  it("splits by gameIdHash deterministically and records hashes", async () => {
    const out = await mkdtemp(join(tmpdir(), "jev-dataset-split-"));
    const samples = ["a", "b", "c", "d"].map((id, index) => parseDecisionSample({
      id,
      state: { round: "E1", hand: ["1m"] },
      legalActions: ["1m", "2m"],
      provenance: {
        platform: "tenhou",
        gameIdHash: String.fromCharCode(97 + Math.floor(index / 2)).repeat(64),
        handIndex: index % 2,
        eventIndex: index,
        seat: 0,
      },
    }));
    const input = join(out, "input.jsonl");
    const calibration = join(out, "calibration.jsonl");
    const evaluation = join(out, "evaluation.jsonl");
    const manifestPath = join(out, "split.json");
    await writeSamples(input, samples);
    const first = await splitDataset({
      inputPath: input,
      calibrationOut: calibration,
      evaluationOut: evaluation,
      ratio: 0.5,
      seed: 42,
      manifestPath,
    });
    const calibrationText = await readFile(calibration, "utf8");
    const evaluationText = await readFile(evaluation, "utf8");
    const second = await splitDataset({
      inputPath: input,
      calibrationOut: calibration,
      evaluationOut: evaluation,
      ratio: 0.5,
      seed: 42,
      manifestPath,
    });
    expect(first).toEqual(second);
    expect(calibrationText).toBe(await readFile(calibration, "utf8"));
    expect(evaluationText).toBe(await readFile(evaluation, "utf8"));
    expect(first).toMatchObject({
      calibrationSampleCount: 2,
      evaluationSampleCount: 2,
      calibrationGameCount: 1,
      evaluationGameCount: 1,
      gameIdHashOverlap: false,
      gameIdHashOverlapCount: 0,
    });
  });
});
