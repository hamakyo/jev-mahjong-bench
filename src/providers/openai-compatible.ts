import { performance } from "node:perf_hooks";
import {
  createProviderCall,
  numericProviderCounters,
  requestJson,
  resolveHeaders,
  wrapProviderError,
  type HttpRetryOptions,
} from "./http.js";
import type { ResolvedModelDefinition } from "./model-schema.js";
import { ACTION_SCHEMA_VERSION, JSON_MODE_INSTRUCTION, PROMPT_VERSION, systemInstruction, toolInputSchema, USAGE_MAPPING_VERSION } from "./prompt.js";
import {
  ProviderRequestError,
  type LlmProvider,
  type NormalizedUsage,
  type ProviderDecisionRequest,
  type ProviderDecisionResult,
} from "./types.js";

interface ChatMessage {
  content?: unknown;
  tool_calls?: Array<{ type?: string; function?: { name?: string; arguments?: string } }>;
}

interface ChatResponse {
  model?: string;
  choices?: Array<{ message?: ChatMessage; finish_reason?: string }>;
  usage?: Record<string, unknown>;
}

export interface OpenAiCompatibleProviderOptions extends HttpRetryOptions {}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function retryable(status: number, details: { quota: boolean }): boolean {
  return !details.quota && (status === 429 || status >= 500);
}

function usage(body: ChatResponse): NormalizedUsage | undefined {
  const raw = body.usage;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const inputTokens = typeof raw.prompt_tokens === "number" ? raw.prompt_tokens : undefined;
  const outputTokens = typeof raw.completion_tokens === "number" ? raw.completion_tokens : undefined;
  const totalTokens = typeof raw.total_tokens === "number" ? raw.total_tokens : undefined;
  const promptDetails = raw.prompt_tokens_details && typeof raw.prompt_tokens_details === "object" && !Array.isArray(raw.prompt_tokens_details)
    ? raw.prompt_tokens_details as Record<string, unknown> : undefined;
  const completionDetails = raw.completion_tokens_details && typeof raw.completion_tokens_details === "object" && !Array.isArray(raw.completion_tokens_details)
    ? raw.completion_tokens_details as Record<string, unknown> : undefined;
  const cachedInputTokens = firstNumber(promptDetails?.cached_tokens, raw.cached_tokens);
  const cacheCreationInputTokens = firstNumber(
    promptDetails?.cache_write_tokens,
    promptDetails?.cache_creation_input_tokens,
    raw.cache_write_tokens,
    raw.cache_creation_input_tokens,
  );
  const uncachedInputTokens = inputTokens === undefined
    ? undefined
    : Math.max(0, inputTokens - (cachedInputTokens ?? 0) - (cacheCreationInputTokens ?? 0));
  const reasoningTokens = typeof completionDetails?.reasoning_tokens === "number" ? completionDetails.reasoning_tokens : undefined;
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

function jsonAction(content: unknown): string {
  if (typeof content !== "string") throw new Error("OpenAI-compatible response did not contain JSON content");
  let value: unknown;
  try { value = JSON.parse(content) as unknown; } catch { throw new Error("OpenAI-compatible response action was not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OpenAI-compatible response action was not an object");
  const action = (value as Record<string, unknown>).action;
  if (typeof action !== "string" || !action) throw new Error("OpenAI-compatible response had no string action");
  return action;
}

function toolAction(message: ChatMessage): string {
  const calls = message.tool_calls ?? [];
  if (calls.length !== 1) throw new Error(`OpenAI-compatible response contained ${calls.length} tool calls; expected exactly one`);
  const call = calls[0]!;
  if (call.type !== "function" || call.function?.name !== "select_action") throw new Error("OpenAI-compatible response used an unexpected tool");
  const args = call.function.arguments;
  if (typeof args !== "string") throw new Error("OpenAI-compatible tool call had no arguments");
  return jsonAction(args);
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly id = "openai-compatible";
  constructor(private readonly options: OpenAiCompatibleProviderOptions = {}) {}

  async decide(request: ProviderDecisionRequest, model: ResolvedModelDefinition, signal?: AbortSignal): Promise<ProviderDecisionResult> {
    if (model.provider !== "openai-compatible") throw new Error(`OpenAI-compatible provider cannot use ${model.provider} model`);
    const startedAt = performance.now();
    const apiKey = process.env[model.apiKeyEnv];
    if (!apiKey) {
      const call = createProviderCall(model, request, "openai-compatible-chat-completions", startedAt, { attempts: 0, retryCount: 0, totalBackoffMs: 0, statuses: [] }, { errorCategory: "configuration" });
      throw new ProviderRequestError(`Environment variable ${model.apiKeyEnv} is required for model "${model.id}"`, call, "configuration");
    }
    const mode = model.requestMode ?? "json";
    const system = [systemInstruction(request.kind), ...(mode === "json" ? [JSON_MODE_INSTRUCTION] : [])].join("\n");
    const body: Record<string, unknown> = {
      model: model.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: request.canonicalInput },
      ],
      max_tokens: model.maxOutputTokens ?? 128,
      ...(mode === "json" ? { response_format: { type: "json_object" } } : {
        tools: [{ type: "function", function: {
          name: "select_action",
          description: "Select exactly one legal mahjong action ID.",
          parameters: toolInputSchema(request.legalActionIds),
        } }],
        tool_choice: { type: "function", function: { name: "select_action" } },
      }),
    };
    let responseMetadata: import("./http.js").HttpAttemptMetadata | undefined;
    try {
      const response = await requestJson<ChatResponse>({
        url: `${model.baseUrl.replace(/\/+$/, "")}/chat/completions`,
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
          body: JSON.stringify(body),
        },
      });
      responseMetadata = response.metadata;
      const message = response.body.choices?.[0]?.message;
      if (!message) throw new Error("OpenAI-compatible response had no choice message");
      const action = mode === "tool" ? toolAction(message) : jsonAction(message.content);
      const finishReason = response.body.choices?.[0]?.finish_reason;
      const normalizedUsage = usage(response.body);
      const call = createProviderCall(model, request, "openai-compatible-chat-completions", startedAt, response.metadata, {
        ...(normalizedUsage ? { usage: normalizedUsage } : {}),
        ...(finishReason ? { finishReason } : {}),
      });
      return {
        action,
        ...(normalizedUsage ? { usage: normalizedUsage } : {}),
        ...(response.body.model ? { returnedModel: response.body.model } : {}),
        ...(finishReason ? { finishReason } : {}),
        ...(response.metadata.requestIds?.length ? { requestIds: [...response.metadata.requestIds] } : {}),
        metadata: {
          provider: "openai-compatible",
          modelId: model.id,
          model: model.model,
          requestMode: mode,
          promptVersion: PROMPT_VERSION,
          actionSchemaVersion: ACTION_SCHEMA_VERSION,
          usageMappingVersion: USAGE_MAPPING_VERSION,
          attempts: response.metadata.attempts,
          retryCount: response.metadata.retryCount,
          totalBackoffMs: response.metadata.totalBackoffMs,
          statuses: [...response.metadata.statuses],
          ...(response.metadata.requestIds?.length ? { requestIds: [...response.metadata.requestIds] } : {}),
        },
        providerCall: call,
      };
    } catch (error) {
      throw wrapProviderError(error, model, request, "openai-compatible-chat-completions", startedAt, responseMetadata);
    }
  }
}

export const OpenAiCompatibleProvider = OpenAICompatibleProvider;
