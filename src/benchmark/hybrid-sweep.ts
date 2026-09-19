import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { AgentDecision, DecisionSample, TokenUsage } from "../types.js";
import { validateHybridThreshold } from "../agents/hybrid.js";

export interface HybridSweepProvider {
  decide(sample: DecisionSample): Promise<AgentDecision>;
}

interface ProviderCall {
  decision?: AgentDecision;
  latencyMs: number;
  usage: TokenUsage;
  error?: string;
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
  inputTokensPerSample: number;
  outputTokensPerSample: number;
}

export interface HybridSweepUsage {
  sampleCount: number;
  jevCalls: number;
  gptCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface HybridSweepThresholdResult extends HybridSweepPolicySummary {
  threshold: number;
}

export interface HybridSweepRawDecision {
  sampleId: string;
  referenceAction?: string;
  jev: {
    action?: string;
    confidence?: number | null;
    latencyMs: number;
    usage: TokenUsage;
    legal: boolean;
    error?: string;
  };
  gpt: {
    action?: string;
    latencyMs: number;
    usage: TokenUsage;
    legal: boolean;
    error?: string;
  };
  thresholds: Record<string, {
    finalAction?: string;
    finalSource: "jev" | "gpt" | "jev-fallback" | "error";
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
  agreementLabel: "Mortal agreement" | "Reference agreement";
  jevBaseline: HybridSweepPolicySummary;
  gptBaseline: HybridSweepPolicySummary;
  thresholdResults: HybridSweepThresholdResult[];
  usage: HybridSweepUsage;
  rawDecisions: HybridSweepRawDecision[];
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
  const inputTokens = (left?.inputTokens ?? 0) + (right?.inputTokens ?? 0);
  const outputTokens = (left?.outputTokens ?? 0) + (right?.outputTokens ?? 0);
  return { inputTokens, outputTokens };
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

function legalAction(call: ProviderCall, sample: DecisionSample): boolean {
  return typeof call.decision?.action === "string" && sample.legalActions.includes(call.decision.action);
}

function validConfidence(call: ProviderCall): boolean {
  const confidence = call.decision?.confidence;
  return typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

function confidenceValue(call: ProviderCall): number | null | undefined {
  const confidence = call.decision?.confidence;
  if (typeof confidence !== "number") return undefined;
  return Number.isFinite(confidence) ? confidence : null;
}

function jevEscalationReason(call: ProviderCall, sample: DecisionSample): string | undefined {
  if (call.error) return "jev-error";
  if (!legalAction(call, sample)) return "illegal-jev-action";
  if (typeof call.decision?.confidence !== "number") return "missing-confidence";
  if (!validConfidence(call)) return "invalid-confidence";
  return undefined;
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
    inputTokensPerSample: rows.length ? inputTokens / rows.length : 0,
    outputTokensPerSample: rows.length ? outputTokens / rows.length : 0,
  };
}

function providerJson(call: ProviderCall, sample: DecisionSample, includeConfidence: boolean): HybridSweepRawDecision["jev"] {
  const action = call.decision?.action;
  const confidence = confidenceValue(call);
  return {
    ...(typeof action === "string" ? { action } : {}),
    ...(includeConfidence ? { confidence: confidence ?? null } : {}),
    latencyMs: call.latencyMs,
    usage: call.usage,
    legal: legalAction(call, sample),
    ...(call.error ? { error: call.error } : {}),
  };
}

export async function evaluateHybridSweep(
  samples: DecisionSample[],
  thresholds: number[],
  providers: { jev: HybridSweepProvider; gpt: HybridSweepProvider },
): Promise<HybridSweepResult> {
  const normalizedThresholds = normalizeThresholds(thresholds);
  const rawDecisions: HybridSweepRawDecision[] = [];
  const jevRows: Array<{ action?: string; legal: boolean; referenceAction?: string; latencyMs: number; usage: TokenUsage; escalated: boolean }> = [];
  const gptRows: Array<{ action?: string; legal: boolean; referenceAction?: string; latencyMs: number; usage: TokenUsage; escalated: boolean }> = [];
  const thresholdRows = new Map<number, Array<{ action?: string; legal: boolean; referenceAction?: string; latencyMs: number; usage: TokenUsage; escalated: boolean }>>();
  for (const threshold of normalizedThresholds) thresholdRows.set(threshold, []);
  let jevCalls = 0;
  let gptCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const sample of samples) {
    const jev = await callProvider(providers.jev, sample);
    jevCalls += 1;
    inputTokens += jev.usage.inputTokens ?? 0;
    outputTokens += jev.usage.outputTokens ?? 0;
    const jevLegal = legalAction(jev, sample);
    const jevValid = jevLegal && validConfidence(jev);
    const jevConfidence = jev.decision?.confidence;
    const gpt = await callProvider(providers.gpt, sample);
    gptCalls += 1;
    inputTokens += gpt.usage.inputTokens ?? 0;
    outputTokens += gpt.usage.outputTokens ?? 0;
    gptRows.push({
      ...(typeof gpt.decision?.action === "string" ? { action: gpt.decision.action } : {}),
      legal: legalAction(gpt, sample),
      ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
      latencyMs: gpt.latencyMs,
      usage: gpt.usage,
      escalated: false,
    });
    jevRows.push({
      ...(typeof jev.decision?.action === "string" ? { action: jev.decision.action } : {}),
      legal: jevLegal,
      ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
      latencyMs: jev.latencyMs,
      usage: jev.usage,
      escalated: false,
    });

    const thresholdOutput: HybridSweepRawDecision["thresholds"] = {};
    for (const threshold of normalizedThresholds) {
      const jevAccepted = jevValid && jevConfidence! >= threshold;
      const gptLegal = legalAction(gpt, sample);
      const source: "jev" | "gpt" | "jev-fallback" | "error" = jevAccepted
        ? "jev"
        : gptLegal
          ? "gpt"
          : jevLegal
            ? "jev-fallback"
            : "error";
      const finalAction = source === "jev"
        ? jev.decision?.action
        : source === "gpt"
          ? gpt.decision?.action
          : source === "jev-fallback"
            ? jev.decision?.action
            : undefined;
      const escalated = source !== "jev";
      const row = {
        ...(typeof finalAction === "string" ? { action: finalAction } : {}),
        legal: typeof finalAction === "string" && sample.legalActions.includes(finalAction),
        ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
        latencyMs: source === "jev" ? jev.latencyMs : jev.latencyMs + gpt.latencyMs,
        usage: source === "jev" ? jev.usage : sumUsage(jev.usage, gpt.usage),
        escalated,
      };
      thresholdRows.get(threshold)!.push(row);
      const reason = jevAccepted ? undefined : jevEscalationReason(jev, sample) ?? "below-threshold";
      thresholdOutput[threshold.toString()] = {
        ...(typeof finalAction === "string" ? { finalAction } : {}),
        finalSource: source,
        escalated,
        ...(reason ? { escalationReason: reason } : {}),
        isLegal: row.legal,
        ...(sample.referenceAction !== undefined ? { isMatch: finalAction === sample.referenceAction } : {}),
        latencyMs: row.latencyMs,
        usage: row.usage,
      };
    }
    rawDecisions.push({
      sampleId: sample.id,
      ...(sample.referenceAction !== undefined ? { referenceAction: sample.referenceAction } : {}),
      jev: providerJson(jev, sample, true),
      gpt: providerJson(gpt, sample, false),
      thresholds: thresholdOutput,
    });
  }

  return {
    thresholds: normalizedThresholds,
    totalSamples: samples.length,
    agreementLabel: (() => {
      const references = samples.filter((sample) => sample.referenceAction !== undefined);
      return references.length > 0 && references.every((sample) => sample.referenceMetadata?.name.toLowerCase().startsWith("mortal"))
        ? "Mortal agreement" as const
        : "Reference agreement" as const;
    })(),
    jevBaseline: summary("jev", jevRows),
    gptBaseline: summary("gpt", gptRows),
    thresholdResults: normalizedThresholds.map((threshold) => ({
      threshold,
      ...summary(`hybrid@${threshold}`, thresholdRows.get(threshold)!),
    })),
    usage: { sampleCount: samples.length, jevCalls, gptCalls, inputTokens, outputTokens },
    rawDecisions,
  };
}

export async function writeHybridSweep(outDir: string, result: HybridSweepResult): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const report = {
    version: 1,
    thresholds: result.thresholds,
    totalSamples: result.totalSamples,
    agreementLabel: result.agreementLabel,
    jevBaseline: result.jevBaseline,
    gptBaseline: result.gptBaseline,
    thresholdResults: result.thresholdResults,
    usage: result.usage,
  };
  const agreementText = (value: number | undefined): string => value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
  const rows = result.thresholdResults.map((item) =>
    `| ${item.threshold.toFixed(2)} | ${agreementText(item.agreementRate)} | ${(item.escalationRate * 100).toFixed(1)}% | ${item.p50LatencyMs.toFixed(1)} | ${item.p95LatencyMs.toFixed(1)} | ${item.inputTokens} / ${item.outputTokens} |`);
  const markdown = `# Hybrid threshold sweep

GPT baseline runs on every sample. Each provider is called once per sample; threshold rows count GPT usage when GPT is called for an escalated decision, including a Jev fallback after a GPT failure.

| Threshold | ${result.agreementLabel} | Escalation | p50 ms | p95 ms | Tokens in / out |
| ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

Jev baseline: ${agreementText(result.jevBaseline.agreementRate)} agreement, ${result.jevBaseline.inputTokens} / ${result.jevBaseline.outputTokens} tokens.

GPT baseline coverage: ${result.gptBaseline.samples}/${result.totalSamples} samples.
`;
  await Promise.all([
    writeFile(join(outDir, "hybrid-sweep.json"), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(outDir, "hybrid-sweep.md"), markdown),
    writeFile(join(outDir, "decisions.jsonl"), result.rawDecisions.map((row) => JSON.stringify(row)).join("\n") + (result.rawDecisions.length ? "\n" : "")),
  ]);
}
