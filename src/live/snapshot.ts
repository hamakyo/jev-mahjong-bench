import type {
  DebugDecisionEndEvent,
  DebugDecisionStartEvent,
  DebugLiveEvent,
  DebugMjaiEvent,
  LiveEventBatch,
  LiveGameActionView,
  LiveMode,
  PublicLiveEvent,
  TournamentSettingsSnapshot,
} from "./events.js";

const SEATS = ["E", "S", "W", "N"] as const;
const RECENT_EVENT_LIMIT = 50;

export interface LiveLatencySummary {
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
}

/** Fields safe to expose to spectator clients. */
export interface LivePublicAgentAggregate {
  handCount: number;
  wins: number;
  dealIns: number;
  riichi: number;
  calls: number;
  completedGames: number;
}

/** Full live diagnostics, exposed only by debug snapshots. */
export interface LiveAgentAggregate extends LivePublicAgentAggregate {
  decisions: number;
  legalDecisions: number;
  fallbackCount: number;
  errorCount: number;
  latency: LiveLatencySummary;
  inputTokens: number;
  outputTokens: number;
  retryCount: number;
  escalationCount: number;
}

export interface LiveDecisionView {
  player?: number;
  agentId?: string;
  pending: boolean;
  actionType?: string;
  requestedActionId?: string;
  requestedAction?: Record<string, unknown>;
  appliedActionId?: string;
  appliedAction?: Record<string, unknown>;
  isLegal?: boolean;
  fallbackReason?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  retryCount?: number;
  error?: string;
}

export interface LiveCurrentGame {
  gameId: string;
  pairId: string;
  rotationIndex: number;
  seed: number;
  baseSeed: number;
  seats: string[];
  gameIndex: number;
  totalGames: number;
}

export interface LiveDebugSnapshot {
  latestStateBySeat: Record<string, unknown>;
  legalActionsBySeat: Record<string, LiveGameActionView[]>;
  rawEvents: unknown[];
  providerMetadataBySeat: Record<string, Record<string, unknown> | undefined>;
  diagnosticsBySeat: Record<string, Record<string, unknown> | undefined>;
}

export interface LiveSnapshot {
  schemaVersion: 1;
  streamId: string;
  lastEventId: number;
  mode: LiveMode;
  status: "idle" | "running" | "complete" | "error";
  error?: string;
  tournament: {
    settings?: TournamentSettingsSnapshot;
    totalGames: number;
    completedGames: number;
    errorCount: number;
  };
  currentGame: LiveCurrentGame | null;
  round: string | null;
  honba: number;
  kyotaku: number;
  oya: number | null;
  currentSeat: number | null;
  scores: number[];
  ranks: number[];
  seatAgents: Record<string, string>;
  discards: Record<string, string[]>;
  melds: Record<string, string[]>;
  doraIndicators: string[];
  riichi: Record<string, boolean>;
  recentEvents: Record<string, unknown>[];
  decisionsBySeat: Record<string, LiveDecisionView>;
  lastDecisions: LiveDecisionView[];
  agents: Record<string, LivePublicAgentAggregate>;
  debug?: LiveDebugSnapshot;
}

export interface SnapshotCheckpoint {
  spectator: LiveSnapshot;
  debug: LiveSnapshot;
  latencyValuesByAgent: Record<string, number[]>;
}

interface MutableAgentAggregate extends LiveAgentAggregate {
  latencyValues: number[];
}

interface MutableSnapshot extends Omit<LiveSnapshot, "mode" | "debug" | "agents"> {
  agents: Record<string, MutableAgentAggregate>;
  debugState: LiveDebugSnapshot;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function seatKey(value: unknown): string | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < SEATS.length
    ? SEATS[value]
    : undefined;
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return lower === upper ? low : low + (high - low) * (position - lower);
}

function emptyLatency(): LiveLatencySummary {
  return { count: 0, meanMs: 0, p50Ms: 0, p95Ms: 0 };
}

function emptyAgent(): MutableAgentAggregate {
  return {
    decisions: 0,
    legalDecisions: 0,
    fallbackCount: 0,
    errorCount: 0,
    latency: emptyLatency(),
    inputTokens: 0,
    outputTokens: 0,
    retryCount: 0,
    escalationCount: 0,
    wins: 0,
    dealIns: 0,
    riichi: 0,
    calls: 0,
    handCount: 0,
    completedGames: 0,
    latencyValues: [],
  };
}

function emptySnapshot(streamId: string): MutableSnapshot {
  return {
    schemaVersion: 1,
    streamId,
    lastEventId: 0,
    status: "idle",
    tournament: { totalGames: 0, completedGames: 0, errorCount: 0 },
    currentGame: null,
    round: null,
    honba: 0,
    kyotaku: 0,
    oya: null,
    currentSeat: null,
    scores: [],
    ranks: [],
    seatAgents: {},
    discards: Object.fromEntries(SEATS.map((seat) => [seat, []])),
    melds: Object.fromEntries(SEATS.map((seat) => [seat, []])),
    doraIndicators: [],
    riichi: Object.fromEntries(SEATS.map((seat) => [seat, false])),
    recentEvents: [],
    decisionsBySeat: {},
    lastDecisions: [],
    agents: {},
    debugState: {
      latestStateBySeat: {},
      legalActionsBySeat: {},
      rawEvents: [],
      providerMetadataBySeat: {},
      diagnosticsBySeat: {},
    },
  };
}

function resetBoard(snapshot: MutableSnapshot): void {
  snapshot.round = null;
  snapshot.honba = 0;
  snapshot.kyotaku = 0;
  snapshot.oya = null;
  snapshot.currentSeat = null;
  snapshot.scores = [];
  snapshot.ranks = [];
  snapshot.discards = Object.fromEntries(SEATS.map((seat) => [seat, []]));
  snapshot.melds = Object.fromEntries(SEATS.map((seat) => [seat, []]));
  snapshot.doraIndicators = [];
  snapshot.riichi = Object.fromEntries(SEATS.map((seat) => [seat, false]));
  snapshot.decisionsBySeat = {};
  snapshot.lastDecisions = [];
}

function updateLatency(agent: MutableAgentAggregate, latencyMs: number): void {
  if (!Number.isFinite(latencyMs)) return;
  agent.latencyValues.push(latencyMs);
  const values = agent.latencyValues;
  agent.latency = {
    count: values.length,
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

function updateMjai(snapshot: MutableSnapshot, event: Record<string, unknown>): void {
  const type = typeof event.type === "string" ? event.type : "unknown";
  const actor = seatKey(event.actor);
  if (type === "start_kyoku") {
    const bakaze = typeof event.bakaze === "string" ? event.bakaze : "?";
    const kyoku = numberValue(event.kyoku, 0);
    snapshot.round = `${bakaze}${kyoku}`;
    snapshot.honba = numberValue(event.honba);
    snapshot.kyotaku = numberValue(event.kyotaku);
    snapshot.oya = typeof event.oya === "number" ? event.oya : null;
    snapshot.scores = Array.isArray(event.scores) ? event.scores.map((value) => numberValue(value)) : [];
    snapshot.discards = Object.fromEntries(SEATS.map((seat) => [seat, []]));
    snapshot.melds = Object.fromEntries(SEATS.map((seat) => [seat, []]));
    snapshot.doraIndicators = typeof event.dora_marker === "string" ? [event.dora_marker] : [];
    snapshot.riichi = Object.fromEntries(SEATS.map((seat) => [seat, false]));
  } else if (type === "dahai" && actor && typeof event.pai === "string") {
    snapshot.discards[actor]?.push(event.pai);
    snapshot.currentSeat = typeof event.actor === "number" ? event.actor : snapshot.currentSeat;
  } else if (["chi", "pon", "daiminkan", "ankan", "kakan"].includes(type) && actor) {
    const visible = {
      type,
      ...(typeof event.pai === "string" ? { pai: event.pai } : {}),
      ...(Array.isArray(event.consumed) ? { consumed: clone(event.consumed) } : {}),
      ...(typeof event.target === "number" ? { target: event.target } : {}),
    };
    snapshot.melds[actor]?.push(JSON.stringify(visible));
    snapshot.currentSeat = typeof event.actor === "number" ? event.actor : snapshot.currentSeat;
  } else if (type === "dora" && typeof event.dora_marker === "string") {
    snapshot.doraIndicators.push(event.dora_marker);
  } else if ((type === "reach" || type === "riichi") && actor) {
    snapshot.riichi[actor] = true;
    snapshot.currentSeat = typeof event.actor === "number" ? event.actor : snapshot.currentSeat;
  } else if (type === "tsumo" && typeof event.actor === "number") {
    snapshot.currentSeat = event.actor;
  }
  if (Array.isArray(event.scores)) snapshot.scores = event.scores.map((value) => numberValue(value));
  if (Array.isArray(event.new_scores)) snapshot.scores = event.new_scores.map((value) => numberValue(value));
  snapshot.recentEvents.push(clone(event));
  if (snapshot.recentEvents.length > RECENT_EVENT_LIMIT) snapshot.recentEvents.shift();
}

function actionViews(value: unknown): LiveGameActionView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): LiveGameActionView[] => {
    const action = objectValue(item);
    if (!action || typeof action.id !== "string" || typeof action.type !== "string") return [];
    const mjai = objectValue(action.mjai);
    if (!mjai) return [];
    return [{ id: action.id, type: action.type, mjai: clone(mjai) }];
  });
}

function applyDecisionEnd(snapshot: MutableSnapshot, event: DebugDecisionEndEvent): void {
  const agentId = event.agentId;
  if (agentId) {
    const agent = snapshot.agents[agentId] ?? emptyAgent();
    snapshot.agents[agentId] = agent;
    agent.decisions += 1;
    if (event.isLegal) agent.legalDecisions += 1;
    if (event.fallbackReason) agent.fallbackCount += 1;
    if (event.error) agent.errorCount += 1;
    updateLatency(agent, event.latencyMs);
    agent.inputTokens += event.inputTokens ?? 0;
    agent.outputTokens += event.outputTokens ?? 0;
    agent.retryCount += event.retryCount;
    if (event.diagnostics?.hybridTrace?.escalated) agent.escalationCount += 1;
  }
  const seat = seatKey(event.player);
  const view: LiveDecisionView = {
    ...(event.player !== undefined ? { player: event.player } : {}),
    ...(event.agentId ? { agentId: event.agentId } : {}),
    pending: false,
    actionType: typeof event.appliedAction.type === "string" ? event.appliedAction.type : "unknown",
    ...(event.requestedActionId ? { requestedActionId: event.requestedActionId } : {}),
    ...(event.requestedAction ? { requestedAction: clone(event.requestedAction) } : {}),
    appliedActionId: event.appliedActionId,
    appliedAction: clone(event.appliedAction),
    isLegal: event.isLegal,
    ...(event.fallbackReason ? { fallbackReason: event.fallbackReason } : {}),
    latencyMs: event.latencyMs,
    ...(event.inputTokens !== undefined ? { inputTokens: event.inputTokens } : {}),
    ...(event.outputTokens !== undefined ? { outputTokens: event.outputTokens } : {}),
    retryCount: event.retryCount,
    ...(event.error ? { error: event.error } : {}),
  };
  if (seat) snapshot.decisionsBySeat[seat] = view;
  snapshot.lastDecisions.unshift(view);
  snapshot.lastDecisions = snapshot.lastDecisions.slice(0, 20);
  if (seat) {
    snapshot.debugState.providerMetadataBySeat[seat] = clone(event.metadata);
    snapshot.debugState.diagnosticsBySeat[seat] = event.diagnostics
      ? clone(event.diagnostics) as unknown as Record<string, unknown>
      : undefined;
  }
}

function applyPublicEvent(snapshot: MutableSnapshot, event: PublicLiveEvent): void {
  switch (event.type) {
    case "tournament:start":
      snapshot.status = "running";
      delete snapshot.error;
      snapshot.tournament = { settings: clone(event.settings), totalGames: event.totalGames, completedGames: 0, errorCount: 0 };
      break;
    case "tournament:progress":
      snapshot.tournament.completedGames = event.completedGames;
      snapshot.tournament.totalGames = event.totalGames;
      break;
    case "game:start":
      snapshot.status = "running";
      snapshot.currentGame = {
        gameId: event.gameId ?? "",
        pairId: event.pairId ?? "",
        rotationIndex: event.rotationIndex ?? 0,
        seed: event.seed,
        baseSeed: event.baseSeed,
        seats: [...event.seats],
        gameIndex: event.gameIndex,
        totalGames: event.totalGames,
      };
      snapshot.seatAgents = Object.fromEntries(event.seats.map((agentId, seat) => [SEATS[seat]!, agentId]));
      resetBoard(snapshot);
      break;
    case "mjai":
      updateMjai(snapshot, event.event);
      break;
    case "decision:start": {
      const seat = seatKey(event.player);
      if (seat) snapshot.decisionsBySeat[seat] = {
        ...(event.player !== undefined ? { player: event.player } : {}),
        ...(event.agentId ? { agentId: event.agentId } : {}),
        pending: true,
      };
      if (event.player !== undefined) snapshot.currentSeat = event.player;
      break;
    }
    case "decision:end":
      // Decision metrics and provider diagnostics are applied from the debug
      // event below, while this public pass keeps the board-free projection
      // useful if a caller only supplies public events.
      break;
    case "game:end":
      snapshot.scores = [...event.scores];
      snapshot.ranks = [...event.ranks];
      snapshot.tournament.errorCount += event.errorCount;
      break;
    case "tournament:end":
      snapshot.status = "complete";
      snapshot.tournament.completedGames = event.completedGames;
      snapshot.tournament.totalGames = event.totalGames;
      snapshot.tournament.errorCount = event.errorCount;
      break;
    case "tournament:error":
      snapshot.status = "error";
      snapshot.error = event.message;
      snapshot.tournament.completedGames = event.completedGames;
      snapshot.tournament.totalGames = event.totalGames;
      snapshot.tournament.errorCount += 1;
      break;
  }
}

function applyDebugEvent(snapshot: MutableSnapshot, event: DebugLiveEvent): void {
  if (event.type === "game:start") {
    snapshot.debugState.latestStateBySeat = {};
    snapshot.debugState.legalActionsBySeat = {};
    snapshot.debugState.rawEvents = [];
    snapshot.debugState.providerMetadataBySeat = {};
    snapshot.debugState.diagnosticsBySeat = {};
  } else if (event.type === "decision:start") {
    const decision = event as DebugDecisionStartEvent;
    const seat = seatKey(decision.player);
    if (seat) {
      snapshot.debugState.latestStateBySeat[seat] = clone(decision.observation.state);
      snapshot.debugState.legalActionsBySeat[seat] = actionViews(decision.observation.legalActions);
    }
  } else if (event.type === "decision:end") {
    applyDecisionEnd(snapshot, event as DebugDecisionEndEvent);
  } else if (event.type === "mjai") {
    const mjai = event as DebugMjaiEvent;
    snapshot.debugState.rawEvents.push(clone(mjai.event));
    if (snapshot.debugState.rawEvents.length > RECENT_EVENT_LIMIT) snapshot.debugState.rawEvents.shift();
  } else if (event.type === "game:end") {
    const result = objectValue(event.result);
    const players = result && Array.isArray(result.players) ? result.players : [];
    for (const item of players) {
      const player = objectValue(item);
      if (!player) continue;
      const agentId = typeof player?.agentId === "string" ? player.agentId : undefined;
      if (!agentId) continue;
      const aggregate = snapshot.agents[agentId] ?? emptyAgent();
      snapshot.agents[agentId] = aggregate;
      aggregate.completedGames += 1;
      aggregate.handCount += numberValue(player.handCount);
      aggregate.wins += numberValue(player.wins);
      aggregate.dealIns += numberValue(player.dealIns);
      aggregate.riichi += numberValue(player.riichi);
      aggregate.calls += numberValue(player.calls);
    }
  }
}

function publicAgentView(agent: MutableAgentAggregate): LivePublicAgentAggregate {
  return {
    handCount: agent.handCount,
    wins: agent.wins,
    dealIns: agent.dealIns,
    riichi: agent.riichi,
    calls: agent.calls,
    completedGames: agent.completedGames,
  };
}

function debugAgentView(agent: MutableAgentAggregate): LiveAgentAggregate {
  return {
    decisions: agent.decisions,
    legalDecisions: agent.legalDecisions,
    fallbackCount: agent.fallbackCount,
    errorCount: agent.errorCount,
    latency: clone(agent.latency),
    inputTokens: agent.inputTokens,
    outputTokens: agent.outputTokens,
    retryCount: agent.retryCount,
    escalationCount: agent.escalationCount,
    handCount: agent.handCount,
    wins: agent.wins,
    dealIns: agent.dealIns,
    riichi: agent.riichi,
    calls: agent.calls,
    completedGames: agent.completedGames,
  };
}

function publicDecisionView(decision: LiveDecisionView): LiveDecisionView {
  return {
    ...(decision.player !== undefined ? { player: decision.player } : {}),
    ...(decision.agentId ? { agentId: decision.agentId } : {}),
    pending: decision.pending,
    ...(decision.actionType ? { actionType: decision.actionType } : {}),
    ...(decision.appliedActionId ? { appliedActionId: decision.appliedActionId } : {}),
  };
}

export class SnapshotStore {
  private readonly streamId: string;
  private readonly publicState: MutableSnapshot;
  private readonly debugState: MutableSnapshot;

  constructor(streamId: string) {
    this.streamId = streamId;
    this.publicState = emptySnapshot(streamId);
    this.debugState = emptySnapshot(streamId);
  }

  apply(batch: LiveEventBatch): void {
    if (batch.streamId !== this.streamId) throw new Error("snapshot stream ID mismatch");
    this.publicState.lastEventId = batch.id;
    this.debugState.lastEventId = batch.id;
    applyPublicEvent(this.publicState, batch.publicEvent);
    applyPublicEvent(this.debugState, batch.publicEvent);
    applyDebugEvent(this.publicState, batch.debugEvent);
    applyDebugEvent(this.debugState, batch.debugEvent);
  }

  checkpoint(): SnapshotCheckpoint {
    return {
      spectator: this.getSnapshot("spectator"),
      debug: this.getSnapshot("debug"),
      latencyValuesByAgent: Object.fromEntries(
        Object.entries(this.debugState.agents).map(([agentId, aggregate]) => [agentId, [...aggregate.latencyValues]]),
      ),
    };
  }

  restore(checkpoint: SnapshotCheckpoint): void {
    if (checkpoint.spectator.streamId !== this.streamId || checkpoint.debug.streamId !== this.streamId) {
      throw new Error("snapshot checkpoint stream ID mismatch");
    }
    restoreMutableSnapshot(this.publicState, checkpoint.debug, checkpoint.latencyValuesByAgent);
    restoreMutableSnapshot(this.debugState, checkpoint.debug, checkpoint.latencyValuesByAgent);
  }

  getSnapshot(mode: LiveMode = "spectator"): LiveSnapshot {
    const source = mode === "debug" ? this.debugState : this.publicState;
    const decisionsBySeat = mode === "debug"
      ? source.decisionsBySeat
      : Object.fromEntries(Object.entries(source.decisionsBySeat).map(([seat, decision]) => [seat, publicDecisionView(decision)]));
    const lastDecisions = mode === "debug"
      ? source.lastDecisions
      : source.lastDecisions.map(publicDecisionView);
    const result: LiveSnapshot = {
      schemaVersion: 1,
      streamId: source.streamId,
      lastEventId: source.lastEventId,
      mode,
      status: source.status,
      ...(source.error ? { error: source.error } : {}),
      tournament: clone(source.tournament),
      currentGame: clone(source.currentGame),
      round: source.round,
      honba: source.honba,
      kyotaku: source.kyotaku,
      oya: source.oya,
      currentSeat: source.currentSeat,
      scores: [...source.scores],
      ranks: [...source.ranks],
      seatAgents: clone(source.seatAgents),
      discards: clone(source.discards),
      melds: clone(source.melds),
      doraIndicators: [...source.doraIndicators],
      riichi: clone(source.riichi),
      recentEvents: clone(source.recentEvents),
      decisionsBySeat: clone(decisionsBySeat),
      lastDecisions: clone(lastDecisions),
      agents: Object.fromEntries(Object.entries(source.agents).map(([agentId, aggregate]) => [
        agentId,
        mode === "debug" ? debugAgentView(aggregate) : publicAgentView(aggregate),
      ])),
    };
    if (mode === "debug") result.debug = clone(source.debugState);
    return result;
  }
}

function restoreMutableSnapshot(
  target: MutableSnapshot,
  source: LiveSnapshot,
  latencyValuesByAgent: Record<string, number[]>,
): void {
  const agents = Object.fromEntries(Object.entries(source.agents).map(([agentId, value]) => {
    const full = value as Partial<LiveAgentAggregate>;
    return [agentId, {
      decisions: numberValue(full.decisions),
      legalDecisions: numberValue(full.legalDecisions),
      fallbackCount: numberValue(full.fallbackCount),
      errorCount: numberValue(full.errorCount),
      latency: full.latency ? clone(full.latency) : emptyLatency(),
      inputTokens: numberValue(full.inputTokens),
      outputTokens: numberValue(full.outputTokens),
      retryCount: numberValue(full.retryCount),
      escalationCount: numberValue(full.escalationCount),
      handCount: numberValue(value.handCount),
      wins: numberValue(value.wins),
      dealIns: numberValue(value.dealIns),
      riichi: numberValue(value.riichi),
      calls: numberValue(value.calls),
      completedGames: numberValue(value.completedGames),
      latencyValues: [...(latencyValuesByAgent[agentId] ?? [])],
    } satisfies MutableAgentAggregate];
  }));
  const debugState = source.debug ?? {
    latestStateBySeat: {},
    legalActionsBySeat: {},
    rawEvents: [],
    providerMetadataBySeat: {},
    diagnosticsBySeat: {},
  };
  Object.assign(target, {
    schemaVersion: 1,
    streamId: source.streamId,
    lastEventId: source.lastEventId,
    status: source.status,
    ...(source.error ? { error: source.error } : {}),
    tournament: clone(source.tournament),
    currentGame: clone(source.currentGame),
    round: source.round,
    honba: source.honba,
    kyotaku: source.kyotaku,
    oya: source.oya,
    currentSeat: source.currentSeat,
    scores: [...source.scores],
    ranks: [...source.ranks],
    seatAgents: clone(source.seatAgents),
    discards: clone(source.discards),
    melds: clone(source.melds),
    doraIndicators: [...source.doraIndicators],
    riichi: clone(source.riichi),
    recentEvents: clone(source.recentEvents),
    decisionsBySeat: clone(source.decisionsBySeat),
    lastDecisions: clone(source.lastDecisions),
    agents,
    debugState: clone(debugState),
  });
}
