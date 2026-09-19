import { describe, expect, it, vi } from "vitest";
import { serializedAgentAct, timeout, type AgentCallTails } from "../src/tournament/run.js";
import type { GameAction, GameObservation } from "../src/types.js";

const action: GameAction = {
  id: "action",
  type: "none",
  mjai: { type: "none", actor: 0 },
};

function observation(turnIndex: number): GameObservation {
  return {
    player: 0,
    newEvents: [JSON.stringify({ type: "start_game" })],
    events: [JSON.stringify({ type: "start_game" })],
    state: { round: "E1", hand: [] },
    legalActions: [action],
    gameId: "test-game",
    handIndex: 0,
    turnIndex,
  };
}

describe("tournament agent call gate", () => {
  it("does not start a queued call after its timeout", async () => {
    let release!: () => void;
    const firstResult = new Promise<void>((resolve) => { release = resolve; });
    const act = vi.fn(async () => {
      await firstResult;
      return action.id;
    });
    const agent = {
      id: "test",
      lastMetadata: undefined,
      lastUsage: undefined,
      act,
      cancel: vi.fn(),
    };
    const tails: AgentCallTails = new WeakMap();
    const first = serializedAgentAct(agent, observation(0), tails);
    const queued = serializedAgentAct(agent, observation(1), tails);

    await expect(timeout(queued, 10)).rejects.toThrow(/timeout/);
    expect(agent.cancel).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledTimes(1);

    release();
    await expect(first.promise).resolves.toMatchObject({ action: action.id });
    await expect(queued.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(act).toHaveBeenCalledTimes(1);
  });
});
