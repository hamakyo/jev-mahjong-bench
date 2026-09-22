import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { parseDocument } from "yaml";
import { canonicalJson } from "../mjai/tiles.js";
import {
  ENV_NAME_RE,
  RESERVED_MODEL_IDS,
  type CompatibleRequestMode,
  type HeaderEnvReference,
  type ModelDefinition,
  type OpenAiCompatibleModelDefinition,
  type ReasoningEffort,
  type ResolvedModelDefinition,
} from "./model-schema.js";

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ALLOWED_COMMON = new Set(["provider", "model", "apiKeyEnv", "baseUrl", "headers", "reasoningEffort", "maxOutputTokens"]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return string(value, label);
}

function validateEnvName(value: string, label: string): string {
  if (!ENV_NAME_RE.test(value)) throw new Error(`${label} must be a valid environment variable name`);
  return value;
}

function validateUrl(value: string, label: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute http(s) URL`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must be an absolute http(s) URL`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  return value.replace(/\/+$/, "");
}

function parseHeaders(value: unknown, label: string): Record<string, HeaderEnvReference> | undefined {
  if (value === undefined) return undefined;
  const raw = object(value, label);
  const headers: Record<string, HeaderEnvReference> = {};
  for (const [name, referenceValue] of Object.entries(raw)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error(`${label} has an invalid header name`);
    const reference = object(referenceValue, `${label}.${name}`);
    const keys = Object.keys(reference);
    if (keys.length !== 1 || keys[0] !== "env") throw new Error(`${label}.${name} must contain only env`);
    headers[name] = { env: validateEnvName(string(reference.env, `${label}.${name}.env`), `${label}.${name}.env`) };
  }
  return headers;
}

function rejectUnknown(raw: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`${label} has unknown field "${key}"`);
}

function parseDefinition(id: string, value: unknown, label = `models.${id}`): ModelDefinition {
  if (!MODEL_ID_RE.test(id)) throw new Error(`${label} has an invalid model ID`);
  if (RESERVED_MODEL_IDS.has(id)) throw new Error(`${label} uses reserved model ID "${id}"`);
  const raw = object(value, label);
  rejectUnknown(raw, new Set([...ALLOWED_COMMON, "requestMode"]), label);
  const provider = string(raw.provider, `${label}.provider`);
  if (provider !== "openai" && provider !== "anthropic" && provider !== "openai-compatible") {
    throw new Error(`${label}.provider must be openai, anthropic, or openai-compatible`);
  }
  const model = string(raw.model, `${label}.model`);
  const apiKeyEnv = raw.apiKeyEnv === undefined ? undefined : validateEnvName(string(raw.apiKeyEnv, `${label}.apiKeyEnv`), `${label}.apiKeyEnv`);
  const baseUrl = raw.baseUrl === undefined ? undefined : validateUrl(string(raw.baseUrl, `${label}.baseUrl`), `${label}.baseUrl`);
  const headers = parseHeaders(raw.headers, `${label}.headers`);
  const reasoningEffort = raw.reasoningEffort === undefined ? undefined : string(raw.reasoningEffort, `${label}.reasoningEffort`) as ReasoningEffort;
  if (reasoningEffort !== undefined && !["none", "low", "medium", "high", "xhigh", "max", "ultra"].includes(reasoningEffort)) {
    throw new Error(`${label}.reasoningEffort is invalid`);
  }
  if (reasoningEffort !== undefined && provider !== "openai") {
    throw new Error(`${label}.reasoningEffort is not supported for ${provider} models`);
  }
  const maxOutputTokens = raw.maxOutputTokens === undefined ? undefined : raw.maxOutputTokens;
  if (maxOutputTokens !== undefined && (typeof maxOutputTokens !== "number" || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1)) {
    throw new Error(`${label}.maxOutputTokens must be a positive integer`);
  }
  const requestMode = raw.requestMode === undefined ? undefined : string(raw.requestMode, `${label}.requestMode`) as CompatibleRequestMode;
  if (requestMode !== undefined && requestMode !== "json" && requestMode !== "tool") throw new Error(`${label}.requestMode must be json or tool`);
  if (provider === "openai-compatible" && !baseUrl) throw new Error(`${label}.baseUrl is required for openai-compatible models`);
  if (provider !== "openai-compatible" && requestMode !== undefined) throw new Error(`${label}.requestMode is only valid for openai-compatible models`);
  if (provider === "openai-compatible") {
    return {
      id,
      provider,
      model,
      baseUrl: baseUrl!,
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
      ...(headers ? { headers } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(requestMode ? { requestMode } : {}),
    } as OpenAiCompatibleModelDefinition;
  }
  return {
    id,
    provider,
    model,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(headers ? { headers } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  } as ModelDefinition;
}

function validateDefinition(definition: ModelDefinition, label = `models.${definition.id}`, allowReserved = false): void {
  const raw = definition as unknown as Record<string, unknown>;
  if (typeof definition.id !== "string" || !MODEL_ID_RE.test(definition.id)) {
    throw new Error(`${label} has an invalid model ID`);
  }
  if (!allowReserved && RESERVED_MODEL_IDS.has(definition.id)) throw new Error(`${label} uses reserved model ID "${definition.id}"`);
  if (definition.provider !== "openai" && definition.provider !== "anthropic" && definition.provider !== "openai-compatible") {
    throw new Error(`${label}.provider is invalid`);
  }
  if (typeof definition.model !== "string" || !definition.model.trim()) throw new Error(`${label}.model must be a non-empty string`);
  rejectUnknown(raw, new Set(["id", ...ALLOWED_COMMON, "requestMode"]), label);
  if (definition.apiKeyEnv !== undefined) validateEnvName(definition.apiKeyEnv, `${label}.apiKeyEnv`);
  if (definition.baseUrl !== undefined) validateUrl(definition.baseUrl, `${label}.baseUrl`);
  if (definition.headers !== undefined) parseHeaders(definition.headers, `${label}.headers`);
  if (definition.reasoningEffort !== undefined && !["none", "low", "medium", "high", "xhigh", "max", "ultra"].includes(definition.reasoningEffort)) {
    throw new Error(`${label}.reasoningEffort is invalid`);
  }
  if (definition.reasoningEffort !== undefined && definition.provider !== "openai") {
    throw new Error(`${label}.reasoningEffort is not supported for ${definition.provider} models`);
  }
  if (definition.maxOutputTokens !== undefined && (!Number.isInteger(definition.maxOutputTokens) || definition.maxOutputTokens < 1)) {
    throw new Error(`${label}.maxOutputTokens must be a positive integer`);
  }
  const requestMode = raw.requestMode;
  if (requestMode !== undefined && requestMode !== "json" && requestMode !== "tool") throw new Error(`${label}.requestMode must be json or tool`);
  if (definition.provider === "openai-compatible" && (!definition.baseUrl || typeof definition.baseUrl !== "string")) {
    throw new Error(`${label}.baseUrl is required for openai-compatible models`);
  }
  if (definition.provider !== "openai-compatible" && requestMode !== undefined) {
    throw new Error(`${label}.requestMode is only valid for openai-compatible models`);
  }
}

function normalizedDefinition(definition: ModelDefinition): Record<string, unknown> {
  const apiKeyEnv = definition.apiKeyEnv
    ?? (definition.provider === "anthropic" ? "ANTHROPIC_API_KEY" : definition.provider === "openai" ? "OPENAI_API_KEY" : undefined);
  const result: Record<string, unknown> = {
    id: definition.id,
    provider: definition.provider,
    model: definition.model,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(definition.baseUrl ? { baseUrl: definition.baseUrl } : {}),
    ...(definition.headers ? { headers: definition.headers } : {}),
    ...(definition.reasoningEffort ? { reasoningEffort: definition.reasoningEffort } : {}),
    ...(definition.maxOutputTokens !== undefined ? { maxOutputTokens: definition.maxOutputTokens } : {}),
  };
  if (definition.provider === "openai-compatible") result.requestMode = definition.requestMode ?? "json";
  return result;
}

export function legacyGptDefinition(): ModelDefinition {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna";
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT?.trim() || "none";
  return {
    id: "gpt",
    provider: "openai",
    model,
    apiKeyEnv: "OPENAI_API_KEY",
    reasoningEffort: reasoningEffort as ReasoningEffort,
  };
}

export const BUILTIN_MODEL_DEFINITIONS: readonly ModelDefinition[] = [legacyGptDefinition()];

function parseRegistryDocument(text: string, source: string): ModelDefinition[] {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${source}: ${document.errors[0]?.message ?? "invalid YAML"}`);
  const root = object(document.toJS(), source);
  rejectUnknown(root, new Set(["models"]), source);
  const models = object(root.models, `${source}.models`);
  return Object.entries(models).map(([id, value]) => parseDefinition(id, value));
}

export function parseModelDefinitions(text: string, source = "models.yaml"): ModelDefinition[] {
  return parseRegistryDocument(text, source);
}

export class ModelRegistry {
  readonly hash: string;
  readonly models: ReadonlyMap<string, ResolvedModelDefinition>;

  constructor(definitions: ModelDefinition[], includeBuiltins = true) {
    // Read the legacy GPT environment at registry construction time. This keeps
    // programmatic callers and test harnesses deterministic when they set env
    // values after importing this module.
    const builtins = includeBuiltins ? [legacyGptDefinition()] : [];
    const all = [...builtins, ...definitions];
    const seen = new Set<string>();
    for (const [index, definition] of all.entries()) {
      validateDefinition(definition, undefined, index < builtins.length);
      if (seen.has(definition.id)) throw new Error(`duplicate model ID "${definition.id}"`);
      seen.add(definition.id);
    }
    const normalized = all.map(normalizedDefinition).sort((left, right) => {
      const leftId = String(left.id);
      const rightId = String(right.id);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
    this.hash = sha256(canonicalJson({ models: normalized }));
    const resolved = new Map<string, ResolvedModelDefinition>();
    for (const definition of all) {
      const normalizedOne = canonicalJson(normalizedDefinition(definition));
      const apiKeyEnv = definition.apiKeyEnv
        ?? (definition.provider === "anthropic" ? "ANTHROPIC_API_KEY" : definition.provider === "openai" ? "OPENAI_API_KEY" : undefined);
      if (!apiKeyEnv) throw new Error(`model "${definition.id}" requires apiKeyEnv`);
      const fingerprint = sha256(normalizedOne);
      resolved.set(definition.id, {
        ...definition,
        apiKeyEnv,
        ...(definition.provider === "openai-compatible" ? { requestMode: definition.requestMode ?? "json" } : {}),
        registryHash: this.hash,
        fingerprint,
      } as ResolvedModelDefinition);
    }
    this.models = resolved;
  }

  has(id: string): boolean { return this.models.has(id); }

  resolve(id: string): ResolvedModelDefinition {
    const model = this.models.get(id);
    if (!model) throw new Error(`Unknown model ID "${id}"`);
    return model;
  }

  validateSelected(ids: readonly string[], requireEnvironment = true): void {
    for (const id of ids) {
      if (id === "jev" || id === "mortal" || id === "random" || id === "hybrid" || /^hybrid@(?:0|1|0?\.\d+)$/.test(id)) continue;
      const model = this.resolve(id);
      if (!requireEnvironment) continue;
      const required = [model.apiKeyEnv, ...Object.values(model.headers ?? {}).map((header) => header.env)];
      for (const envName of required) if (!process.env[envName]) throw new Error(`Environment variable ${envName} is required for model "${id}"`);
    }
  }

  definitionsFor(ids: readonly string[]): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const id of ids) {
      if (!this.has(id)) continue;
      const model = this.resolve(id);
      result[id] = {
        id: model.id,
        provider: model.provider,
        model: model.model,
        apiKeyEnv: model.apiKeyEnv,
        ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
        ...(model.requestMode ? { requestMode: model.requestMode } : {}),
        ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
        ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
        ...(model.headers ? { headerEnv: Object.fromEntries(Object.entries(model.headers).map(([name, value]) => [name, value.env])) } : {}),
        fingerprint: model.fingerprint,
      };
    }
    return result;
  }
}

export function createModelRegistry(definitions: ModelDefinition[] = []): ModelRegistry {
  return new ModelRegistry(definitions);
}

export async function loadModelRegistry(path?: string): Promise<ModelRegistry> {
  if (!path) return createModelRegistry();
  const source = resolvePath(path);
  const text = await readFile(source, "utf8");
  return new ModelRegistry(parseRegistryDocument(text, source));
}

export function loadModelRegistryFromYaml(text: string, source = "models.yaml"): ModelRegistry {
  return new ModelRegistry(parseRegistryDocument(text, source));
}
