import { createHash } from "node:crypto";

const HONORS: Record<string, string> = {
  E: "1z",
  S: "2z",
  W: "3z",
  N: "4z",
  P: "5z",
  F: "6z",
  C: "7z",
};

const MPSZ_HONORS: Record<string, string> = Object.fromEntries(
  Object.entries(HONORS).map(([mjai, mpsz]) => [mpsz, mjai]),
);

export const TILE_RE = /^(?:[0-9][mps]|[1-7]z)$/;

export function assertMpszTile(tile: string): string {
  if (!TILE_RE.test(tile) || (tile[0] === "0" && tile[1] === "z")) {
    throw new Error(`Invalid mpsz tile: ${tile}`);
  }
  return tile;
}

/** Convert a single MJAI tile to the public mpsz representation. */
export function mjaiToMpsz(tile: string): string {
  if (tile in HONORS) return HONORS[tile]!;
  const match = /^(\d)([mpsz])r?$/.exec(tile);
  if (!match) {
    if (TILE_RE.test(tile)) return tile;
    throw new Error(`Invalid MJAI tile: ${tile}`);
  }
  const [, number, suit] = match;
  if (suit === "z") {
    if (!/^[1-7]$/.test(number!)) throw new Error(`Invalid honor tile: ${tile}`);
    return `${number}z`;
  }
  return `${number === "5" && tile.endsWith("r") ? "0" : number}${suit}`;
}

/** Convert a public mpsz tile to the spelling accepted by MJAI/RiichiEnv. */
export function mpszToMjai(tile: string): string {
  assertMpszTile(tile);
  if (tile in MPSZ_HONORS) return MPSZ_HONORS[tile]!;
  const number = tile[0]!;
  const suit = tile[1]!;
  if (number === "0") return `5${suit}r`;
  return tile;
}

/** Convert RiichiEnv's internal 0..135 tile id to mpsz. */
export function riichiTileToMpsz(tile: number): string {
  if (!Number.isInteger(tile) || tile < 0 || tile >= 136) {
    throw new Error(`Invalid RiichiEnv tile id: ${tile}`);
  }
  const kind = Math.floor(tile / 4);
  if (kind >= 34) throw new Error(`Invalid RiichiEnv tile kind: ${tile}`);
  if (kind >= 27) return `${kind - 26}z`;
  const suit = kind < 9 ? "m" : kind < 18 ? "p" : "s";
  const number = (kind % 9) + 1;
  if (number === 5 && tile % 4 === 0) return `0${suit}`;
  return `${number}${suit}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

export function stableSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function normalizeMortalAction(value: unknown): string {
  if (typeof value === "string") return mjaiToMpsz(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Mortal response is not an MJAI object");
  }
  const obj = value as Record<string, unknown>;
  if (obj.type !== "dahai" || typeof obj.pai !== "string") {
    throw new Error("Mortal response is not a discard action");
  }
  return mjaiToMpsz(obj.pai);
}
