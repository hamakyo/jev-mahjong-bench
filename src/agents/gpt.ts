import type { MahjongAgent } from "./agent.js";
import type { AgentDecision, DecisionSample, GameDecisionInput } from "../types.js";

type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
interface ResponsesBody {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
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

export class GptAgent implements MahjongAgent {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly effort: ReasoningEffort;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for the GPT agent");
    this.apiKey = apiKey;
    this.model = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
    this.effort = (process.env.OPENAI_REASONING_EFFORT as ReasoningEffort | undefined) ?? "none";
    this.id = `gpt:${this.model}`;
  }

  async decide(sample: DecisionSample, signal?: AbortSignal): Promise<AgentDecision> {
    if (signal?.aborted) throw new Error("agent call aborted");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: this.effort },
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
      }),
    });

    const body = (await response.json()) as ResponsesBody & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(body.error?.message ?? `OpenAI request failed: ${response.status}`);
    }
    if (signal?.aborted) throw new Error("agent call aborted");

    const parsed = JSON.parse(outputText(body)) as { action?: unknown };
    if (typeof parsed.action !== "string") throw new Error("OpenAI response had no string action");

    return {
      action: parsed.action,
      ...(body.usage ? {
        usage: {
          ...(typeof body.usage.input_tokens === "number" ? { inputTokens: body.usage.input_tokens } : {}),
          ...(typeof body.usage.output_tokens === "number" ? { outputTokens: body.usage.output_tokens } : {}),
        },
      } : {}),
      metadata: { model: this.model, reasoningEffort: this.effort },
    };
  }

  async decideGame(input: GameDecisionInput, signal?: AbortSignal): Promise<AgentDecision> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        reasoning: { effort: this.effort },
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
      }),
    });

    const body = (await response.json()) as ResponsesBody & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(body.error?.message ?? `OpenAI request failed: ${response.status}`);
    }
    if (signal?.aborted) throw new Error("agent call aborted");
    const parsed = JSON.parse(outputText(body)) as { action?: unknown };
    if (typeof parsed.action !== "string") throw new Error("OpenAI response had no string action");
    return {
      action: parsed.action,
      ...(body.usage ? {
        usage: {
          ...(typeof body.usage.input_tokens === "number" ? { inputTokens: body.usage.input_tokens } : {}),
          ...(typeof body.usage.output_tokens === "number" ? { outputTokens: body.usage.output_tokens } : {}),
        },
      } : {}),
      metadata: { model: this.model, reasoningEffort: this.effort },
    };
  }
}
