import { describe, expect, it } from "vitest";
import { buildResearchSnapshots, buildResearchTrends, buildRunComparison } from "../src/server/research.js";
import type { RunRecord, RunType } from "../src/server/run-store.js";

function run(id: string, type: RunType, status: RunRecord["status"] = "completed"): RunRecord {
  return {
    schemaVersion: 1,
    id,
    type,
    status,
    createdAt: "2026-09-23T00:00:00.000Z",
    finishedAt: "2026-09-23T00:01:00.000Z",
    config: {},
    configHash: `${id}-hash`,
    artifactDir: `/tmp/${id}`,
  };
}

describe("research run comparison", () => {
  it("builds one latest headline snapshot per completed run type", () => {
    const latest = run("run_latest", "benchmark");
    latest.createdAt = "2026-09-23T03:00:00.000Z";
    const older = run("run_older", "benchmark");
    older.createdAt = "2026-09-22T03:00:00.000Z";
    const snapshots = buildResearchSnapshots([
      { run: latest, result: { summaries: [{ agentId: "jev", legalActionRate: 1, exactMatchRate: 0, p95LatencyMs: 40 }] } },
      { run: older, result: { summaries: [{ agentId: "gpt", legalActionRate: 0.8, exactMatchRate: 0.7, p95LatencyMs: 400 }] } },
      { run: run("run_hybrid", "hybrid-sweep"), result: { thresholdResults: [{ threshold: 0.3, agreementRate: 0.9, escalationRate: 0.2 }] } },
      { run: run("run_active", "tournament", "running"), result: { metrics: { agents: [{ agentId: "random", meanRank: 1 }] } } },
    ]);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({ runId: "run_latest", runType: "benchmark" });
    expect(snapshots[0]?.metrics.map(({ key }) => key)).toEqual(["legalActionRate", "exactMatchRate", "p95LatencyMs", "totalTokensPerDecision"]);
    expect(snapshots[0]?.columns[0]?.values).toEqual({ legalActionRate: 1, exactMatchRate: 0, p95LatencyMs: 40, totalTokensPerDecision: null });
    expect(snapshots[1]).toMatchObject({ runId: "run_hybrid", runType: "hybrid-sweep" });
  });

  it("compares canonical decision metrics and preserves missing values as unavailable", () => {
    const comparison = buildRunComparison([
      {
        run: run("run_a", "benchmark"),
        result: { summaries: [{ agentId: "jev", decisions: 5, successRate: 1, legalActionRate: 1, exactMatchRate: 0, p50LatencyMs: 20, p95LatencyMs: 40 }] },
      },
      {
        run: run("run_b", "benchmark"),
        result: { summaries: [{ agentId: "gpt", decisions: 5, successRate: 1, legalActionRate: 1, exactMatchRate: 0.8, p50LatencyMs: 200, p95LatencyMs: 400, totalTokensPerDecision: 100 }] },
      },
    ]);
    expect(comparison.runType).toBe("benchmark");
    expect(comparison.columns).toHaveLength(2);
    expect(comparison.columns[0]?.values.exactMatchRate).toBe(0);
    expect(comparison.columns[0]?.values.totalTokensPerDecision).toBeNull();
    expect(comparison.columns[1]?.values.totalTokensPerDecision).toBe(100);
    expect(comparison.metrics).toContainEqual({ key: "brierScore", category: "decision-quality", format: "number" });
  });

  it("compares tournament and Hybrid metrics without inventing values", () => {
    const tournament = buildRunComparison([
      { run: run("run_t1", "tournament"), result: { metrics: { agents: [{ agentId: "jev", games: 2, meanScore: 25_000, meanRank: 2.5, fallbackRate: 0 }] } } },
      { run: run("run_t2", "tournament"), result: { metrics: { agents: [{ agentId: "gpt", games: 2, meanScore: 26_000, meanRank: 2, fallbackRate: 0.1 }] } } },
    ]);
    expect(tournament.columns[0]?.values.winRate).toBeNull();
    expect(tournament.columns[0]?.values.fallbackRate).toBe(0);

    const hybrid = buildRunComparison([
      { run: run("run_h1", "hybrid-sweep"), result: { thresholdResults: [{ threshold: 0.3, agreementRate: 0.8, estimatedUsage: { totalTokens: 30 } }] } },
      { run: run("run_h2", "hybrid-sweep"), result: { thresholdResults: [{ threshold: 0.5, agreementRate: 0.7, estimatedUsage: { totalTokens: 20 } }] } },
    ]);
    expect(hybrid.columns[0]).toMatchObject({ entityId: "hybrid@0.3", values: { agreementRate: 0.8, estimatedTotalTokens: 30 } });
  });

  it("builds chronological, type-specific trends and preserves zero values", () => {
    const newer = run("run_new", "benchmark");
    newer.createdAt = "2026-09-23T03:00:00.000Z";
    const older = run("run_old", "benchmark");
    older.createdAt = "2026-09-22T03:00:00.000Z";
    const trends = buildResearchTrends([
      { run: newer, result: { summaries: [{ agentId: "jev", exactMatchRate: 0.8 }] } },
      { run: older, result: { summaries: [{ agentId: "jev", exactMatchRate: 0 }] } },
      { run: run("run_t", "tournament"), result: { metrics: { agents: [{ agentId: "jev", meanRank: 2 }] } } },
    ]);
    expect(trends).toHaveLength(2);
    expect(trends[0]).toMatchObject({ runType: "tournament", metric: { key: "meanRank" }, direction: "lower" });
    expect(trends[1]).toMatchObject({ runType: "benchmark", metric: { key: "exactMatchRate" }, direction: "higher" });
    expect(trends[1]?.series[0]?.points.map(({ runId, value }) => ({ runId, value }))).toEqual([
      { runId: "run_old", value: 0 },
      { runId: "run_new", value: 0.8 },
    ]);
  });

  it("rejects incompatible, incomplete, or undersized selections", () => {
    expect(() => buildRunComparison([{ run: run("run_a", "benchmark"), result: {} }])).toThrow("at least two");
    expect(() => buildRunComparison([
      { run: run("run_a", "benchmark"), result: {} },
      { run: run("run_b", "tournament"), result: {} },
    ])).toThrow("same run type");
    expect(() => buildRunComparison([
      { run: run("run_a", "benchmark", "running"), result: {} },
      { run: run("run_b", "benchmark"), result: {} },
    ])).toThrow("only completed");
  });
});
