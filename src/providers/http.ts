import type { ProviderDecisionRequest } from "./types.js";
import {
  ProviderRequestError,
  type ProviderCallRecord,
  type ProviderErrorCategory,
} from "./types.js";
import type { ResolvedModelDefinition } from "./model-schema.js";

export interface HttpRetryOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  retryBudgetMs?: number;
  jitterMs?: number;
}

export const DEFAULT_HTTP_RETRY_OPTIONS: Required<HttpRetryOptions> = {
  maxRetries: 3,
  initialBackoffMs: 500,
  maxBackoffMs: 10_000,
  retryBudgetMs: 30_000,
  jitterMs: 100,
};

export interface HttpAttemptMetadata {
  attempts: number;
  retryCount: number;
  totalBackoffMs: number;
  statuses: number[];
  requestIds?: string[];
}

export class ProviderHttpError extends Error {
  readonly metadata: HttpAttemptMetadata;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly category: ProviderErrorCategory;

  constructor(
    message: string,
    metadata: HttpAttemptMetadata,
    category: ProviderErrorCategory,
    status?: number,
    code?: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
    this.metadata = cloneHttpMetadata(metadata);
    this.category = category;
    this.status = status;
    this.code = code;
  }
}

function cloneHttpMetadata(value: HttpAttemptMetadata): HttpAttemptMetadata {
  return {
    attempts: value.attempts,
    retryCount: value.retryCount,
    totalBackoffMs: value.totalBackoffMs,
    statuses: [...value.statuses],
    ...(value.requestIds?.length ? { requestIds: [...value.requestIds] } : {}),
  };
}

export function abortError(metadata?: HttpAttemptMetadata): ProviderHttpError {
  return new ProviderHttpError("agent call aborted", metadata ?? { attempts: 0, retryCount: 0, totalBackoffMs: 0, statuses: [] }, "aborted");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function sleep(ms: number, signal?: AbortSignal, metadata?: HttpAttemptMetadata): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) return Promise.reject(abortError(metadata));
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(metadata));
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

interface ErrorDetails { message: string; code?: string; type?: string; quota: boolean; }

function errorDetails(value: unknown, status: number): ErrorDetails {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    const nested = raw.error && typeof raw.error === "object" && !Array.isArray(raw.error)
      ? raw.error as Record<string, unknown>
      : raw;
    const message = typeof nested.message === "string" ? nested.message : `provider request failed with HTTP ${status}`;
    const code = typeof nested.code === "string" ? nested.code : undefined;
    const type = typeof nested.type === "string" ? nested.type : undefined;
    const searchable = [message, code, type].filter(Boolean).join(" ").toLowerCase();
    return { message, ...(code ? { code } : {}), ...(type ? { type } : {}), quota: /insufficient[_ -]?quota|quota|billing|spend[_ -]?limit|payment|credit/.test(searchable) };
  }
  return { message: `provider request failed with HTTP ${status}`, quota: false };
}

export interface RequestJsonOptions<T> {
  url: string;
  init: RequestInit;
  signal?: AbortSignal;
  retry?: HttpRetryOptions;
  isRetryable?: (status: number, details: ErrorDetails) => boolean;
  parse?: (value: unknown) => T;
}

export interface JsonResponse<T> {
  body: T;
  metadata: HttpAttemptMetadata;
  status: number;
}

export async function requestJson<T = Record<string, unknown>>(options: RequestJsonOptions<T>): Promise<JsonResponse<T>> {
  const retry = { ...DEFAULT_HTTP_RETRY_OPTIONS, ...(options.retry ?? {}) };
  if (!Number.isInteger(retry.maxRetries) || retry.maxRetries < 0
    || !Number.isFinite(retry.initialBackoffMs) || retry.initialBackoffMs < 0
    || !Number.isFinite(retry.maxBackoffMs) || retry.maxBackoffMs < retry.initialBackoffMs
    || !Number.isFinite(retry.retryBudgetMs) || retry.retryBudgetMs < 0
    || !Number.isFinite(retry.jitterMs) || retry.jitterMs < 0) {
    throw new Error("provider retry options must be finite, non-negative, and maxBackoffMs must cover initialBackoffMs");
  }
  const metadata: HttpAttemptMetadata = { attempts: 0, retryCount: 0, totalBackoffMs: 0, statuses: [] };
  const requestIds: string[] = [];
  const started = Date.now();
  while (true) {
    throwIfAborted(options.signal);
    metadata.attempts += 1;
    let response: Response;
    try {
      response = await fetch(options.url, { ...options.init, ...(options.signal ? { signal: options.signal } : {}) });
    } catch (error) {
      if (options.signal?.aborted) throw abortError(metadata);
      throw new ProviderHttpError(error instanceof Error ? error.message : String(error), metadata, "network");
    }
    metadata.statuses.push(response.status);
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
    if (requestId) requestIds.push(requestId);
    if (requestIds.length) metadata.requestIds = requestIds;

    const raw = await response.text();
    let parsed: unknown;
    let validJson = false;
    if (raw.trim()) {
      try { parsed = JSON.parse(raw) as unknown; validJson = true; } catch { /* handled below */ }
    }
    if (response.ok) {
      if (!validJson) throw new ProviderHttpError("provider returned non-JSON response", metadata, "invalid-response", response.status);
      try {
        return { body: options.parse ? options.parse(parsed) : parsed as T, metadata: cloneHttpMetadata(metadata), status: response.status };
      } catch (error) {
        if (error instanceof ProviderHttpError) throw error;
        throw new ProviderHttpError(error instanceof Error ? error.message : "provider returned an invalid response", metadata, "invalid-response", response.status);
      }
    }

    const details = errorDetails(validJson ? parsed : undefined, response.status);
    const retryable = options.isRetryable?.(response.status, details) ?? (
      !details.quota && (response.status === 429 || response.status >= 500)
    );
    if (!retryable || metadata.retryCount >= retry.maxRetries) {
      const category: ProviderErrorCategory = details.quota ? "quota" : response.status === 429 ? "rate-limit" : response.status >= 500 ? "server" : response.status === 401 || response.status === 403 ? "authentication" : "unknown";
      throw new ProviderHttpError(details.message, metadata, category, response.status, details.code);
    }
    const retryNumber = metadata.retryCount + 1;
    const fallbackDelay = Math.min(retry.maxBackoffMs, retry.initialBackoffMs * (2 ** (retryNumber - 1)));
    const baseDelay = retryAfterMs(response.headers) ?? fallbackDelay;
    const delay = baseDelay + Math.random() * retry.jitterMs;
    if (delay > retry.maxBackoffMs || Date.now() - started + delay > retry.retryBudgetMs) {
      const category: ProviderErrorCategory = details.quota ? "quota" : response.status === 429 ? "rate-limit" : "server";
      throw new ProviderHttpError(details.message, metadata, category, response.status, details.code);
    }
    metadata.retryCount += 1;
    metadata.totalBackoffMs += delay;
    await sleep(delay, options.signal, metadata);
  }
}

function numericCounters(value: unknown, prefix = "", output: Record<string, number> = {}): Record<string, number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    output[prefix] = value;
    return output;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) numericCounters(child, prefix ? `${prefix}.${key}` : key, output);
  return output;
}

export function numericProviderCounters(value: unknown): Record<string, number> | undefined {
  const counters = numericCounters(value);
  return Object.keys(counters).length ? counters : undefined;
}

export function resolveHeaders(model: ResolvedModelDefinition): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, reference] of Object.entries(model.headers ?? {})) {
    const value = process.env[reference.env];
    if (!value) throw new ProviderRequestError(
      `Environment variable ${reference.env} is required for model "${model.id}"`,
      {
        providerId: model.provider,
        modelId: model.id,
        model: model.model,
        endpointFamily: "configuration",
        canonicalInputBytes: 0,
        latencyMs: 0,
        logicalCallCount: 1,
        httpAttemptCount: 0,
        retryCount: 0,
        errorCategory: "configuration",
      },
      "configuration",
    );
    result[name] = value;
  }
  return result;
}

export function createProviderCall(
  model: ResolvedModelDefinition,
  request: ProviderDecisionRequest,
  endpointFamily: string,
  startedAt: number,
  metadata: HttpAttemptMetadata,
  extras: Partial<Pick<ProviderCallRecord, "usage" | "finishReason" | "errorCategory">> = {},
): ProviderCallRecord {
  return {
    providerId: model.provider,
    modelId: model.id,
    model: model.model,
    endpointFamily,
    canonicalInputBytes: request.canonicalInputBytes,
    latencyMs: Math.max(0, performance.now() - startedAt),
    logicalCallCount: 1,
    httpAttemptCount: metadata.attempts,
    retryCount: metadata.retryCount,
    ...(metadata.requestIds?.length ? { requestIds: [...metadata.requestIds] } : {}),
    ...(extras.usage ? { usage: extras.usage } : {}),
    ...(extras.finishReason ? { finishReason: extras.finishReason } : {}),
    ...(extras.errorCategory ? { errorCategory: extras.errorCategory } : {}),
  };
}

export function wrapProviderError(
  error: unknown,
  model: ResolvedModelDefinition,
  request: ProviderDecisionRequest,
  endpointFamily: string,
  startedAt: number,
  fallbackMetadata?: HttpAttemptMetadata,
): ProviderRequestError {
  const http = error instanceof ProviderHttpError ? error : undefined;
  const metadata = http?.metadata ?? fallbackMetadata ?? { attempts: 0, retryCount: 0, totalBackoffMs: 0, statuses: [] };
  const call = createProviderCall(model, request, endpointFamily, startedAt, metadata, {
    errorCategory: http?.category ?? "unknown",
  });
  if (error instanceof ProviderRequestError) {
    // Header/env validation can fail before requestJson starts. Preserve the
    // actual canonical input and endpoint family in that safe configuration
    // record instead of leaking a zero-byte placeholder into artifacts.
    const providerCall: ProviderCallRecord = {
      ...error.providerCall,
      endpointFamily,
      canonicalInputBytes: request.canonicalInputBytes,
    };
    return new ProviderRequestError(error.message, providerCall, error.category, error.status, error.code, error.requestMetadata);
  }
  return new ProviderRequestError(
    error instanceof Error ? error.message : String(error),
    call,
    http?.category ?? "unknown",
    http?.status,
    http?.code,
    metadata,
  );
}
