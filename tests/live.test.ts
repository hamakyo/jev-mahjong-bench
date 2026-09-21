import { readFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LiveEventHub } from "../src/live/hub.js";
import { projectTournamentEvent } from "../src/live/projector.js";
import { createLiveServer } from "../src/live/server.js";
import { SnapshotStore } from "../src/live/snapshot.js";
import { runTournament } from "../src/tournament/run.js";

const base = { schemaVersion: 1 as const, gameId: "game", pairId: "pair", rotationIndex: 0 };

function mjai(event: Record<string, unknown>) {
  return { ...base, type: "mjai" as const, source: "bridge" as const, event };
}

describe("live event projection", () => {
  it("keeps hidden tiles out of spectator events while retaining them for debug", () => {
    const start = projectTournamentEvent(mjai({
      type: "start_kyoku",
      tehais: [["1m"], ["2m"], ["3m"], ["4m"]],
      scores: [25_000, 25_000, 25_000, 25_000],
    }));
    const publicEvent = start.publicEvent as Extract<typeof start.publicEvent, { type: "mjai" }>;
    const debugEvent = start.debugEvent as Extract<typeof start.debugEvent, { type: "mjai" }>;
    expect(publicEvent.event).not.toHaveProperty("tehais");
    expect(debugEvent.event).toHaveProperty("tehais");

    const tsumo = projectTournamentEvent(mjai({ type: "tsumo", actor: 0, pai: "1m" }));
    const publicTsumo = tsumo.publicEvent as Extract<typeof tsumo.publicEvent, { type: "mjai" }>;
    expect(publicTsumo.event).toEqual({ type: "tsumo", actor: 0 });
    expect(projectTournamentEvent(mjai({ type: "future_secret", hand: ["1m"] })).publicEvent).toMatchObject({
      event: { type: "future_secret" },
    });
    expect((projectTournamentEvent(mjai({ type: "future_secret", hand: ["1m"] })).publicEvent as { event: Record<string, unknown> }).event).not.toHaveProperty("hand");

    const decision = projectTournamentEvent({
      ...base,
      type: "decision:end",
      player: 0,
      agentId: "gpt",
      appliedActionId: "id",
      appliedAction: { type: "dahai", pai: "1m" },
      isLegal: false,
      fallbackReason: "timeout",
      latencyMs: 100,
      retryCount: 2,
      error: "provider failed",
      metadata: { secret: "debug-only" },
    });
    expect(decision.publicEvent).not.toHaveProperty("error");
    expect(decision.publicEvent).not.toHaveProperty("fallbackReason");
    expect(decision.publicEvent).not.toHaveProperty("retryCount");
    expect(decision.publicEvent).not.toHaveProperty("isLegal");
    expect(decision.publicEvent).not.toHaveProperty("latencyMs");
    expect(decision.debugEvent).toHaveProperty("metadata.secret", "debug-only");
  });
});

describe("live hub and snapshot", () => {
  it("assigns monotonic IDs, replays suffixes, and reports an old cursor", () => {
    const hub = new LiveEventHub({ streamId: "stream", bufferSize: 2, now: () => "now" });
    hub.emit({ schemaVersion: 1, type: "tournament:progress", completedGames: 0, totalGames: 2 });
    hub.emit({ schemaVersion: 1, type: "tournament:progress", completedGames: 1, totalGames: 2 });
    hub.emit({ schemaVersion: 1, type: "tournament:progress", completedGames: 2, totalGames: 2 });
    const replay: number[] = [];
    const subscriber = {
      send: (event: { id: number }) => { replay.push(event.id); return true; },
      reset: () => true,
    };
    hub.subscribe("spectator", 1, subscriber);
    expect(replay).toEqual([2, 3]);
    let reset: unknown;
    hub.subscribe("spectator", 0, {
      send: () => true,
      reset: (event) => { reset = event; return true; },
    });
    expect(reset).toMatchObject({ type: "reset", streamId: "stream", oldestEventId: 2, lastEventId: 3 });

    let closed = false;
    hub.subscribe("spectator", 3, {
      send: () => false,
      reset: () => true,
      close: () => { closed = true; },
    });
    hub.emit({ schemaVersion: 1, type: "tournament:progress", completedGames: 2, totalGames: 2 });
    expect(closed).toBe(true);
  });

  it("reconstructs public board state and keeps debug state separate", () => {
    const hub = new LiveEventHub({ streamId: "snapshot-stream" });
    const store = new SnapshotStore(hub.streamId);
    const apply = (event: Parameters<LiveEventHub["emit"]>[0]) => store.apply(hub.emit(event));
    apply({
      schemaVersion: 1,
      type: "tournament:start",
      totalGames: 1,
      settings: { mode: "4p-red-east", rule: "tenhou", seed: 1, seatPolicy: "fixed", requestedSeats: ["random", "random", "random", "random"], timeoutMs: 1000, pairedRuns: null },
      schedule: [],
    });
    apply({ type: "game:start", ...base, seed: 1, baseSeed: 1, seats: ["random", "random", "random", "random"], gameIndex: 0, totalGames: 1 });
    apply(mjai({ type: "start_kyoku", bakaze: "E", kyoku: 1, honba: 2, kyotaku: 1, oya: 0, scores: [25_000, 25_000, 25_000, 25_000], tehais: [["1m"]] }));
    apply({ type: "decision:start", ...base, player: 0, agentId: "random", observation: { state: { round: "E1", hand: [] }, legalActions: [], newEvents: [] } });
    apply({ type: "decision:end", ...base, player: 0, agentId: "random", requestedActionId: "requested", requestedAction: { type: "dahai", actor: 0, pai: "2m" }, appliedActionId: "a", appliedAction: { type: "dahai", actor: 0, pai: "1m" }, isLegal: true, latencyMs: 3, inputTokens: 12, outputTokens: 4, retryCount: 0, diagnostics: { confidence: 1 } });
    apply(mjai({ type: "dahai", actor: 0, pai: "1m" }));
    apply({
      type: "game:end",
      ...base,
      seed: 1,
      baseSeed: 1,
      seats: ["random", "random", "random", "random"],
      scores: [30_000, 20_000, 25_000, 25_000],
      ranks: [1, 2, 3, 4],
      handCount: 2,
      errorCount: 0,
      result: {
        gameId: "game",
        seed: 1,
        baseSeed: 1,
        pairId: "pair",
        rotationIndex: 0,
        seats: ["random", "random", "random", "random"],
        scores: [30_000, 20_000, 25_000, 25_000],
        ranks: [1, 2, 3, 4],
        handCount: 2,
        eventCounts: {},
        players: [{
          gameId: "game",
          seed: 1,
          pairId: "pair",
          baseSeed: 1,
          rotationIndex: 0,
          agentId: "random",
          seat: 0,
          score: 30_000,
          rank: 1,
          handCount: 2,
          wins: 1,
          dealIns: 0,
          riichi: 1,
          calls: 1,
          decisions: 1,
          legalDecisions: 1,
          fallbackCount: 0,
          errorCount: 0,
          latenciesMs: [3],
          decisionInputBytes: [100],
          stateBytes: [80],
          retryCount: 0,
          escalationCount: 0,
          jevFallbackCount: 0,
          jevInputTokens: 12,
          jevOutputTokens: 4,
          gptInputTokens: 0,
          gptOutputTokens: 0,
          gptRetryCount: 0,
          inputTokens: 12,
          outputTokens: 4,
          rawEventCounts: {},
        }],
        errorCount: 0,
      },
    });
    const spectator = store.getSnapshot("spectator");
    expect(spectator.round).toBe("E1");
    expect(spectator.honba).toBe(2);
    expect(spectator.discards.E).toEqual(["1m"]);
    expect(spectator).not.toHaveProperty("debug");
    const debug = store.getSnapshot("debug");
    expect(debug.debug?.latestStateBySeat.E).toEqual({ round: "E1", hand: [] });
    expect(debug.debug?.rawEvents).toHaveLength(2);
    expect(debug.lastDecisions[0]).toMatchObject({
      actionType: "dahai",
      player: 0,
      requestedActionId: "requested",
      requestedAction: { type: "dahai", actor: 0, pai: "2m" },
      appliedActionId: "a",
      appliedAction: { type: "dahai", actor: 0, pai: "1m" },
      inputTokens: 12,
      outputTokens: 4,
    });
    expect(spectator.lastDecisions[0]).not.toHaveProperty("requestedAction");
    expect(spectator.lastDecisions[0]).not.toHaveProperty("appliedAction");
    expect(spectator.lastDecisions[0]).not.toHaveProperty("isLegal");
    expect(spectator.lastDecisions[0]).not.toHaveProperty("latencyMs");
    expect(spectator.agents.random).toEqual({
      handCount: 2,
      wins: 1,
      dealIns: 0,
      riichi: 1,
      calls: 1,
      completedGames: 1,
    });
    expect(spectator.agents.random).not.toHaveProperty("inputTokens");
    expect(spectator.agents.random).not.toHaveProperty("retryCount");
    expect(spectator.agents.random).not.toHaveProperty("fallbackCount");
    expect(spectator.agents.random).not.toHaveProperty("escalationCount");
    expect(debug.agents.random).toMatchObject({
      handCount: 2,
      inputTokens: 12,
      outputTokens: 4,
      retryCount: 0,
    });
  });
});

describe("live HTTP server", () => {
  it("serves snapshots and an SSE event on an ephemeral port", async () => {
    const hub = new LiveEventHub({ streamId: "http-stream" });
    const store = new SnapshotStore(hub.streamId);
    const server = createLiveServer({ hub, snapshots: store, port: 0 });
    const port = await server.listen();
    try {
      const root = await fetch(`http://127.0.0.1:${port}/`);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain("Jev Mahjong live tournament");
      const snapshot = await fetch(`http://127.0.0.1:${port}/api/snapshot?mode=spectator`);
      expect(snapshot.status).toBe(200);
      expect((await snapshot.json()).streamId).toBe("http-stream");

      const controller = new AbortController();
      const responsePromise = fetch(`http://127.0.0.1:${port}/api/events?mode=spectator&after=0`, { signal: controller.signal });
      const response = await responsePromise;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("SSE response has no body");
      const firstRead = reader.read();
      hub.emit({ schemaVersion: 1, type: "tournament:progress", completedGames: 1, totalGames: 1 });
      const chunk = await firstRead;
      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain("event: tournament:progress");
      controller.abort();
      await reader.cancel().catch(() => undefined);
    } finally {
      await server.close();
    }
  });

  it("prefers Last-Event-ID over a stale URL cursor on reconnect", async () => {
    const hub = new LiveEventHub({ streamId: "http-cursor-stream" });
    for (let completedGames = 0; completedGames < 6; completedGames += 1) {
      hub.emit({ schemaVersion: 1, type: "tournament:progress", completedGames, totalGames: 6 });
    }
    const store = new SnapshotStore(hub.streamId);
    const server = createLiveServer({ hub, snapshots: store, port: 0 });
    const port = await server.listen();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events?mode=spectator&after=3`, {
       headers: { "Last-Event-ID": "5" },
     });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("SSE response has no body");
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      const text = new TextDecoder().decode(value);
      expect(text).toContain("id: 6");
      expect(text).not.toContain("id: 4");
      expect(text).not.toContain("id: 5");
      await reader.cancel().catch(() => undefined);
    } finally {
      await server.close();
    }
  });
});

describe("tournament observer", () => {
  it("publishes deltas without changing normal tournament artifacts", async () => {
    const out = await mkdtemp(join(tmpdir(), "jev-live-tournament-"));
    const events: Array<{ type: string }> = [];
    await runTournament({
      seats: ["random", "random", "random", "random"],
      games: 1,
      mode: "4p-red-east",
      rule: "tenhou",
      seed: 7,
      seatPolicy: "fixed",
      out,
      timeoutMs: 1_000,
    }, {
      observer: {
        emit: (event) => {
          events.push(event);
          if (event.type === "tournament:start") event.settings.requestedSeats[0] = "mutated";
        },
      },
    });
    expect(events[0]?.type).toBe("tournament:start");
    expect(events[1]?.type).toBe("game:start");
    expect(events[2]?.type).toBe("mjai");
    expect(events.some((event) => event.type === "decision:start")).toBe(true);
    expect(events.some((event) => event.type === "decision:end")).toBe(true);
    expect(events.at(-2)?.type).toBe("tournament:progress");
    expect(events.at(-1)?.type).toBe("tournament:end");
    const observedMjai = events.filter((event) => event.type === "mjai").length;
    const gameFiles = await readdir(join(out, "games"));
    const gameLog = await readFile(join(out, "games", gameFiles[0]!), "utf8");
    expect(observedMjai).toBe(gameLog.trim().split("\n").filter(Boolean).length);
    const report = JSON.parse(await readFile(join(out, "tournament.json"), "utf8")) as { settings: { requestedSeats: string[] }; errorCount: number };
    expect(report.settings.requestedSeats[0]).toBe("random");
    expect(report.errorCount).toBe(0);

    const normalOut = await mkdtemp(join(tmpdir(), "jev-live-normal-"));
    await runTournament({
      seats: ["random", "random", "random", "random"],
      games: 1,
      mode: "4p-red-east",
      rule: "tenhou",
      seed: 7,
      seatPolicy: "fixed",
      out: normalOut,
      timeoutMs: 1_000,
    });
    const normalGameFiles = await readdir(join(normalOut, "games"));
    const normalLog = await readFile(join(normalOut, "games", normalGameFiles[0]!), "utf8");
    expect(normalLog).toBe(gameLog);
    const normalReport = JSON.parse(await readFile(join(normalOut, "tournament.json"), "utf8")) as { games: Array<{ scores: number[]; ranks: number[] }> };
    const watchedReport = JSON.parse(await readFile(join(out, "tournament.json"), "utf8")) as { games: Array<{ scores: number[]; ranks: number[] }> };
    expect(watchedReport.games[0]?.scores).toEqual(normalReport.games[0]?.scores);
    expect(watchedReport.games[0]?.ranks).toEqual(normalReport.games[0]?.ranks);
  }, 30_000);
});
