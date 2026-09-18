import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { MahjongAgent } from "./agent.js";
import type { AgentDecision, DecisionSample } from "../types.js";

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

  async decide(sample: DecisionSample): Promise<AgentDecision> {
    const options = Object.fromEntries(
      sample.legalActions.map((action) => [
        action,
        `Discard ${action} if it is the best discard for the given state.`,
      ]),
    );

    const response = await this.client.systemOne({
      state: { ...sample.state, legalActions: sample.legalActions },
      questions: {
        discard: choice(
          "Which legal tile should the player discard now to maximize riichi-mahjong playing strength?",
          options,
        ),
      },
    });

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
}
