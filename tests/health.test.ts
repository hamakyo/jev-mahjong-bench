import { describe, expect, it } from "vitest";
import { redactLog, summarizeRunHealth } from "../src/server/health.js";
import type { RunRecord } from "../src/server/run-store.js";

const run: RunRecord = {
  schemaVersion: 1,
  id: "run_health",
  type: "tournament",
  status: "running",
  createdAt: "2026-09-23T00:00:00.000Z",
  startedAt: "2026-09-23T00:00:00.000Z",
  config: {},
  configHash: "hash",
  artifactDir: "/tmp/run_health",
};

describe("run health", () => {
  it("aggregates existing debug diagnostics without inventing unavailable values", () => {
    const health = summarizeRunHealth(run, {
      status: "running",
      lastEventId: 31,
      tournament: { completedGames: 2, totalGames: 8, errorCount: 1 },
      currentGame: { gameIndex: 2, totalGames: 8 },
      decisionsBySeat: { E: { pending: true, agentId: "gpt" }, S: { pending: false, agentId: "jev" } },
      agents: {
        jev: { decisions: 20, retryCount: 1, fallbackCount: 2, errorCount: 0, escalationCount: 3, latency: { p95Ms: 40 } },
        gpt: { decisions: 10, retryCount: 2, fallbackCount: 0, errorCount: 1, latency: { p95Ms: 400 } },
      },
      lastDecisions: [{ latencyMs: 380, fallbackReason: "timeout" }],
      recentEvents: [{ type: "dahai" }],
      debug: { providerMetadataBySeat: { E: { statuses: [429, 429, 200] }, S: { nested: { statuses: [503, 200] } } } },
    }, { stdout: "ok", stderr: "warning" }, new Date("2026-09-23T00:02:00.000Z"));

    expect(health).toMatchObject({
      available: true,
      completedGames: 2,
      totalGames: 8,
      currentGame: 3,
      currentAgents: ["gpt"],
      decisions: 30,
      decisionsPerMinute: 15,
      retries: 3,
      status429: 2,
      status503: 1,
      timeouts: 1,
      fallbacks: 2,
      errors: 2,
      escalations: 3,
      p95LatencyMs: 400,
      latestLatencyMs: 380,
      lastEventType: "dahai",
      lastEventId: 31,
    });
  });

  it("returns log-only health when a live snapshot is unavailable", () => {
    expect(summarizeRunHealth(run, undefined, { stdout: "started", stderr: "" })).toMatchObject({
      available: false,
      decisions: 0,
      p95LatencyMs: null,
      currentAgents: [],
      logs: { stdout: "started", stderr: "" },
    });
  });

  it("redacts common credential forms before log display", () => {
    const output = redactLog('Authorization: Bearer top-secret\nOPENAI_API_KEY=sk-examplecredential123\n{"password":"plain-secret"}\nAuthorization: Basic-credential');
    expect(output).not.toContain("top-secret");
    expect(output).not.toContain("sk-examplecredential123");
    expect(output).not.toContain("plain-secret");
    expect(output).not.toContain("Basic-credential");
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(4);
  });
});
