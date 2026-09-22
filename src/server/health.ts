import { open } from "node:fs/promises";
import type { RunRecord, RunStore } from "./run-store.js";

const LOG_TAIL_BYTES = 16 * 1024;
const LOG_TAIL_LINES = 40;

interface LiveAgentHealth {
  decisions?: number;
  fallbackCount?: number;
  errorCount?: number;
  retryCount?: number;
  escalationCount?: number;
  latency?: { p95Ms?: number };
}

interface LiveHealthSnapshot {
  lastEventId?: number;
  status?: string;
  tournament?: { completedGames?: number; totalGames?: number; errorCount?: number };
  currentGame?: { gameIndex?: number; totalGames?: number } | null;
  decisionsBySeat?: Record<string, { pending?: boolean; agentId?: string }>;
  lastDecisions?: Array<{ latencyMs?: number; fallbackReason?: string; error?: string }>;
  recentEvents?: Array<Record<string, unknown>>;
  agents?: Record<string, LiveAgentHealth>;
  debug?: { providerMetadataBySeat?: Record<string, unknown> };
}

export interface RunHealth {
  available: boolean;
  snapshotStatus?: string;
  completedGames: number;
  totalGames: number;
  currentGame: number | null;
  currentAgents: string[];
  decisions: number;
  decisionsPerMinute: number;
  retries: number;
  status429: number;
  status503: number;
  timeouts: number;
  fallbacks: number;
  errors: number;
  escalations: number;
  p95LatencyMs: number | null;
  latestLatencyMs: number | null;
  lastEventType: string | null;
  lastEventId: number | null;
  logs: { stdout: string; stderr: string };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function countStatus(value: unknown, target: number, seen = new Set<object>()): number {
  if (!value || typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countStatus(item, target, seen), 0);
  let count = 0;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "statuses" && Array.isArray(child)) count += child.filter((status) => status === target).length;
    else count += countStatus(child, target, seen);
  }
  return count;
}

export function redactLog(text: string): string {
  return text
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
    .replace(/((?:Authorization|X-Api-Key)\s*:\s*)(?!Bearer\s+\[REDACTED\]|\[REDACTED\])\S+/gi, "$1[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|token|secret|password)["']?\s*:\s*["']?)([^"',\s}]+)/gi, "$1[REDACTED]")
    .replace(/((?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
}

async function logTail(path: string): Promise<string> {
  let handle;
  try {
    handle = await open(path, "r");
    const details = await handle.stat();
    const bytes = Math.min(details.size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, Math.max(0, details.size - bytes));
    return redactLog(buffer.toString("utf8")).split(/\r?\n/).slice(-LOG_TAIL_LINES).join("\n").trim();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
    throw error;
  } finally {
    await handle?.close();
  }
}

export function summarizeRunHealth(
  run: RunRecord,
  snapshot: LiveHealthSnapshot | undefined,
  logs: { stdout: string; stderr: string },
  now = new Date(),
): RunHealth {
  const agents = Object.values(snapshot?.agents ?? {});
  const decisions = agents.reduce((sum, agent) => sum + finite(agent.decisions), 0);
  const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  const elapsedMinutes = Number.isFinite(startedAt) ? Math.max((now.getTime() - startedAt) / 60_000, 1 / 60) : 0;
  const lastDecisions = snapshot?.lastDecisions ?? [];
  const recentEvents = snapshot?.recentEvents ?? [];
  const latestEvent = record(recentEvents.at(-1));
  const p95Values = agents.map((agent) => finite(agent.latency?.p95Ms)).filter((value) => value > 0);
  const currentAgents = [...new Set(Object.values(snapshot?.decisionsBySeat ?? {})
    .filter((decision) => decision.pending && typeof decision.agentId === "string")
    .map((decision) => decision.agentId!))];
  const metadata = snapshot?.debug?.providerMetadataBySeat;
  return {
    available: snapshot !== undefined,
    ...(snapshot?.status ? { snapshotStatus: snapshot.status } : {}),
    completedGames: finite(snapshot?.tournament?.completedGames),
    totalGames: finite(snapshot?.tournament?.totalGames),
    currentGame: typeof snapshot?.currentGame?.gameIndex === "number" ? snapshot.currentGame.gameIndex + 1 : null,
    currentAgents,
    decisions,
    decisionsPerMinute: elapsedMinutes ? decisions / elapsedMinutes : 0,
    retries: agents.reduce((sum, agent) => sum + finite(agent.retryCount), 0),
    status429: countStatus(metadata, 429),
    status503: countStatus(metadata, 503),
    timeouts: lastDecisions.filter((decision) => decision.fallbackReason === "timeout" || /timeout/i.test(decision.error ?? "")).length,
    fallbacks: agents.reduce((sum, agent) => sum + finite(agent.fallbackCount), 0),
    errors: agents.reduce((sum, agent) => sum + finite(agent.errorCount), 0) + finite(snapshot?.tournament?.errorCount),
    escalations: agents.reduce((sum, agent) => sum + finite(agent.escalationCount), 0),
    p95LatencyMs: p95Values.length ? Math.max(...p95Values) : null,
    latestLatencyMs: typeof lastDecisions[0]?.latencyMs === "number" ? lastDecisions[0].latencyMs : null,
    lastEventType: typeof latestEvent?.type === "string" ? latestEvent.type : null,
    lastEventId: typeof snapshot?.lastEventId === "number" ? snapshot.lastEventId : null,
    logs,
  };
}

export async function runHealth(store: RunStore, run: RunRecord): Promise<RunHealth> {
  const [stdout, stderr, snapshot] = await Promise.all([
    logTail(store.logPath(run.id, "stdout")),
    logTail(store.logPath(run.id, "stderr")),
    run.liveUrl && run.status === "running"
      ? fetch(new URL("/api/snapshot?mode=debug", run.liveUrl), { signal: AbortSignal.timeout(2_000), cache: "no-store" })
        .then(async (response) => response.ok ? await response.json() as LiveHealthSnapshot : undefined)
        .catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  return summarizeRunHealth(run, snapshot, { stdout, stderr });
}
