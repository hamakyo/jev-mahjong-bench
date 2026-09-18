import { describe, expect, it } from "vitest";
import { countDiscardResponses, eventNeedsDiscardResponse, eventNeedsResponse, MortalAgent } from "../src/agents/mortal.js";
import { gameDecisionInput, MortalGameAgent } from "../src/agents/game.js";
import { RiichiEnvBridge } from "../src/game/bridge.js";
import type { GameObservation, GameAction, DecisionSample } from "../src/types.js";

describe("complete-game contracts", () => {
  it("counts calls and reach declarations as the following discard response", () => {
    for (const type of ["chi", "pon", "reach"]) {
      const event = JSON.stringify({ type, actor: 2 });
      expect(eventNeedsDiscardResponse(event, 2)).toBe(true);
      expect(eventNeedsResponse(event, 2)).toBe(true);
    }
    expect(eventNeedsDiscardResponse(JSON.stringify({ type: "ankan", actor: 2 }), 2)).toBe(false);
    expect(countDiscardResponses([
      JSON.stringify({ type: "tsumo", actor: 2 }),
      JSON.stringify({ type: "reach", actor: 2 }),
    ], 2)).toBe(1);
    expect(countDiscardResponses([
      JSON.stringify({ type: "tsumo", actor: 2 }),
      JSON.stringify({ type: "ankan", actor: 2 }),
      JSON.stringify({ type: "tsumo", actor: 2 }),
    ], 2)).toBe(1);
    expect(countDiscardResponses([
      JSON.stringify({ type: "tsumo", actor: 2 }),
      JSON.stringify({ type: "kakan", actor: 2 }),
      JSON.stringify({ type: "tsumo", actor: 2 }),
    ], 2)).toBe(1);
  });

  it("keeps the MJAI meaning alongside complete-game action ids", () => {
    const action: GameAction = {
      id: "a",
      type: "pon",
      mjai: { type: "pon", actor: 0, target: 1, pai: "5m", consumed: ["5m", "5m"] },
    };
    const observation: GameObservation = {
      player: 0,
      newEvents: ["{\"type\":\"dahai\"}"],
      events: ["{\"type\":\"dahai\"}"],
      state: { round: "E1", hand: ["5m"] },
      legalActions: [action],
      gameId: "game",
      handIndex: 0,
      turnIndex: 1,
    };
    expect(gameDecisionInput(observation).legalActions[0]).toEqual(action);
  });

  it("returns cumulative per-seat history from the bridge", async () => {
    const bridge = new RiichiEnvBridge();
    try {
      let response = await bridge.startGame({
        gameId: "history-test",
        mode: "4p-red-single",
        rule: "tenhou",
        seed: 42,
      });
      const previousByPlayer = new Map<number, number>();
      for (let step = 0; step < 8 && !response.done; step += 1) {
        for (const observation of response.observations) {
          const previousLength = previousByPlayer.get(observation.player) ?? 0;
          expect(observation.events.length).toBeGreaterThanOrEqual(previousLength);
          expect(observation.newEvents).toEqual(observation.events.slice(previousLength));
          expect(observation.state.mjaiEvents).toEqual(observation.events);
          expect(observation.events[0]).toContain('"type":"start_game"');
          previousByPlayer.set(observation.player, observation.events.length);
        }
        response = await bridge.step(new Map(response.observations.map((item) => [item.player, item.legalActions[0]!] )));
      }
    } finally {
      bridge.close();
    }
  }, 30_000);

  it("drains stale Mortal responses before taking the requested discard", async () => {
    const agent = new MortalAgent({
      command: [process.execPath, "tests/fixtures/fake-mortal.mjs", "{seat}"],
      version: "test",
      timeoutMs: 1_000,
    });
    const sample: DecisionSample = {
      id: "sample",
      state: {
        round: "E1",
        hand: ["1m"],
        drawnTile: "0m",
        mjaiEvents: [
          JSON.stringify({ type: "start_game" }),
          JSON.stringify({ type: "start_kyoku", oya: 0 }),
          JSON.stringify({ type: "tsumo", actor: 0, pai: "0m" }),
        ],
      },
      legalActions: ["0m"],
      provenance: {
        platform: "tenhou",
        gameIdHash: "a".repeat(64),
        handIndex: 0,
        eventIndex: 2,
        seat: 0,
      },
    };
    try {
      await expect(agent.decide(sample)).resolves.toMatchObject({ action: "0m" });
    } finally {
      await agent.close();
    }
  });

  it("matches a complete-game Mortal response against GameAction", async () => {
    const bridge = new RiichiEnvBridge();
    const agent = new MortalGameAgent({
      command: [process.execPath, "tests/fixtures/fake-mortal.mjs", "{seat}"],
      version: "test",
      timeoutMs: 1_000,
    });
    try {
      const response = await bridge.startGame({
        gameId: "game-mortal-test",
        mode: "4p-red-single",
        rule: "tenhou",
        seed: 42,
      });
      const observation = response.observations[0]!;
      const actionId = await agent.act(observation);
      expect(observation.legalActions.find((action) => action.id === actionId)?.type).toBe("dahai");
    } finally {
      await agent.close();
      bridge.close();
    }
  }, 30_000);

  it("accepts the discard observation emitted immediately after reach", async () => {
    const agent = new MortalGameAgent({
      command: [process.execPath, "tests/fixtures/fake-mortal-reach.mjs", "{seat}"],
      version: "test",
      timeoutMs: 1_000,
    });
    const discard: GameAction = {
      id: "discard-1m",
      type: "dahai",
      mjai: { type: "dahai", actor: 0, pai: "1m", tsumogiri: false },
    };
    const base = {
      player: 0,
      state: { round: "E1", hand: ["1m"] },
      legalActions: [discard],
      gameId: "reach-test",
      handIndex: 0,
      turnIndex: 1,
    };
    try {
      await expect(agent.act({
        ...base,
        newEvents: ["{\"actor\":0,\"pai\":\"1m\",\"type\":\"tsumo\"}"],
        events: ["{\"actor\":0,\"pai\":\"1m\",\"type\":\"tsumo\"}"],
      })).resolves.toBe(discard.id);
      await expect(agent.act({
        ...base,
        turnIndex: 2,
        newEvents: ["{\"actor\":0,\"type\":\"reach\"}"],
        events: [
          "{\"actor\":0,\"pai\":\"1m\",\"type\":\"tsumo\"}",
          "{\"actor\":0,\"type\":\"reach\"}",
        ],
      })).resolves.toBe(discard.id);
    } finally {
      await agent.close();
    }
  });

  it("counts a dataset reach sequence as one Mortal discard response", async () => {
    const agent = new MortalAgent({
      command: [process.execPath, "tests/fixtures/fake-mortal-dataset-reach.mjs", "{seat}"],
      version: "test",
      timeoutMs: 1_000,
    });
    const sample: DecisionSample = {
      id: "reach-sample",
      state: {
        round: "E1",
        hand: ["1m"],
        drawnTile: "1m",
        mjaiEvents: [
          JSON.stringify({ type: "start_game" }),
          JSON.stringify({ type: "start_kyoku", oya: 0 }),
          JSON.stringify({ type: "tsumo", actor: 0, pai: "1m" }),
          JSON.stringify({ type: "reach", actor: 0 }),
        ],
      },
      legalActions: ["1m"],
      provenance: {
        platform: "tenhou",
        gameIdHash: "b".repeat(64),
        handIndex: 0,
        eventIndex: 3,
        seat: 0,
      },
    };
    try {
      await expect(agent.decide(sample)).resolves.toMatchObject({ action: "1m" });
    } finally {
      await agent.close();
    }
  });
});
