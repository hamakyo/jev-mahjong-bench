import type { GameDecisionInput, LlmGameState } from "../types.js";
import { canonicalJson } from "../mjai/tiles.js";

export const MAX_LLM_INPUT_BYTES = 16_384;

export interface GameInputDiagnostics {
  decisionInputBytes: number;
  stateBytes: number;
  recentEventCount: number;
}

export class LlmInputContractError extends Error {
  readonly diagnostics: GameInputDiagnostics;

  constructor(message: string, diagnostics: GameInputDiagnostics) {
    super(`llm-input-contract: ${message}`);
    this.name = "LlmInputContractError";
    this.diagnostics = diagnostics;
  }
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function diagnosticsFor(input: GameDecisionInput): GameInputDiagnostics {
  const rawState = (input as unknown as { state?: unknown }).state;
  const rawRecentEvents = isObject(rawState) ? rawState.recentEvents : undefined;
  return {
    decisionInputBytes: byteLength(input),
    stateBytes: byteLength(rawState),
    recentEventCount: Array.isArray(rawRecentEvents) ? rawRecentEvents.length : 0,
  };
}

export function assertLlmGameState(value: unknown): asserts value is LlmGameState {
  if (!isObject(value)) {
    throw new Error("llm-input-contract: state must be an object");
  }
  if (Object.prototype.hasOwnProperty.call(value, "mjaiEvents")) {
    throw new Error("llm-input-contract: state.mjaiEvents must not be sent to an LLM provider");
  }
  if (Object.prototype.hasOwnProperty.call(value, "recentEvents")) {
    throw new Error("llm-input-contract: state.recentEvents is not supported yet");
  }
}

export function inspectGameDecisionInput(input: GameDecisionInput): GameInputDiagnostics {
  const diagnostics = diagnosticsFor(input);
  try {
    assertLlmGameState(input.state);
  } catch (error) {
    throw new LlmInputContractError(error instanceof Error ? error.message.replace(/^llm-input-contract:\s*/, "") : String(error), diagnostics);
  }
  if (diagnostics.decisionInputBytes > MAX_LLM_INPUT_BYTES) {
    throw new LlmInputContractError(
      `decision input is ${diagnostics.decisionInputBytes} bytes; maximum is ${MAX_LLM_INPUT_BYTES}`,
      diagnostics,
    );
  }
  return diagnostics;
}
