import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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

export interface DatasetSplitOptions {
  inputPath: string;
  calibrationOut: string;
  evaluationOut: string;
  ratio: number;
  seed: number;
  manifestPath: string;
}

export interface DatasetSplitManifest {
  version: 1;
  inputDatasetSha256: string;
  calibrationSha256: string;
  evaluationSha256: string;
  calibrationSampleCount: number;
  evaluationSampleCount: number;
  calibrationGameCount: number;
  evaluationGameCount: number;
  calibration: { samples: number; games: number };
  evaluation: { samples: number; games: number };
  seed: number;
  ratio: number;
  gameIdHashOverlap: boolean;
  gameIdHashOverlapCount: number;
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

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await readFile(path));
}

function splitRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
    state ^= state >>> 16;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function sampleGameKey(sample: DecisionSample): string {
  return sample.provenance
    ? `game/${sample.provenance.gameIdHash}`
    : `sample/${sample.id}`;
}

function gameHashes(samples: DecisionSample[]): Set<string> {
  return new Set(samples.flatMap((sample) => sample.provenance ? [sample.provenance.gameIdHash] : []));
}

function splitArgumentError(message: string): never {
  throw new Error(`dataset split ${message}`);
}

interface SplitPathIdentity {
  label: string;
  path: string;
  canonicalPath: string;
  device?: number;
  inode?: number;
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

/** Resolve a path through the nearest existing parent without creating anything. */
async function materializedPath(path: string): Promise<string> {
  const missingBasenames: string[] = [basename(path)];
  let parent = dirname(path);
  while (true) {
    try {
      const existingParent = await realpath(parent);
      return join(existingParent, ...missingBasenames);
    } catch (error) {
      if (!isMissingPath(error)) throw error;
      const nextParent = dirname(parent);
      if (nextParent === parent) return path;
      missingBasenames.unshift(basename(parent));
      parent = nextParent;
    }
  }
}

async function splitPathIdentity(label: string, path: string): Promise<SplitPathIdentity> {
  try {
    const [canonicalPath, fileStat] = await Promise.all([realpath(path), stat(path)]);
    return { label, path, canonicalPath, device: fileStat.dev, inode: fileStat.ino };
  } catch (error) {
    if (!isMissingPath(error)) throw error;
    return { label, path, canonicalPath: await materializedPath(path) };
  }
}

async function normalizedSplitPaths(options: DatasetSplitOptions): Promise<DatasetSplitOptions> {
  const normalized = {
    inputPath: resolve(options.inputPath),
    calibrationOut: resolve(options.calibrationOut),
    evaluationOut: resolve(options.evaluationOut),
    ratio: options.ratio,
    seed: options.seed,
    manifestPath: resolve(options.manifestPath),
  };
  const pathEntries = [
    ["dataset", normalized.inputPath],
    ["calibration output", normalized.calibrationOut],
    ["evaluation output", normalized.evaluationOut],
    ["manifest", normalized.manifestPath],
  ] as const;
  const identities = await Promise.all(pathEntries.map(([label, path]) => splitPathIdentity(label, path)));
  for (let leftIndex = 0; leftIndex < identities.length; leftIndex += 1) {
    const left = identities[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < identities.length; rightIndex += 1) {
      const right = identities[rightIndex]!;
      const sameMaterializedPath = left.canonicalPath === right.canonicalPath;
      const sameExistingFile = left.device !== undefined && left.inode !== undefined
        && left.device === right.device && left.inode === right.inode;
      if (sameMaterializedPath || sameExistingFile) {
        splitArgumentError(`${right.label} path overlaps ${left.label}: ${right.path}`);
      }
    }
  }
  return normalized;
}

/**
 * Deterministically split a JSONL dataset at the provenance game boundary.
 * Samples without provenance are isolated into one group each.
 */
export function splitDataset(options: DatasetSplitOptions): Promise<DatasetSplitManifest>;
export function splitDataset(
  inputPath: string,
  calibrationOut: string,
  evaluationOut: string,
  ratio: number,
  seed: number,
  manifestPath: string,
): Promise<DatasetSplitManifest>;
export async function splitDataset(
  optionsOrInput: DatasetSplitOptions | string,
  calibrationOut?: string,
  evaluationOut?: string,
  ratio?: number,
  seed?: number,
  manifestPath?: string,
): Promise<DatasetSplitManifest> {
  const options: DatasetSplitOptions = typeof optionsOrInput === "string"
    ? {
      inputPath: optionsOrInput,
      calibrationOut: calibrationOut ?? splitArgumentError("calibration output is required"),
      evaluationOut: evaluationOut ?? splitArgumentError("evaluation output is required"),
      ratio: ratio ?? splitArgumentError("ratio is required"),
      seed: seed ?? splitArgumentError("seed is required"),
      manifestPath: manifestPath ?? splitArgumentError("manifest path is required"),
    }
    : optionsOrInput;
  const normalized = await normalizedSplitPaths(options);
  if (!Number.isFinite(normalized.ratio) || normalized.ratio <= 0 || normalized.ratio >= 1) {
    splitArgumentError("ratio must be a finite number between 0 and 1");
  }
  if (!Number.isInteger(normalized.seed)) splitArgumentError("seed must be an integer");
  const inputBytes = await readFile(normalized.inputPath);
  const { samples } = await readDatasetSamples(normalized.inputPath);
  const groups = new Map<string, DecisionSample[]>();
  for (const sample of samples) {
    const key = sampleGameKey(sample);
    const current = groups.get(key) ?? [];
    current.push(sample);
    groups.set(key, current);
  }
  if (groups.size < 2) splitArgumentError("requires at least two game groups");

  const shuffled = [...groups.keys()].sort();
  const random = splitRandom(normalized.seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  const calibrationGroupCount = Math.min(
    shuffled.length - 1,
    Math.max(1, Math.floor(shuffled.length * normalized.ratio)),
  );
  const calibrationKeys = new Set(shuffled.slice(0, calibrationGroupCount));
  const calibration = samples.filter((sample) => calibrationKeys.has(sampleGameKey(sample)));
  const evaluation = samples.filter((sample) => !calibrationKeys.has(sampleGameKey(sample)));
  await Promise.all([
    writeSamples(normalized.calibrationOut, calibration),
    writeSamples(normalized.evaluationOut, evaluation),
  ]);
  const calibrationSha256 = await sha256File(options.calibrationOut);
  const evaluationSha256 = await sha256File(options.evaluationOut);
  const calibrationHashes = gameHashes(calibration);
  const evaluationHashes = gameHashes(evaluation);
  const overlapCount = [...calibrationHashes].filter((hash) => evaluationHashes.has(hash)).length;
  const manifest: DatasetSplitManifest = {
    version: 1,
    inputDatasetSha256: sha256Bytes(inputBytes),
    calibrationSha256,
    evaluationSha256,
    calibrationSampleCount: calibration.length,
    evaluationSampleCount: evaluation.length,
    calibrationGameCount: new Set(calibration.map(sampleGameKey)).size,
    evaluationGameCount: new Set(evaluation.map(sampleGameKey)).size,
    calibration: { samples: calibration.length, games: new Set(calibration.map(sampleGameKey)).size },
    evaluation: { samples: evaluation.length, games: new Set(evaluation.map(sampleGameKey)).size },
    seed: normalized.seed,
    ratio: normalized.ratio,
    gameIdHashOverlap: overlapCount > 0,
    gameIdHashOverlapCount: overlapCount,
  };
  await mkdir(dirname(normalized.manifestPath), { recursive: true });
  await writeFile(normalized.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
