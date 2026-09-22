import { performance } from "node:perf_hooks";
import type { ResolvedModelDefinition } from "./model-schema.js";
import {
  actionOutputSchema,
  createProviderDecisionRequest,
  ACTION_SCHEMA_VERSION,
  PROMPT_VERSION,
  systemInstruction,
  USAGE_MAPPING_VERSION,
} from "./prompt.js";
import {
  createProviderCall,
  numericProviderCounters,
  requestJson,
  resolveHeaders,
  wrapProviderError,
  type HttpAttemptMetadata,
  type HttpRetryOptions,
  ProviderHttpError,
} from "./http.js";
import {
  ProviderRequestError,
  type LlmProvider,
  type NormalizedUsage,
  type ProviderDecisionRequest,
  type ProviderDecisionResult,
} from "./types.js";

interface OpenAiResponse {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  model?: string;
  status?: string;
  usage?: Record<string, unknown>;
}

export interface OpenAiProviderOptions extends HttpRetryOptions {
  baseUrl?: string;
}

function outputText(body: OpenAiResponse): string {
  if (typeof body.output_text === "string") return body.output_text;
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response did not contain output_text");
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function usage(body: OpenAiResponse): NormalizedUsage | undefined {
  const raw = body.usage;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const inputTokens = typeof raw.input_tokens === "number" ? raw.input_tokens : undefined;
  const outputTokens = typeof raw.output_tokens === "number" ? raw.output_tokens : undefined;
  const totalTokens = typeof raw.total_tokens === "number" ? raw.total_tokens : undefined;
  const details = raw.input_tokens_details && typeof raw.input_tokens_details === "object" && !Array.isArray(raw.input_tokens_details)
    ? raw.input_tokens_details as Record<string, unknown> : undefined;
  const outputDetails = raw.output_tokens_details && typeof raw.output_tokens_details === "object" && !Array.isArray(raw.output_tokens_details)
    ? raw.output_tokens_details as Record<string, unknown> : undefined;
  const cachedInputTokens = firstNumber(details?.cached_tokens, raw.cached_tokens);
  const cacheCreationInputTokens = firstNumber(
    details?.cache_write_tokens,
    details?.cache_creation_input_tokens,
    raw.cache_write_tokens,
    raw.cache_creation_input_tokens,
  );
  const uncachedInputTokens = inputTokens === undefined
    ? undefined
    : Math.max(0, inputTokens - (cachedInputTokens ?? 0) - (cacheCreationInputTokens ?? 0));
  const reasoningTokens = typeof outputDetails?.reasoning_tokens === "number" ? outputDetails.reasoning_tokens : undefined;
  const providerReported = numericProviderCounters(raw);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined
    && cachedInputTokens === undefined && cacheCreationInputTokens === undefined && reasoningTokens === undefined && !providerReported) return undefined;
  return {
    ...(uncachedInputTokens === undefined ? {} : { uncachedInputTokens }),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(providerReported ? { providerReported } : {}),
  };
}

function jsonAction(text: string): string {
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { throw new Error("OpenAI response action was not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OpenAI response action was not an object");
  const action = (value as Record<string, unknown>).action;
  if (typeof action !== "string" || !action) throw new Error("OpenAI response had no string action");
  return action;
}

function retryable(status: number, details: { quota: boolean }): boolean {
  return !details.quota && (status === 429 || status === 503);
}

function metadata(metadata: HttpAttemptMetadata, model: ResolvedModelDefinition): Record<string, unknown> {
  return {
    provider: "openai",
    modelId: model.id,
    model: model.model,
    promptVersion: PROMPT_VERSION,
    actionSchemaVersion: ACTION_SCHEMA_VERSION,
    usageMappingVersion: USAGE_MAPPING_VERSION,
    attempts: metadata.attempts,
    retryCount: metadata.retryCount,
    totalBackoffMs: metadata.totalBackoffMs,
    statuses: [...metadata.statuses],
    ...(metadata.requestIds?.length ? { requestIds: [...metadata.requestIds] } : {}),
    ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
  };
}

export class OpenAIProvider implements LlmProvider {
  readonly id = "openai";
  private readonly options: OpenAiProviderOptions;

  constructor(options: OpenAiProviderOptions = {}) { this.options = options; }

  async decide(request: ProviderDecisionRequest, model: ResolvedModelDefinition, signal?: AbortSignal): Promise<ProviderDecisionResult> {
    if (model.provider !== "openai") throw new Error(`OpenAI provider cannot use ${model.provider} model`);
    const startedAt = performance.now();
    const apiKey = process.env[model.apiKeyEnv];
    if (!apiKey) {
      const call = createProviderCall(model, request, "openai-responses", startedAt, { attempts: 0, retryCount: 0, totalBackoffMs: 0, statuses: [] }, { errorCategory: "configuration" });
      throw new ProviderRequestError(`Environment variable ${model.apiKeyEnv} is required for model "${model.id}"`, call, "configuration");
    }
    const baseUrl = (model.baseUrl ?? this.options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    let responseMetadata: HttpAttemptMetadata | undefined;
    try {
      const response = await requestJson<OpenAiResponse>({
        url: `${baseUrl}/responses`,
        ...(signal ? { signal } : {}),
        retry: this.options,
        isRetryable: retryable,
        init: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...resolveHeaders(model),
          },
          body: JSON.stringify({
            model: model.model,
            store: false,
            ...(model.reasoningEffort ? { reasoning: { effort: model.reasoningEffort } } : {}),
            max_output_tokens: model.maxOutputTokens ?? 128,
            instructions: systemInstruction(request.kind),
            input: request.canonicalInput,
            text: {
              format: actionOutputSchema(request.legalActionIds, request.kind === "game" ? "mahjong_game_action" : "mahjong_discard"),
            },
          }),
        },
      });
      responseMetadata = response.metadata;
      const action = jsonAction(outputText(response.body));
      const normalizedUsage = usage(response.body);
      const call = createProviderCall(model, request, "openai-responses", startedAt, response.metadata, {
        ...(normalizedUsage ? { usage: normalizedUsage } : {}),
        ...(response.body.status ? { finishReason: response.body.status } : {}),
      });
      return {
        action,
        ...(normalizedUsage ? { usage: normalizedUsage } : {}),
        ...(response.body.model ? { returnedModel: response.body.model } : {}),
        ...(response.body.status ? { finishReason: response.body.status } : {}),
        ...(response.metadata.requestIds?.length ? { requestIds: [...response.metadata.requestIds] } : {}),
        metadata: metadata(response.metadata, model),
        providerCall: call,
      };
    } catch (error) {
      throw wrapProviderError(error, model, request, "openai-responses", startedAt, responseMetadata);
    }
  }
}

/** Alias retained for callers that use the provider name as a class name. */
export const OpenAiProvider = OpenAIProvider;

export function openAiRequestFor(input: Parameters<typeof createProviderDecisionRequest>[0]) {
  return createProviderDecisionRequest(input);
}
