import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadReplay } from "../src/replay/loader.js";
import { ReplayRecorder } from "../src/replay/recorder.js";
import { createReplayServer } from "../src/replay/server.js";
import { ReplayTimeline } from "../src/replay/timeline.js";
import { gameRange } from "../src/export/video.js";

const base = { schemaVersion: 1 as const, gameId: "game", pairId: "pair", rotationIndex: 0 };

describe("offline replay", () => {
  it("persists a readable running replay and points checkpoints after their event", async () => {
    const out = await mkdtemp(join(tmpdir(), "jev-replay-running-"));
    const recorder = new ReplayRecorder(out, "running-stream");
    recorder.record({ type: "game:start", ...base, seed: 1, baseSeed: 1, seats: ["random", "random", "random", "random"], gameIndex: 0, totalGames: 1 });
    recorder.record({ type: "mjai", ...base, source: "bridge", event: { type: "start_kyoku", tehais: [["1m"]], scores: [25_000, 25_000, 25_000, 25_000] } });
    await recorder.flush();

    const runningManifest = JSON.parse(await readFile(join(out, "replay", "manifest.json"), "utf8")) as { status: string; revision: number; eventCount: number };
    expect(runningManifest).toMatchObject({ status: "running", revision: 2, eventCount: 2 });
    const running = await loadReplay(out);
    expect(running.events).toHaveLength(2);
    const checkpoint = running.checkpoints.find((value) => value.reason === "start_kyoku");
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.byteOffset).toBe((await stat(join(out, "replay", "events.jsonl"))).size);

    await recorder.finalize({ status: "complete" });
  });

  it("reconstructs snapshots with checkpoints and sanitizes spectator output", async () => {
    const out = await mkdtemp(join(tmpdir(), "jev-replay-"));
    const recorder = new ReplayRecorder(out, "replay-stream");
    recorder.record({
      schemaVersion: 1,
      type: "tournament:start",
      totalGames: 1,
      settings: { mode: "4p-red-east", rule: "tenhou", seed: 1, seatPolicy: "fixed", requestedSeats: ["random", "random", "random", "random"], timeoutMs: 1_000, pairedRuns: null },
      schedule: [],
    });
    recorder.record({ type: "game:start", ...base, seed: 1, baseSeed: 1, seats: ["random", "random", "random", "random"], gameIndex: 0, totalGames: 1 });
    recorder.record({ type: "mjai", ...base, source: "bridge", event: { type: "start_kyoku", tehais: [["1m"]], scores: [25_000, 25_000, 25_000, 25_000] } });
    recorder.record({ type: "decision:end", ...base, player: 0, agentId: "random", requestedActionId: "requested", requestedAction: { type: "dahai", pai: "1m" }, appliedActionId: "applied", appliedAction: { type: "dahai", pai: "1m" }, isLegal: false, fallbackReason: "timeout", latencyMs: 12, inputTokens: 99, outputTokens: 3, retryCount: 2, error: "timed out", metadata: { secret: "provider" } });
    await recorder.finalize({ status: "complete", configSha256: "config", results: [] });

    const data = await loadReplay(out);
    const timeline = new ReplayTimeline(data);
    const spectator = timeline.snapshot(data.events.length, "spectator");
    const debug = timeline.snapshot(data.events.length, "debug");
    expect(spectator.snapshot.lastDecisions[0]).not.toHaveProperty("isLegal");
    expect(spectator.snapshot.lastDecisions[0]).not.toHaveProperty("latencyMs");
    expect(spectator.snapshot.lastDecisions[0]).not.toHaveProperty("requestedAction");
    expect(spectator.snapshot.lastDecisions[0]).not.toHaveProperty("fallbackReason");
    expect(spectator.snapshot.lastDecisions[0]).not.toHaveProperty("error");
    expect(spectator.snapshot.lastDecisions[0]).not.toHaveProperty("inputTokens");
    expect(spectator.snapshot.lastDecisions[0]).not.toHaveProperty("retryCount");
    expect(spectator.snapshot.agents.random).not.toHaveProperty("inputTokens");
    expect(spectator.snapshot.agents.random).not.toHaveProperty("fallbackCount");
    expect(spectator.snapshot.agents.random).not.toHaveProperty("errorCount");
    expect(spectator.snapshot.agents.random).not.toHaveProperty("escalationCount");
    expect(debug.snapshot.lastDecisions[0]).toMatchObject({ isLegal: false, latencyMs: 12, retryCount: 2 });
    expect(debug.snapshot.debug?.providerMetadataBySeat.E).toMatchObject({ secret: "provider" });
    expect(data.checkpoints.some((checkpoint) => checkpoint.reason === "start_kyoku")).toBe(true);
    const manifest = JSON.parse(await readFile(join(out, "replay", "manifest.json"), "utf8")) as { configSha256: string };
    expect(manifest.configSha256).toBe("config");
  });

  it("uses the latest checkpoint and applies a bounded delta", async () => {
    const out = await mkdtemp(join(tmpdir(), "jev-replay-checkpoint-"));
    const recorder = new ReplayRecorder(out, "checkpoint-stream");
    for (let index = 0; index < 130; index += 1) {
      recorder.record({ schemaVersion: 1, type: "tournament:progress", completedGames: 0, totalGames: 1 });
    }
    await recorder.finalize({ status: "complete" });
    const timeline = new ReplayTimeline(await loadReplay(out));
    const snapshot = timeline.snapshot(130, "spectator");
    expect(snapshot.checkpointSequence).toBe(128);
    expect(snapshot.appliedDeltaCount).toBe(2);
    expect(snapshot.appliedDeltaCount).toBeLessThanOrEqual(127);
  });

  it("serves replay endpoints without creating agent calls", async () => {
    const out = await mkdtemp(join(tmpdir(), "jev-replay-server-"));
    const recorder = new ReplayRecorder(out, "server-stream");
    recorder.record({ schemaVersion: 1, type: "tournament:progress", completedGames: 0, totalGames: 1 });
    recorder.record({ type: "mjai", ...base, source: "bridge", event: { type: "start_kyoku", tehais: [["1m"]], scores: [25_000, 25_000, 25_000, 25_000] } });
    await recorder.finalize({ status: "complete" });
    const timeline = new ReplayTimeline(await loadReplay(out));
    const server = createReplayServer({ timeline, port: 0 });
    const port = await server.listen();
    try {
      const manifest = await fetch("http://127.0.0.1:" + port + "/api/replay/manifest");
      expect(manifest.status).toBe(200);
      const index = await fetch("http://127.0.0.1:" + port + "/api/replay/index");
      expect(index.status).toBe(200);
      const snapshot = await fetch("http://127.0.0.1:" + port + "/api/replay/snapshot?cursor=1&mode=spectator");
      expect(snapshot.status).toBe(200);
      expect((await snapshot.json()).replay.cursor).toBe(1);
      const events = await fetch("http://127.0.0.1:" + port + "/api/replay/events?from=1&to=1&mode=spectator");
      expect((await events.json())).toHaveLength(1);
      const spectatorEvents = await fetch("http://127.0.0.1:" + port + "/api/replay/events?from=2&to=2&mode=spectator");
      const spectatorEvent = (await spectatorEvents.json())[0];
      expect(spectatorEvent.event.event).not.toHaveProperty("tehais");
      expect(spectatorEvent.event.event).not.toHaveProperty("pai");
      const debugEvents = await fetch("http://127.0.0.1:" + port + "/api/replay/events?from=2&to=2&mode=debug");
      expect((await debugEvents.json())[0].event.event).toHaveProperty("tehais");
      const app = await fetch("http://127.0.0.1:" + port + "/assets/app.js");
      const appText = await app.text();
      expect(appText).toContain("renderDecisionTable");
      expect(appText).toContain("previous-hand");
    } finally {
      await server.close();
    }
  });

  it("rejects a video range that crosses the selected game", async () => {
    const out = await mkdtemp(join(tmpdir(), "jev-replay-video-range-"));
    const recorder = new ReplayRecorder(out, "video-range-stream");
    recorder.record({ type: "game:start", ...base, gameId: "game-1", seed: 1, baseSeed: 1, seats: ["random", "random", "random", "random"], gameIndex: 0, totalGames: 2 });
    recorder.record({ type: "game:end", ...base, gameId: "game-1", seed: 1, baseSeed: 1, seats: ["random", "random", "random", "random"], scores: [25_000, 25_000, 25_000, 25_000], ranks: [1, 2, 3, 4], handCount: 1, errorCount: 0, result: { gameId: "game-1", seed: 1, baseSeed: 1, pairId: "pair", rotationIndex: 0, seats: ["random", "random", "random", "random"], scores: [25_000, 25_000, 25_000, 25_000], ranks: [1, 2, 3, 4], handCount: 1, eventCounts: {}, errorCount: 0, players: [] } });
    recorder.record({ type: "game:start", ...base, gameId: "game-2", seed: 2, baseSeed: 2, seats: ["random", "random", "random", "random"], gameIndex: 1, totalGames: 2 });
    await recorder.finalize({ status: "complete" });
    const timeline = new ReplayTimeline(await loadReplay(out));
    expect(gameRange(timeline, "game-1", 1, 2)).toEqual({ from: 1, to: 2 });
    expect(() => gameRange(timeline, "game-1", 1, 3)).toThrow("selected game");
  });

  it("can publish a failed manifest after finalization I/O fails", async () => {
    const out = await mkdtemp(join(tmpdir(), "jev-replay-finalize-retry-"));
    const recorder = new ReplayRecorder(out, "finalize-retry-stream");
    recorder.record({ schemaVersion: 1, type: "tournament:progress", completedGames: 0, totalGames: 1 });
    await recorder.flush();
    await rm(join(out, "replay", "index.json"), { force: true });
    await mkdir(join(out, "replay", "index.json"), { recursive: true });
    await expect(recorder.finalize({ status: "complete" })).rejects.toThrow();
    await rm(join(out, "replay", "index.json"), { recursive: true, force: true });
    await recorder.finalize({ status: "failed", error: "finalization failed" });
    const manifest = JSON.parse(await readFile(join(out, "replay", "manifest.json"), "utf8")) as { status: string; error?: string };
    expect(manifest).toMatchObject({ status: "failed", error: "finalization failed" });
  });
});
