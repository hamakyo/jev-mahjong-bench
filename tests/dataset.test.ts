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
});
