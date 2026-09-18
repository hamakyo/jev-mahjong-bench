import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DecisionSample } from "../types.js";
import { parseDecisionSample } from "./dataset.js";
import { canonicalJson } from "../mjai/tiles.js";

function linesOf(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function readText(path: string): Promise<string> {
  const bytes = await readFile(path);
  if (path.toLowerCase().endsWith(".gz")) {
    // Keep gzip support dependency-free while retaining a useful error message.
    const { gunzipSync } = await import("node:zlib");
    return gunzipSync(bytes).toString("utf8");
  }
  return bytes.toString("utf8");
}

export interface DatasetStats {
  samples: number;
  games: number;
  hands: number;
  duplicateCount: number;
  referenceCount: number;
  referenceRate: number;
  byPlatform: Record<string, number>;
  bySeat: Record<string, number>;
  byRound: Record<string, number>;
  legalActionCount: { min: number; max: number; mean: number; distribution: Record<string, number> };
  referencePolicies: Record<string, number>;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function sortedRecord(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

export async function readDatasetSamples(path: string, allowDuplicateIds = false): Promise<{ samples: DecisionSample[]; duplicateCount: number }> {
  const parsed: DecisionSample[] = [];
  const ids = new Set<string>();
  let duplicateCount = 0;
  for (const [index, text] of linesOf(await readText(path)).entries()) {
    let value: unknown;
    try { value = JSON.parse(text) as unknown; } catch { throw new Error(`line ${index + 1}: invalid JSON`); }
    const sample = parseDecisionSample(value, index + 1);
    if (ids.has(sample.id)) {
      duplicateCount += 1;
      if (!allowDuplicateIds) throw new Error(`line ${index + 1}: duplicate id "${sample.id}"`);
    }
    ids.add(sample.id);
    parsed.push(sample);
  }
  if (!parsed.length) throw new Error(`Dataset is empty: ${path}`);
  return { samples: parsed, duplicateCount };
}

export async function validateDataset(path: string): Promise<{ samples: number; references: number }> {
  const { samples } = await readDatasetSamples(path);
  const knownTypes = new Set([
    "start_game", "start_kyoku", "tsumo", "dahai", "chi", "pon", "daiminkan", "ankan", "kakan",
    "reach", "reach_accepted", "riichi", "dora", "hora", "ryukyoku", "end_kyoku", "end_game", "kita", "none",
  ]);
  for (const [index, sample] of samples.entries()) {
    if (sample.observedAction !== undefined && !sample.legalActions.includes(sample.observedAction)) {
      throw new Error(`sample ${index + 1} (${sample.id}): observedAction is not legal`);
    }
    for (const [eventIndex, eventText] of (sample.state.mjaiEvents ?? []).entries()) {
      const event = (typeof eventText === "string" ? JSON.parse(eventText) : eventText) as Record<string, unknown>;
      if (!knownTypes.has(String(event.type))) {
        throw new Error(`sample ${sample.id}: unknown MJAI event type at ${eventIndex}: ${String(event.type)}`);
      }
    }
    if (sample.provenance && sample.provenance.seat > 3) {
      throw new Error(`sample ${sample.id}: seat must be in 0..3`);
    }
  }
  return {
    samples: samples.length,
    references: samples.filter((sample) => sample.referenceAction !== undefined).length,
  };
}

export async function datasetStats(path: string): Promise<DatasetStats> {
  const { samples, duplicateCount } = await readDatasetSamples(path, true);
  const games = new Set<string>();
  const hands = new Set<string>();
  const byPlatform: Record<string, number> = {};
  const bySeat: Record<string, number> = {};
  const byRound: Record<string, number> = {};
  const distribution: Record<string, number> = {};
  const referencePolicies: Record<string, number> = {};
  const counts: number[] = [];
  for (const sample of samples) {
    const p = sample.provenance;
    if (p) {
      games.add(`${p.platform}/${p.gameIdHash}`);
      hands.add(`${p.platform}/${p.gameIdHash}/${p.handIndex}`);
      increment(byPlatform, p.platform);
      increment(bySeat, String(p.seat));
    } else {
      increment(byPlatform, "unknown");
      increment(bySeat, "unknown");
    }
    increment(byRound, sample.state.round);
    const count = sample.legalActions.length;
    counts.push(count);
    increment(distribution, String(count));
    if (sample.referenceMetadata) increment(referencePolicies, sample.referenceMetadata.name);
  }
  const total = counts.reduce((sum, value) => sum + value, 0);
  return {
    samples: samples.length,
    games: games.size,
    hands: hands.size,
    duplicateCount,
    referenceCount: samples.filter((sample) => sample.referenceAction !== undefined).length,
    referenceRate: samples.length ? samples.filter((sample) => sample.referenceAction !== undefined).length / samples.length : 0,
    byPlatform: sortedRecord(byPlatform),
    bySeat: sortedRecord(bySeat),
    byRound: sortedRecord(byRound),
    legalActionCount: {
      min: Math.min(...counts),
      max: Math.max(...counts),
      mean: total / counts.length,
      distribution: sortedRecord(distribution),
    },
    referencePolicies: sortedRecord(referencePolicies),
  };
}

export async function writeStats(path: string, stats: DatasetStats): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(stats, null, 2)}\n`);
}

export async function writeSamples(path: string, samples: DecisionSample[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const output = samples.map((sample) => canonicalJson(sample)).join("\n") + "\n";
  await writeFile(path, output);
}
