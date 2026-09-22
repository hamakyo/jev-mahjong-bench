import type { MahjongAgent } from "./agent.js";
import type { AgentDecision, DecisionSample, GameDecisionInput, TokenUsage } from "../types.js";
import { createProviderDecisionRequest } from "../providers/prompt.js";
import { ModelRegistry } from "../providers/registry.js";
import { OpenAIProvider, type OpenAiProviderOptions } from "../providers/openai.js";
import { ProviderRequestError, type ProviderCallRecord } from "../providers/types.js";

export interface GptRequestMetadata {
  attempts: number;
  retryCount: number;
  totalBackoffMs: number;
  statuses: number[];
  requestIds?: string[];
}

export interface GptRetryOptions extends OpenAiProviderOptions {}

export const DEFAULT_GPT_RETRY_OPTIONS = {
  maxRetries: 3,
  initialBackoffMs: 500,
  maxBackoffMs: 10_000,
  retryBudgetMs: 30_000,
  jitterMs: 100,
};

export class GptRequestError extends Error {
  readonly metadata: GptRequestMetadata;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly providerCall: ProviderCallRecord | undefined;

  constructor(message: string, metadata: GptRequestMetadata, status?: number, code?: string, providerCall?: ProviderCallRecord) {
    super(message);
    this.name = "GptRequestError";
    this.metadata = metadata;
    this.status = status;
    this.code = code;
    this.providerCall = providerCall;
  }
}

function requestMetadata(error: ProviderRequestError): GptRequestMetadata {
  const value = error.requestMetadata;
  return {
    attempts: value?.attempts ?? error.providerCall.httpAttemptCount,
    retryCount: value?.retryCount ?? error.providerCall.retryCount,
    totalBackoffMs: value?.totalBackoffMs ?? 0,
    statuses: value?.statuses ? [...value.statuses] : [],
    ...(value?.requestIds?.length ? { requestIds: [...value.requestIds] } : error.providerCall.requestIds?.length ? { requestIds: [...error.providerCall.requestIds] } : {}),
  };
}

function toGptError(error: unknown): Error {
  if (!(error instanceof ProviderRequestError)) return error instanceof Error ? error : new Error(String(error));
  const mapped = new GptRequestError(error.message, requestMetadata(error), error.status, error.code, structuredClone(error.providerCall));
  if (error.category === "aborted") mapped.name = "AbortError";
  return mapped;
}

function tokenUsage(value: { inputTokens?: number; outputTokens?: number } | undefined): TokenUsage | undefined {
  if (!value || (value.inputTokens === undefined && value.outputTokens === undefined)) return undefined;
  return {
    ...(value.inputTokens === undefined ? {} : { inputTokens: value.inputTokens }),
    ...(value.outputTokens === undefined ? {} : { outputTokens: value.outputTokens }),
  };
}

/** Compatibility facade for the former hard-coded GPT agent. */
export class GptAgent implements MahjongAgent {
  readonly id: string;
  private readonly model;
  private readonly provider: OpenAIProvider;
  lastProviderCalls: ProviderCallRecord[] | undefined;

  constructor(options: GptRetryOptions = {}) {
    this.model = new ModelRegistry([], true).resolve("gpt");
    if (!process.env[this.model.apiKeyEnv]) throw new Error(`${this.model.apiKeyEnv} is required for the GPT agent`);
    this.provider = new OpenAIProvider(options);
    this.id = `gpt:${this.model.model}`;
  }

  private async decideInput(input: DecisionSample | GameDecisionInput, signal?: AbortSignal): Promise<AgentDecision> {
    const request = createProviderDecisionRequest(input);
    try {
      const result = await this.provider.decide(request, this.model, signal);
      this.lastProviderCalls = [structuredClone(result.providerCall)];
      const usage = tokenUsage(result.usage);
      return {
        action: result.action,
        ...(usage ? { usage } : {}),
        ...(result.usage ? { normalizedUsage: structuredClone(result.usage) } : {}),
        ...(result.metadata ? { metadata: result.metadata } : {}),
        providerCalls: structuredClone(this.lastProviderCalls),
      };
    } catch (error) {
      const mapped = toGptError(error);
      if (mapped instanceof GptRequestError) this.lastProviderCalls = mapped.providerCall ? [structuredClone(mapped.providerCall)] : undefined;
      throw mapped;
    }
  }

  async decide(sample: DecisionSample, signal?: AbortSignal): Promise<AgentDecision> {
    return this.decideInput(sample, signal);
  }

  async decideGame(input: GameDecisionInput, signal?: AbortSignal): Promise<AgentDecision> {
    return this.decideInput(input, signal);
  }
}
