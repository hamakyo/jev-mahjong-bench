import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { GameAction, GameObservation, MahjongState } from "../types.js";

interface WireResponse {
  ok: boolean;
  id?: number;
  error?: string;
  observations?: unknown[];
  events?: unknown[];
  done?: boolean;
  scores?: number[];
  ranks?: number[];
  gameId?: string;
}

export interface GameStartOptions {
  gameId: string;
  mode: string;
  rule: string;
  seed: number;
}

function parseAction(value: unknown): GameAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bridge returned an invalid game action");
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.type !== "string" || !item.mjai || typeof item.mjai !== "object" || Array.isArray(item.mjai)) {
    throw new Error("Bridge returned an invalid game action shape");
  }
  return { id: item.id, type: item.type as GameAction["type"], mjai: item.mjai as Record<string, unknown> };
}

function parseObservation(value: unknown): GameObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bridge returned an invalid observation");
  const item = value as Record<string, unknown>;
  if (!Number.isInteger(item.player) || typeof item.gameId !== "string" || !Number.isInteger(item.handIndex) || !Number.isInteger(item.turnIndex)) {
    throw new Error("Bridge returned an invalid observation identity");
  }
  const newEvents = item.newEvents;
  const events = item.events;
  if (!Array.isArray(newEvents) || !newEvents.every((event) => typeof event === "string")) {
    throw new Error("Bridge returned invalid newEvents");
  }
  if (!Array.isArray(events) || !events.every((event) => typeof event === "string")) {
    throw new Error("Bridge returned invalid events");
  }
  if (newEvents.length > events.length
      || events.slice(events.length - newEvents.length).some((event, index) => event !== newEvents[index])) {
    throw new Error("Bridge returned newEvents that are not the cumulative-history suffix");
  }
  if (!item.state || typeof item.state !== "object" || Array.isArray(item.state)) throw new Error("Bridge returned invalid state");
  if (!Array.isArray(item.legalActions)) throw new Error("Bridge returned invalid legalActions");
  return {
    player: item.player as number,
    newEvents: newEvents as string[],
    events: events as string[],
    state: item.state as MahjongState,
    legalActions: item.legalActions.map(parseAction),
    gameId: item.gameId,
    handIndex: item.handIndex as number,
    turnIndex: item.turnIndex as number,
  };
}

function parseResponse(raw: string): WireResponse {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("RiichiEnv bridge returned non-JSON output"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RiichiEnv bridge returned a non-object");
  const response = value as WireResponse;
  if (response.ok !== true) throw new Error(response.error ?? "RiichiEnv bridge request failed");
  return response;
}

export class RiichiEnvBridge {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly queue: string[] = [];
  private readonly waiters: Array<(line: string) => void> = [];
  private readonly errors: string[] = [];
  private nextId = 1;
  private closed = false;

  constructor(projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")) {
    this.child = spawn("uv", ["run", "--project", projectRoot, "python", "-m", "jev_mahjong_bench.bridge"], {
      cwd: projectRoot,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.queue.push(line);
    });
    this.child.stderr.on("data", (chunk: Buffer) => this.errors.push(chunk.toString("utf8")));
    this.child.once("exit", () => {
      this.closed = true;
      const detail = this.errors.join("").trim();
      while (this.waiters.length) this.waiters.shift()!(JSON.stringify({ ok: false, error: detail || "RiichiEnv bridge exited" }));
    });
  }

  private readLine(): Promise<string> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.closed) return Promise.reject(new Error(this.errors.join("").trim() || "RiichiEnv bridge exited"));
    return new Promise((resolveLine) => this.waiters.push(resolveLine));
  }

  private async request(payload: Record<string, unknown>): Promise<WireResponse> {
    if (this.closed) throw new Error("RiichiEnv bridge is closed");
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    const response = parseResponse(await this.readLine());
    if (response.id !== undefined && response.id !== id) throw new Error("RiichiEnv bridge response id mismatch");
    return response;
  }

  async startGame(options: GameStartOptions): Promise<{ observations: GameObservation[]; events: unknown[]; done: boolean }> {
    const response = await this.request({ op: "startGame", ...options });
    return {
      observations: (response.observations ?? []).map(parseObservation),
      events: response.events ?? [],
      done: response.done === true,
    };
  }

  async step(actions: Map<number, GameAction>): Promise<{ observations: GameObservation[]; events: unknown[]; done: boolean }> {
    const wireActions = Object.fromEntries([...actions.entries()].map(([player, action]) => [String(player), action.id]));
    const response = await this.request({ op: "step", actions: wireActions });
    return {
      observations: (response.observations ?? []).map(parseObservation),
      events: response.events ?? [],
      done: response.done === true,
    };
  }

  async finish(): Promise<{ scores: number[]; ranks: number[]; events: unknown[]; gameId: string }> {
    const response = await this.request({ op: "finish" });
    return {
      scores: response.scores ?? [],
      ranks: response.ranks ?? [],
      events: response.events ?? [],
      gameId: response.gameId ?? "",
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    this.child.kill();
  }
}
