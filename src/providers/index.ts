export * from "./types.js";
export * from "./model-schema.js";
export * from "./prompt.js";
export * from "./registry.js";
export * from "./http.js";
export * from "./openai.js";
export * from "./anthropic.js";
export * from "./openai-compatible.js";
export * from "./pricing.js";

import type { ResolvedModelDefinition } from "./model-schema.js";
import type { LlmProvider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { OpenAIProvider } from "./openai.js";

export function createProvider(model: ResolvedModelDefinition): LlmProvider {
  if (model.provider === "openai") return new OpenAIProvider();
  if (model.provider === "anthropic") return new AnthropicProvider();
  return new OpenAICompatibleProvider();
}
