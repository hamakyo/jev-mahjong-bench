import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const TILE_ASSET_SOURCE = "https://github.com/FluffyStuff/riichi-mahjong-tiles";
export const TILE_ASSET_LICENSE = "Public domain / CC0 1.0";

const SUITS = ["m", "p", "s"] as const;
const HONORS = ["Ton", "Nan", "Shaa", "Pei", "Haku", "Hatsu", "Chun"] as const;
const MJAI_HONOR_ASSETS = {
  E: "Ton.svg",
  S: "Nan.svg",
  W: "Shaa.svg",
  N: "Pei.svg",
  P: "Haku.svg",
  F: "Hatsu.svg",
  C: "Chun.svg",
} as const;
export const MJAI_HONOR_SORT_VALUES = {
  E: 31,
  S: 32,
  W: 33,
  N: 34,
  P: 35,
  F: 36,
  C: 37,
} as const;
const HONOR_ASSETS_BY_MPSZ = Object.fromEntries(
  HONORS.map((asset, index) => [`${index + 1}z`, `${asset}.svg`]),
) as Record<string, string>;

export const TILE_ASSET_FILENAMES = [
  "Back.svg",
  "Blank.svg",
  ...SUITS.flatMap((suit) => Array.from({ length: 9 }, (_, index) => `${suit === "m" ? "Man" : suit === "p" ? "Pin" : "Sou"}${index + 1}.svg`)),
  ...SUITS.map((suit) => `${suit === "m" ? "Man" : suit === "p" ? "Pin" : "Sou"}5-Dora.svg`),
  ...HONORS.map((honor) => `${honor}.svg`),
] as const;

export type TileAssetFilename = typeof TILE_ASSET_FILENAMES[number];

const TILE_ASSET_SET = new Set<string>(TILE_ASSET_FILENAMES);
const ASSET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "assets", "tiles");

function normalizedTile(value: string): { rank: number; suit: "m" | "p" | "s" } | undefined {
  const match = /^(0|[1-9])([mps])(?:r)?$/.exec(value.trim());
  if (!match) return undefined;
  const rank = Number(match[1]);
  if (!Number.isInteger(rank)) return undefined;
  const suit = match[2] as "m" | "p" | "s";
  return { rank, suit };
}

export function tileAssetFilename(value: unknown): TileAssetFilename {
  if (typeof value !== "string") return "Blank.svg";
  const normalized = value.trim().toUpperCase();
  const mjaiHonor = MJAI_HONOR_ASSETS[normalized as keyof typeof MJAI_HONOR_ASSETS];
  if (mjaiHonor) return mjaiHonor;
  const tile = normalizedTile(value);
  if (tile) {
    const prefix = tile.suit === "m" ? "Man" : tile.suit === "p" ? "Pin" : "Sou";
    const red = tile.rank === 0 || /r$/.test(value.trim());
    const filename = `${prefix}${red ? "5-Dora" : tile.rank}.svg`;
    if (TILE_ASSET_SET.has(filename)) return filename as TileAssetFilename;
  }
  const mpszHonor = HONOR_ASSETS_BY_MPSZ[value.trim().toLowerCase()];
  if (mpszHonor) return mpszHonor as TileAssetFilename;
  return "Blank.svg";
}

export function tileAssetPath(filename: string): string | undefined {
  return TILE_ASSET_SET.has(filename) ? join(ASSET_ROOT, filename) : undefined;
}

export const tileCatalogRuntimeJs = String.raw`
  const mjaiHonorAssets = ${JSON.stringify(MJAI_HONOR_ASSETS)};
  const mpszHonorAssets = ${JSON.stringify(HONOR_ASSETS_BY_MPSZ)};
  const mjaiHonorSortValues = ${JSON.stringify(MJAI_HONOR_SORT_VALUES)};
  const tileAssetFilename = (value) => {
    const text = String(value ?? '').trim();
    const normalized = text.toUpperCase();
    if (mjaiHonorAssets[normalized]) return mjaiHonorAssets[normalized];
    const match = /^(0|[1-9])([mps])(?:r)?$/.exec(text);
    if (match) {
      const prefix = match[2] === 'm' ? 'Man' : match[2] === 'p' ? 'Pin' : 'Sou';
      return prefix + ((match[1] === '0' || /r$/.test(text)) ? '5-Dora' : match[1]) + '.svg';
    }
    if (mpszHonorAssets[text.toLowerCase()]) return mpszHonorAssets[text.toLowerCase()];
    return 'Blank.svg';
  };
  const tileAssetUrl = (value) => '/assets/tiles/' + encodeURIComponent(tileAssetFilename(value));
`;
