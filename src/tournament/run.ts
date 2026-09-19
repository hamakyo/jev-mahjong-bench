import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";
import type {
  GameAction,
  GameDecisionRecord,
  GameObservation,
  SeatGameResult,
  TournamentGameResult,
} from "../types.js";
import { canonicalJson } from "../mjai/tiles.js";
import { createGameAgent, type GameAgentWithMetadata } from "../agents/game.js";
import { mortalReferencePolicy, type MortalConfig } from "../agents/mortal.js";
import { aggregateTournament, renderTournamentMarkdown, type TournamentMetrics } from "./metrics.js";
import { extractGameOutcomes } from "./outcomes.js";
import { RiichiEnvBridge } from "../game/bridge.js";

export interface TournamentOptions {
  seats: string[];
  games?: number;
  pairedRuns?: number;
  mode: string;
  rule: string;
  seed: number;
  seatPolicy: "rotate" | "fixed";
  out: string;
  timeoutMs: number;
  hybridThreshold?: number;
  mortalConfig?: MortalConfig;
}

export interface ScheduledTournamentGame {
  index: number;
  gameId: string;
  seed: number;
  baseSeed: number;
  pairId: string;
  rotationIndex: number;
  seats: string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function effectiveHybridThreshold(options: TournamentOptions): number | undefined {
  return options.hybridThreshold ?? (options.seats.includes("hybrid") ? 0.75 : undefined);
}

export function rotateSeats(seats: string[], rotationIndex: number): string[] {
  if (!seats.length) return [];
  const offset = ((rotationIndex % seats.length) + seats.length) % seats.length;
  return seats.map((_, index) => seats[(index + offset) % seats.length]!);
}

function gameId(
  options: TournamentOptions,
  index: number,
  seats: string[],
  seed: number,
  baseSeed: number,
  pairId: string,
  rotationIndex: number,
): string {
  const digest = sha256(canonicalJson({
    mode: options.mode,
    rule: options.rule,
    index,
    seed,
    baseSeed,
    pairId,
    rotationIndex,
    seats,
    hybridThreshold: effectiveHybridThreshold(options) ?? null,
  }));
  return `seed-${seed}-base-${baseSeed}-pair-${fileToken(pairId)}-rotation-${rotationIndex}-seats-${seats.map(fileToken).join("_")}-${digest}`;
}

export function buildTournamentSchedule(options: TournamentOptions): ScheduledTournamentGame[] {
  if (options.games !== undefined && options.pairedRuns !== undefined) {
    throw new Error("--games and --paired-runs are mutually exclusive");
  }
  const schedule: ScheduledTournamentGame[] = [];
  if (options.pairedRuns !== undefined) {
    for (let pairIndex = 0; pairIndex < options.pairedRuns; pairIndex += 1) {
      const baseSeed = options.seed + pairIndex;
      const pairId = `pair-${pairIndex}`;
      const seen = new Set<string>();
      for (let rotationIndex = 0; rotationIndex < options.seats.length; rotationIndex += 1) {
        const seats = rotateSeats(options.seats, rotationIndex);
        const key = seats.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        const index = schedule.length;
        schedule.push({
          index,
          seed: baseSeed,
          baseSeed,
          pairId,
          rotationIndex,
          seats,
          gameId: gameId(options, index, seats, baseSeed, baseSeed, pairId, rotationIndex),
        });
      }
    }
    return schedule;
  }

  const games = options.games ?? 1;
  for (let index = 0; index < games; index += 1) {
    const baseSeed = options.seed + index;
    const rotationIndex = options.seatPolicy === "rotate" ? index % options.seats.length : 0;
    const seats = rotateSeats(options.seats, options.seatPolicy === "rotate" ? index : 0);
    const pairId = `single-${index}`;
    schedule.push({
      index,
      seed: baseSeed,
      baseSeed,
      pairId,
      rotationIndex,
      seats,
      gameId: gameId(options, index, seats, baseSeed, baseSeed, pairId, rotationIndex),
    });
  }
  return schedule;
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
    if (cancelled) throw abortedError();
    controller = new AbortController();
    agent.lastMetadata = undefined;
    agent.lastUsage = undefined;
    return agent.act(observation, controller.signal).then((action) => {
      if (cancelled || controller?.signal.aborted) throw abortedError();
      return { action, metadata: agent.lastMetadata, usage: agent.lastUsage };
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
  return new Promise<T>((resolvePromise, reject) => {
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
      resolvePromise(value);
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

function playerResult(
  seat: number,
  records: GameDecisionRecord[],
  outcomes: ReturnType<typeof extractGameOutcomes>,
  scores: number[],
  ranks: number[],
  agentId: string,
  game: ScheduledTournamentGame,
): SeatGameResult {
  const ownRecords = records.filter((record) => record.player === seat);
  const outcome = outcomes.seats[seat]!;
  return {
    gameId: game.gameId,
    seed: game.seed,
    pairId: game.pairId,
    baseSeed: game.baseSeed,
    rotationIndex: game.rotationIndex,
    agentId,
    seat,
    score: scores[seat] ?? 0,
    rank: ranks[seat] ?? 0,
    handCount: outcomes.handCount,
    wins: outcome.wins,
    dealIns: outcome.dealIns,
    riichi: outcome.riichi,
    calls: outcome.calls,
    decisions: ownRecords.length,
    legalDecisions: ownRecords.filter((record) => record.isLegal).length,
    fallbackCount: ownRecords.filter((record) => Boolean(record.fallbackReason)).length,
    errorCount: ownRecords.filter((record) => Boolean(record.error)).length,
    latenciesMs: ownRecords.map((record) => record.latencyMs),
    inputTokens: ownRecords.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0),
    outputTokens: ownRecords.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0),
    rawEventCounts: outcome.rawEventCounts,
  };
}

async function runGame(
  options: TournamentOptions,
  game: ScheduledTournamentGame,
): Promise<{ result: TournamentGameResult; records: GameDecisionRecord[]; events: unknown[] }> {
  const bridge = new RiichiEnvBridge();
  const agents: GameAgentWithMetadata[] = [];
  const records: GameDecisionRecord[] = [];
  const agentCallTails: AgentCallTails = new WeakMap();
  let observations: GameObservation[] = [];
  let done = false;
  try {
    for (const [seat, name] of game.seats.entries()) {
      agents.push(createGameAgent(name, game.seed + seat, {
        ...(options.mortalConfig ? { mortalConfig: options.mortalConfig } : {}),
        ...(options.hybridThreshold !== undefined ? { hybridThreshold: options.hybridThreshold } : {}),
      }));
    }
    ({ observations, done } = await bridge.startGame({ gameId: game.gameId, mode: options.mode, rule: options.rule, seed: game.seed }));
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
    const outcomes = extractGameOutcomes(final.events);
    const players = game.seats.map((_, seat) => playerResult(
      seat,
      records,
      outcomes,
      final.scores,
      final.ranks,
      agents[seat]!.id,
      game,
    ));
    const result: TournamentGameResult = {
      gameId: game.gameId,
      seed: game.seed,
      baseSeed: game.baseSeed,
      pairId: game.pairId,
      rotationIndex: game.rotationIndex,
      seats: game.seats,
      scores: final.scores,
      ranks: final.ranks,
      handCount: outcomes.handCount,
      eventCounts: outcomes.eventCounts,
      players,
      errorCount: records.filter((record) => Boolean(record.error)).length,
    };
    return { result, records, events: final.events };
  } finally {
    await Promise.all(agents.map((agent) => agent.close?.()));
    bridge.close();
  }
}

function validateOptions(options: TournamentOptions): void {
  if (options.seats.length !== 4) throw new Error("--seats must contain exactly four agents");
  if (options.games !== undefined && (!Number.isInteger(options.games) || options.games < 1)) {
    throw new Error("--games must be a positive integer");
  }
  if (options.pairedRuns !== undefined && (!Number.isInteger(options.pairedRuns) || options.pairedRuns < 1)) {
    throw new Error("--paired-runs must be a positive integer");
  }
  if (options.games !== undefined && options.pairedRuns !== undefined) {
    throw new Error("--games and --paired-runs are mutually exclusive");
  }
  if (options.mode !== "4p-red-half" && options.mode !== "4p-red-single" && options.mode !== "4p-red-east") {
    throw new Error("v1 tournament supports four-player red modes only");
  }
  if (options.rule !== "tenhou") throw new Error("v1 tournament supports only --rule tenhou");
  if (options.seatPolicy !== "rotate" && options.seatPolicy !== "fixed") throw new Error("--seat-policy must be rotate or fixed");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error("--timeout-ms must be positive");
  if (options.hybridThreshold !== undefined && (!Number.isFinite(options.hybridThreshold) || options.hybridThreshold < 0 || options.hybridThreshold > 1)) {
    throw new Error("--hybrid-threshold must be a finite number between 0 and 1");
  }
}

function modelMetadata(options: TournamentOptions, mortalPolicy: Record<string, unknown> | undefined): Record<string, unknown> {
  const hybridThreshold = effectiveHybridThreshold(options);
  return {
    jev: {
      provider: "typesafe",
      model: process.env.TYPESAFE_MODEL ?? "system-one",
      reasoningEffort: process.env.TYPESAFE_REASONING_EFFORT ?? "default",
    },
    gpt: {
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      reasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "none",
    },
    ...(hybridThreshold !== undefined ? { hybridThreshold } : {}),
    ...(mortalPolicy ? { mortal: mortalPolicy } : {}),
  };
}

export async function runTournament(options: TournamentOptions): Promise<void> {
  validateOptions(options);
  const schedule = buildTournamentSchedule(options);
  const output = resolve(options.out);
  await mkdir(join(output, "games"), { recursive: true });
  const allResults: TournamentGameResult[] = [];
  const allRecords: GameDecisionRecord[] = [];
  for (const game of schedule) {
    const finished = await runGame(options, game);
    allResults.push(finished.result);
    allRecords.push(...finished.records);
    const eventLines = finished.events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await writeFile(join(output, "games", `${finished.result.gameId}.mjai.jsonl`), eventLines);
    console.log(`Finished game ${game.index + 1}/${schedule.length}: ${finished.result.gameId}`);
  }

  const metrics: TournamentMetrics = aggregateTournament(allResults, allRecords);
  const mortalPolicy = options.mortalConfig
    ? await mortalReferencePolicy(options.mortalConfig) as unknown as Record<string, unknown>
    : undefined;
  const hybridThreshold = effectiveHybridThreshold(options);
  const settings = {
    schedule: options.pairedRuns !== undefined ? "paired" : "games",
    games: schedule.length,
    pairedRuns: options.pairedRuns ?? null,
    mode: options.mode,
    rule: options.rule,
    seed: options.seed,
    seatPolicy: options.pairedRuns !== undefined ? "rotate" : options.seatPolicy,
    timeoutMs: options.timeoutMs,
    requestedSeats: options.seats,
    ...(hybridThreshold !== undefined ? { hybridThreshold } : {}),
  };
  const dependencies = { riichienv: "0.4.10", node: process.version };
  const models = modelMetadata(options, mortalPolicy);
  const seedSchedule = schedule.map(({ index, gameId: id, seed, baseSeed, pairId, rotationIndex, seats }) => ({
    index,
    gameId: id,
    seed,
    baseSeed,
    pairId,
    rotationIndex,
    seats,
  }));
  const benchmarkConfig = { settings, dependencies, models, seedSchedule };
  const configSha256 = sha256(canonicalJson(benchmarkConfig));
  const summary = {
    version: 2,
    ...benchmarkConfig,
    configSha256,
    games: allResults,
    metrics,
    errorCount: allResults.reduce((sum, game) => sum + game.errorCount, 0),
  };
  await writeFile(join(output, "tournament.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(output, "games.jsonl"), allResults.map((result) => JSON.stringify(result)).join("\n") + "\n");
  await writeFile(join(output, "decisions.jsonl"), allRecords.map((record) => JSON.stringify(record)).join("\n") + "\n");
  await writeFile(join(output, "tournament.md"), `${renderTournamentMarkdown(metrics)}\n\n## Reproduction\n\nConfiguration SHA-256: \`${configSha256}\`\n`);
}
