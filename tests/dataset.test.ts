import { describe, expect, it } from "vitest";
import { parseDecisionSample } from "../src/benchmark/dataset.js";

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
});
