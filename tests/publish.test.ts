import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listPublishedBenchmarks, publishBenchmark } from "../src/publish/benchmark.js";
import { RunStore } from "../src/server/run-store.js";

const temporaryDirectories: string[] = [];

async function project(): Promise<{ root: string; store: RunStore }> {
  const root = await mkdtemp(join(tmpdir(), "jev-publish-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "datasets"), { recursive: true });
  await writeFile(join(root, "datasets", "sample.jsonl"), '{"id":"sample"}\n');
  const store = new RunStore(join(root, "results", "runs"), () => new Date("2026-09-23T02:00:00.000Z"));
  await store.init();
  return { root, store };
}

async function completedBenchmark(store: RunStore, extra: Record<string, unknown> = {}) {
  const run = await store.create("benchmark", {
    agents: ["jev", "gpt"],
    dataset: "datasets/sample.jsonl",
    concurrency: 1,
    seed: 42,
    models: "models.example.yaml",
    ...extra,
  });
  await writeFile(join(run.artifactDir, "report.json"), JSON.stringify({
    version: 2,
    metadata: {
      openaiModel: "gpt-5.6-luna",
      openaiReasoningEffort: "none",
      registryModels: [{ id: "gpt", provider: "openai", model: "gpt-5.6-luna", apiKeyEnv: "OPENAI_API_KEY", headers: { "X-Secret": { env: "PRIVATE_HEADER" } } }],
    },
    summaries: [{ agentId: "jev", decisions: 5, legalActionRate: 1, exactMatchRate: 0, p95LatencyMs: 20 }],
    records: [{ sampleId: "must-not-be-published", providerResponse: "private" }],
  }));
  return store.update(run.id, { status: "completed", finishedAt: "2026-09-23T03:00:00.000Z" });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("benchmark publication", () => {
  it("publishes deterministic, aggregate-only records and lists them", async () => {
    const { root, store } = await project();
    const run = await completedBenchmark(store);
    const commit = "a".repeat(40);
    const first = await publishBenchmark({ projectRoot: root, store, runId: run.id, category: "providers", slug: "jev-vs-gpt", benchmarkCommit: commit });
    const second = await publishBenchmark({ projectRoot: root, store, runId: run.id, category: "providers", slug: "jev-vs-gpt", benchmarkCommit: "b".repeat(40) });

    expect(first.path).toBe(`benchmarks/providers/2026-09-23-jev-vs-gpt-${run.configHash.slice(0, 6)}`);
    expect(second).toEqual(first);
    expect(first.manifest).toMatchObject({
      sourceRunId: run.id,
      benchmarkCommit: commit,
      agents: ["jev", "gpt"],
      dataset: { path: "datasets/sample.jsonl", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      rawArtifacts: { included: false },
    });
    expect(first.manifest.models).toEqual([{ id: "gpt", model: "gpt-5.6-luna", provider: "openai", reasoningEffort: "none" }]);
    expect(first.summary).toHaveProperty("summaries");
    expect(first.summary).not.toHaveProperty("records");
    const serialized = await readFile(join(root, first.path, "manifest.json"), "utf8");
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("PRIVATE_HEADER");
    expect(await readFile(join(root, first.path, "report.md"), "utf8")).toContain("## Aggregate results");
    expect(await listPublishedBenchmarks(root)).toEqual([first]);
  });

  it("extracts aggregate-only tournament and Hybrid summaries", async () => {
    const { root, store } = await project();
    const tournament = await store.create("tournament", { seats: ["jev", "gpt", "random", "random"], games: 1, mode: "4p-red-east", rule: "tenhou", seed: 9, seatPolicy: "rotate", timeoutMs: 60_000 });
    await writeFile(join(tournament.artifactDir, "tournament.json"), JSON.stringify({
      models: { registryModels: [{ id: "gpt", provider: "openai", model: "gpt-5.6-luna", apiKeyEnv: "OPENAI_API_KEY" }] },
      metrics: { agents: [{ agentId: "jev", games: 1, meanRank: 1, meanScore: 40_000 }] },
      games: [{ gameId: "raw-game-must-not-be-published" }],
    }));
    await store.update(tournament.id, { status: "completed", finishedAt: "2026-09-23T03:00:00.000Z" });
    const publishedTournament = await publishBenchmark({ projectRoot: root, store, runId: tournament.id, benchmarkCommit: "a".repeat(40) });
    expect(publishedTournament.path).toContain("benchmarks/tournaments/");
    expect(publishedTournament.summary).toEqual({ schemaVersion: 1, runType: "tournament", metrics: { agents: [{ agentId: "jev", games: 1, meanRank: 1, meanScore: 40_000 }] } });
    expect(publishedTournament.summary).not.toHaveProperty("games");

    const hybrid = await store.create("hybrid-sweep", { dataset: "datasets/sample.jsonl", thresholds: [0.3] });
    await writeFile(join(hybrid.artifactDir, "hybrid-sweep.json"), JSON.stringify({
      totalSamples: 5,
      models: { jev: { model: "system-one", reasoningEffort: "default" }, gpt: { model: "gpt-5.6-luna", reasoningEffort: "none" } },
      thresholdResults: [{ threshold: 0.3, agreementRate: 0.8, escalationRate: 0.2 }],
      rawDecisions: [{ sampleId: "raw-decision-must-not-be-published" }],
    }));
    await store.update(hybrid.id, { status: "completed", finishedAt: "2026-09-23T03:00:00.000Z" });
    const publishedHybrid = await publishBenchmark({ projectRoot: root, store, runId: hybrid.id, benchmarkCommit: "a".repeat(40) });
    expect(publishedHybrid.path).toContain("benchmarks/hybrid/");
    expect(publishedHybrid.summary).toMatchObject({ schemaVersion: 1, runType: "hybrid-sweep", totalSamples: 5, thresholdResults: [{ threshold: 0.3 }] });
    expect(publishedHybrid.summary).not.toHaveProperty("rawDecisions");
  });

  it("rejects incomplete runs, unsafe names, secrets, and path collisions", async () => {
    const { root, store } = await project();
    const queued = await store.create("benchmark", { agents: ["gpt"], dataset: "datasets/sample.jsonl" });
    await expect(publishBenchmark({ projectRoot: root, store, runId: queued.id, benchmarkCommit: "a".repeat(40) })).rejects.toThrow("only completed");

    const secret = await completedBenchmark(store, { apiKey: "sk-example-secret-value" });
    await expect(publishBenchmark({ projectRoot: root, store, runId: secret.id, benchmarkCommit: "a".repeat(40) })).rejects.toThrow("secret-bearing field");

    const first = await completedBenchmark(store);
    await expect(publishBenchmark({ projectRoot: root, store, runId: first.id, category: "../outside", benchmarkCommit: "a".repeat(40) })).rejects.toThrow("category must");
    await publishBenchmark({ projectRoot: root, store, runId: first.id, category: "providers", slug: "same-run", benchmarkCommit: "a".repeat(40) });
    const second = await completedBenchmark(store);
    await expect(publishBenchmark({ projectRoot: root, store, runId: second.id, category: "providers", slug: "same-run", benchmarkCommit: "a".repeat(40) })).rejects.toThrow("already belongs");
  });
});
