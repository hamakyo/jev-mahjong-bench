import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { MahjongAgent } from "./agent.js";
import type { AgentDecision, DecisionSample, GameDecisionInput } from "../types.js";
import { canonicalJson } from "../mjai/tiles.js";
import { inspectGameDecisionInput } from "../game/input.js";

interface JevChoiceAnswer {
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}
interface JevUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export class JevAgent implements MahjongAgent {
  readonly id = "jev";
  private readonly client: TypeSafeClient;

  constructor() {
    if (!process.env.TYPESAFE_API_KEY) {
      throw new Error("TYPESAFE_API_KEY is required for the Jev agent");
    }
    this.client = new TypeSafeClient();
  }

  async decide(sample: DecisionSample, signal?: AbortSignal): Promise<AgentDecision> {
    if (signal?.aborted) throw new Error("agent call aborted");
    const options = Object.fromEntries(
      sample.legalActions.map((action) => [
        action,
        `Discard ${action} if it is the best discard for the given state.`,
      ]),
    );

    const response = await this.client.systemOne({
      state: { ...sample.state, legalActions: sample.legalActions } as any,
      questions: {
        discard: choice(
          "Which legal tile should the player discard now to maximize riichi-mahjong playing strength?",
          options,
        ),
      },
    }, signal ? { signal } : undefined);
    if (signal?.aborted) throw new Error("agent call aborted");

    const answer = response.answers.discard as JevChoiceAnswer;
    const usage = (response as unknown as { usage?: JevUsage }).usage;

    return {
      action: answer.choice,
      ...(answer.probabilities ? { probabilities: answer.probabilities } : {}),
      ...(typeof answer.confidence === "number" ? { confidence: answer.confidence } : {}),
      ...(usage ? {
        usage: {
          ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
          ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
        },
      } : {}),
    };
  }

  async decideGame(input: GameDecisionInput, signal?: AbortSignal): Promise<AgentDecision> {
    if (signal?.aborted) throw new Error("agent call aborted");
    inspectGameDecisionInput(input);
    const options = Object.fromEntries(
      input.legalActions.map((action) => [
        action.id,
        `Choose this legal operation: type=${action.type}; MJAI=${canonicalJson(action.mjai)}`,
      ]),
    );
    const response = await this.client.systemOne({
      state: {
        ...input.state,
        legalActions: input.legalActions.map((action) => ({
          id: action.id,
          type: action.type,
          mjai: action.mjai,
        })),
      } as any,
      questions: {
        gameAction: choice(
          "Choose exactly one legal MJAI operation for this complete riichi-mahjong turn. The option id is an identifier; use the operation type and MJAI payload to make the decision. It may be a discard, call, riichi, win, draw, abortive draw, pass, or other legal operation.",
          options,
        ),
      },
    }, signal ? { signal } : undefined);
    if (signal?.aborted) throw new Error("agent call aborted");
    const answer = response.answers.gameAction as JevChoiceAnswer;
    const usage = (response as unknown as { usage?: JevUsage }).usage;
    return {
      action: answer.choice,
      ...(answer.probabilities ? { probabilities: answer.probabilities } : {}),
      ...(typeof answer.confidence === "number" ? { confidence: answer.confidence } : {}),
      ...(usage ? {
        usage: {
          ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
          ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
        },
      } : {}),
    };
  }
}
