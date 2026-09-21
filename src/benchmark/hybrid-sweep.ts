import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { AgentDecision, DecisionSample, TokenUsage } from "../types.js";
import { stableSha256 } from "../mjai/tiles.js";
import { validateHybridThreshold } from "../agents/hybrid.js";

export const HYBRID_SWEEP_CACHE_SCHEMA_VERSION = 1;
export const DEFAULT_HYBRID_THRESHOLDS = [0.20, 0.25, 0.30, 0.35, 0.40, 0.50] as const;

export type HybridSweepFinalSource = "jev" | "gpt" | "jev-fallback" | "error";
export type HybridConfidenceStatus = "valid" | "missing" | "non-finite" | "out-of-range";

export interface HybridSweepProviderMetadata {
  model: string;
  reasoningEffort: string;
}

export interface HybridSweepProvider {
  decide(sample: DecisionSample): Promise<AgentDecision>;
}

interface ProviderCall {
  decision?: AgentDecision;
  latencyMs: number;
  usage: TokenUsage;
  error?: string;
}

export interface HybridSweepProviderCall {
  action?: string;
  confidence?: number | null;
  confidenceStatus?: HybridConfidenceStatus;
  latencyMs: number;
  usage: TokenUsage;
  legal: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface HybridSweepCacheRow {
  cacheSchemaVersion: number;
  datasetSha256: string;
  sampleId: string;
  legalActionsHash: string;
  referenceAction?: string;
  models: {
    jev: HybridSweepProviderMetadata;
    gpt: HybridSweepProviderMetadata;
  };
  jevModel: string;
  jevReasoningEffort: string;
  gptModel: string;
  gptReasoningEffort: string;
  jev: HybridSweepProviderCall;
  gpt: HybridSweepProviderCall;
}

export interface HybridSweepCache {
  cacheSchemaVersion: number;
  /** Kept as an alias for consumers that call the field schemaVersion. */
  schemaVersion: number;
  datasetSha256: string;
  models: {
    jev: HybridSweepProviderMetadata;
    gpt: HybridSweepProviderMetadata;
  };
  jevModel: string;
  jevReasoningEffort: string;
  gptModel: string;
  gptReasoningEffort: string;
  calls: HybridSweepCacheRow[];
  /** Aliases make the in-memory cache convenient without changing the JSONL shape. */
  rows: HybridSweepCacheRow[];
  samples: HybridSweepCacheRow[];
}

export interface HybridSweepCollectionOptions {
  datasetSha256?: string;
  models?: Partial<{
    jev: Partial<HybridSweepProviderMetadata>;
    gpt: Partial<HybridSweepProviderMetadata>;
  }>;
}

export interface HybridSweepCacheValidationOptions {
  datasetSha256?: string;
  models?: Partial<{
    jev: Partial<HybridSweepProviderMetadata>;
    gpt: Partial<HybridSweepProviderMetadata>;
  }>;
}

export interface HybridSweepCostRates {
  gptInputPer1kTokens?: number;
  gptOutputPer1kTokens?: number;
}

export interface HybridSweepEvaluationOptions extends HybridSweepCacheValidationOptions {
  cost?: HybridSweepCostRates;
  gptInputPer1kTokens?: number;
  gptOutputPer1kTokens?: number;
  /** Direct aliases are accepted for CLI and programmatic callers. */
  gptInputCostPer1kTokens?: number;
  gptOutputCostPer1kTokens?: number;
}

export interface HybridSweepPolicySummary {
  policy: string;
  samples: number;
  referenceSamples: number;
  agreements: number;
  agreementRate?: number;
  legalActions: number;
  legalRate: number;
  escalated: number;
  escalationRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokensPerSample: number;
  outputTokensPerSample: number;
}

export interface HybridSweepUsageBreakdown {
  sampleCount: number;
  jevCalls: number;
  gptCalls: number;
  jevInputTokens: number;
  jevOutputTokens: number;
  gptInputTokens: number;
  gptOutputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface HybridSweepUsage extends HybridSweepUsageBreakdown {
  /** Physical provider calls captured in the cache. */
  physical: HybridSweepUsageBreakdown;
  /** Estimated usage if each threshold were run in production. */
  estimatedByThreshold: Record<string, HybridSweepUsageBreakdown>;
  /** Alias with a more explicit name for downstream report consumers. */
  estimatedUsageByThreshold: Record<string, HybridSweepUsageBreakdown>;
}

export interface HybridSweepThresholdResult extends HybridSweepPolicySummary {
  threshold: number;
  referenceAgreement?: number;
  finalSourceCounts: Record<HybridSweepFinalSource, number>;
  finalSources: Record<HybridSweepFinalSource, number>;
  escalationReasonCounts: Record<string, number>;
  escalationReasons: Record<string, number>;
  jevFinalCount: number;
  gptFinalCount: number;
  jevFallbackCount: number;
  fallbackCount: number;
  fallbackRate: number;
  errorCount: number;
  errorRate: number;
  estimatedP50LatencyMs: number;
  estimatedP95LatencyMs: number;
  jevInputTokens: number;
  jevOutputTokens: number;
  gptInputTokens: number;
  gptOutputTokens: number;
  providerTokens: {
    jevInputTokens: number;
    jevOutputTokens: number;
    gptInputTokens: number;
    gptOutputTokens: number;
    totalTokens: number;
  };
  estimatedUsage: HybridSweepUsageBreakdown;
  gptCost?: number;
  estimatedGptCost?: number;
}

export interface HybridSweepConfidenceDistribution {
  min: number | null;
  p10: number | null;
  p25: number | null;
  median: number | null;
  mean: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  max: number | null;
  validConfidenceCount: number;
  validCount: number;
  effectiveCount: number;
  missingConfidenceCount: number;
  missing: number;
  nonFiniteConfidenceCount: number;
  nonFinite: number;
  outOfRangeConfidenceCount: number;
  outOfRange: number;
  illegalJevActionCount: number;
  illegalActions: number;
  /** Ranges are [lower, upper), except the final range which includes 1.0. */
  histogram: Record<string, number>;
  histogramBins: Array<{ lower: number; upper: number; count: number }>;
}

export interface HybridSweepRawDecision {
  sampleId: string;
  referenceAction?: string;
  jev: HybridSweepProviderCall;
  gpt: HybridSweepProviderCall;
  thresholds: Record<string, {
    finalAction?: string;
    finalSource: HybridSweepFinalSource;
    escalated: boolean;
    escalationReason?: string;
    isLegal: boolean;
    isMatch?: boolean;
    latencyMs: number;
    usage: TokenUsage;
  }>;
}

export interface HybridSweepResult {
  thresholds: number[];
  totalSamples: number;
  datasetSha256: string;
  cacheSchemaVersion: number;
  models: HybridSweepCache["models"];
  agreementLabel: "Mortal agreement" | "Reference agreement";
  confidenceDistribution: HybridSweepConfidenceDistribution;
  jevBaseline: HybridSweepPolicySummary;
  gptBaseline: HybridSweepPolicySummary;
  thresholdResults: HybridSweepThresholdResult[];
  paretoFrontier: HybridSweepThresholdResult[];
  paretoThresholds: number[];
  gptCostRates?: HybridSweepCostRates;
  usage: HybridSweepUsage;
  rawDecisions: HybridSweepRawDecision[];
  /** Present for writeHybridSweep; not copied into hybrid-sweep.json. */
  cache?: HybridSweepCache;
}

interface EvaluationRow {
  action?: string;
  legal: boolean;
  referenceAction?: string;
  latencyMs: number;
  usage: TokenUsage;
  jevUsage: TokenUsage;
  gptUsage: TokenUsage;
  escalated: boolean;
  source: HybridSweepFinalSource;
  escalationReason?: string;
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function usage(value: TokenUsage | undefined): TokenUsage {
  return {
    ...(typeof value?.inputTokens === "number" ? { inputTokens: value.inputTokens } : {}),
    ...(typeof value?.outputTokens === "number" ? { outputTokens: value.outputTokens } : {}),
  };
}

function sumUsage(left: TokenUsage | undefined, right: TokenUsage | undefined): TokenUsage {
  return {
    inputTokens: (left?.inputTokens ?? 0) + (right?.inputTokens ?? 0),
    outputTokens: (left?.outputTokens ?? 0) + (right?.outputTokens ?? 0),
  };
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return lower === upper ? low : low + (high - low) * (position - lower);
}

function normalizeThresholds(values: number[]): number[] {
  if (!values.length) throw new Error("at least one hybrid threshold is required");
  return [...new Set(values.map(validateHybridThreshold))].sort((left, right) => left - right);
}

function defaultProviderMetadata(kind: "jev" | "gpt"): HybridSweepProviderMetadata {
  return kind === "jev"
    ? {
      model: process.env.TYPESAFE_MODEL ?? "system-one",
      reasoningEffort: process.env.TYPESAFE_REASONING_EFFORT ?? "default",
    }
    : {
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      reasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "none",
    };
}

function providerMetadata(
  provider: HybridSweepProvider,
  kind: "jev" | "gpt",
  override: Partial<HybridSweepProviderMetadata> | undefined,
): HybridSweepProviderMetadata {
  const fallback = defaultProviderMetadata(kind);
  return {
    model: override?.model ?? fallback.model,
    reasoningEffort: override?.reasoningEffort ?? fallback.reasoningEffort,
  };
}

function confidenceStatus(value: number | null | undefined): HybridConfidenceStatus {
  if (typeof value !== "number") return "missing";
  if (!Number.isFinite(value)) return "non-finite";
  if (value < 0 || value > 1) return "out-of-range";
  return "valid";
}

function callConfidence(call: ProviderCall | HybridSweepProviderCall): number | null | undefined {
  if (Object.prototype.hasOwnProperty.call(call, "decision")) {
    const decision = (call as ProviderCall).decision;
    return typeof decision?.confidence === "number" ? decision.confidence : undefined;
  }
  return (call as HybridSweepProviderCall).confidence;
}

function callAction(call: ProviderCall | HybridSweepProviderCall): string | undefined {
  if (Object.prototype.hasOwnProperty.call(call, "decision")) {
    const decision = (call as ProviderCall).decision;
    return typeof decision?.action === "string" ? decision.action : undefined;
  }
  return (call as HybridSweepProviderCall).action;
}

function legalAction(call: ProviderCall | HybridSweepProviderCall, sample: DecisionSample): boolean {
  const action = callAction(call);
  return typeof action === "string" && sample.legalActions.includes(action);
}

function statusFor(call: ProviderCall | HybridSweepProviderCall): HybridConfidenceStatus {
  if ("confidenceStatus" in call && call.confidenceStatus) return call.confidenceStatus;
  return confidenceStatus(callConfidence(call));
}

function validConfidence(call: ProviderCall | HybridSweepProviderCall, sample: DecisionSample): boolean {
  return legalAction(call, sample) && statusFor(call) === "valid";
}

function confidenceValue(call: ProviderCall | HybridSweepProviderCall): number | null | undefined {
  const value = callConfidence(call);
  if (typeof value !== "number") return undefined;
  return value;
}

function jevEscalationReason(call: ProviderCall | HybridSweepProviderCall, sample: DecisionSample): string | undefined {
  if (call.error) return "jev-error";
  if (!legalAction(call, sample)) return "illegal-jev-action";
  if (statusFor(call) === "missing") return "missing-confidence";
  if (statusFor(call) !== "valid") return "invalid-confidence";
  return undefined;
}

async function callProvider(provider: HybridSweepProvider, sample: DecisionSample): Promise<ProviderCall> {
  const started = performance.now();
  try {
    const decision = await provider.decide(sample);
    return {
      decision,
      latencyMs: performance.now() - started,
      usage: usage(decision.usage),
    };
  } catch (error) {
    return {
      latencyMs: performance.now() - started,
      usage: {},
      error: errorText(error),
    };
  }
}

function providerCacheJson(
  call: ProviderCall,
  sample: DecisionSample,
  includeConfidence: boolean,
): HybridSweepProviderCall {
  const action = callAction(call);
  const confidence = confidenceValue(call);
  return {
    ...(typeof action === "string" ? { action } : {}),
    ...(includeConfidence ? { confidence: confidence ?? null, confidenceStatus: confidenceStatus(confidence) } : {}),
    latencyMs: call.latencyMs,
    usage: call.usage,
    legal: legalAction(call, sample),
    ...(call.decision?.metadata ? { metadata: call.decision.metadata } : {}),
    ...(call.error ? { error: call.error } : {}),
  };
}

function modelsFor(
  providers: { jev: HybridSweepProvider; gpt: HybridSweepProvider },
  options: HybridSweepCollectionOptions = {},
): HybridSweepCache["models"] {
  return {
    jev: providerMetadata(providers.jev, "jev", options.models?.jev),
    gpt: providerMetadata(providers.gpt, "gpt", options.models?.gpt),
  };
}

function makeCache(
  calls: HybridSweepCacheRow[],
  datasetSha256: string,
  models: HybridSweepCache["models"],
): HybridSweepCache {
  return {
    cacheSchemaVersion: HYBRID_SWEEP_CACHE_SCHEMA_VERSION,
    schemaVersion: HYBRID_SWEEP_CACHE_SCHEMA_VERSION,
    datasetSha256,
    models,
    jevModel: models.jev.model,
    jevReasoningEffort: models.jev.reasoningEffort,
    gptModel: models.gpt.model,
    gptReasoningEffort: models.gpt.reasoningEffort,
    calls,
    rows: calls,
    samples: calls,
  };
}

/** Call Jev and GPT exactly once per sample and retain only provider results. */
export async function collectHybridCalls(
  samples: DecisionSample[],
  providers: { jev: HybridSweepProvider; gpt: HybridSweepProvider },
  options: HybridSweepCollectionOptions = {},
): Promise<HybridSweepCache> {
  const datasetSha256 = options.datasetSha256 ?? stableSha256(samples);
  const models = modelsFor(providers, options);
  const calls: HybridSweepCacheRow[] = [];
  for (const sample of samples) {
    const jev = await callProvider(providers.jev, sample);
    const gpt = await callProvider(providers.gpt, sample);
    calls.push({
      cacheSchemaVersion: HYBRID_SWEEP_CACHE_SCHEMA_VERSION,
      datasetSha256,
      sampleId: sample.id,
      legalActionsHash: stableSha256(sample.legalActions),
      ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
      models,
      jevModel: models.jev.model,
      jevReasoningEffort: models.jev.reasoningEffort,
      gptModel: models.gpt.model,
      gptReasoningEffort: models.gpt.reasoningEffort,
      jev: providerCacheJson(jev, sample, true),
      gpt: providerCacheJson(gpt, sample, false),
    });
  }
  return makeCache(calls, datasetSha256, models);
}

function modelsFromCache(cache: HybridSweepCache): HybridSweepCache["models"] {
  if (cache.models?.jev?.model && cache.models?.gpt?.model) return cache.models;
  return {
    jev: { model: cache.jevModel, reasoningEffort: cache.jevReasoningEffort },
    gpt: { model: cache.gptModel, reasoningEffort: cache.gptReasoningEffort },
  };
}

function assertProviderMetadata(
  actual: HybridSweepProviderMetadata | undefined,
  expected: HybridSweepProviderMetadata,
  label: string,
): void {
  if (!actual
    || actual.model !== expected.model
    || actual.reasoningEffort !== expected.reasoningEffort) {
    throw new Error(
      `hybrid sweep cache ${label} mismatch: expected ${expected.model}/${expected.reasoningEffort}, `
      + `got ${actual?.model ?? "<missing>"}/${actual?.reasoningEffort ?? "<missing>"}`,
    );
  }
}

function callsFromCache(cache: HybridSweepCache): HybridSweepCacheRow[] {
  return cache.calls ?? cache.rows ?? cache.samples ?? [];
}

/** Validate the dataset/model/legal-action signature before using a cache. */
export function validateHybridSweepCache(
  samples: DecisionSample[],
  cache: HybridSweepCache,
  options: HybridSweepCacheValidationOptions = {},
): void {
  if (cache.cacheSchemaVersion !== HYBRID_SWEEP_CACHE_SCHEMA_VERSION
    && cache.schemaVersion !== HYBRID_SWEEP_CACHE_SCHEMA_VERSION) {
    throw new Error(`hybrid sweep cache schema mismatch: expected ${HYBRID_SWEEP_CACHE_SCHEMA_VERSION}`);
  }
  const models = modelsFromCache(cache);
  if (cache.jevModel !== undefined && cache.jevModel !== models.jev.model) {
    throw new Error(`hybrid sweep cache top-level Jev model alias mismatch: expected ${models.jev.model}, got ${cache.jevModel}`);
  }
  if (cache.jevReasoningEffort !== undefined && cache.jevReasoningEffort !== models.jev.reasoningEffort) {
    throw new Error(`hybrid sweep cache top-level Jev reasoning effort alias mismatch: expected ${models.jev.reasoningEffort}, got ${cache.jevReasoningEffort}`);
  }
  if (cache.gptModel !== undefined && cache.gptModel !== models.gpt.model) {
    throw new Error(`hybrid sweep cache top-level GPT model alias mismatch: expected ${models.gpt.model}, got ${cache.gptModel}`);
  }
  if (cache.gptReasoningEffort !== undefined && cache.gptReasoningEffort !== models.gpt.reasoningEffort) {
    throw new Error(`hybrid sweep cache top-level GPT reasoning effort alias mismatch: expected ${models.gpt.reasoningEffort}, got ${cache.gptReasoningEffort}`);
  }
  for (const kind of ["jev", "gpt"] as const) {
    const expected = options.models?.[kind];
    if (!expected) continue;
    if (expected.model !== undefined && models[kind].model !== expected.model) {
      throw new Error(`hybrid sweep cache ${kind} model mismatch: expected ${expected.model}, got ${models[kind].model}`);
    }
    if (expected.reasoningEffort !== undefined && models[kind].reasoningEffort !== expected.reasoningEffort) {
      throw new Error(`hybrid sweep cache ${kind} reasoning effort mismatch: expected ${expected.reasoningEffort}, got ${models[kind].reasoningEffort}`);
    }
  }
  const calls = callsFromCache(cache);
  if (calls.length !== samples.length) {
    throw new Error(`hybrid sweep cache sample count mismatch: expected ${samples.length}, got ${calls.length}`);
  }
  for (const [index, sample] of samples.entries()) {
    const call = calls[index];
    if (!call || call.sampleId !== sample.id) {
      throw new Error(`hybrid sweep cache sample ID mismatch at index ${index}: expected ${sample.id}`);
    }
    if (call.cacheSchemaVersion !== HYBRID_SWEEP_CACHE_SCHEMA_VERSION || call.datasetSha256 !== cache.datasetSha256) {
      throw new Error(`hybrid sweep cache row signature mismatch for sample ${sample.id}`);
    }
    assertProviderMetadata(call.models?.jev, models.jev, `row ${sample.id} Jev model settings`);
    assertProviderMetadata(call.models?.gpt, models.gpt, `row ${sample.id} GPT model settings`);
    if (call.jevModel !== models.jev.model || call.jevReasoningEffort !== models.jev.reasoningEffort) {
      throw new Error(`hybrid sweep cache row ${sample.id} Jev model aliases mismatch`);
    }
    if (call.gptModel !== models.gpt.model || call.gptReasoningEffort !== models.gpt.reasoningEffort) {
      throw new Error(`hybrid sweep cache row ${sample.id} GPT model aliases mismatch`);
    }
    const expectedLegalActionsHash = stableSha256(sample.legalActions);
    if (call.legalActionsHash !== expectedLegalActionsHash) {
      throw new Error(`hybrid sweep cache legal actions hash mismatch for sample ${sample.id}`);
    }
    if (call.referenceAction !== sample.referenceAction) {
      throw new Error(`hybrid sweep cache reference action mismatch for sample ${sample.id}`);
    }
  }
  const expectedDatasetSha256 = options.datasetSha256 ?? stableSha256(samples);
  if (cache.datasetSha256 !== expectedDatasetSha256) {
    throw new Error(`hybrid sweep cache dataset SHA-256 mismatch: expected ${expectedDatasetSha256}, got ${cache.datasetSha256}`);
  }
}

function summary(
  policy: string,
  rows: Array<{
    action?: string;
    legal: boolean;
    referenceAction?: string;
    latencyMs: number;
    usage: TokenUsage;
    escalated: boolean;
  }>,
): HybridSweepPolicySummary {
  const referenceRows = rows.filter((row) => row.referenceAction !== undefined);
  const agreements = referenceRows.filter((row) => row.action === row.referenceAction).length;
  const legalActions = rows.filter((row) => row.legal).length;
  const escalated = rows.filter((row) => row.escalated).length;
  const inputTokens = rows.reduce((sum, row) => sum + (row.usage.inputTokens ?? 0), 0);
  const outputTokens = rows.reduce((sum, row) => sum + (row.usage.outputTokens ?? 0), 0);
  return {
    policy,
    samples: rows.length,
    referenceSamples: referenceRows.length,
    agreements,
    ...(referenceRows.length ? { agreementRate: agreements / referenceRows.length } : {}),
    legalActions,
    legalRate: rows.length ? legalActions / rows.length : 0,
    escalated,
    escalationRate: rows.length ? escalated / rows.length : 0,
    p50LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.5),
    p95LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.95),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokensPerSample: rows.length ? inputTokens / rows.length : 0,
    outputTokensPerSample: rows.length ? outputTokens / rows.length : 0,
  };
}

function breakdown(rows: EvaluationRow[], physical = false): HybridSweepUsageBreakdown {
  const jevInputTokens = rows.reduce((sum, row) => sum + (row.jevUsage.inputTokens ?? 0), 0);
  const jevOutputTokens = rows.reduce((sum, row) => sum + (row.jevUsage.outputTokens ?? 0), 0);
  const gptRows = physical ? rows : rows.filter((row) => row.escalated);
  const gptInputTokens = gptRows.reduce((sum, row) => sum + (row.gptUsage.inputTokens ?? 0), 0);
  const gptOutputTokens = gptRows.reduce((sum, row) => sum + (row.gptUsage.outputTokens ?? 0), 0);
  const inputTokens = jevInputTokens + gptInputTokens;
  const outputTokens = jevOutputTokens + gptOutputTokens;
  return {
    sampleCount: rows.length,
    jevCalls: rows.length,
    gptCalls: physical ? rows.length : gptRows.length,
    jevInputTokens,
    jevOutputTokens,
    gptInputTokens,
    gptOutputTokens,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function emptySourceCounts(): Record<HybridSweepFinalSource, number> {
  return { jev: 0, gpt: 0, "jev-fallback": 0, error: 0 };
}

function thresholdSummary(
  threshold: number,
  rows: EvaluationRow[],
  cost: HybridSweepCostRates | undefined,
): HybridSweepThresholdResult {
  const base = summary(`hybrid@${threshold}`, rows);
  const finalSourceCounts = emptySourceCounts();
  const escalationReasonCounts: Record<string, number> = {};
  for (const row of rows) {
    finalSourceCounts[row.source] += 1;
    if (row.escalationReason) escalationReasonCounts[row.escalationReason] = (escalationReasonCounts[row.escalationReason] ?? 0) + 1;
  }
  const estimated = breakdown(rows);
  const fallbackCount = finalSourceCounts["jev-fallback"];
  const errorCount = finalSourceCounts.error;
  const estimatedGptCost = cost
    ? (estimated.gptInputTokens / 1_000) * (cost.gptInputPer1kTokens ?? 0)
      + (estimated.gptOutputTokens / 1_000) * (cost.gptOutputPer1kTokens ?? 0)
    : undefined;
  return {
    threshold,
    ...base,
    ...(base.agreementRate !== undefined ? { referenceAgreement: base.agreementRate } : {}),
    finalSourceCounts,
    finalSources: finalSourceCounts,
    escalationReasonCounts,
    escalationReasons: escalationReasonCounts,
    jevFinalCount: finalSourceCounts.jev,
    gptFinalCount: finalSourceCounts.gpt,
    jevFallbackCount: fallbackCount,
    fallbackCount,
    fallbackRate: rows.length ? fallbackCount / rows.length : 0,
    errorCount,
    errorRate: rows.length ? errorCount / rows.length : 0,
    estimatedP50LatencyMs: base.p50LatencyMs,
    estimatedP95LatencyMs: base.p95LatencyMs,
    jevInputTokens: estimated.jevInputTokens,
    jevOutputTokens: estimated.jevOutputTokens,
    gptInputTokens: estimated.gptInputTokens,
    gptOutputTokens: estimated.gptOutputTokens,
    providerTokens: {
      jevInputTokens: estimated.jevInputTokens,
      jevOutputTokens: estimated.jevOutputTokens,
      gptInputTokens: estimated.gptInputTokens,
      gptOutputTokens: estimated.gptOutputTokens,
      totalTokens: estimated.totalTokens,
    },
    estimatedUsage: estimated,
    ...(estimatedGptCost !== undefined ? { gptCost: estimatedGptCost, estimatedGptCost } : {}),
  };
}

function confidenceDistribution(samples: DecisionSample[], cache: HybridSweepCache): HybridSweepConfidenceDistribution {
  const values: number[] = [];
  let missingConfidenceCount = 0;
  let nonFiniteConfidenceCount = 0;
  let outOfRangeConfidenceCount = 0;
  let illegalJevActionCount = 0;
  const calls = callsFromCache(cache);
  for (const [index, sample] of samples.entries()) {
    const call = calls[index]?.jev;
    if (!call) continue;
    const action = call.action;
    if (typeof action === "string" && !sample.legalActions.includes(action)) illegalJevActionCount += 1;
    const status = statusFor(call);
    if (status === "missing") missingConfidenceCount += 1;
    else if (status === "non-finite") nonFiniteConfidenceCount += 1;
    else if (status === "out-of-range") outOfRangeConfidenceCount += 1;
    else if (typeof action === "string" && sample.legalActions.includes(action) && typeof call.confidence === "number") values.push(call.confidence);
  }
  const histogram: Record<string, number> = {};
  const histogramBins: Array<{ lower: number; upper: number; count: number }> = [];
  for (let index = 0; index < 10; index += 1) {
    const lower = index / 10;
    const upper = (index + 1) / 10;
    const key = `${lower.toFixed(1)}-${upper.toFixed(1)}`;
    const count = values.filter((value) => value >= lower && (index === 9 ? value <= upper : value < upper)).length;
    histogram[key] = count;
    histogramBins.push({ lower, upper, count });
  }
  return {
    min: values.length ? Math.min(...values) : null,
    p10: values.length ? percentile(values, 0.10) : null,
    p25: values.length ? percentile(values, 0.25) : null,
    median: values.length ? percentile(values, 0.50) : null,
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    p75: values.length ? percentile(values, 0.75) : null,
    p90: values.length ? percentile(values, 0.90) : null,
    p95: values.length ? percentile(values, 0.95) : null,
    max: values.length ? Math.max(...values) : null,
    validConfidenceCount: values.length,
    validCount: values.length,
    effectiveCount: values.length,
    missingConfidenceCount,
    missing: missingConfidenceCount,
    nonFiniteConfidenceCount,
    nonFinite: nonFiniteConfidenceCount,
    outOfRangeConfidenceCount,
    outOfRange: outOfRangeConfidenceCount,
    illegalJevActionCount,
    illegalActions: illegalJevActionCount,
    histogram,
    histogramBins,
  };
}

function paretoFrontier(results: HybridSweepThresholdResult[]): HybridSweepThresholdResult[] {
  const dominated = (candidate: HybridSweepThresholdResult, other: HybridSweepThresholdResult): boolean => {
    const candidateAgreement = candidate.agreementRate ?? Number.NEGATIVE_INFINITY;
    const otherAgreement = other.agreementRate ?? Number.NEGATIVE_INFINITY;
    const candidateBadRate = candidate.fallbackRate + candidate.errorRate;
    const otherBadRate = other.fallbackRate + other.errorRate;
    const noWorse = otherAgreement >= candidateAgreement
      && other.gptInputTokens <= candidate.gptInputTokens
      && other.estimatedP50LatencyMs <= candidate.estimatedP50LatencyMs
      && otherBadRate <= candidateBadRate;
    const strictlyBetter = otherAgreement > candidateAgreement
      || other.gptInputTokens < candidate.gptInputTokens
      || other.estimatedP50LatencyMs < candidate.estimatedP50LatencyMs
      || otherBadRate < candidateBadRate;
    return noWorse && strictlyBetter;
  };
  return results.filter((candidate) => !results.some((other) => other !== candidate && dominated(candidate, other)));
}

function resolveCost(options: HybridSweepEvaluationOptions): HybridSweepCostRates | undefined {
  const cost = options.cost ?? {};
  const input = options.gptInputCostPer1kTokens ?? options.gptInputPer1kTokens ?? cost.gptInputPer1kTokens;
  const output = options.gptOutputCostPer1kTokens ?? options.gptOutputPer1kTokens ?? cost.gptOutputPer1kTokens;
  if (input === undefined && output === undefined) return undefined;
  for (const [name, value] of [["gpt input", input], ["gpt output", output]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`${name} cost must be finite and non-negative`);
  }
  return { ...(input !== undefined ? { gptInputPer1kTokens: input } : {}), ...(output !== undefined ? { gptOutputPer1kTokens: output } : {}) };
}

/** Evaluate every threshold using an already-collected provider cache. */
export function evaluateHybridThresholds(
  samples: DecisionSample[],
  cache: HybridSweepCache,
  thresholds: number[],
  options: HybridSweepEvaluationOptions = {},
): HybridSweepResult {
  validateHybridSweepCache(samples, cache, options);
  const normalizedThresholds = normalizeThresholds(thresholds);
  const calls = callsFromCache(cache);
  const thresholdRows = new Map<number, EvaluationRow[]>();
  for (const threshold of normalizedThresholds) thresholdRows.set(threshold, []);
  const jevRows: Array<{ action?: string; legal: boolean; referenceAction?: string; latencyMs: number; usage: TokenUsage; escalated: boolean }> = [];
  const gptRows: Array<{ action?: string; legal: boolean; referenceAction?: string; latencyMs: number; usage: TokenUsage; escalated: boolean }> = [];
  const rawDecisions: HybridSweepRawDecision[] = [];

  for (const [index, sample] of samples.entries()) {
    const cached = calls[index]!;
    const jev = cached.jev;
    const gpt = cached.gpt;
    const jevLegal = typeof jev.action === "string" && sample.legalActions.includes(jev.action);
    const gptLegal = typeof gpt.action === "string" && sample.legalActions.includes(gpt.action);
    const jevValid = validConfidence(jev, sample);
    const jevConfidence = jev.confidence;
    jevRows.push({
      ...(typeof jev.action === "string" ? { action: jev.action } : {}),
      legal: jevLegal,
      ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
      latencyMs: jev.latencyMs,
      usage: jev.usage,
      escalated: false,
    });
    gptRows.push({
      ...(typeof gpt.action === "string" ? { action: gpt.action } : {}),
      legal: gptLegal,
      ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
      latencyMs: gpt.latencyMs,
      usage: gpt.usage,
      escalated: false,
    });

    const thresholdOutput: HybridSweepRawDecision["thresholds"] = {};
    for (const threshold of normalizedThresholds) {
      const jevAccepted = jevValid && typeof jevConfidence === "number" && jevConfidence >= threshold;
      const escalationReason = jevAccepted ? undefined : jevEscalationReason(jev, sample) ?? "below-threshold";
      const source: HybridSweepFinalSource = jevAccepted
        ? "jev"
        : gptLegal
          ? "gpt"
          : jevLegal
            ? "jev-fallback"
            : "error";
      const finalAction = source === "jev" || source === "jev-fallback"
        ? jev.action
        : source === "gpt" ? gpt.action : undefined;
      const escalated = source !== "jev";
      const row: EvaluationRow = {
        ...(typeof finalAction === "string" ? { action: finalAction } : {}),
        legal: typeof finalAction === "string" && sample.legalActions.includes(finalAction),
        ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
        latencyMs: source === "jev" ? jev.latencyMs : jev.latencyMs + gpt.latencyMs,
        usage: source === "jev" ? jev.usage : sumUsage(jev.usage, gpt.usage),
        jevUsage: jev.usage,
        gptUsage: gpt.usage,
        escalated,
        source,
        ...(escalationReason ? { escalationReason } : {}),
      };
      thresholdRows.get(threshold)!.push(row);
      thresholdOutput[threshold.toString()] = {
        ...(typeof finalAction === "string" ? { finalAction } : {}),
        finalSource: source,
        escalated,
        ...(escalationReason ? { escalationReason } : {}),
        isLegal: row.legal,
        ...(sample.referenceAction !== undefined ? { isMatch: finalAction === sample.referenceAction } : {}),
        latencyMs: row.latencyMs,
        usage: row.usage,
      };
    }
    rawDecisions.push({
      sampleId: sample.id,
      ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
      jev,
      gpt,
      thresholds: thresholdOutput,
    });
  }

  const cost = resolveCost(options);
  const thresholdResults = normalizedThresholds.map((threshold) => thresholdSummary(threshold, thresholdRows.get(threshold)!, cost));
  const estimatedByThreshold: Record<string, HybridSweepUsageBreakdown> = {};
  for (const threshold of normalizedThresholds) estimatedByThreshold[threshold.toString()] = breakdown(thresholdRows.get(threshold)!);
  const physicalRows: EvaluationRow[] = samples.map((sample, index) => {
    const call = calls[index]!;
    return {
      ...(typeof call.jev.action === "string" ? { action: call.jev.action } : {}),
      legal: call.jev.legal,
      ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
      latencyMs: call.jev.latencyMs,
      usage: call.jev.usage,
      jevUsage: call.jev.usage,
      gptUsage: call.gpt.usage,
      escalated: false,
      source: "jev",
    };
  });
  const physical = breakdown(physicalRows, true);
  const usageResult: HybridSweepUsage = {
    ...physical,
    physical,
    estimatedByThreshold,
    estimatedUsageByThreshold: estimatedByThreshold,
  };
  const references = samples.filter((sample) => sample.referenceAction !== undefined);
  const models = modelsFromCache(cache);
  const frontier = paretoFrontier(thresholdResults);
  return {
    thresholds: normalizedThresholds,
    totalSamples: samples.length,
    datasetSha256: cache.datasetSha256,
    cacheSchemaVersion: cache.cacheSchemaVersion,
    models,
    agreementLabel: references.length > 0 && references.every((sample) => sample.referenceMetadata?.name.toLowerCase().startsWith("mortal"))
      ? "Mortal agreement"
      : "Reference agreement",
    confidenceDistribution: confidenceDistribution(samples, cache),
    jevBaseline: summary("jev", jevRows),
    gptBaseline: summary("gpt", gptRows),
    thresholdResults,
    paretoFrontier: frontier,
    paretoThresholds: frontier.map((result) => result.threshold),
    ...(cost ? { gptCostRates: cost } : {}),
    usage: usageResult,
    rawDecisions,
    cache,
  };
}

/** Backward-compatible one-shot API: collect first, then evaluate from the cache. */
export async function evaluateHybridSweep(
  samples: DecisionSample[],
  thresholds: number[],
  providers: { jev: HybridSweepProvider; gpt: HybridSweepProvider },
): Promise<HybridSweepResult> {
  const cache = await collectHybridCalls(samples, providers);
  return evaluateHybridThresholds(samples, cache, thresholds);
}

function parseCacheValue(value: unknown, line?: number): HybridSweepCacheRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid hybrid sweep cache row${line ? ` at line ${line}` : ""}`);
  const row = value as Partial<HybridSweepCacheRow>;
  if (typeof row.sampleId !== "string" || typeof row.legalActionsHash !== "string") {
    throw new Error(`invalid hybrid sweep cache row${line ? ` at line ${line}` : ""}`);
  }
  return row as HybridSweepCacheRow;
}

function cacheFromRows(rows: HybridSweepCacheRow[], metadata?: Partial<HybridSweepCache>): HybridSweepCache {
  const first = rows[0];
  const models = metadata?.models ?? first?.models ?? {
    jev: { model: first?.jevModel ?? defaultProviderMetadata("jev").model, reasoningEffort: first?.jevReasoningEffort ?? defaultProviderMetadata("jev").reasoningEffort },
    gpt: { model: first?.gptModel ?? defaultProviderMetadata("gpt").model, reasoningEffort: first?.gptReasoningEffort ?? defaultProviderMetadata("gpt").reasoningEffort },
  };
  const datasetSha256 = metadata?.datasetSha256 ?? first?.datasetSha256;
  if (!datasetSha256) throw new Error("hybrid sweep cache is missing dataset SHA-256");
  return makeCache(rows, datasetSha256, models);
}

/** Read provider-calls.jsonl, or a sweep directory containing that artifact. */
export async function readHybridSweepCache(inputPath: string): Promise<HybridSweepCache> {
  const inputStat = await stat(inputPath);
  const path = inputStat.isDirectory() ? join(inputPath, "provider-calls.jsonl") : inputPath;
  const text = await readFile(path, "utf8");
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`hybrid sweep cache is empty: ${path}`);
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const value = parsed as Partial<HybridSweepCache> & { calls?: unknown[]; rows?: unknown[]; samples?: unknown[] };
        const values = value.calls ?? value.rows ?? value.samples;
        if (Array.isArray(values)) {
          return cacheFromRows(values.map((row, index) => parseCacheValue(row, index + 1)), value);
        }
      }
    } catch {
      // A JSONL cache also starts with `{`; parse it line by line below.
    }
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return cacheFromRows(parsed.map((row, index) => parseCacheValue(row, index + 1)));
  }
  const rows = trimmed.split(/\r?\n/).filter(Boolean).map((line, index) => parseCacheValue(JSON.parse(line) as unknown, index + 1));
  return cacheFromRows(rows);
}

function cacheForWriting(result: HybridSweepResult, cache?: HybridSweepCache): HybridSweepCache {
  if (cache) return cache;
  if (result.cache) return result.cache;
  throw new Error("hybrid sweep result has no provider cache");
}

function sourceCell(result: HybridSweepThresholdResult): string {
  return `${result.finalSourceCounts.jev}/${result.finalSourceCounts.gpt}/${result.finalSourceCounts["jev-fallback"]}/${result.finalSourceCounts.error}`;
}

export async function writeHybridSweep(outDir: string, result: HybridSweepResult, cache?: HybridSweepCache): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const providerCache = cacheForWriting(result, cache);
  const report = {
    version: 2,
    cacheSchemaVersion: result.cacheSchemaVersion,
    datasetSha256: result.datasetSha256,
    models: result.models,
    thresholds: result.thresholds,
    totalSamples: result.totalSamples,
    agreementLabel: result.agreementLabel,
    confidenceDistribution: result.confidenceDistribution,
    jevBaseline: result.jevBaseline,
    gptBaseline: result.gptBaseline,
    thresholdResults: result.thresholdResults,
    paretoFrontier: result.paretoFrontier,
    paretoThresholds: result.paretoThresholds,
    ...(result.gptCostRates ? { gptCostRates: result.gptCostRates } : {}),
    usage: result.usage,
  };
  const agreementText = (value: number | undefined): string => value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
  const rows = result.thresholdResults.map((item) =>
    `| ${item.threshold.toFixed(2)} | ${agreementText(item.agreementRate)} | ${(item.escalationRate * 100).toFixed(1)}% | ${sourceCell(item)} | ${item.estimatedP50LatencyMs.toFixed(1)} / ${item.estimatedP95LatencyMs.toFixed(1)} | ${item.jevInputTokens} / ${item.jevOutputTokens} | ${item.gptInputTokens} / ${item.gptOutputTokens} | ${item.totalTokens} |`);
  const frontierRows = result.paretoFrontier.map((item) => `| ${item.threshold.toFixed(2)} | ${agreementText(item.agreementRate)} | ${sourceCell(item)} | ${item.estimatedP50LatencyMs.toFixed(1)} | ${item.gptInputTokens} |`);
  const markdown = `# Hybrid threshold sweep

Provider calls are collected once per sample. Physical API usage is recorded separately from the estimated usage of each threshold. Latency is an estimate from measured provider latencies: Jev-only rows use Jev latency, and escalated rows use Jev + GPT latency.

| threshold | ${result.agreementLabel} | escalation | Jev/GPT/fallback/error | p50/p95 ms | Jev tokens | GPT tokens | total tokens |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

Jev baseline: ${agreementText(result.jevBaseline.agreementRate)} agreement, ${result.jevBaseline.inputTokens} / ${result.jevBaseline.outputTokens} tokens.

GPT baseline coverage: ${result.gptBaseline.samples}/${result.totalSamples} samples.

## Pareto frontier

| threshold | ${result.agreementLabel} | Jev/GPT/fallback/error | estimated p50 ms | GPT input tokens |
| ---: | ---: | ---: | ---: | ---: |
${frontierRows.length ? frontierRows.join("\n") : "—"}
`;
  await Promise.all([
    writeFile(join(outDir, "hybrid-sweep.json"), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(outDir, "hybrid-sweep.md"), markdown),
    writeFile(join(outDir, "decisions.jsonl"), result.rawDecisions.map((row) => JSON.stringify(row)).join("\n") + (result.rawDecisions.length ? "\n" : "")),
    writeFile(join(outDir, "provider-calls.jsonl"), providerCache.calls.map((row) => JSON.stringify(row)).join("\n") + (providerCache.calls.length ? "\n" : "")),
  ]);
}
