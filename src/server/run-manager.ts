import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { RunStore, type RunRecord, type RunType } from "./run-store.js";
import { DEFAULT_HYBRID_THRESHOLDS } from "../benchmark/hybrid-sweep.js";

export interface CreateRunInput {
  type: RunType;
  config: Record<string, unknown>;
}

interface ActiveRun {
  child: ChildProcess;
  cancelled: boolean;
}

function stringValue(value: unknown, name: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function integerValue(value: unknown, name: string, fallback: number, minimum = 0): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return result;
}

function numberValue(value: unknown, name: string, fallback: number, minimum: number, maximum: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "number" || !Number.isFinite(result) || result < minimum || result > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return result;
}

function optionalPath(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return stringValue(value, name);
}

function normalizeTournament(input: Record<string, unknown>): Record<string, unknown> {
  const seats = Array.isArray(input.seats)
    ? input.seats.map((value) => stringValue(value, "seats[]"))
    : stringValue(input.seats, "seats").split(",").map((value) => value.trim()).filter(Boolean);
  if (seats.length !== 4) throw new Error("tournament seats must contain exactly four agents");
  const seatPolicy = stringValue(input.seatPolicy, "seatPolicy", "rotate");
  if (seatPolicy !== "rotate" && seatPolicy !== "fixed") throw new Error("seatPolicy must be rotate or fixed");
  const config: Record<string, unknown> = {
    seats,
    games: integerValue(input.games, "games", 1, 1),
    mode: stringValue(input.mode, "mode", "4p-red-half"),
    rule: stringValue(input.rule, "rule", "tenhou"),
    seed: integerValue(input.seed, "seed", 42, 0),
    seatPolicy,
    timeoutMs: integerValue(input.timeoutMs, "timeoutMs", 60_000, 1),
  };
  if (input.pairedRuns !== undefined) {
    config.pairedRuns = integerValue(input.pairedRuns, "pairedRuns", 1, 1);
    delete config.games;
  }
  if (input.hybridThreshold !== undefined) config.hybridThreshold = numberValue(input.hybridThreshold, "hybridThreshold", 0.3, 0, 1);
  for (const name of ["models", "pricing", "mortalConfig", "hybridFallback"] as const) {
    const value = optionalPath(input[name], name);
    if (value) config[name] = value;
  }
  return config;
}

function normalizeBenchmark(input: Record<string, unknown>): Record<string, unknown> {
  const agents = Array.isArray(input.agents)
    ? input.agents.map((value) => stringValue(value, "agents[]"))
    : stringValue(input.agents, "agents", "random").split(",").map((value) => value.trim()).filter(Boolean);
  if (!agents.length) throw new Error("benchmark agents cannot be empty");
  const config: Record<string, unknown> = {
    agents,
    dataset: stringValue(input.dataset, "dataset", "datasets/sample.jsonl"),
    concurrency: integerValue(input.concurrency, "concurrency", 1, 1),
    seed: integerValue(input.seed, "seed", 42, 0),
  };
  if (input.hybridThreshold !== undefined) config.hybridThreshold = numberValue(input.hybridThreshold, "hybridThreshold", 0.3, 0, 1);
  for (const name of ["models", "pricing", "mortalConfig", "hybridFallback"] as const) {
    const value = optionalPath(input[name], name);
    if (value) config[name] = value;
  }
  return config;
}

function normalizeSweep(input: Record<string, unknown>): Record<string, unknown> {
  const thresholds = Array.isArray(input.thresholds)
    ? input.thresholds.map((value) => numberValue(value, "thresholds[]", 0, 0, 1))
    : stringValue(input.thresholds, "thresholds", DEFAULT_HYBRID_THRESHOLDS.join(","))
      .split(",").map((value) => numberValue(Number(value.trim()), "thresholds[]", 0, 0, 1));
  if (!thresholds.length) throw new Error("thresholds cannot be empty");
  const config: Record<string, unknown> = {
    dataset: stringValue(input.dataset, "dataset", "datasets/sample.jsonl"),
    thresholds,
  };
  const cacheIn = optionalPath(input.cacheIn, "cacheIn");
  if (cacheIn) config.cacheIn = cacheIn;
  return config;
}

export function normalizeRunInput(input: CreateRunInput): CreateRunInput {
  if (!input || typeof input !== "object") throw new Error("run input must be an object");
  if (input.type === "tournament") return { type: input.type, config: normalizeTournament(input.config ?? {}) };
  if (input.type === "benchmark") return { type: input.type, config: normalizeBenchmark(input.config ?? {}) };
  if (input.type === "hybrid-sweep") return { type: input.type, config: normalizeSweep(input.config ?? {}) };
  throw new Error("type must be tournament, benchmark, or hybrid-sweep");
}

function flags(config: Record<string, unknown>, names: Record<string, string>): string[] {
  const result: string[] = [];
  for (const [key, flag] of Object.entries(names)) {
    const value = config[key];
    if (value === undefined) continue;
    result.push(`--${flag}`, Array.isArray(value) ? value.join(",") : String(value));
  }
  return result;
}

async function freePort(): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate a local port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

export class RunManager {
  readonly store: RunStore;
  private readonly projectRoot: string;
  private readonly active = new Map<string, ActiveRun>();
  private readonly replays = new Map<string, ChildProcess>();

  constructor(store: RunStore, projectRoot = process.cwd()) {
    this.store = store;
    this.projectRoot = resolve(projectRoot);
  }

  async init(): Promise<void> {
    await this.store.init();
    await this.store.recoverInterrupted();
  }

  async start(input: CreateRunInput): Promise<RunRecord> {
    const normalized = normalizeRunInput(input);
    const run = await this.store.create(normalized.type, normalized.config);
    void this.execute(run).catch(async (error: unknown) => {
      await this.store.update(run.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    });
    return run;
  }

  async cancel(id: string): Promise<RunRecord> {
    const run = await this.store.get(id);
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return run;
    const active = this.active.get(id);
    if (!active) return this.store.update(id, { status: "cancelled", finishedAt: new Date().toISOString() });
    active.cancelled = true;
    active.child.kill("SIGTERM");
    return this.store.get(id);
  }

  async startReplay(id: string): Promise<string> {
    const run = await this.store.get(id);
    if (run.type !== "tournament") throw new Error("replay is only available for tournament runs");
    await access(join(run.artifactDir, "replay", "manifest.json"));
    const current = this.replays.get(id);
    if (current && current.exitCode === null && run.replayUrl) return run.replayUrl;
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const child = spawn("pnpm", ["replay:serve", "--", "--input", run.artifactDir, "--host", "127.0.0.1", "--port", String(port)], {
      cwd: this.projectRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.replays.set(id, child);
    const stdout = createWriteStream(this.store.logPath(id, "stdout"), { flags: "a" });
    const stderr = createWriteStream(this.store.logPath(id, "stderr"), { flags: "a" });
    child.stdout?.pipe(stdout, { end: false });
    child.stderr?.pipe(stderr, { end: false });
    child.once("exit", () => {
      stdout.end();
      stderr.end();
      this.replays.delete(id);
      void this.store.update(id, { replayUrl: undefined }).catch(() => undefined);
    });
    child.once("error", () => {
      stdout.end();
      stderr.end();
      this.replays.delete(id);
    });
    await this.store.update(id, { replayUrl: url });
    return url;
  }

  async close(): Promise<void> {
    for (const value of this.active.values()) value.cancelled = true;
    const children = [...this.active.values()].map((value) => value.child).concat([...this.replays.values()]);
    for (const child of children) child.kill("SIGTERM");
    await Promise.all(children.map((child) => new Promise<void>((resolvePromise) => {
      if (child.exitCode !== null) return resolvePromise();
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolvePromise(); }, 2_000);
      child.once("exit", () => { clearTimeout(timer); resolvePromise(); });
    })));
  }

  private async execute(run: RunRecord): Promise<void> {
    const { script, args, liveUrl } = await this.command(run);
    const child = spawn("pnpm", [script, "--", ...args], {
      cwd: this.projectRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const active: ActiveRun = { child, cancelled: false };
    this.active.set(run.id, active);
    const stdout = createWriteStream(this.store.logPath(run.id, "stdout"), { flags: "a" });
    const stderr = createWriteStream(this.store.logPath(run.id, "stderr"), { flags: "a" });
    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);
    const outcomePromise = new Promise<{ code: number | null; error?: Error }>((resolvePromise) => {
      let settled = false;
      const finish = (value: { code: number | null; error?: Error }) => {
        if (settled) return;
        settled = true;
        resolvePromise(value);
      };
      child.once("error", (error) => finish({ code: null, error }));
      child.once("exit", (code) => finish({ code }));
    });
    await this.store.update(run.id, {
      status: "running",
      startedAt: new Date().toISOString(),
      ...(child.pid ? { pid: child.pid } : {}),
      ...(liveUrl ? { liveUrl } : {}),
    });
    const outcome = await outcomePromise;
    this.active.delete(run.id);
    const finishedAt = new Date().toISOString();
    if (active.cancelled) {
      await this.store.update(run.id, { status: "cancelled", finishedAt, pid: undefined, liveUrl: undefined, exitCode: outcome.code ?? undefined });
    } else if (!outcome.error && outcome.code === 0) {
      await this.store.update(run.id, { status: "completed", finishedAt, pid: undefined, liveUrl: undefined, exitCode: 0 });
    } else {
      await this.store.update(run.id, {
        status: "failed",
        finishedAt,
        pid: undefined,
        liveUrl: undefined,
        exitCode: outcome.code ?? undefined,
        error: outcome.error?.message ?? `run process exited with code ${outcome.code ?? "unknown"}`,
      });
    }
  }

  private async command(run: RunRecord): Promise<{ script: string; args: string[]; liveUrl?: string }> {
    const out = run.artifactDir;
    if (run.type === "tournament") {
      const port = await freePort();
      return {
        script: "tournament:watch",
        liveUrl: `http://127.0.0.1:${port}/`,
        args: [
          ...flags(run.config, {
            seats: "seats", games: "games", pairedRuns: "paired-runs", mode: "mode", rule: "rule", seed: "seed",
            seatPolicy: "seat-policy", timeoutMs: "timeout-ms", hybridThreshold: "hybrid-threshold",
            hybridFallback: "hybrid-fallback", models: "models", pricing: "pricing", mortalConfig: "mortal-config",
          }),
          "--out", out, "--host", "127.0.0.1", "--port", String(port), "--exit-on-complete", "true",
        ],
      };
    }
    if (run.type === "benchmark") {
      return {
        script: "bench",
        args: [
          ...flags(run.config, {
            agents: "agents", dataset: "dataset", concurrency: "concurrency", seed: "seed",
            hybridThreshold: "hybrid-threshold", hybridFallback: "hybrid-fallback", models: "models",
            pricing: "pricing", mortalConfig: "mortal-config",
          }),
          "--out", out,
        ],
      };
    }
    return {
      script: "hybrid:sweep",
      args: [
        ...flags(run.config, { dataset: "dataset", thresholds: "thresholds", cacheIn: "cache-in" }),
        "--out", out,
      ],
    };
  }
}
