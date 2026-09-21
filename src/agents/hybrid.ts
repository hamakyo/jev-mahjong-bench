import { performance } from "node:perf_hooks";
import type {
  AgentDecision,
  DecisionSample,
  GameDecisionInput,
  TokenUsage,
} from "../types.js";
import { GptAgent } from "./gpt.js";
import { JevAgent } from "./jev.js";
import type { MahjongAgent } from "./agent.js";
import { inspectGameDecisionInput } from "../game/input.js";

export const DEFAULT_HYBRID_THRESHOLD = 0.75;

export interface HybridAgentSpec {
  name: "hybrid";
  threshold?: number;
  explicitThreshold: boolean;
}

/** Parse the public agent spelling used by both benchmark and tournament CLIs. */
export function parseHybridAgentSpec(value: string): HybridAgentSpec | undefined {
  if (value === "hybrid") return { name: "hybrid", explicitThreshold: false };
  if (!value.startsWith("hybrid@")) return undefined;
  const rawThreshold = value.slice("hybrid@".length);
  if (!rawThreshold) throw new Error(`Invalid hybrid agent "${value}"; expected hybrid@<threshold>`);
  const threshold = Number(rawThreshold);
  if (!Number.isFinite(threshold)) {
    throw new Error(`Invalid hybrid agent "${value}"; threshold must be a finite number`);
  }
  return { name: "hybrid", threshold: validateHybridThreshold(threshold), explicitThreshold: true };
}

export interface HybridProviderRecord {
  action?: string;
  confidence: number | null;
  latencyMs: number;
  usage: TokenUsage;
  metadata?: Record<string, unknown>;
  error?: string;
}

export type HybridTraceProviderRecord = HybridProviderRecord & {
  probabilities?: Record<string, number>;
};

export interface HybridTrace {
  threshold: number;
  jev: HybridTraceProviderRecord;
  gpt?: HybridTraceProviderRecord;
  escalated: boolean;
  escalationReason?: string;
  finalSource?: HybridMetadata["finalSource"];
  finalAction?: string;
}

export type HybridTraceCallback = (trace: HybridTrace) => void;

export interface HybridMetadata {
  threshold: number;
  jev: HybridProviderRecord;
  escalated: boolean;
  escalationReason?: string;
  gpt?: HybridProviderRecord;
  finalSource: "jev" | "gpt" | "jev-fallback" | "error";
  finalAction?: string;
  error?: string;
}

export interface HybridProvider<T> {
  decide(input: T, signal?: AbortSignal): Promise<AgentDecision>;
}

export interface HybridProviderCalls<T> {
  jev: (input: T, signal?: AbortSignal) => Promise<AgentDecision>;
  gpt: (input: T, signal?: AbortSignal) => Promise<AgentDecision>;
}

export function validateHybridThreshold(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("hybrid threshold must be a finite number between 0 and 1");
  }
  return value;
}

function usage(value: TokenUsage | undefined): TokenUsage {
  return {
    ...(typeof value?.inputTokens === "number" ? { inputTokens: value.inputTokens } : {}),
    ...(typeof value?.outputTokens === "number" ? { outputTokens: value.outputTokens } : {}),
  };
}

function sumUsage(left: TokenUsage | undefined, right: TokenUsage | undefined): TokenUsage {
  const input = (left?.inputTokens ?? 0) + (right?.inputTokens ?? 0);
  const output = (left?.outputTokens ?? 0) + (right?.outputTokens ?? 0);
  return {
    ...(left?.inputTokens !== undefined || right?.inputTokens !== undefined ? { inputTokens: input } : {}),
    ...(left?.outputTokens !== undefined || right?.outputTokens !== undefined ? { outputTokens: output } : {}),
  };
}

function providerRecord(
  decision: AgentDecision | undefined,
  latencyMs: number,
  error?: string,
  failureMetadata?: Record<string, unknown>,
): HybridProviderRecord {
  const confidence = typeof decision?.confidence === "number" && Number.isFinite(decision.confidence)
    ? decision.confidence
    : null;
  return {
    ...(typeof decision?.action === "string" ? { action: decision.action } : {}),
    confidence,
    latencyMs,
    usage: usage(decision?.usage),
    ...(decision?.metadata ? { metadata: decision.metadata } : failureMetadata ? { metadata: failureMetadata } : {}),
    ...(error ? { error } : {}),
  };
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function errorMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const metadata = (value as { metadata?: unknown }).metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : undefined;
}

function hybridFailure(
  message: string,
  threshold: number,
  jev: HybridProviderRecord,
  gpt: HybridProviderRecord,
  escalationReason: string | undefined,
): Error {
  const error = new Error(message);
  const metadata: HybridMetadata = {
    threshold,
    jev,
    escalated: true,
    ...(escalationReason ? { escalationReason } : {}),
    gpt,
    finalSource: "error",
    error: message,
  };
  Object.assign(error, { metadata: { hybrid: metadata } });
  return error;
}

function publicConfidence(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function emitTrace(callback: HybridTraceCallback | undefined, trace: HybridTrace): void {
  if (!callback) return;
  try { callback(trace); } catch { /* diagnostics cannot change the decision */ }
}

function traceRecord(record: HybridProviderRecord, decision: AgentDecision | undefined): HybridTraceProviderRecord {
  return {
    ...record,
    ...(decision?.probabilities ? { probabilities: { ...decision.probabilities } } : {}),
  };
}

/** Run one Jev/GPT decision and return provider-neutral Hybrid metadata. */
export async function runHybridDecision<T>(
  input: T,
  legalActions: string[],
  threshold: number,
  calls: HybridProviderCalls<T>,
  signal?: AbortSignal,
  trace?: HybridTraceCallback,
): Promise<AgentDecision> {
  validateHybridThreshold(threshold);
  if (signal?.aborted) throw new Error("agent call aborted");

  const jevStarted = performance.now();
  let jevDecision: AgentDecision | undefined;
  let jevError: string | undefined;
  let jevFailureMetadata: Record<string, unknown> | undefined;
  try {
    jevDecision = await calls.jev(input, signal);
  } catch (error) {
    jevError = errorText(error);
    jevFailureMetadata = errorMetadata(error);
  }
  const jevLatency = performance.now() - jevStarted;
  const jevRecord = providerRecord(jevDecision, jevLatency, jevError, jevFailureMetadata);
  const jevLegal = typeof jevDecision?.action === "string" && legalActions.includes(jevDecision.action);
  const confidence = jevDecision?.confidence;
  const confidenceValid = typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;

  let escalationReason: string | undefined;
  if (jevError) escalationReason = "jev-error";
  else if (!jevLegal) escalationReason = "illegal-jev-action";
  else if (typeof confidence !== "number") escalationReason = "missing-confidence";
  else if (!confidenceValid) escalationReason = "invalid-confidence";
  else if (confidence < threshold) escalationReason = "below-threshold";

  emitTrace(trace, {
    threshold,
    jev: traceRecord(jevRecord, jevDecision),
    escalated: Boolean(escalationReason),
    ...(escalationReason ? { escalationReason } : {}),
  });

  if (!escalationReason && jevDecision) {
    const finalConfidence = publicConfidence(jevDecision.confidence);
    const metadata: HybridMetadata = {
      threshold,
      jev: jevRecord,
      escalated: false,
      finalSource: "jev",
      finalAction: jevDecision.action,
    };
    emitTrace(trace, {
      threshold,
      jev: traceRecord(jevRecord, jevDecision),
      escalated: false,
      finalSource: "jev",
      finalAction: jevDecision.action,
    });
    return {
      action: jevDecision.action,
      ...(jevDecision.probabilities ? { probabilities: jevDecision.probabilities } : {}),
      ...(finalConfidence !== undefined ? { confidence: finalConfidence } : {}),
      usage: usage(jevDecision.usage),
      metadata: { hybrid: metadata },
    };
  }

  if (signal?.aborted) {
    const gptRecord = providerRecord(undefined, 0, "agent call aborted");
    emitTrace(trace, {
      threshold,
      jev: traceRecord(jevRecord, jevDecision),
      escalated: true,
      ...(escalationReason ? { escalationReason } : {}),
      gpt: gptRecord,
      finalSource: "error",
    });
    const aborted = hybridFailure("agent call aborted", threshold, jevRecord, gptRecord, escalationReason);
    aborted.name = "AbortError";
    throw aborted;
  }
  const gptStarted = performance.now();
  let gptDecision: AgentDecision | undefined;
  let gptError: string | undefined;
  let gptFailureMetadata: Record<string, unknown> | undefined;
  try {
    gptDecision = await calls.gpt(input, signal);
  } catch (error) {
    gptError = errorText(error);
    gptFailureMetadata = errorMetadata(error);
  }
  const gptRecord = providerRecord(gptDecision, performance.now() - gptStarted, gptError, gptFailureMetadata);
  emitTrace(trace, {
    threshold,
    jev: traceRecord(jevRecord, jevDecision),
    escalated: true,
    ...(escalationReason ? { escalationReason } : {}),
    gpt: traceRecord(gptRecord, gptDecision),
  });
  if (signal?.aborted) {
    const aborted = hybridFailure("agent call aborted", threshold, jevRecord, gptRecord, escalationReason);
    aborted.name = "AbortError";
    throw aborted;
  }
  const gptLegal = typeof gptDecision?.action === "string" && legalActions.includes(gptDecision.action);
  if (gptLegal && gptDecision) {
    const finalConfidence = publicConfidence(gptDecision.confidence);
    const metadata: HybridMetadata = {
      threshold,
      jev: jevRecord,
      escalated: true,
      ...(escalationReason ? { escalationReason } : {}),
      gpt: gptRecord,
      finalSource: "gpt",
      finalAction: gptDecision.action,
    };
    emitTrace(trace, {
      threshold,
      jev: traceRecord(jevRecord, jevDecision),
      escalated: true,
      ...(escalationReason ? { escalationReason } : {}),
      gpt: traceRecord(gptRecord, gptDecision),
      finalSource: "gpt",
      finalAction: gptDecision.action,
    });
    return {
      action: gptDecision.action,
      ...(gptDecision.probabilities ? { probabilities: gptDecision.probabilities } : {}),
      ...(finalConfidence !== undefined ? { confidence: finalConfidence } : {}),
      usage: sumUsage(jevDecision?.usage, gptDecision.usage),
      metadata: { hybrid: metadata },
    };
  }

  if (jevLegal && jevDecision) {
    const finalConfidence = publicConfidence(jevDecision.confidence);
    const fallbackError = gptError ?? "GPT returned an illegal action";
    const metadata: HybridMetadata = {
      threshold,
      jev: jevRecord,
      escalated: true,
      ...(escalationReason ? { escalationReason } : {}),
      gpt: { ...gptRecord, error: fallbackError },
      finalSource: "jev-fallback",
      finalAction: jevDecision.action,
    };
    emitTrace(trace, {
      threshold,
      jev: traceRecord(jevRecord, jevDecision),
      escalated: true,
      ...(escalationReason ? { escalationReason } : {}),
      gpt: { ...traceRecord(gptRecord, gptDecision), error: fallbackError },
      finalSource: "jev-fallback",
      finalAction: jevDecision.action,
    });
    return {
      action: jevDecision.action,
      ...(jevDecision.probabilities ? { probabilities: jevDecision.probabilities } : {}),
      ...(finalConfidence !== undefined ? { confidence: finalConfidence } : {}),
      usage: sumUsage(jevDecision.usage, gptDecision?.usage),
      metadata: { hybrid: metadata },
    };
  }

  const failure = gptError ?? "GPT returned an illegal action";
  emitTrace(trace, {
    threshold,
    jev: traceRecord(jevRecord, jevDecision),
    escalated: true,
    ...(escalationReason ? { escalationReason } : {}),
    gpt: traceRecord(gptRecord, gptDecision),
    finalSource: "error",
  });
  throw hybridFailure(`Hybrid decision failed: ${failure}`, threshold, jevRecord, gptRecord, escalationReason);
}

export class HybridAgent implements MahjongAgent {
  readonly id: string;
  private readonly threshold: number;
  private readonly jev: JevAgent;
  private readonly gpt: GptAgent;

  constructor(threshold = DEFAULT_HYBRID_THRESHOLD, jev?: JevAgent, gpt?: GptAgent) {
    this.threshold = validateHybridThreshold(threshold);
    this.id = `hybrid@${this.threshold}`;
    this.jev = jev ?? new JevAgent();
    this.gpt = gpt ?? new GptAgent();
  }

  async decide(sample: DecisionSample, signal?: AbortSignal): Promise<AgentDecision> {
    return runHybridDecision(sample, sample.legalActions, this.threshold, {
      jev: (input, providerSignal) => this.jev.decide(input, providerSignal),
      gpt: (input, providerSignal) => this.gpt.decide(input, providerSignal),
    }, signal);
  }

  async close(): Promise<void> {
    return;
  }
}

export interface HybridGameProviders {
  jev: HybridProvider<GameDecisionInput>;
  gpt: HybridProvider<GameDecisionInput>;
}

export function hybridGameDecision(
  input: GameDecisionInput,
  threshold: number,
  providers: HybridGameProviders,
  signal?: AbortSignal,
  trace?: HybridTraceCallback,
): Promise<AgentDecision> {
  inspectGameDecisionInput(input);
  return runHybridDecision(input, input.legalActions.map((action) => action.id), threshold, {
    jev: (value, providerSignal) => providers.jev.decide(value, providerSignal),
    gpt: (value, providerSignal) => providers.gpt.decide(value, providerSignal),
  }, signal, trace);
}
