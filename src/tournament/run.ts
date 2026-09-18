import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";
import type { GameAction, GameDecisionRecord, GameObservation } from "../types.js";
import { canonicalJson } from "../mjai/tiles.js";
import { createGameAgent, type GameAgentWithMetadata } from "../agents/game.js";
import type { MortalConfig } from "../agents/mortal.js";
import { RiichiEnvBridge } from "../game/bridge.js";

export interface TournamentOptions {
  seats: string[];
  games: number;
  mode: string;
  rule: string;
  seed: number;
  seatPolicy: "rotate" | "fixed";
  out: string;
  timeoutMs: number;
  mortalConfig?: MortalConfig;
}

interface GameResult {
  gameId: string;
  seed: number;
  seats: string[];
  scores: number[];
  ranks: number[];
  errorCount: number;
}

function gameId(options: TournamentOptions, index: number, seatAgents: string[], seed: number): string {
  const source = canonicalJson({ mode: options.mode, rule: options.rule, seed, index, seats: seatAgents });
  return createHash("sha256").update(source).digest("hex");
}

export type AgentCallTails = WeakMap<GameAgentWithMetadata, Promise<void>>;
export interface AgentCallResult {
  action: string;
  metadata: Record<string, unknown> | undefined;
  usage: { inputTokens?: number; outputTokens?: number } | undefined;
}

export interface AgentCall<T> {
  promise: Promise<T>;
  cancel: () => void;
}

function abortedError(): Error {
  const error = new Error("agent call aborted");
  error.name = "AbortError";
  return error;
}

export function serializedAgentAct(
  agent: GameAgentWithMetadata,
  observation: GameObservation,
  tails: AgentCallTails,
): AgentCall<AgentCallResult> {
  let cancelled = false;
  let controller: AbortController | undefined;
  const previous = tails.get(agent) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => {
    // A call can time out while waiting behind an earlier call.  Check the
    // cancellation flag at the gate so that such a call never reaches the
    // provider or subprocess.
    if (cancelled) throw abortedError();
    controller = new AbortController();
    // Clear metadata immediately before the call that owns it.  A timed-out
    // call may finish later, but the next call cannot start until this one has
    // settled, so late completions can never overlap or overwrite a following
    // turn's metadata.
    agent.lastMetadata = undefined;
    agent.lastUsage = undefined;
    return agent.act(observation, controller.signal).then((action) => {
      if (cancelled || controller?.signal.aborted) throw abortedError();
      return {
        action,
        metadata: agent.lastMetadata,
        usage: agent.lastUsage,
      };
    });
  });
  tails.set(agent, current.then(() => undefined, () => undefined));
  return {
    promise: current,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      controller?.abort();
      agent.cancel?.();
    },
  };
}

export function timeout<T>(call: AgentCall<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      call.cancel();
      reject(new Error(`agent exceeded ${timeoutMs}ms timeout`));
    }, timeoutMs);
    call.promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function fallbackAction(observation: GameObservation): GameAction {
  const pass = observation.legalActions.find((action) => action.type === "none");
  if (pass) return pass;
  const sorted = [...observation.legalActions].sort((left, right) => {
    const a = canonicalJson(left.mjai), b = canonicalJson(right.mjai);
    return (a < b ? -1 : a > b ? 1 : 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
  const first = sorted[0];
  if (!first) throw new Error(`player ${observation.player} has no legal action`);
  return first;
}

async function decide(
  observation: GameObservation,
  agent: GameAgentWithMetadata,
  timeoutMs: number,
  tails: AgentCallTails,
): Promise<{ action: GameAction; record: GameDecisionRecord }> {
  const started = performance.now();
  let requestedActionId: string | undefined;
  let callMetadata: Record<string, unknown> | undefined;
  let callUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  let error: string | undefined;
  let fallbackReason: string | undefined;
  try {
    const result = await timeout(serializedAgentAct(agent, observation, tails), timeoutMs);
    requestedActionId = result.action;
    callMetadata = result.metadata;
    callUsage = result.usage;
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
    fallbackReason = error.includes("timeout") ? "timeout" : "agent-error";
  }
  const requested = requestedActionId ? observation.legalActions.find((action) => action.id === requestedActionId) : undefined;
  if (!requested && !fallbackReason) fallbackReason = "illegal-action";
  const applied = requested ?? fallbackAction(observation);
  const record: GameDecisionRecord = {
    gameId: observation.gameId,
    handIndex: observation.handIndex,
    turnIndex: observation.turnIndex,
    player: observation.player,
    agentId: agent.id,
    ...(requestedActionId ? { requestedActionId } : {}),
    appliedActionId: applied.id,
    ...(requested ? { requestedAction: requested.mjai } : {}),
    appliedAction: applied.mjai,
    isLegal: Boolean(requested),
    ...(fallbackReason ? { fallbackReason } : {}),
    latencyMs: performance.now() - started,
    ...(callUsage && typeof callUsage.inputTokens === "number" ? { inputTokens: callUsage.inputTokens } : {}),
    ...(callUsage && typeof callUsage.outputTokens === "number" ? { outputTokens: callUsage.outputTokens } : {}),
    ...(callMetadata ? { metadata: callMetadata } : {}),
    ...(error ? { error } : {}),
  };
  return { action: applied, record };
}

async function runGame(options: TournamentOptions, index: number, seatAgents: string[]): Promise<{ result: GameResult; records: GameDecisionRecord[]; events: unknown[] }> {
  const seed = options.seed + index;
  const id = gameId(options, index, seatAgents, seed);
  const bridge = new RiichiEnvBridge();
  const agents = seatAgents.map((name, seat) => createGameAgent(name, seed + seat, options.mortalConfig));
  const records: GameDecisionRecord[] = [];
  const agentCallTails: AgentCallTails = new WeakMap();
  let observations: GameObservation[] = [];
  let done = false;
  let scores: number[] = [];
  let ranks: number[] = [];
  try {
    ({ observations, done } = await bridge.startGame({ gameId: id, mode: options.mode, rule: options.rule, seed }));
    let guard = 0;
    while (!done) {
      if (++guard > 20_000) throw new Error("RiichiEnv game exceeded the safety turn limit");
      if (!observations.length) throw new Error("RiichiEnv returned no pending observations before game end");
      const decisions = await Promise.all(
        observations
          .slice()
          .sort((left, right) => left.player - right.player)
          .map(async (observation) => {
            const agent = agents[observation.player];
            if (!agent) throw new Error(`No agent for player ${observation.player}`);
            return decide(observation, agent, options.timeoutMs, agentCallTails);
          }),
      );
      decisions.sort((left, right) => left.record.player - right.record.player);
      for (const decision of decisions) records.push(decision.record);
      const actions = new Map(decisions.map((decision) => [decision.record.player, decision.action]));
      ({ observations, done } = await bridge.step(actions));
    }
    const final = await bridge.finish();
    scores = final.scores;
    ranks = final.ranks;
    return {
      result: {
        gameId: id,
        seed,
        seats: seatAgents,
        scores,
        ranks,
        errorCount: records.filter((record) => record.error || record.fallbackReason).length,
      },
      records,
      events: final.events,
    };
  } finally {
    await Promise.all(agents.map((agent) => agent.close?.()));
    bridge.close();
  }
}

export async function runTournament(options: TournamentOptions): Promise<void> {
  if (options.seats.length !== 4) throw new Error("--seats must contain exactly four agents");
  if (!Number.isInteger(options.games) || options.games < 1) throw new Error("--games must be a positive integer");
  if (options.mode !== "4p-red-half" && options.mode !== "4p-red-single" && options.mode !== "4p-red-east") {
    throw new Error("v1 tournament supports four-player red modes only");
  }
  if (options.rule !== "tenhou") throw new Error("v1 tournament supports only --rule tenhou");
  if (options.seatPolicy !== "rotate" && options.seatPolicy !== "fixed") throw new Error("--seat-policy must be rotate or fixed");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error("--timeout-ms must be positive");
  const output = resolve(options.out);
  await mkdir(join(output, "games"), { recursive: true });
  const allResults: GameResult[] = [];
  const allRecords: GameDecisionRecord[] = [];
  for (let index = 0; index < options.games; index += 1) {
    const seats = options.seatPolicy === "fixed"
      ? [...options.seats]
      : options.seats.map((_, seat) => options.seats[(seat + index) % options.seats.length]!);
    const game = await runGame(options, index, seats);
    allResults.push(game.result);
    allRecords.push(...game.records);
    const eventLines = game.events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await writeFile(join(output, "games", `${game.result.gameId}.mjai.jsonl`), eventLines);
    console.log(`Finished game ${index + 1}/${options.games}: ${game.result.gameId}`);
  }
  await writeFile(join(output, "decisions.jsonl"), allRecords.map((record) => JSON.stringify(record)).join("\n") + "\n");
  const summary = {
    version: 1,
    settings: {
      games: options.games,
      mode: options.mode,
      rule: options.rule,
      seed: options.seed,
      seatPolicy: options.seatPolicy,
      timeoutMs: options.timeoutMs,
      requestedSeats: options.seats,
    },
    dependencies: { riichienv: "0.4.10", node: process.version },
    games: allResults,
    errorCount: allResults.reduce((sum, game) => sum + game.errorCount, 0),
  };
  await writeFile(join(output, "tournament.json"), `${JSON.stringify(summary, null, 2)}\n`);
}
