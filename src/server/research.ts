import type { RunRecord, RunType } from "./run-store.js";

export type ComparisonCategory = "gameplay" | "decision-quality" | "efficiency";
export type ComparisonFormat = "number" | "percent" | "milliseconds" | "usd";

export interface ComparisonMetric {
  key: string;
  category: ComparisonCategory;
  format: ComparisonFormat;
}

export interface ComparisonColumn {
  runId: string;
  configHash: string;
  createdAt: string;
  entityId: string;
  values: Record<string, number | null>;
}

export interface RunComparison {
  runType: RunType;
  metrics: ComparisonMetric[];
  columns: ComparisonColumn[];
}

export interface ResearchSnapshot extends RunComparison {
  runId: string;
  createdAt: string;
}

export interface ComparisonInput {
  run: RunRecord;
  result: unknown;
}

const metrics: Record<RunType, ComparisonMetric[]> = {
  tournament: [
    { key: "games", category: "gameplay", format: "number" },
    { key: "meanScore", category: "gameplay", format: "number" },
    { key: "meanRank", category: "gameplay", format: "number" },
    { key: "firstRate", category: "gameplay", format: "percent" },
    { key: "fourthRate", category: "gameplay", format: "percent" },
    { key: "winRate", category: "gameplay", format: "percent" },
    { key: "dealInRate", category: "gameplay", format: "percent" },
    { key: "riichiRate", category: "gameplay", format: "percent" },
    { key: "callRate", category: "gameplay", format: "percent" },
    { key: "p50LatencyMs", category: "efficiency", format: "milliseconds" },
    { key: "p95LatencyMs", category: "efficiency", format: "milliseconds" },
    { key: "totalTokensPerDecision", category: "efficiency", format: "number" },
    { key: "costPerDecisionUsd", category: "efficiency", format: "usd" },
    { key: "escalationRate", category: "efficiency", format: "percent" },
    { key: "fallbackRate", category: "efficiency", format: "percent" },
    { key: "errorRate", category: "efficiency", format: "percent" },
  ],
  benchmark: [
    { key: "decisions", category: "decision-quality", format: "number" },
    { key: "successRate", category: "decision-quality", format: "percent" },
    { key: "legalActionRate", category: "decision-quality", format: "percent" },
    { key: "exactMatchRate", category: "decision-quality", format: "percent" },
    { key: "referenceEce", category: "decision-quality", format: "number" },
    { key: "brierScore", category: "decision-quality", format: "number" },
    { key: "p50LatencyMs", category: "efficiency", format: "milliseconds" },
    { key: "p95LatencyMs", category: "efficiency", format: "milliseconds" },
    { key: "totalTokensPerDecision", category: "efficiency", format: "number" },
    { key: "costPerDecisionUsd", category: "efficiency", format: "usd" },
  ],
  "hybrid-sweep": [
    { key: "agreementRate", category: "decision-quality", format: "percent" },
    { key: "legalRate", category: "decision-quality", format: "percent" },
    { key: "escalationRate", category: "efficiency", format: "percent" },
    { key: "estimatedP50LatencyMs", category: "efficiency", format: "milliseconds" },
    { key: "estimatedP95LatencyMs", category: "efficiency", format: "milliseconds" },
    { key: "estimatedTotalTokens", category: "efficiency", format: "number" },
    { key: "estimatedGptCost", category: "efficiency", format: "usd" },
    { key: "fallbackRate", category: "efficiency", format: "percent" },
    { key: "errorRate", category: "efficiency", format: "percent" },
  ],
};

const headlineMetricKeys: Record<RunType, string[]> = {
  tournament: ["meanRank", "meanScore", "p95LatencyMs", "fallbackRate"],
  benchmark: ["legalActionRate", "exactMatchRate", "p95LatencyMs", "totalTokensPerDecision"],
  "hybrid-sweep": ["agreementRate", "escalationRate", "estimatedP95LatencyMs", "fallbackRate"],
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function rows(type: RunType, result: unknown): Array<{ entityId: string; source: Record<string, unknown> }> {
  const root = record(result);
  if (!root) return [];
  const candidates = type === "tournament"
    ? record(root.metrics)?.agents
    : type === "benchmark" ? root.summaries : root.thresholdResults;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    const source = record(candidate);
    if (!source) return [];
    const rawId = type === "hybrid-sweep" ? `hybrid@${String(source.threshold ?? "unknown")}` : source.agentId;
    return typeof rawId === "string" ? [{ entityId: rawId, source }] : [];
  });
}

function metricValue(source: Record<string, unknown>, key: string): number | null {
  const raw = key === "estimatedTotalTokens" ? record(source.estimatedUsage)?.totalTokens : source[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function columnsFor(input: ComparisonInput, definitions: ComparisonMetric[]): ComparisonColumn[] {
  return rows(input.run.type, input.result).map(({ entityId, source }) => ({
    runId: input.run.id,
    configHash: input.run.configHash,
    createdAt: input.run.createdAt,
    entityId,
    values: Object.fromEntries(definitions.map(({ key }) => [key, metricValue(source, key)])),
  }));
}

export function buildRunComparison(inputs: ComparisonInput[]): RunComparison {
  if (inputs.length < 2) throw new Error("select at least two runs to compare");
  if (inputs.length > 8) throw new Error("compare supports at most eight runs");
  const runType = inputs[0]!.run.type;
  if (inputs.some(({ run }) => run.type !== runType)) throw new Error("selected runs must have the same run type");
  if (inputs.some(({ run }) => run.status !== "completed")) throw new Error("only completed runs can be compared");
  const definitions = metrics[runType];
  const columns = inputs.flatMap((input) => columnsFor(input, definitions));
  if (!columns.length) throw new Error("selected runs do not have comparable canonical results");
  return { runType, metrics: definitions, columns };
}

export function buildResearchSnapshots(inputs: ComparisonInput[]): ResearchSnapshot[] {
  const seen = new Set<RunType>();
  const snapshots: ResearchSnapshot[] = [];
  for (const input of inputs) {
    if (input.run.status !== "completed" || seen.has(input.run.type)) continue;
    const definitions = metrics[input.run.type].filter(({ key }) => headlineMetricKeys[input.run.type].includes(key));
    const columns = columnsFor(input, definitions);
    if (!columns.length) continue;
    snapshots.push({
      runId: input.run.id,
      createdAt: input.run.createdAt,
      runType: input.run.type,
      metrics: definitions,
      columns,
    });
    seen.add(input.run.type);
  }
  return snapshots;
}
