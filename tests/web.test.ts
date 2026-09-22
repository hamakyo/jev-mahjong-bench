import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeRunInput, RunManager } from "../src/server/run-manager.js";
import { RunStore } from "../src/server/run-store.js";
import { createWebServer } from "../src/server/server.js";
import { LiveEventHub } from "../src/live/hub.js";
import { SnapshotStore } from "../src/live/snapshot.js";
import { TournamentControl } from "../src/live/control.js";
import { createLiveServer } from "../src/live/server.js";
import { webDashboardHtml, webDashboardJs } from "../src/server/dashboard.js";
import { DEFAULT_HYBRID_THRESHOLDS } from "../src/benchmark/hybrid-sweep.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Web UI run orchestration", () => {
  it("ships syntactically valid browser JavaScript", () => {
    expect(() => new Function(webDashboardJs)).not.toThrow();
    expect(webDashboardHtml).toContain(`value="${DEFAULT_HYBRID_THRESHOLDS.join(",")}"`);
  });

  it("normalizes supported run types and rejects unsafe shapes", () => {
    expect(normalizeRunInput({
      type: "tournament",
      config: { seats: "jev,random,random,random", games: 2, seed: 7 },
    })).toEqual({
      type: "tournament",
      config: {
        seats: ["jev", "random", "random", "random"],
        games: 2,
        mode: "4p-red-half",
        rule: "tenhou",
        seed: 7,
        seatPolicy: "rotate",
        timeoutMs: 60_000,
      },
    });
    expect(() => normalizeRunInput({
      type: "tournament",
      config: { seats: ["random"], games: 1 },
    })).toThrow("exactly four");
    expect(() => normalizeRunInput({ type: "unknown" as "benchmark", config: {} })).toThrow("type must be");
    expect(normalizeRunInput({ type: "hybrid-sweep", config: {} }).config.thresholds)
      .toEqual([...DEFAULT_HYBRID_THRESHOLDS]);
  });

  it("persists stable config hashes and recovers interrupted runs", async () => {
    const root = await temporaryDirectory("jev-runs-");
    const now = () => new Date("2026-09-22T10:00:00.000Z");
    const store = new RunStore(root, now);
    const first = await store.create("benchmark", { dataset: "sample", agents: ["random"], seed: 42 });
    const second = await store.create("benchmark", { seed: 42, agents: ["random"], dataset: "sample" });
    expect(first.configHash).toBe(second.configHash);
    await store.update(first.id, { status: "running", pid: 123 });

    const reopened = new RunStore(root, now);
    await reopened.recoverInterrupted();
    expect(await reopened.get(first.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("stopped before"),
    });
    expect((await reopened.get(first.id)).pid).toBeUndefined();
  });

  it("serves persisted run details, results, artifacts, models, and datasets", async () => {
    const root = await temporaryDirectory("jev-web-");
    const store = new RunStore(join(root, "runs"));
    const manager = new RunManager(store, resolve("."));
    await manager.init();
    const run = await store.create("benchmark", { agents: ["random"], dataset: "datasets/sample.jsonl" });
    await writeFile(join(run.artifactDir, "report.json"), JSON.stringify({ summaries: [{ agentId: "random" }] }));
    await store.update(run.id, { status: "completed", finishedAt: new Date().toISOString() });
    const server = createWebServer({ manager, projectRoot: resolve("."), port: 0 });
    const port = await server.listen();
    try {
      const origin = `http://127.0.0.1:${port}`;
      expect(await (await fetch(`${origin}/`)).text()).toContain("Local control plane");
      expect(await (await fetch(`${origin}/api/runs`)).json()).toHaveLength(1);
      const detail = await (await fetch(`${origin}/api/runs/${run.id}`)).json();
      expect(detail.run.status).toBe("completed");
      expect(detail.result.summaries[0].agentId).toBe("random");
      expect(detail.artifacts).toEqual([expect.objectContaining({ path: "report.json" })]);
      expect((await (await fetch(`${origin}/api/models`)).json()).models[0]).not.toHaveProperty("apiKey");
      expect(Array.isArray(await (await fetch(`${origin}/api/datasets`)).json())).toBe(true);
      const traversal = await fetch(`${origin}/api/runs/${run.id}/artifact?path=${encodeURIComponent("../../outside")}`);
      expect(traversal.status).toBe(400);
      const invalid = await fetch(`${origin}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "invalid", config: {} }),
      });
      expect(invalid.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("exposes run-scoped live snapshot and control endpoints", async () => {
    const root = await temporaryDirectory("jev-web-live-");
    const hub = new LiveEventHub({ streamId: "run-scoped-live" });
    const snapshots = new SnapshotStore(hub.streamId);
    const control = new TournamentControl();
    const live = createLiveServer({ hub, snapshots, control, port: 0 });
    const livePort = await live.listen();
    const store = new RunStore(join(root, "runs"));
    const manager = new RunManager(store, resolve("."));
    await manager.init();
    const run = await store.create("tournament", { seats: ["random", "random", "random", "random"] });
    await store.update(run.id, { status: "running", liveUrl: `http://127.0.0.1:${livePort}/` });
    const web = createWebServer({ manager, port: 0 });
    const webPort = await web.listen();
    try {
      const origin = `http://127.0.0.1:${webPort}`;
      const snapshot = await (await fetch(`${origin}/api/runs/${run.id}/snapshot?mode=spectator`)).json();
      expect(snapshot.streamId).toBe("run-scoped-live");
      const paused = await (await fetch(`${origin}/api/runs/${run.id}/control/pause`, { method: "POST" })).json();
      expect(paused.pauseRequested).toBe(true);
      expect(control.getSnapshot().pauseRequested).toBe(true);
    } finally {
      await web.close();
      await live.close();
    }
  });

  it("runs a decision benchmark through the existing CLI and keeps canonical artifacts", async () => {
    const root = await temporaryDirectory("jev-web-run-");
    const store = new RunStore(join(root, "runs"));
    const manager = new RunManager(store, resolve("."));
    await manager.init();
    const run = await manager.start({
      type: "benchmark",
      config: { agents: "random", dataset: "datasets/sample.jsonl", concurrency: 1, seed: 5 },
    });
    let current = await store.get(run.id);
    const deadline = Date.now() + 20_000;
    while (current.status === "queued" || current.status === "running") {
      if (Date.now() > deadline) throw new Error("benchmark run did not finish");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      current = await store.get(run.id);
    }
    await manager.close();
    expect(current.status).toBe("completed");
    expect(await store.result(run.id)).toMatchObject({ summaries: [expect.objectContaining({ agentId: "random" })] });
    expect((await store.artifacts(run.id)).map((artifact) => artifact.path)).toEqual(expect.arrayContaining(["report.json", "report.md"]));
  }, 25_000);
});
