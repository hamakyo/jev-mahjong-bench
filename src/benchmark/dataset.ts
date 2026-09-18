import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import type { DecisionSample, MahjongState, MjaiEvent, ReferencePolicy, SampleProvenance } from "../types.js";
import { assertMpszTile } from "../mjai/tiles.js";

const gunzipAsync = promisify(gunzip);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((x) => typeof x !== "string")) {
    throw new Error(`${field} must be a non-empty string array`);
  }
}

function optionalEvents(value: unknown, field: string): MjaiEvent[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((x) =>
    typeof x !== "string" && (!record(x) || typeof x.type !== "string"))) {
    throw new Error(`${field} must contain MJAI JSON strings or objects when present`);
  }
  return value as MjaiEvent[];
}

function parseProvenance(value: unknown, prefix: string): SampleProvenance | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new Error(`${prefix}provenance must be an object`);
  if (value.platform !== "tenhou" && value.platform !== "majsoul") {
    throw new Error(`${prefix}provenance.platform must be tenhou or majsoul`);
  }
  if (typeof value.gameIdHash !== "string" || !/^[0-9a-f]{64}$/.test(value.gameIdHash)) {
    throw new Error(`${prefix}provenance.gameIdHash must be a SHA-256 hex string`);
  }
  for (const field of ["handIndex", "eventIndex", "seat"] as const) {
    if (!Number.isInteger(value[field]) || (value[field] as number) < 0 || (field === "seat" && (value[field] as number) > 3)) {
      throw new Error(`${prefix}provenance.${field} must be a non-negative integer`);
    }
  }
  return {
    platform: value.platform,
    gameIdHash: value.gameIdHash,
    handIndex: value.handIndex as number,
    eventIndex: value.eventIndex as number,
    seat: value.seat as number,
  };
}

function parseReferenceMetadata(value: unknown, prefix: string): ReferencePolicy | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || typeof value.name !== "string" || !value.name) {
    throw new Error(`${prefix}referenceMetadata.name must be a non-empty string`);
  }
  if (value.version !== undefined && typeof value.version !== "string") {
    throw new Error(`${prefix}referenceMetadata.version must be a string when present`);
  }
  if (value.modelSha256 !== undefined &&
      (typeof value.modelSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.modelSha256))) {
    throw new Error(`${prefix}referenceMetadata.modelSha256 must be a SHA-256 hex string`);
  }
  if (value.config !== undefined && !record(value.config)) {
    throw new Error(`${prefix}referenceMetadata.config must be an object when present`);
  }
  return {
    name: value.name,
    ...(typeof value.version === "string" ? { version: value.version } : {}),
    ...(typeof value.modelSha256 === "string" ? { modelSha256: value.modelSha256 } : {}),
    ...(record(value.config) ? { config: value.config } : {}),
  };
}

export function parseDecisionSample(value: unknown, line?: number): DecisionSample {
  const p = line ? `line ${line}: ` : "";
  if (!record(value)) throw new Error(`${p}sample must be an object`);
  if (typeof value.id !== "string" || !value.id) throw new Error(`${p}id must be a non-empty string`);
  if (!record(value.state)) throw new Error(`${p}state must be an object`);
  if (typeof value.state.round !== "string") throw new Error(`${p}state.round must be a string`);
  stringArray(value.state.hand, `${p}state.hand`);
  stringArray(value.legalActions, `${p}legalActions`);

  if (value.state.tileEncoding !== undefined && value.state.tileEncoding !== "mpsz") {
    throw new Error(`${p}state.tileEncoding must be mpsz when present`);
  }
  const mpszFields = [
    [value.state.hand, `${p}state.hand`],
    [value.legalActions, `${p}legalActions`],
  ] as const;
  for (const [tiles, field] of mpszFields) {
    for (const tile of tiles) {
      try { assertMpszTile(tile); } catch { throw new Error(`${field} contains invalid mpsz tile "${tile}"`); }
    }
  }
  const optionalTileArrays: Array<[unknown, string]> = [
    [value.state.doraIndicators, `${p}state.doraIndicators`],
    [value.state.melds && Object.values(value.state.melds).flat(), `${p}state.melds`],
    [value.state.discards && Object.values(value.state.discards).flat(), `${p}state.discards`],
  ];
  for (const [tiles, field] of optionalTileArrays) {
    if (tiles === undefined) continue;
    if (!Array.isArray(tiles) || tiles.some((tile) => typeof tile !== "string")) throw new Error(`${field} must contain strings`);
    for (const tile of tiles) {
      try { assertMpszTile(tile as string); } catch { throw new Error(`${field} contains invalid mpsz tile "${tile}"`); }
    }
  }
  if (value.state.drawnTile !== undefined && typeof value.state.drawnTile !== "string") {
    throw new Error(`${p}state.drawnTile must be a string when present`);
  }
  if (typeof value.state.drawnTile === "string") {
    try { assertMpszTile(value.state.drawnTile); } catch { throw new Error(`${p}state.drawnTile contains an invalid mpsz tile`); }
  }

  const legal = new Set(value.legalActions);
  if (legal.size !== value.legalActions.length) throw new Error(`${p}legalActions must not contain duplicates`);
  if (value.referenceAction !== undefined && typeof value.referenceAction !== "string") {
    throw new Error(`${p}referenceAction must be a string when present`);
  }
  if (typeof value.referenceAction === "string" && !legal.has(value.referenceAction)) {
    throw new Error(`${p}referenceAction must be a legal action`);
  }
  if (value.observedAction !== undefined && typeof value.observedAction !== "string") {
    throw new Error(`${p}observedAction must be a string when present`);
  }
  if (typeof value.observedAction === "string" && !legal.has(value.observedAction)) {
    throw new Error(`${p}observedAction must be a legal action`);
  }
  const mjaiEvents = optionalEvents(value.state.mjaiEvents, `${p}state.mjaiEvents`);
  for (const [i, event] of (mjaiEvents ?? []).entries()) {
    try {
      const parsed = typeof event === "string" ? JSON.parse(event) as unknown : event;
      if (!record(parsed) || typeof parsed.type !== "string") throw new Error("not an MJAI event");
    } catch {
      throw new Error(`${p}state.mjaiEvents[${i}] must be a JSON MJAI event`);
    }
  }
  const provenance = parseProvenance(value.provenance, p);
  const referenceMetadata = parseReferenceMetadata(value.referenceMetadata, p);
  if (referenceMetadata && typeof value.referenceAction !== "string") {
    throw new Error(`${p}referenceMetadata requires referenceAction`);
  }

  return {
    id: value.id,
    state: value.state as unknown as MahjongState,
    legalActions: value.legalActions,
    ...(value.state.tileEncoding === "mpsz" ? { state: { ...(value.state as unknown as MahjongState), tileEncoding: "mpsz" as const } } : {}),
    ...(typeof value.observedAction === "string" ? { observedAction: value.observedAction } : {}),
    ...(typeof value.referenceAction === "string" ? { referenceAction: value.referenceAction } : {}),
    ...(provenance ? { provenance } : {}),
    ...(referenceMetadata ? { referenceMetadata } : {}),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(Array.isArray(value.tags) && value.tags.every((x) => typeof x === "string")
      ? { tags: value.tags as string[] } : {}),
  };
}

export async function loadDataset(path: string): Promise<DecisionSample[]> {
  const bytes = await readFile(path);
  const text = path.toLowerCase().endsWith(".gz") ? (await gunzipAsync(bytes)).toString("utf8") : bytes.toString("utf8");
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error(`Dataset is empty: ${path}`);
  const ids = new Set<string>();
  return lines.map((text, i) => {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error(`line ${i + 1}: invalid JSON`); }
    const sample = parseDecisionSample(raw, i + 1);
    if (ids.has(sample.id)) throw new Error(`line ${i + 1}: duplicate id "${sample.id}"`);
    ids.add(sample.id);
    return sample;
  });
}
