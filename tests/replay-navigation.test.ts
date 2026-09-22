import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadReplay } from "../src/replay/loader.js";
import { ReplayRecorder } from "../src/replay/recorder.js";
import { createReplayServer } from "../src/replay/server.js";
import { buildReplayNavigationIndex, type ReplayNavigationIndex } from "../src/replay/navigation.js";
import { ReplayTimeline } from "../src/replay/timeline.js";
import type { ReplayEventRecord } from "../src/replay/schema.js";

const base = { schemaVersion: 1 as const, gameId: "game", pairId: "pair", rotationIndex: 0 };

function record(sequence: number, event: ReplayEventRecord["event"]): ReplayEventRecord {
  return { schemaVersion: 1, sequence, event };
}

function decisionStart(player: number, agentId: string, turnIndex: number): ReplayEventRecord["event"] {
  return {
    type: "decision:start",
    ...base,
    handIndex: 0,
    turnIndex,
    player,
    agentId,
    observation: {
      state: { round: "E1", player },
      legalActions: [{ id: `dahai:${player}`, type: "dahai", mjai: { type: "dahai", actor: player, pai: "1m" } }],
      newEvents: [],
    },
  };
}

function decisionEnd(player: number, agentId: string, turnIndex: number): ReplayEventRecord["event"] {
  return {
    type: "decision:end",
    ...base,
    handIndex: 0,
    turnIndex,
    player,
    agentId,
    requestedActionId: "requested",
    requestedAction: { type: "dahai", actor: player, pai: "1m" },
    appliedActionId: "applied",
    appliedAction: { type: "dahai", actor: player, pai: "1m" },
    isLegal: true,
    latencyMs: 12,
    inputTokens: 10,
    outputTokens: 2,
    retryCount: 0,
    diagnostics: { confidence: 0.8, probabilities: { "dahai:1m": 0.8 } },
    metadata: { provider: "test-provider", model: "test-model" },
  };
}

function navigationFixture(): ReplayEventRecord[] {
  return [
    record(1, { type: "game:start", ...base, seed: 1, baseSeed: 1, seats: ["a", "b", "c", "d"], gameIndex: 0, totalGames: 1 }),
    record(2, { type: "mjai", ...base, source: "bridge", event: { type: "start_kyoku", bakaze: "E", kyoku: 1, oya: 0, scores: [25_000, 25_000, 25_000, 25_000] } }),
    record(3, decisionStart(0, "a", 0)),
    record(4, decisionStart(1, "b", 0)),
    record(5, decisionEnd(0, "a", 0)),
    record(6, decisionEnd(1, "b", 0)),
    record(7, { type: "mjai", ...base, source: "bridge", event: { type: "dahai", actor: 0, pai: "1m" } }),
    record(8, decisionStart(2, "c", 1)),
    record(9, decisionEnd(2, "c", 1)),
    record(10, { type: "mjai", ...base, source: "bridge", event: { type: "tsumo", actor: 2 } }),
    record(11, { type: "mjai", ...base, source: "bridge", event: { type: "end_kyoku", scores: [25_000, 25_000, 25_000, 25_000] } }),
    record(12, { type: "game:end", ...base, seed: 1, baseSeed: 1, seats: ["a", "b", "c", "d"], scores: [25_000, 25_000, 25_000, 25_000], ranks: [1, 2, 3, 4], handCount: 1, errorCount: 0, result: { gameId: "game", seed: 1, baseSeed: 1, pairId: "pair", rotationIndex: 0, seats: ["a", "b", "c", "d"], scores: [25_000, 25_000, 25_000, 25_000], ranks: [1, 2, 3, 4], handCount: 1, eventCounts: {}, players: [], errorCount: 0 } }),
  ];
}

describe("replay navigation index", () => {
  it("shares the post-environment snapshot across same-turn decisions", () => {
    const index = buildReplayNavigationIndex(navigationFixture());
    expect(index.decisions).toHaveLength(3);
    expect(index.decisions.slice(0, 2)).toMatchObject([
      { startSequence: 3, endSequence: 5, snapshotSequence: 7, handDecisionNumber: 1, handDecisionCount: 3 },
      { startSequence: 4, endSequence: 6, snapshotSequence: 7, handDecisionNumber: 2, handDecisionCount: 3 },
    ]);
    expect(index.decisions[2]).toMatchObject({ startSequence: 8, endSequence: 9, snapshotSequence: 11, handDecisionNumber: 3 });
    expect(index.games[0]?.hands[0]).toMatchObject({ startSequence: 2, endSequence: 11, decisionIndices: [0, 1, 2] });
  });

  it("keeps an unfinished decision selectable in a running replay", () => {
    const events = navigationFixture().slice(0, 4);
    const index = buildReplayNavigationIndex(events);
    expect(index.decisions).toHaveLength(2);
    expect(index.decisions[1]).toMatchObject({ startSequence: 4, snapshotSequence: 4 });
  });

  it("serves public selection metadata separately from debug decision details", async () => {
    const out = await mkdtemp(join(tmpdir(), "jev-replay-navigation-"));
    const recorder = new ReplayRecorder(out, "navigation-stream");
    for (const event of navigationFixture().map((item) => item.event)) recorder.record(event);
    await recorder.finalize({ status: "complete" });
    const timeline = new ReplayTimeline(await loadReplay(out));
    const index = timeline.navigationIndex as ReplayNavigationIndex;
    expect(index.games[0]?.hands).toHaveLength(1);
    expect(index.decisions[0]).toMatchObject({ snapshotSequence: 7 });

    const server = createReplayServer({ timeline, port: 0 });
    const port = await server.listen();
    try {
      const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
      expect(html).toContain("replay-stage");
      expect(html).not.toContain("sections.recentDecisions");
      const runtimeIndex = await (await fetch(`http://127.0.0.1:${port}/api/replay/index`)).json() as Record<string, any>;
      expect(runtimeIndex.decisions).toHaveLength(3);
      const spectator = await (await fetch(`http://127.0.0.1:${port}/api/replay/snapshot?decision=0&mode=spectator`)).json() as Record<string, any>;
      expect(spectator.replay.selection).toMatchObject({ decisionIndex: 0, rawCursor: 7, agentId: "a", actionType: "dahai" });
      expect(spectator.replay.selection).not.toHaveProperty("debug");
      expect(spectator).not.toHaveProperty("debug");
      expect(spectator.replay.selection).not.toHaveProperty("requestedAction");
      expect(spectator.replay.selection).not.toHaveProperty("appliedAction");
      expect(spectator.table.seats.bottom.river).toHaveLength(1);

      const debug = await (await fetch(`http://127.0.0.1:${port}/api/replay/snapshot?decision=0&mode=debug`)).json() as Record<string, any>;
      expect(debug.replay.selection.debug).toMatchObject({
        requestedAction: { type: "dahai" },
        appliedAction: { type: "dahai" },
        diagnostics: { confidence: 0.8 },
        metadata: { provider: "test-provider" },
      });
      expect(debug.replay.selection.debug.rawEvents.map((item: { sequence: number }) => item.sequence)).toEqual([3, 4, 5, 6, 7]);

      const legacyCursor = await (await fetch(`http://127.0.0.1:${port}/api/replay/snapshot?cursor=7&mode=spectator`)).json() as Record<string, any>;
      expect(legacyCursor.replay.selection.decisionIndex).toBe(1);
      expect(legacyCursor.replay.selection.rawCursor).toBe(7);
    } finally {
      await server.close();
    }
  });
});
