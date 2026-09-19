import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { AgentDecision, DecisionSample, MjaiEvent, ReferencePolicy } from "../types.js";
import { canonicalJson, normalizeMortalAction } from "../mjai/tiles.js";
import type { MahjongAgent } from "./agent.js";

export interface MortalConfig {
  command: string[];
  version: string;
  modelPath?: string;
  config?: Record<string, unknown>;
  timeoutMs?: number;
  name?: string;
}

interface MortalProcess {
  child: ChildProcessWithoutNullStreams;
  lines: Interface;
  exitDetail?: string;
  sentEvents: string[];
  queued: string[];
  waiters: Array<(line: string | undefined) => void>;
  closed: boolean;
}

function assertConfig(value: unknown): MortalConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mortal config must be an object");
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.command) || item.command.length === 0 || item.command.some((x) => typeof x !== "string" || !x)) {
    throw new Error("Mortal config command must be a non-empty argument array");
  }
  if (item.command.some((x) => x.includes("\0"))) throw new Error("Mortal command contains a NUL byte");
  if (typeof item.version !== "string" || !item.version) throw new Error("Mortal config version is required");
  if (item.modelPath !== undefined && typeof item.modelPath !== "string") throw new Error("Mortal modelPath must be a string");
  if (item.config !== undefined && (!item.config || typeof item.config !== "object" || Array.isArray(item.config))) {
    throw new Error("Mortal config.config must be an object");
  }
  if (item.timeoutMs !== undefined && (!Number.isFinite(item.timeoutMs) || Number(item.timeoutMs) <= 0)) {
    throw new Error("Mortal timeoutMs must be positive");
  }
  return {
    command: item.command as string[],
    version: item.version,
    ...(typeof item.modelPath === "string" ? { modelPath: item.modelPath } : {}),
    ...(item.config && typeof item.config === "object" && !Array.isArray(item.config)
      ? { config: item.config as Record<string, unknown> } : {}),
    ...(typeof item.timeoutMs === "number" ? { timeoutMs: item.timeoutMs } : {}),
    ...(typeof item.name === "string" && item.name ? { name: item.name } : {}),
  };
}

function redact(value: unknown, key = ""): unknown {
  if (/(secret|token|password|api[_-]?key|access[_-]?key|credential|private|model[_-]?path|auth)/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, redact(item, k)]));
  }
  return value;
}

export async function modelSha256(modelPath?: string): Promise<string | undefined> {
  if (!modelPath) return undefined;
  await access(modelPath, constants.R_OK);
  const hash = createHash("sha256");
  const stream = createReadStream(modelPath);
  for await (const chunk of stream) hash.update(chunk as Uint8Array);
  return hash.digest("hex");
}

export async function loadMortalConfig(path: string): Promise<MortalConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read Mortal config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return assertConfig(raw);
}

export async function mortalReferencePolicy(config: MortalConfig): Promise<ReferencePolicy> {
  const hash = await modelSha256(config.modelPath);
  return {
    name: config.name ?? "mortal",
    version: config.version,
    ...(hash ? { modelSha256: hash } : {}),
    ...(config.config ? { config: redact(config.config) as Record<string, unknown> } : {}),
  };
}

function commandForSeat(config: MortalConfig, seat: number): string[] {
  return config.command.map((part) => part.replaceAll("{seat}", String(seat)));
}

function responsePayload(response: unknown): unknown {
  return response && typeof response === "object" && !Array.isArray(response)
    ? ((response as Record<string, unknown>).action ?? response) : response;
}

export function responseActor(response: unknown, payload: unknown): number | undefined {
  const outer = response && typeof response === "object" && !Array.isArray(response)
    ? (response as Record<string, unknown>).actor : undefined;
  const inner = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).actor : undefined;
  return typeof inner === "number" ? inner : typeof outer === "number" ? outer : undefined;
}

export function eventNeedsResponse(event: string, seat: number): boolean {
  let value: unknown;
  try { value = JSON.parse(event) as unknown; } catch { return false; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const actor = item.actor;
  if (typeof actor !== "number") return false;
  if (item.type === "tsumo") return actor === seat;
  if (item.type === "dahai") return actor !== seat;
  return actor === seat && ["chi", "pon", "daiminkan", "ankan", "kakan", "reach", "riichi"].includes(String(item.type));
}

export function eventNeedsDiscardResponse(event: string, seat: number): boolean {
  let value: unknown;
  try { value = JSON.parse(event) as unknown; } catch { return false; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  // RiichiEnv emits the reach declaration and then a separate observation
  // requiring the declaring player to choose the discard.  Calls have the
  // same shape: chi/pon is followed immediately by that player's discard.
  // Kan declarations are followed by a replacement draw, so they are counted
  // by the subsequent self-tsumo event instead.
  return item.actor === seat && ["tsumo", "chi", "pon", "reach", "riichi"].includes(String(item.type));
}

type PendingDiscardResponse = "tsumo" | "reach" | "call";

/**
 * Count discard responses emitted while replaying an MJAI delta.
 *
 * A self-tsumo opens a discard decision, but a following reach replaces that
 * decision with the post-reach discard.  A kan consumes the tsumo decision and
 * the replacement tsumo opens a new one.  Keeping the pending state until the
 * corresponding dahai also counts old responses when a process is restarted
 * and the whole prefix is replayed.
 */
export function countDiscardResponses(events: string[], seat: number): number {
  let pending: PendingDiscardResponse | undefined;
  let count = 0;
  for (const event of events) {
    let value: unknown;
    try { value = JSON.parse(event) as unknown; } catch { continue; }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const actor = item.actor;
    const type = item.type;
    if (actor !== seat || typeof type !== "string") continue;
    if (type === "tsumo") {
      pending = "tsumo";
    } else if (type === "reach" || type === "riichi") {
      // The declaration replaces the discard that would otherwise follow the
      // tsumo immediately before it.
      pending = "reach";
    } else if (type === "chi" || type === "pon") {
      pending = "call";
    } else if (type === "daiminkan" || type === "ankan" || type === "kakan") {
      // A kan is followed by rinshan tsumo, not an immediate discard.
      pending = undefined;
    } else if (type === "dahai") {
      if (pending) count += 1;
      pending = undefined;
    } else if (type === "hora" || type === "ron" || type === "tsumo_agari" || type === "ryukyoku") {
      pending = undefined;
    }
  }
  if (pending) count += 1;
  return count;
}

function killProcess(process: MortalProcess): void {
  process.closed = true;
  process.lines.close();
  if (!process.child.killed) process.child.kill();
}

export class MortalAgent implements MahjongAgent {
  readonly id = "mortal";
  private readonly config: MortalConfig;
  private readonly processes = new Map<string, MortalProcess>();
  private readonly policyPromise: Promise<ReferencePolicy>;

  constructor(config: MortalConfig) {
    this.config = assertConfig(config);
    this.policyPromise = mortalReferencePolicy(this.config);
  }

  async policy(): Promise<ReferencePolicy> {
    return this.policyPromise;
  }

  private start(key: string, seat: number): MortalProcess {
    const command = commandForSeat(this.config, seat);
    const executable = command[0];
    if (!executable) throw new Error("Mortal command is empty");
    // spawn's default shell=false is intentional: command is an argv array.
    const child = spawn(executable, command.slice(1), { shell: false, stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    const process: MortalProcess = { child, lines, sentEvents: [], queued: [], waiters: [], closed: false };
    lines.on("line", (line) => {
      const waiter = process.waiters.shift();
      if (waiter) waiter(line);
      else process.queued.push(line);
    });
    // Do not copy subprocess stderr into reports: it may contain credentials
    // or model paths emitted by an external Mortal wrapper.
    child.once("error", () => { process.exitDetail = "process error"; });
    child.once("exit", (code, signal) => {
      process.closed = true;
      if (code !== 0 || signal) process.exitDetail = `exited code=${code ?? "?"} signal=${signal ?? "?"}`;
      while (process.waiters.length) process.waiters.shift()!(undefined);
    });
    this.processes.set(key, process);
    return process;
  }

  private restart(key: string, seat: number): MortalProcess {
    const old = this.processes.get(key);
    if (old) killProcess(old);
    return this.start(key, seat);
  }

  private readLine(process: MortalProcess, timeout: number): Promise<string> {
    if (process.queued.length) return Promise.resolve(process.queued.shift()!);
    if (process.closed) {
      const detail = process.exitDetail;
      return Promise.reject(new Error(`Mortal process exited before responding${detail ? `: ${detail}` : ""}`));
    }
    return new Promise((resolve, reject) => {
      const waiter = (line: string | undefined) => {
        clearTimeout(timer);
        if (line === undefined) {
          const detail = process.exitDetail;
          reject(new Error(`Mortal process exited before responding${detail ? `: ${detail}` : ""}`));
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

  private async readResponse(process: MortalProcess, seat: number, legalActions: string[], expectedDiscards: number): Promise<string> {
    const timeout = this.config.timeoutMs ?? 5_000;
    const deadline = Date.now() + timeout;
    let discards = 0;
    let lastDiscard: string | undefined;
    if (expectedDiscards < 1) throw new Error("Mortal observation has no discard-triggering event");
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Mortal process timed out after ${timeout}ms`);
      const line = (await this.readLine(process, remaining)).trim();
      if (!line) throw new Error("Mortal process returned an empty response");
      let response: unknown;
      try {
        response = JSON.parse(line) as unknown;
      } catch {
        throw new Error("Mortal process returned non-JSON output");
      }
      const payload = responsePayload(response);
      const actor = responseActor(response, payload);
      // A Mortal wrapper may emit pass/call lines while replaying the events
      // leading to this discard decision.  Drain all non-discard responses and
      // use the final self-seat discard response.  This also handles a prefix
      // replay, where earlier discards are necessarily stale for this sample.
      if (typeof actor === "number" && actor !== seat) continue;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Mortal response is not an MJAI object");
      }
      const type = (payload as Record<string, unknown>).type;
      if (typeof type !== "string") throw new Error("Mortal response is not an MJAI object");
      if (type === "dahai") {
        const action = normalizeMortalAction(payload);
        lastDiscard = action;
        discards += 1;
      }
      if (discards >= expectedDiscards) {
        if (!lastDiscard || !legalActions.includes(lastDiscard)) {
          throw new Error(`Mortal returned non-legal discard ${lastDiscard ?? "<none>"}`);
        }
        return lastDiscard;
      }
    }
  }

  async decide(sample: DecisionSample): Promise<AgentDecision> {
    const events = sample.state.mjaiEvents;
    if (!events?.length) throw new Error("Mortal observation history is missing");
    const seat = sample.provenance?.seat;
    if (seat === undefined || !Number.isInteger(seat)) throw new Error("Mortal sample provenance seat is missing");
    const key = `${sample.provenance?.gameIdHash ?? "dataset"}:${seat}`;
    const eventStrings = events.map((event: MjaiEvent) => {
      try {
        return typeof event === "string" ? canonicalJson(JSON.parse(event)) : canonicalJson(event);
      } catch {
        throw new Error("Mortal observation history contains a non-JSON MJAI event");
      }
    });
    let process = this.processes.get(key);
    const prefix = process
      && process.sentEvents.length <= eventStrings.length
      && process.sentEvents.every((event, index) => eventStrings[index] === event);
    if (!process || !prefix) {
      process = process ? this.restart(key, seat) : this.start(key, seat);
    }
    try {
      const offset = process.sentEvents.length;
      const delta = eventStrings.slice(offset);
      if (!delta.length) throw new Error("Mortal observation history did not advance");
      for (const event of delta) {
        const parsed = JSON.parse(event) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as Record<string, unknown>).type !== "string") {
          throw new Error("Mortal observation history contains a non-MJAI event");
        }
        process.child.stdin.write(`${event}\n`);
      }
      process.sentEvents = [...eventStrings];
      const expectedDiscards = countDiscardResponses(delta, seat);
      const action = await this.readResponse(process, seat, sample.legalActions, expectedDiscards);
      const policy = await this.policy();
      return { action, metadata: policy as unknown as Record<string, unknown> };
    } catch (error) {
      this.restart(key, seat);
      throw error;
    }
  }

  async close(): Promise<void> {
    for (const process of this.processes.values()) killProcess(process);
    this.processes.clear();
  }
}

export { assertConfig as validateMortalConfig };
