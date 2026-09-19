import { createInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { GameAction, GameAgent, GameDecisionInput, GameObservation } from "../types.js";
import { canonicalJson, mjaiToMpsz } from "../mjai/tiles.js";
import { GptAgent } from "./gpt.js";
import { hybridGameDecision, validateHybridThreshold } from "./hybrid.js";
import { JevAgent } from "./jev.js";
import { eventNeedsResponse, responseActor, type MortalConfig, mortalReferencePolicy } from "./mortal.js";

export interface GameAgentWithMetadata extends GameAgent {
  lastMetadata: Record<string, unknown> | undefined;
  lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;
}

export interface GameAgentFactoryOptions {
  mortalConfig?: MortalConfig;
  hybridThreshold?: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("agent call aborted");
    error.name = "AbortError";
    throw error;
  }
}

function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class RandomGameAgent implements GameAgentWithMetadata {
  readonly id = "random";
  lastMetadata: Record<string, unknown> | undefined;
  lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  constructor(private readonly seed: number) {}

  async act(observation: GameObservation, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const index = hash32(`${this.seed}:${observation.gameId}:${observation.turnIndex}:${observation.player}`) % observation.legalActions.length;
    const action = observation.legalActions[index];
    if (!action) throw new Error("No legal game action available");
    this.lastMetadata = { seed: this.seed };
    return action.id;
  }
}

export function gameDecisionInput(observation: GameObservation): GameDecisionInput {
  return {
    id: `${observation.gameId}/${observation.turnIndex}/${observation.player}`,
    state: observation.state,
    legalActions: observation.legalActions,
  };
}

export class JevGameAgent implements GameAgentWithMetadata {
  readonly id = "jev";
  private readonly agent = new JevAgent();
  private generation = 0;
  lastMetadata: Record<string, unknown> | undefined;
  lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;

  async act(observation: GameObservation, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const generation = this.generation;
    const decision = await this.agent.decideGame(gameDecisionInput(observation), signal);
    throwIfAborted(signal);
    if (generation !== this.generation) {
      const error = new Error("agent call aborted");
      error.name = "AbortError";
      throw error;
    }
    this.lastMetadata = { provider: "typesafe", ...(decision.metadata ?? {}) };
    this.lastUsage = decision.usage;
    return decision.action;
  }

  cancel(): void { this.generation += 1; }

  async close(): Promise<void> { this.cancel(); }
}

export class GptGameAgent implements GameAgentWithMetadata {
  readonly id: string;
  private readonly agent = new GptAgent();
  private readonly controllers = new Set<AbortController>();
  lastMetadata: Record<string, unknown> | undefined;
  lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;

  constructor() { this.id = this.agent.id; }

  async act(observation: GameObservation, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    this.controllers.add(controller);
    try {
      const decision = await this.agent.decideGame(gameDecisionInput(observation), controller.signal);
      throwIfAborted(signal);
      throwIfAborted(controller.signal);
      this.lastMetadata = decision.metadata;
      this.lastUsage = decision.usage;
      return decision.action;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }

  cancel(): void {
    for (const controller of this.controllers) controller.abort();
  }

  async close(): Promise<void> { this.cancel(); }
}

export class HybridGameAgent implements GameAgentWithMetadata {
  readonly id: string;
  private readonly threshold: number;
  private readonly jev = new JevAgent();
  private readonly gpt = new GptAgent();
  private readonly controllers = new Set<AbortController>();
  private generation = 0;
  lastMetadata: Record<string, unknown> | undefined;
  lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;

  constructor(threshold = 0.75) {
    this.threshold = validateHybridThreshold(threshold);
    this.id = `hybrid@${this.threshold}`;
  }

  async act(observation: GameObservation, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const generation = this.generation;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    this.controllers.add(controller);
    try {
      const input = gameDecisionInput(observation);
      const decision = await hybridGameDecision(input, this.threshold, {
        jev: { decide: (value, providerSignal) => this.jev.decideGame(value, providerSignal) },
        gpt: { decide: (value, providerSignal) => this.gpt.decideGame(value, providerSignal) },
      }, controller.signal);
      throwIfAborted(signal);
      throwIfAborted(controller.signal);
      if (generation !== this.generation) {
        const error = new Error("agent call aborted");
        error.name = "AbortError";
        throw error;
      }
      this.lastMetadata = decision.metadata;
      this.lastUsage = decision.usage;
      return decision.action;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }

  cancel(): void {
    this.generation += 1;
    for (const controller of this.controllers) controller.abort();
  }

  async close(): Promise<void> { this.cancel(); }
}

interface MortalGameProcess {
  child: ChildProcessWithoutNullStreams;
  lines: ReturnType<typeof createInterface>;
  queued: string[];
  waiters: Array<(line: string | undefined) => void>;
  sentEvents: string[];
  exitDetail?: string;
  closed: boolean;
}

function canonicalEvent(value: string): string {
  const parsed = JSON.parse(value) as unknown;
  return canonicalJson(parsed);
}

function discardTile(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.pai !== "string") return undefined;
  try { return mjaiToMpsz(item.pai); } catch { return undefined; }
}

function sameAction(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "dahai") return discardTile(left) === discardTile(right);
  const strip = (value: Record<string, unknown>) => {
    const copy = { ...value };
    delete copy.actor;
    return copy;
  };
  return canonicalJson(strip(left)) === canonicalJson(strip(right));
}

class MortalGameSession {
  private readonly config: MortalConfig;
  private readonly processes = new Map<number, MortalGameProcess>();
  private readonly cancelledSeats = new Set<number>();

  constructor(config: MortalConfig) { this.config = config; }

  private start(seat: number): MortalGameProcess {
    const command = this.config.command.map((part) => part.replaceAll("{seat}", String(seat)));
    const executable = command[0];
    if (!executable) throw new Error("Mortal command is empty");
    const child = spawn(executable, command.slice(1), { shell: false, stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    const process: MortalGameProcess = { child, lines, queued: [], waiters: [], sentEvents: [], closed: false };
    lines.on("line", (line) => {
      const waiter = process.waiters.shift();
      if (waiter) waiter(line);
      else process.queued.push(line);
    });
    child.once("error", () => { process.exitDetail = "process error"; });
    child.once("exit", (code, signal) => {
      process.closed = true;
      if (code !== 0 || signal) process.exitDetail = `exited code=${code ?? "?"} signal=${signal ?? "?"}`;
      while (process.waiters.length) process.waiters.shift()!(undefined);
    });
    this.processes.set(seat, process);
    return process;
  }

  private restart(seat: number): MortalGameProcess {
    const old = this.processes.get(seat);
    if (old) {
      old.lines.close();
      old.closed = true;
      old.child.kill();
    }
    return this.start(seat);
  }

  private read(process: MortalGameProcess, timeout: number): Promise<string> {
    if (process.queued.length) return Promise.resolve(process.queued.shift()!);
    if (process.closed) {
      return Promise.reject(new Error(`Mortal process exited before responding${process.exitDetail ? `: ${process.exitDetail}` : ""}`));
    }
    return new Promise((resolve, reject) => {
      const waiter = (line: string | undefined) => {
        clearTimeout(timer);
        if (line === undefined) {
          reject(new Error(`Mortal process exited before responding${process.exitDetail ? `: ${process.exitDetail}` : ""}`));
          return;
        }
        resolve(line);
      };
      const timer = setTimeout(() => {
        const index = process.waiters.indexOf(waiter);
        if (index >= 0) process.waiters.splice(index, 1);
        reject(new Error(`Mortal process timed out after ${timeout}ms`));
      }, timeout);
      process.waiters.push(waiter);
    });
  }

  async act(observation: GameObservation, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const onAbort = () => this.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    this.cancelledSeats.delete(observation.player);
    try {
      return await this.actInternal(observation, signal);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private async actInternal(observation: GameObservation, signal?: AbortSignal): Promise<string> {
    if (!observation.events.length) throw new Error("Mortal game observation has no MJAI history");
    const fullEvents = observation.events.map(canonicalEvent);
    let process = this.processes.get(observation.player);
    const prefix = process
      && process.sentEvents.length <= fullEvents.length
      && process.sentEvents.every((event, index) => fullEvents[index] === event);
    const replaying = !process || !prefix;
    if (replaying) process = process ? this.restart(observation.player) : this.start(observation.player);
    if (!process) throw new Error("Mortal game process could not be started");
    const delta = replaying ? fullEvents : fullEvents.slice(process.sentEvents.length);
    if (!delta.length) throw new Error("Mortal game observation history did not advance");
    try {
      for (const event of delta) process.child.stdin.write(`${event}\n`);
      process.sentEvents = fullEvents;
    } catch (error) {
      if (this.cancelledSeats.delete(observation.player)) throw error;
      this.restart(observation.player);
      throw error;
    }
    throwIfAborted(signal);
    const timeout = this.config.timeoutMs ?? 5_000;
    const expectedResponses = delta.filter((event) => eventNeedsResponse(event, observation.player)).length;
    if (expectedResponses < 1) {
      this.restart(observation.player);
      throw new Error("Mortal game observation has no response-triggering MJAI event");
    }
    let responses = 0;
    let lastPayload: Record<string, unknown> | undefined;
    let lastLegal: Record<string, unknown> | undefined;
    const deadline = Date.now() + timeout;
    try {
      while (responses < expectedResponses) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`Mortal process timed out after ${timeout}ms`);
        const line = (await this.read(process, remaining)).trim();
        if (!line) throw new Error("Mortal game process returned an empty response");
        let response: unknown;
        try { response = JSON.parse(line) as unknown; } catch { throw new Error("Mortal game process returned non-JSON output"); }
        const payload = response && typeof response === "object" && !Array.isArray(response)
          ? ((response as Record<string, unknown>).action ?? response) : response;
        const actor = responseActor(response, payload);
        if (typeof actor === "number" && actor !== observation.player) continue;
        responses += 1;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("Mortal game response is not MJAI");
        }
        lastPayload = payload as Record<string, unknown>;
        if (observation.legalActions.some((action) => sameAction(action.mjai, lastPayload!))) {
          lastLegal = lastPayload;
        }
      }
      if (lastLegal) {
        const match = observation.legalActions.find((action) => sameAction(action.mjai, lastLegal!));
        if (match) return match.id;
      }
      // A wrapper can flush a stale pass/call line after the response count
      // for the preceding event.  Keep draining until the next legal action;
      // this is also what lets a complete-game process replay a prefix whose
      // old actions are not legal in the current observation.
      while (Date.now() < deadline) {
        const line = (await this.read(process, deadline - Date.now())).trim();
        if (!line) throw new Error("Mortal game process returned an empty response");
        let response: unknown;
        try { response = JSON.parse(line) as unknown; } catch { throw new Error("Mortal game process returned non-JSON output"); }
        const payload = response && typeof response === "object" && !Array.isArray(response)
          ? ((response as Record<string, unknown>).action ?? response) : response;
        const actor = responseActor(response, payload);
        if (typeof actor === "number" && actor !== observation.player) continue;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("Mortal game response is not MJAI");
        }
        const match = observation.legalActions.find((action) => sameAction(action.mjai, payload as Record<string, unknown>));
        if (match) return match.id;
      }
      if (!lastPayload) throw new Error("Mortal game process returned no action");
      throw new Error("Mortal game response is not a legal action");
    } catch (error) {
      if (this.cancelledSeats.delete(observation.player)) throw error;
      this.restart(observation.player);
      throw error;
    }
  }

  cancel(): void {
    for (const [seat, process] of this.processes.entries()) {
      this.cancelledSeats.add(seat);
      process.closed = true;
      process.lines.close();
      process.child.kill();
      this.processes.delete(seat);
    }
  }

  close(): void {
    for (const [seat, process] of this.processes.entries()) {
      this.cancelledSeats.add(seat);
      process.closed = true;
      process.lines.close();
      process.child.kill();
    }
    this.processes.clear();
  }
}

export class MortalGameAgent implements GameAgentWithMetadata {
  readonly id = "mortal";
  private readonly session: MortalGameSession;
  private readonly policy: Promise<Record<string, unknown>>;
  lastMetadata: Record<string, unknown> | undefined;
  lastUsage: { inputTokens?: number; outputTokens?: number } | undefined;

  constructor(config: MortalConfig) {
    this.session = new MortalGameSession(config);
    this.policy = mortalReferencePolicy(config).then((value) => value as unknown as Record<string, unknown>);
  }

  async act(observation: GameObservation, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const action = await this.session.act(observation, signal);
    throwIfAborted(signal);
    this.lastMetadata = await this.policy;
    return action;
  }

  cancel(): void { this.session.cancel(); }

  async close(): Promise<void> { this.session.close(); }
}

export function createGameAgent(name: string, seed: number, options: GameAgentFactoryOptions = {}): GameAgentWithMetadata {
  const normalized = name.trim();
  if (normalized === "random") return new RandomGameAgent(seed);
  if (normalized === "jev") return new JevGameAgent();
  if (normalized === "gpt") return new GptGameAgent();
  if (normalized === "hybrid") return new HybridGameAgent(options.hybridThreshold ?? 0.75);
  if (normalized === "mortal") {
    if (!options.mortalConfig) throw new Error("Mortal game agent requires --mortal-config");
    return new MortalGameAgent(options.mortalConfig);
  }
  throw new Error(`Unknown game agent "${name}". Expected: jev, gpt, hybrid, mortal, random`);
}
