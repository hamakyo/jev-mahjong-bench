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
import { ACTION_SCHEMA_VERSION, PROMPT_VERSION, systemInstruction, toolInputSchema, USAGE_MAPPING_VERSION } from "./prompt.js";
import {
  ProviderRequestError,
  type LlmProvider,
  type NormalizedUsage,
  type ProviderDecisionRequest,
  type ProviderDecisionResult,
} from "./types.js";

interface AnthropicContentBlock {
  type?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  model?: string;
  stop_reason?: string;
  usage?: Record<string, unknown>;
}

export interface AnthropicProviderOptions extends HttpRetryOptions {
  baseUrl?: string;
  apiVersion?: string;
}

function retryable(status: number, details: { quota: boolean }): boolean {
  return !details.quota && (status === 429 || status === 529 || status >= 500);
}

function usage(body: AnthropicResponse): NormalizedUsage | undefined {
  const raw = body.usage;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const inputTokens = typeof raw.input_tokens === "number" ? raw.input_tokens : undefined;
  const outputTokens = typeof raw.output_tokens === "number" ? raw.output_tokens : undefined;
  const cachedInputTokens = typeof raw.cache_read_input_tokens === "number" ? raw.cache_read_input_tokens : undefined;
  const cacheCreationInputTokens = typeof raw.cache_creation_input_tokens === "number" ? raw.cache_creation_input_tokens : undefined;
  const totalTokens = typeof raw.total_tokens === "number" ? raw.total_tokens : undefined;
  const uncachedInputTokens = inputTokens;
  const providerReported = numericProviderCounters(raw);
  if (inputTokens === undefined && outputTokens === undefined && cachedInputTokens === undefined
    && cacheCreationInputTokens === undefined && totalTokens === undefined && !providerReported) return undefined;
  return {
    ...(uncachedInputTokens === undefined ? {} : { uncachedInputTokens }),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(providerReported ? { providerReported } : {}),
  };
}

function toolAction(body: AnthropicResponse): string {
  const blocks = body.content ?? [];
  const toolUses = blocks.filter((block) => block.type === "tool_use");
  if (toolUses.length !== 1) throw new Error(`Anthropic response contained ${toolUses.length} select_action tool calls; expected exactly one`);
  const tool = toolUses[0]!;
  if (tool.name !== "select_action") throw new Error("Anthropic response used an unexpected tool");
  if (!tool.input || typeof tool.input !== "object" || Array.isArray(tool.input)) throw new Error("Anthropic tool input was not an object");
  const action = (tool.input as Record<string, unknown>).action;
  if (typeof action !== "string" || !action) throw new Error("Anthropic tool input had no string action");
  return action;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  private readonly options: AnthropicProviderOptions;

  constructor(options: AnthropicProviderOptions = {}) { this.options = options; }

  async decide(request: ProviderDecisionRequest, model: ResolvedModelDefinition, signal?: AbortSignal): Promise<ProviderDecisionResult> {
    if (model.provider !== "anthropic") throw new Error(`Anthropic provider cannot use ${model.provider} model`);
    const startedAt = performance.now();
    const apiKey = process.env[model.apiKeyEnv];
    if (!apiKey) {
      const call = createProviderCall(model, request, "anthropic-messages", startedAt, { attempts: 0, retryCount: 0, totalBackoffMs: 0, statuses: [] }, { errorCategory: "configuration" });
      throw new ProviderRequestError(`Environment variable ${model.apiKeyEnv} is required for model "${model.id}"`, call, "configuration");
    }
    const baseUrl = (model.baseUrl ?? this.options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");
    let responseMetadata: import("./http.js").HttpAttemptMetadata | undefined;
    try {
      const response = await requestJson<AnthropicResponse>({
        url: `${baseUrl}/messages`,
        ...(signal ? { signal } : {}),
        retry: this.options,
        isRetryable: retryable,
        init: {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": this.options.apiVersion ?? "2023-06-01",
            "Content-Type": "application/json",
            ...resolveHeaders(model),
          },
          body: JSON.stringify({
            model: model.model,
            max_tokens: model.maxOutputTokens ?? 128,
            system: systemInstruction(request.kind),
            messages: [{ role: "user", content: request.canonicalInput }],
            tools: [{
              name: "select_action",
              description: "Select exactly one legal mahjong action ID.",
              input_schema: toolInputSchema(request.legalActionIds),
            }],
            tool_choice: { type: "tool", name: "select_action" },
          }),
        },
      });
      responseMetadata = response.metadata;
      const action = toolAction(response.body);
      const normalizedUsage = usage(response.body);
      const call = createProviderCall(model, request, "anthropic-messages", startedAt, response.metadata, {
        ...(normalizedUsage ? { usage: normalizedUsage } : {}),
        ...(response.body.stop_reason ? { finishReason: response.body.stop_reason } : {}),
      });
      return {
        action,
        ...(normalizedUsage ? { usage: normalizedUsage } : {}),
        ...(response.body.model ? { returnedModel: response.body.model } : {}),
        ...(response.body.stop_reason ? { finishReason: response.body.stop_reason } : {}),
        ...(response.metadata.requestIds?.length ? { requestIds: [...response.metadata.requestIds] } : {}),
        metadata: {
          provider: "anthropic",
          modelId: model.id,
          model: model.model,
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
      throw wrapProviderError(error, model, request, "anthropic-messages", startedAt, responseMetadata);
    }
  }
}
