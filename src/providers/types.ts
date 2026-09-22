import type { DecisionSample, GameDecisionInput } from "../types.js";
import type { ResolvedModelDefinition } from "./model-schema.js";

/** A provider may be used by both the decision benchmark and complete-game path. */
export type ProviderInput = DecisionSample | GameDecisionInput;

export interface ProviderDecisionRequest {
  /** Identifies which prompt shape is required by the adapter. */
  readonly kind: "decision" | "game";
  readonly input: ProviderInput;
  /** Canonical, provider-independent JSON sent as the user payload. */
  readonly canonicalInput: string;
  readonly canonicalInputBytes: number;
  readonly legalActionIds: readonly string[];
}

export interface NormalizedUsage {
  /** Input tokens billed at the ordinary, uncached input rate. */
  uncachedInputTokens?: number;
  /** Provider-reported total input tokens, when the provider reports one. */
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
  /** Numeric counters which do not have a safe cross-provider mapping. */
  providerReported?: Record<string, number>;
}

export type ProviderErrorCategory =
  | "aborted"
  | "authentication"
  | "configuration"
  | "invalid-request"
  | "invalid-response"
  | "network"
  | "quota"
  | "rate-limit"
  | "server"
  | "unknown";

export interface ProviderCallRecord {
  providerId: string;
  modelId: string;
  model: string;
  endpointFamily: string;
  canonicalInputBytes: number;
  latencyMs: number;
  logicalCallCount: 1;
  httpAttemptCount: number;
  retryCount: number;
  usage?: NormalizedUsage;
  requestIds?: string[];
  finishReason?: string;
  errorCategory?: ProviderErrorCategory;
}

export interface ProviderAttemptMetadata {
  attempts: number;
  retryCount: number;
  totalBackoffMs: number;
  statuses: number[];
  requestIds?: string[];
}

export interface ProviderDecisionResult {
  /** Parsed action identifier. Legality is checked by the generic agent. */
  action: string;
  usage?: NormalizedUsage;
  /** Model string returned by the vendor, when available. */
  returnedModel?: string;
  finishReason?: string;
  requestIds?: string[];
  /** Safe, provider-specific counters/settings only. Never secrets or bodies. */
  metadata?: Record<string, unknown>;
  providerCall: ProviderCallRecord;
}

export interface LlmProvider {
  readonly id: string;

  decide(
    request: ProviderDecisionRequest,
    model: ResolvedModelDefinition,
    signal?: AbortSignal,
  ): Promise<ProviderDecisionResult>;
  close?(): Promise<void> | void;
}

/** Errors carry only safe call metadata so tournament artifacts can record failures. */
export class ProviderRequestError extends Error {
  readonly providerCall: ProviderCallRecord;
  readonly category: ProviderErrorCategory;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly requestMetadata: ProviderAttemptMetadata | undefined;

  constructor(
    message: string,
    providerCall: ProviderCallRecord,
    category: ProviderErrorCategory,
    status?: number,
    code?: string,
    requestMetadata?: ProviderAttemptMetadata,
  ) {
    super(message);
    this.name = "ProviderRequestError";
    this.providerCall = providerCall;
    this.category = category;
    this.status = status;
    this.code = code;
    this.requestMetadata = requestMetadata ? structuredClone(requestMetadata) : undefined;
  }
}
