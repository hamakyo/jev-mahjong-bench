import { describe, expect, it } from "vitest";
import { runAgent } from "../src/benchmark/run.js";
import type { MahjongAgent } from "../src/agents/agent.js";
import { ProviderRequestError, type ProviderCallRecord } from "../src/providers/types.js";
import type { DecisionSample } from "../src/types.js";

const samples: DecisionSample[] = [
  { id: "A", state: { round: "E1", hand: ["1m"] }, legalActions: ["discard"] },
  { id: "B", state: { round: "E1", hand: ["2m"] }, legalActions: ["discard"] },
];

function call(sampleId: string, bytes: number): ProviderCallRecord {
  return {
    providerId: "test",
    modelId: "test-model",
    model: "test",
    endpointFamily: "test",
    canonicalInputBytes: bytes,
    latencyMs: 1,
    logicalCallCount: 1,
    httpAttemptCount: 1,
    retryCount: 0,
    requestIds: [sampleId],
  };
}

describe("benchmark provider call ownership", () => {
  it("keeps result-local provider calls when one agent is run concurrently", async () => {
    const agent = {
      id: "test-agent",
      lastProviderCalls: undefined as ProviderCallRecord[] | undefined,
      async decide(sample: DecisionSample) {
        const providerCall = call(sample.id, sample.id === "A" ? 100 : 200);
        this.lastProviderCalls = [providerCall];
        await new Promise((resolve) => setTimeout(resolve, sample.id === "A" ? 10 : 0));
        return { action: "discard", providerCalls: [providerCall] };
      },
    } satisfies MahjongAgent & { lastProviderCalls: ProviderCallRecord[] | undefined };

    const records = await runAgent(agent, samples, 2);
    expect(records.map((record) => record.providerCalls?.[0]?.requestIds?.[0])).toEqual(["A", "B"]);
    expect(records.map((record) => record.canonicalInputBytes)).toEqual([100, 200]);
  });

  it("uses the exception-local provider call for failed decisions", async () => {
    const agent: MahjongAgent = {
      id: "failing-agent",
      async decide(sample: DecisionSample) {
        const providerCall = call(sample.id, sample.id === "A" ? 300 : 400);
        throw new ProviderRequestError("failed", providerCall, "server");
      },
    };
    const records = await runAgent(agent, samples, 2);
    expect(records.map((record) => record.providerCalls?.[0]?.requestIds?.[0])).toEqual(["A", "B"]);
    expect(records.map((record) => record.canonicalInputBytes)).toEqual([300, 400]);
  });
});
