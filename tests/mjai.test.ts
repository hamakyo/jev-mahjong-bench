import { describe, expect, it } from "vitest";
import { assertMpszTile, mjaiToMpsz, mpszToMjai, riichiTileToMpsz } from "../src/mjai/tiles.js";

describe("MJAI/mpsz boundary", () => {
  it("normalizes honors and red tiles", () => {
    expect(mjaiToMpsz("E")).toBe("1z");
    expect(mjaiToMpsz("5mr")).toBe("0m");
    expect(mpszToMjai("0p")).toBe("5pr");
  });

  it("converts RiichiEnv tile ids", () => {
    expect(riichiTileToMpsz(16)).toBe("0m");
    expect(riichiTileToMpsz(17)).toBe("5m");
    expect(riichiTileToMpsz(108)).toBe("1z");
  });

  it("rejects impossible honor tiles", () => {
    expect(() => assertMpszTile("8z")).toThrow(/Invalid mpsz tile/);
    expect(() => assertMpszTile("9z")).toThrow(/Invalid mpsz tile/);
  });
});
