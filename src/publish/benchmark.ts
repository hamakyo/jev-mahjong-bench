import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { RunRecord, RunStore, RunType } from "../server/run-store.js";

const execFileAsync = promisify(execFile);
const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECRET_KEY = /(?:api.?key|secret|password|authorization|headers?|access.?token|refresh.?token)/i;
const SECRET_VALUE = /(?:\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{10,}|\bAKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const SAFE_CONFIG_KEYS = [
  "agents", "seats", "games", "pairedRuns", "mode", "rule", "seed", "seatPolicy", "timeoutMs",
  "dataset", "concurrency", "thresholds", "hybridThreshold", "hybridFallback", "models", "pricing", "mortalConfig",
] as const;

export interface PublishedDataset {
  path: string;
  sha256: string;
}

export interface PublishedModel {
  id: string;
  model: string;
  provider?: string;
  reasoningEffort?: string;
}

export interface PublishedBenchmarkManifest {
  schemaVersion: 1;
  id: string;
  date: string;
  sourceRunId: string;
  benchmarkCommit: string;
  configHash: string;
  runType: RunType;
  category: string;
  slug: string;
  dataset?: PublishedDataset;
  agents: string[];
  models: PublishedModel[];
  configuration: Record<string, unknown>;
  rawArtifacts: { included: false; policy: "external-release-or-actions-artifact" };
}

export interface PublishedBenchmark {
  path: string;
  manifest: PublishedBenchmarkManifest;
  summary: Record<string, unknown>;
}

export interface PublishBenchmarkOptions {
  projectRoot: string;
  store: RunStore;
  runId: string;
  category?: string;
  slug?: string;
  benchmarkCommit?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function assertSafeName(value: string, label: string): string {
  if (!SAFE_NAME.test(value)) throw new Error(`${label} must contain lowercase letters, numbers, and single hyphens only`);
  return value;
}

function assertNoSecrets(value: unknown, path = "config"): void {
  if (typeof value === "string" && SECRET_VALUE.test(value)) throw new Error(`refusing to publish a secret-bearing value at ${path}`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    if (SECRET_KEY.test(key)) throw new Error(`refusing to publish secret-bearing field ${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function safeConfiguration(projectRoot: string, config: Record<string, unknown>): Record<string, unknown> {
  assertNoSecrets(config);
  const root = resolve(projectRoot);
  return Object.fromEntries(SAFE_CONFIG_KEYS.flatMap((key) => {
    const value = config[key];
    if (value === undefined) return [];
    if ((key === "dataset" || key === "models" || key === "pricing" || key === "mortalConfig") && typeof value === "string") {
      const pathFromRoot = relative(root, resolve(root, value));
      if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error(`${key} must be inside the project root before publishing`);
      return [[key, pathFromRoot.split("\\").join("/")]];
    }
    return [[key, structuredClone(value)]];
  }));
}

function defaultAgents(run: RunRecord, result: unknown): string[] {
  const configured = run.type === "tournament" ? run.config.seats : run.config.agents;
  if (Array.isArray(configured)) return [...new Set(configured.filter((value): value is string => typeof value === "string"))];
  if (run.type === "hybrid-sweep") {
    const thresholds = record(result)?.thresholdResults;
    if (Array.isArray(thresholds)) return thresholds.flatMap((item) => {
      const threshold = record(item)?.threshold;
      return typeof threshold === "number" ? [`hybrid@${threshold}`] : [];
    });
  }
  return [];
}

function modelRow(value: unknown, fallbackId: string): PublishedModel | undefined {
  const source = record(value);
  if (!source || typeof source.model !== "string") return undefined;
  const id = typeof source.id === "string" ? source.id : fallbackId;
  return {
    id,
    model: source.model,
    ...(typeof source.provider === "string" ? { provider: source.provider } : {}),
    ...(typeof source.reasoningEffort === "string" ? { reasoningEffort: source.reasoningEffort } : {}),
  };
}

function safeModels(run: RunRecord, result: unknown): PublishedModel[] {
  const root = record(result);
  const metadata = record(root?.metadata);
  const models = record(root?.models);
  const registryModels = Array.isArray(record(root?.models)?.registryModels)
    ? record(root?.models)?.registryModels
    : metadata?.registryModels;
  const rows: PublishedModel[] = [];
  if (Array.isArray(registryModels)) {
    for (const item of registryModels) {
      const row = modelRow(item, "model");
      if (row) rows.push(row);
    }
  }
  if (models) {
    for (const [id, value] of Object.entries(models)) {
      const row = modelRow(value, id);
      if (row) rows.push(row);
    }
  }
  if (run.type === "benchmark" && metadata) {
    const openai = typeof metadata.openaiModel === "string" ? metadata.openaiModel : undefined;
    if (openai) rows.push({ id: "gpt", model: openai, ...(typeof metadata.openaiReasoningEffort === "string" ? { reasoningEffort: metadata.openaiReasoningEffort } : {}) });
  }
  const unique = new Map<string, PublishedModel>();
  for (const row of rows) unique.set(row.id, { ...unique.get(row.id), ...row });
  return [...unique.values()];
}

function aggregateSummary(type: RunType, result: unknown): Record<string, unknown> {
  const root = record(result);
  if (!root) throw new Error("completed run does not have a canonical result");
  if (type === "tournament") {
    const metrics = record(root.metrics);
    if (!metrics) throw new Error("tournament result does not contain aggregate metrics");
    return { schemaVersion: 1, runType: type, metrics: structuredClone(metrics) };
  }
  if (type === "benchmark") {
    if (!Array.isArray(root.summaries)) throw new Error("benchmark result does not contain aggregate summaries");
    return {
      schemaVersion: 1,
      runType: type,
      ...(typeof root.referenceLabel === "string" ? { referenceLabel: root.referenceLabel } : {}),
      ...(Array.isArray(root.referencePolicies) ? { referencePolicies: structuredClone(root.referencePolicies) } : {}),
      summaries: structuredClone(root.summaries),
    };
  }
  if (!Array.isArray(root.thresholdResults)) throw new Error("Hybrid sweep result does not contain threshold results");
  return {
    schemaVersion: 1,
    runType: type,
    ...(typeof root.totalSamples === "number" ? { totalSamples: root.totalSamples } : {}),
    ...(typeof root.agreementLabel === "string" ? { agreementLabel: root.agreementLabel } : {}),
    ...(record(root.jevBaseline) ? { jevBaseline: structuredClone(root.jevBaseline) } : {}),
    ...(record(root.gptBaseline) ? { gptBaseline: structuredClone(root.gptBaseline) } : {}),
    thresholdResults: structuredClone(root.thresholdResults),
    ...(Array.isArray(root.paretoThresholds) ? { paretoThresholds: structuredClone(root.paretoThresholds) } : {}),
  };
}

function markdownTable(type: RunType, summary: Record<string, unknown>): string {
  const rows = type === "tournament" ? record(summary.metrics)?.agents : type === "benchmark" ? summary.summaries : summary.thresholdResults;
  if (!Array.isArray(rows) || !rows.length) return "No aggregate rows were available.";
  const preferred = type === "tournament"
    ? ["agentId", "games", "meanScore", "meanRank", "winRate", "dealInRate", "p95LatencyMs", "fallbackRate"]
    : type === "benchmark"
      ? ["agentId", "decisions", "legalActionRate", "exactMatchRate", "p50LatencyMs", "p95LatencyMs", "totalTokensPerDecision"]
      : ["threshold", "agreementRate", "legalRate", "escalationRate", "estimatedP50LatencyMs", "estimatedP95LatencyMs", "fallbackRate"];
  const headers = preferred.filter((key) => rows.some((row) => record(row)?.[key] !== undefined));
  const cell = (value: unknown): string => typeof value === "number" ? String(Math.round(value * 1_000_000) / 1_000_000) : typeof value === "string" ? value.replaceAll("|", "\\|") : "—";
  return `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n${rows.map((row) => `| ${headers.map((key) => cell(record(row)?.[key])).join(" | ")} |`).join("\n")}`;
}

function renderReport(manifest: PublishedBenchmarkManifest, summary: Record<string, unknown>): string {
  const dataset = manifest.dataset ? `${manifest.dataset.path} (SHA-256: \`${manifest.dataset.sha256}\`)` : "Not configured";
  return `# ${manifest.slug}\n\n## Setup\n\n- Date: ${manifest.date}\n- Run type: ${manifest.runType}\n- Source run: \`${manifest.sourceRunId}\`\n- Benchmark commit: \`${manifest.benchmarkCommit}\`\n- Configuration SHA-256: \`${manifest.configHash}\`\n- Dataset: ${dataset}\n- Agents: ${manifest.agents.length ? manifest.agents.map((agent) => `\`${agent}\``).join(", ") : "Not recorded"}\n\n## Experiment configuration\n\n\`\`\`json\n${JSON.stringify(manifest.configuration, null, 2)}\n\`\`\`\n\n## Aggregate results\n\n${markdownTable(manifest.runType, summary)}\n\n## Methodology and limitations\n\nThis record contains aggregate metrics from the canonical completed run. Raw decisions, games, replay data, provider responses, logs, caches, and video are intentionally excluded from Git. Reference agreement is a comparison target, not absolute mahjong accuracy. Interpret small samples and provider-dependent runs with appropriate uncertainty.\n`;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function datasetFor(projectRoot: string, config: Record<string, unknown>): Promise<PublishedDataset | undefined> {
  if (typeof config.dataset !== "string") return undefined;
  const root = resolve(projectRoot);
  const target = resolve(root, config.dataset);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) throw new Error("dataset must be inside the project root before publishing");
  const details = await stat(target);
  if (!details.isFile()) throw new Error("configured dataset is not a file");
  return { path: pathFromRoot.split("\\").join("/"), sha256: await sha256(target) };
}

async function gitCommit(projectRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", projectRoot, "rev-parse", "HEAD"]);
  const commit = stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("could not resolve the benchmark commit SHA");
  return commit;
}

export function defaultPublicationDescriptor(run: RunRecord): { category: string; slug: string } {
  if (run.type === "hybrid-sweep") return { category: "hybrid", slug: "hybrid-calibration" };
  const configured = run.type === "tournament" ? run.config.seats : run.config.agents;
  const agents = Array.isArray(configured) ? [...new Set(configured.filter((value): value is string => typeof value === "string"))] : [];
  const names = agents.map((agent) => agent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter(Boolean).slice(0, 4);
  return run.type === "tournament"
    ? { category: "tournaments", slug: names.length ? names.join("-vs-") : "tournament" }
    : { category: "decisions", slug: names.length ? names.join("-vs-") : "decision-benchmark" };
}

export async function publishBenchmark(options: PublishBenchmarkOptions): Promise<PublishedBenchmark> {
  const projectRoot = resolve(options.projectRoot);
  const run = await options.store.get(options.runId);
  if (run.status !== "completed") throw new Error("only completed runs can be published");
  const result = await options.store.result(run.id);
  const defaults = defaultPublicationDescriptor(run);
  const category = assertSafeName(options.category ?? defaults.category, "category");
  const slug = assertSafeName(options.slug ?? defaults.slug, "slug");
  const date = (run.finishedAt ?? run.createdAt).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("run does not have a valid publication date");
  const configuration = safeConfiguration(projectRoot, run.config);
  const summary = aggregateSummary(run.type, result);
  const dataset = await datasetFor(projectRoot, run.config);
  const agents = defaultAgents(run, result);
  const models = safeModels(run, result);
  assertNoSecrets({ agents, models }, "manifest");
  const manifest: PublishedBenchmarkManifest = {
    schemaVersion: 1,
    id: `${slug}-${date.replaceAll("-", "")}-${run.configHash.slice(0, 6)}`,
    date,
    sourceRunId: run.id,
    benchmarkCommit: run.benchmarkCommit ?? options.benchmarkCommit ?? await gitCommit(projectRoot),
    configHash: run.configHash,
    runType: run.type,
    category,
    slug,
    ...(dataset ? { dataset } : {}),
    agents,
    models,
    configuration,
    rawArtifacts: { included: false, policy: "external-release-or-actions-artifact" },
  };
  const relativePath = `benchmarks/${category}/${date}-${slug}-${run.configHash.slice(0, 6)}`;
  const target = join(projectRoot, relativePath);
  try {
    const existing = JSON.parse(await readFile(join(target, "manifest.json"), "utf8")) as PublishedBenchmarkManifest;
    if (existing.sourceRunId !== run.id || existing.configHash !== run.configHash) throw new Error(`publication path already belongs to run ${existing.sourceRunId}`);
    return { path: relativePath, manifest: existing, summary: JSON.parse(await readFile(join(target, "summary.json"), "utf8")) as Record<string, unknown> };
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  const categoryRoot = join(projectRoot, "benchmarks", category);
  await mkdir(categoryRoot, { recursive: true });
  const staging = join(categoryRoot, `.${basename(target)}.${randomUUID()}.tmp`);
  await mkdir(staging);
  try {
    await Promise.all([
      writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
      writeFile(join(staging, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`),
      writeFile(join(staging, "report.md"), renderReport(manifest, summary)),
    ]);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { path: relativePath, manifest, summary };
}

export async function listPublishedBenchmarks(projectRoot: string): Promise<PublishedBenchmark[]> {
  const benchmarksRoot = join(resolve(projectRoot), "benchmarks");
  const published: PublishedBenchmark[] = [];
  let categories;
  try {
    categories = await readdir(benchmarksRoot, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  for (const category of categories) {
    if (!category.isDirectory() || category.name.startsWith(".")) continue;
    for (const entry of await readdir(join(benchmarksRoot, category.name), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const directory = join(benchmarksRoot, category.name, entry.name);
      try {
        const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as PublishedBenchmarkManifest;
        const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8")) as Record<string, unknown>;
        await readFile(join(directory, "report.md"), "utf8");
        if (manifest.schemaVersion !== 1 || manifest.category !== category.name) continue;
        published.push({ path: `benchmarks/${category.name}/${entry.name}`, manifest, summary });
      } catch {
        // Incomplete or manually managed directories are not published records.
      }
    }
  }
  return published.sort((left, right) => right.manifest.date.localeCompare(left.manifest.date) || left.manifest.id.localeCompare(right.manifest.id));
}
