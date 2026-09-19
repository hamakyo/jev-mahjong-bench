import type { MahjongAgent } from "./agent.js";
import type { AgentDecision, DecisionSample, GameDecisionInput } from "../types.js";
import { inspectGameDecisionInput } from "../game/input.js";

type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

interface ResponsesBody {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; code?: string; type?: string };
}

export interface GptRequestMetadata {
  attempts: number;
  retryCount: number;
  totalBackoffMs: number;
  statuses: number[];
  requestIds?: string[];
}

export interface GptRetryOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  retryBudgetMs?: number;
  jitterMs?: number;
}

export const DEFAULT_GPT_RETRY_OPTIONS: Required<GptRetryOptions> = {
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

  constructor(message: string, metadata: GptRequestMetadata, status?: number, code?: string) {
    super(message);
    this.name = "GptRequestError";
    this.metadata = metadata;
    this.status = status;
    this.code = code;
  }
}

function outputText(body: ResponsesBody): string {
  if (typeof body.output_text === "string") return body.output_text;
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response did not contain output_text");
}

function abortError(metadata?: GptRequestMetadata): Error {
  const error = new Error("agent call aborted");
  error.name = "AbortError";
  if (metadata) Object.assign(error, { metadata: requestMetadata(metadata) });
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return signal?.aborted ? Promise.reject(abortError()) : Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

interface ErrorDetails {
  message: string;
  code?: string;
  type?: string;
  structured: boolean;
}

function errorDetails(body: ResponsesBody | undefined, rawBody: string, status: number): ErrorDetails {
  if (body?.error) {
    return {
      message: body.error.message ?? "OpenAI request failed",
      ...(body.error.code ? { code: body.error.code } : {}),
      ...(body.error.type ? { type: body.error.type } : {}),
      structured: true,
    };
  }
  return {
    message: rawBody.trim().slice(0, 1_000) || `OpenAI request failed: ${status}`,
    structured: false,
  };
}

function isPermanent429(details: ErrorDetails): boolean {
  if (!details.structured) return false;
  const value = [details.code, details.type, details.message].filter(Boolean).join(" ").toLowerCase();
  return /insufficient[_ -]?quota|quota|billing|spend[_ -]?limit|payment|credit/.test(value);
}

function isRetryable(status: number, details: ErrorDetails): boolean {
  if (status === 429) return !isPermanent429(details);
  return status === 503 && !isPermanent429(details);
}

function requestMetadata(value: GptRequestMetadata): GptRequestMetadata {
  return {
    attempts: value.attempts,
    retryCount: value.retryCount,
    totalBackoffMs: value.totalBackoffMs,
    statuses: [...value.statuses],
    ...(value.requestIds?.length ? { requestIds: [...value.requestIds] } : {}),
  };
}

export class GptAgent implements MahjongAgent {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly effort: ReasoningEffort;
  private readonly retryOptions: Required<GptRetryOptions>;

  constructor(options: GptRetryOptions = {}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for the GPT agent");
    this.apiKey = apiKey;
    this.model = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
    this.effort = (process.env.OPENAI_REASONING_EFFORT as ReasoningEffort | undefined) ?? "none";
    this.retryOptions = { ...DEFAULT_GPT_RETRY_OPTIONS, ...options };
    if (!Number.isInteger(this.retryOptions.maxRetries) || this.retryOptions.maxRetries < 0
      || !Number.isFinite(this.retryOptions.initialBackoffMs) || this.retryOptions.initialBackoffMs < 0
      || !Number.isFinite(this.retryOptions.maxBackoffMs) || this.retryOptions.maxBackoffMs < 0
      || !Number.isFinite(this.retryOptions.retryBudgetMs) || this.retryOptions.retryBudgetMs < 0
      || !Number.isFinite(this.retryOptions.jitterMs) || this.retryOptions.jitterMs < 0
      || this.retryOptions.maxBackoffMs < this.retryOptions.initialBackoffMs) {
      throw new Error("GPT retry options must be finite, non-negative, and maxBackoffMs must cover initialBackoffMs");
    }
    this.id = `gpt:${this.model}`;
  }

  private async request(payload: Record<string, unknown>, signal?: AbortSignal): Promise<{ body: ResponsesBody; metadata: GptRequestMetadata }> {
    const metadata: GptRequestMetadata = { attempts: 0, retryCount: 0, totalBackoffMs: 0, statuses: [] };
    const requestIds: string[] = [];
    const retryStartedAt = Date.now();

    while (true) {
      throwIfAborted(signal);
      metadata.attempts += 1;
      let response: Response;
      try {
        response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          ...(signal ? { signal } : {}),
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (signal?.aborted) throw abortError(metadata);
        throw new GptRequestError(error instanceof Error ? error.message : String(error), requestMetadata(metadata));
      }

      metadata.statuses.push(response.status);
      const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
      if (requestId) requestIds.push(requestId);
      if (requestIds.length) metadata.requestIds = requestIds;

      let body: ResponsesBody | undefined;
      let rawBody = "";
      let bodyError: unknown;
      try {
        rawBody = await response.text();
        if (rawBody.trim()) {
          const parsed: unknown = JSON.parse(rawBody);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as ResponsesBody;
        }
      } catch (error) {
        bodyError = error;
      }
      if (response.ok) {
        if (!body) {
          throw new GptRequestError(
            `OpenAI response was not valid JSON: ${bodyError instanceof Error ? bodyError.message : "missing JSON object"}`,
            requestMetadata(metadata),
            response.status,
          );
        }
        return { body, metadata: requestMetadata(metadata) };
      }

      const details = errorDetails(body, rawBody, response.status);
      const message = `${details.message}${details.code ? ` (code: ${details.code})` : ""}`;
      const retryable = isRetryable(response.status, details);
      if (!retryable || metadata.retryCount >= this.retryOptions.maxRetries) {
        throw new GptRequestError(message, requestMetadata(metadata), response.status, details.code);
      }

      const retryNumber = metadata.retryCount + 1;
      const serverDelay = retryAfterMs(response.headers);
      const fallbackDelay = Math.min(
        this.retryOptions.maxBackoffMs,
        this.retryOptions.initialBackoffMs * (2 ** (retryNumber - 1)),
      );
      const baseDelay = serverDelay ?? fallbackDelay;
      const delay = baseDelay + Math.random() * this.retryOptions.jitterMs;
      const elapsed = Date.now() - retryStartedAt;
      if (delay > this.retryOptions.maxBackoffMs || elapsed + delay > this.retryOptions.retryBudgetMs) {
        throw new GptRequestError(message, requestMetadata(metadata), response.status, details.code);
      }

      metadata.retryCount += 1;
      metadata.totalBackoffMs += delay;
      try {
        await sleep(delay, signal);
      } catch (error) {
        if (signal?.aborted) throw abortError(metadata);
        throw error;
      }
    }
  }

  private metadata(request: GptRequestMetadata): Record<string, unknown> {
    return {
      model: this.model,
      reasoningEffort: this.effort,
      ...request,
    };
  }

  async decide(sample: DecisionSample, signal?: AbortSignal): Promise<AgentDecision> {
    throwIfAborted(signal);
    const response = await this.request({
      model: this.model,
      reasoning: { effort: this.effort },
      max_output_tokens: 128,
      instructions:
        "You are playing Japanese riichi mahjong. Choose the strongest discard from legalActions. Do not explain.",
      input: JSON.stringify({ state: sample.state, legalActions: sample.legalActions }),
      text: {
        format: {
          type: "json_schema",
          name: "mahjong_discard",
          strict: true,
          schema: {
            type: "object",
            properties: { action: { type: "string", enum: sample.legalActions } },
            required: ["action"],
            additionalProperties: false,
          },
        },
      },
    }, signal);

    if (signal?.aborted) throw abortError(response.metadata);
    const parsed = JSON.parse(outputText(response.body)) as { action?: unknown };
    if (typeof parsed.action !== "string") throw new Error("OpenAI response had no string action");
    return {
      action: parsed.action,
      ...(response.body.usage ? {
        usage: {
          ...(typeof response.body.usage.input_tokens === "number" ? { inputTokens: response.body.usage.input_tokens } : {}),
          ...(typeof response.body.usage.output_tokens === "number" ? { outputTokens: response.body.usage.output_tokens } : {}),
        },
      } : {}),
      metadata: this.metadata(response.metadata),
    };
  }

  async decideGame(input: GameDecisionInput, signal?: AbortSignal): Promise<AgentDecision> {
    throwIfAborted(signal);
    inspectGameDecisionInput(input);
    const response = await this.request({
      model: this.model,
      reasoning: { effort: this.effort },
      max_output_tokens: 128,
      instructions:
        "You are playing Japanese riichi mahjong in a complete game. Choose exactly one legal operation. The action id is only an identifier; inspect the corresponding type and MJAI object. Calls, riichi, wins, draws, abortive draws, passes, and discards are all possible. Return only the selected action id.",
      input: JSON.stringify({
        id: input.id,
        state: input.state,
        legalActions: input.legalActions.map((action) => ({
          id: action.id,
          type: action.type,
          mjai: action.mjai,
        })),
      }),
      text: {
        format: {
          type: "json_schema",
          name: "mahjong_game_action",
          strict: true,
          schema: {
            type: "object",
            properties: { action: { type: "string", enum: input.legalActions.map((action) => action.id) } },
            required: ["action"],
            additionalProperties: false,
          },
        },
      },
    }, signal);

    if (signal?.aborted) throw abortError(response.metadata);
    const parsed = JSON.parse(outputText(response.body)) as { action?: unknown };
    if (typeof parsed.action !== "string") throw new Error("OpenAI response had no string action");
    return {
      action: parsed.action,
      ...(response.body.usage ? {
        usage: {
          ...(typeof response.body.usage.input_tokens === "number" ? { inputTokens: response.body.usage.input_tokens } : {}),
          ...(typeof response.body.usage.output_tokens === "number" ? { outputTokens: response.body.usage.output_tokens } : {}),
        },
      } : {}),
      metadata: this.metadata(response.metadata),
    };
  }
}
