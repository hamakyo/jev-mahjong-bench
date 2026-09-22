export type ProviderKind = "openai" | "anthropic" | "openai-compatible";
export type CompatibleRequestMode = "json" | "tool";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface HeaderEnvReference {
  env: string;
}

export interface BaseModelDefinition {
  id: string;
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  headers?: Record<string, HeaderEnvReference>;
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens?: number;
}

export interface OpenAiModelDefinition extends BaseModelDefinition {
  provider: "openai";
}

export interface AnthropicModelDefinition extends BaseModelDefinition {
  provider: "anthropic";
}

export interface OpenAiCompatibleModelDefinition extends BaseModelDefinition {
  provider: "openai-compatible";
  baseUrl: string;
  requestMode?: CompatibleRequestMode;
}

export type ModelDefinition =
  | OpenAiModelDefinition
  | AnthropicModelDefinition
  | OpenAiCompatibleModelDefinition;

/** Resolved means validated configuration, not resolved secrets. */
export type ResolvedModelDefinition = ModelDefinition & {
  apiKeyEnv: string;
  requestMode?: CompatibleRequestMode;
  registryHash: string;
  fingerprint: string;
};

export const RESERVED_MODEL_IDS = new Set(["random", "jev", "mortal", "gpt", "hybrid"]);
export const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

