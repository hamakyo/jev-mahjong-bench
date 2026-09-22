import type { DecisionSample, GameDecisionInput } from "../types.js";
import { canonicalJson } from "../mjai/tiles.js";
import { inspectGameDecisionInput, LlmInputContractError, MAX_LLM_INPUT_BYTES } from "../game/input.js";
import type { ProviderDecisionRequest } from "./types.js";

export const PROMPT_VERSION = "mahjong-llm-prompt-v1" as const;
export const ACTION_SCHEMA_VERSION = "mahjong-action-schema-v1" as const;
export const USAGE_MAPPING_VERSION = "normalized-usage-v2" as const;

export const COMMON_SYSTEM_INSTRUCTION =
  "You are playing Japanese riichi mahjong. Choose exactly one legal action. Return only the requested structured action; do not explain.";

export const COMPLETE_GAME_SYSTEM_INSTRUCTION =
  "You are playing Japanese riichi mahjong in a complete game. Choose exactly one legal operation. The action id is only an identifier; inspect its type and MJAI payload. Discards, calls, riichi, wins, draws, abortive draws, passes, and other legal operations are possible.";

export const JSON_MODE_INSTRUCTION =
  "Return only a JSON object with one string property named action. The value must be one of the supplied legal action IDs.";

export function actionSchema(legalActionIds: readonly string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: [...legalActionIds] },
    },
    required: ["action"],
    additionalProperties: false,
  };
}

export function actionOutputSchema(legalActionIds: readonly string[], name = "mahjong_action"): Record<string, unknown> {
  return {
    type: "json_schema",
    name,
    strict: true,
    schema: actionSchema(legalActionIds),
  };
}

export function toolInputSchema(legalActionIds: readonly string[]): Record<string, unknown> {
  return actionSchema(legalActionIds);
}

export function isGameDecisionInput(input: DecisionSample | GameDecisionInput): input is GameDecisionInput {
  return Array.isArray((input as GameDecisionInput).legalActions)
    && ((input as GameDecisionInput).legalActions[0] === undefined
      || typeof (input as GameDecisionInput).legalActions[0] === "object");
}

/** This is the only serialization used as the provider-independent input contract. */
export function canonicalInputPayload(input: DecisionSample | GameDecisionInput): Record<string, unknown> {
  if (isGameDecisionInput(input)) {
    return {
      id: input.id,
      state: input.state,
      legalActions: input.legalActions.map((action) => ({
        id: action.id,
        type: action.type,
        mjai: action.mjai,
      })),
    };
  }
  return {
    id: input.id,
    state: input.state,
    legalActions: [...input.legalActions],
  };
}

export function canonicalInputJson(input: DecisionSample | GameDecisionInput): string {
  return canonicalJson(canonicalInputPayload(input));
}

export function createProviderDecisionRequest(input: DecisionSample | GameDecisionInput): ProviderDecisionRequest {
  const canonicalInput = canonicalInputJson(input);
  const canonicalInputBytes = Buffer.byteLength(canonicalInput, "utf8");
  if (canonicalInputBytes > MAX_LLM_INPUT_BYTES) {
    const rawState = (input as { state?: unknown }).state;
    const recentEvents = rawState && typeof rawState === "object" && !Array.isArray(rawState)
      ? (rawState as { recentEvents?: unknown }).recentEvents
      : undefined;
    throw new LlmInputContractError(
      `decision input is ${canonicalInputBytes} bytes; maximum is ${MAX_LLM_INPUT_BYTES}`,
      {
        decisionInputBytes: canonicalInputBytes,
        stateBytes: Buffer.byteLength(canonicalJson(rawState), "utf8"),
        recentEventCount: Array.isArray(recentEvents) ? recentEvents.length : 0,
      },
    );
  }
  if (isGameDecisionInput(input)) inspectGameDecisionInput(input);
  return {
    kind: isGameDecisionInput(input) ? "game" : "decision",
    input,
    canonicalInput,
    canonicalInputBytes,
    legalActionIds: isGameDecisionInput(input)
      ? input.legalActions.map((action) => action.id)
      : [...input.legalActions],
  };
}

export function systemInstruction(kind: ProviderDecisionRequest["kind"]): string {
  return kind === "game" ? COMPLETE_GAME_SYSTEM_INSTRUCTION : COMMON_SYSTEM_INSTRUCTION;
}
