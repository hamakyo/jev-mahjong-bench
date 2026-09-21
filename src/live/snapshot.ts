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

export type PhysicalSeatPosition = "bottom" | "right" | "top" | "left";
export type Wind = "E" | "S" | "W" | "N";

export const POSITION_BY_PLAYER = ["bottom", "right", "top", "left"] as const satisfies readonly PhysicalSeatPosition[];
export const ROTATION_BY_POSITION: Record<PhysicalSeatPosition, 0 | 90 | 180 | -90> = {
  bottom: 0,
  right: 90,
  top: 180,
  left: -90,
};

export const PRESENTATION_VERSION = 2 as const;

export interface RiverTileView {
  tile: string;
  tsumogiri: boolean;
  riichi: boolean;
}

export interface MeldView {
  type: "chi" | "pon" | "daiminkan" | "ankan" | "kakan";
  tiles: string[];
  fromPlayer?: number;
  calledTileIndex?: number;
  concealedIndexes?: number[];
}

export interface TableSeatView {
  playerIndex: number;
  position: PhysicalSeatPosition;
  agentId: string;
  currentWind: Wind;
  isDealer: boolean;
  score: number;
  rank?: number;
  concealedTileCount: number;
  drawnTilePending: boolean;
  river: RiverTileView[];
  melds: MeldView[];
  riichi: boolean;
  debugHand?: string[];
  debugDrawnTile?: string;
}

export interface TablePresentationState {
  presentationVersion: typeof PRESENTATION_VERSION;
  seats: Record<PhysicalSeatPosition, TableSeatView>;
  pendingRiichiPlayer: number | null;
  latestDiscard: { playerIndex: number; riverIndex: number } | null;
}

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
  presentationVersion: typeof PRESENTATION_VERSION;
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
  table: TablePresentationState;
  debug?: LiveDebugSnapshot;
}

export interface SnapshotCheckpoint {
  presentationVersion: typeof PRESENTATION_VERSION;
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
  playerAgents: string[];
  handCounts: number[];
  drawnTilePendingByPlayer: boolean[];
  riversByPlayer: RiverTileView[][];
  meldsByPlayer: MeldView[][];
  riichiByPlayer: boolean[];
  pendingRiichiPlayer: number | null;
  latestDiscard: { playerIndex: number; riverIndex: number } | null;
  debugHands: Array<string[] | undefined>;
  debugDrawnTiles: Array<string | undefined>;
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

export function windForPlayer(playerIndex: number, oya: number | null): Wind {
  const normalizedOya = typeof oya === "number" && Number.isInteger(oya) && oya >= 0 && oya < 4 ? oya : 0;
  return SEATS[(playerIndex - normalizedOya + 4) % 4] ?? "E";
}

function playerIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 4 ? value : undefined;
}

function emptyRivers(): RiverTileView[][] {
  return Array.from({ length: 4 }, () => []);
}

function emptyMelds(): MeldView[][] {
  return Array.from({ length: 4 }, () => []);
}

function emptyPlayerValues<T>(value: T): T[] {
  return Array.from({ length: 4 }, () => value);
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
    presentationVersion: PRESENTATION_VERSION,
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
    table: {
      presentationVersion: PRESENTATION_VERSION,
      seats: {} as Record<PhysicalSeatPosition, TableSeatView>,
      pendingRiichiPlayer: null,
      latestDiscard: null,
    },
    playerAgents: [],
    handCounts: [0, 0, 0, 0],
    drawnTilePendingByPlayer: [false, false, false, false],
    riversByPlayer: emptyRivers(),
    meldsByPlayer: emptyMelds(),
    riichiByPlayer: [false, false, false, false],
    pendingRiichiPlayer: null,
    latestDiscard: null,
    debugHands: emptyPlayerValues<string[] | undefined>(undefined),
    debugDrawnTiles: emptyPlayerValues<string | undefined>(undefined),
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
  snapshot.handCounts = [0, 0, 0, 0];
  snapshot.drawnTilePendingByPlayer = [false, false, false, false];
  snapshot.riversByPlayer = emptyRivers();
  snapshot.meldsByPlayer = emptyMelds();
  snapshot.riichiByPlayer = [false, false, false, false];
  snapshot.pendingRiichiPlayer = null;
  snapshot.latestDiscard = null;
  snapshot.debugHands = emptyPlayerValues<string[] | undefined>(undefined);
  snapshot.debugDrawnTiles = emptyPlayerValues<string | undefined>(undefined);
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

function tileKind(value: string): string {
  return value.replace(/^0([mps])$/, "5$1").replace(/r$/, "");
}

function calledTileIndexForSource(actor: number | undefined, target: number | undefined, tileCount: number): number | undefined {
  if (!tileCount) return undefined;
  if (actor === undefined || target === undefined) return tileCount - 1;
  const relative = (target - actor + 4) % 4;
  if (relative === 3) return 0;
  if (relative === 2) return Math.floor((tileCount - 1) / 2);
  return tileCount - 1;
}

function meldView(event: Record<string, unknown>, actor?: number): MeldView | undefined {
  const type = typeof event.type === "string" && ["chi", "pon", "daiminkan", "ankan", "kakan"].includes(event.type)
    ? event.type as MeldView["type"]
    : undefined;
  if (!type) return undefined;
  const consumed = Array.isArray(event.consumed)
    ? event.consumed.filter((tile): tile is string => typeof tile === "string")
    : [];
  const pai = typeof event.pai === "string" ? event.pai : undefined;
  const calledTileIndex = pai && type !== "ankan"
    ? calledTileIndexForSource(actor, playerIndex(event.target), consumed.length + 1)
    : undefined;
  const tiles = type === "ankan"
    ? (consumed.length ? consumed : pai ? [pai, pai, pai, pai] : [])
    : calledTileIndex === undefined || pai === undefined
      ? [...consumed, ...(pai ? [pai] : [])]
      : [...consumed.slice(0, calledTileIndex), pai, ...consumed.slice(calledTileIndex)];
  if (!tiles.length) return undefined;
  const target = playerIndex(event.target);
  const view: MeldView = { type, tiles };
  if (target !== undefined) view.fromPlayer = target;
  if (type === "ankan") {
    view.concealedIndexes = [0, 3];
  } else if (pai) {
    if (calledTileIndex !== undefined) view.calledTileIndex = calledTileIndex;
  }
  return view;
}

function applyCountHint(snapshot: MutableSnapshot, event: Record<string, unknown>): void {
  const hint = objectValue(event.presentation);
  if (Array.isArray(hint?.concealedTileCountByPlayer)) {
    const counts = hint.concealedTileCountByPlayer as unknown[];
    snapshot.handCounts = Array.from({ length: 4 }, (_, index) => numberValue(counts[index]));
  }
  const actor = playerIndex(event.actor);
  if (actor === undefined) return;
  if (typeof hint?.handCountDelta === "number") {
    snapshot.handCounts[actor] = Math.max(0, (snapshot.handCounts[actor] ?? 0) + hint.handCountDelta);
  }
  if (typeof hint?.drawnTilePending === "boolean") snapshot.drawnTilePendingByPlayer[actor] = hint.drawnTilePending;
}

function updateMjai(snapshot: MutableSnapshot, event: Record<string, unknown>): void {
  const type = typeof event.type === "string" ? event.type : "unknown";
  const actor = playerIndex(event.actor);
  if (type === "start_kyoku") {
    const bakaze = typeof event.bakaze === "string" ? event.bakaze : "?";
    const kyoku = numberValue(event.kyoku, 0);
    snapshot.round = `${bakaze}${kyoku}`;
    snapshot.honba = numberValue(event.honba);
    snapshot.kyotaku = numberValue(event.kyotaku);
    snapshot.oya = playerIndex(event.oya) ?? null;
    snapshot.currentSeat = snapshot.oya;
    snapshot.scores = Array.isArray(event.scores) ? event.scores.map((value) => numberValue(value)) : [];
    snapshot.discards = Object.fromEntries(SEATS.map((seat) => [seat, []]));
    snapshot.melds = Object.fromEntries(SEATS.map((seat) => [seat, []]));
    snapshot.doraIndicators = typeof event.dora_marker === "string" ? [event.dora_marker] : [];
    snapshot.riichi = Object.fromEntries(SEATS.map((seat) => [seat, false]));
    snapshot.riversByPlayer = emptyRivers();
    snapshot.meldsByPlayer = emptyMelds();
    snapshot.riichiByPlayer = [false, false, false, false];
    snapshot.pendingRiichiPlayer = null;
    snapshot.latestDiscard = null;
    snapshot.drawnTilePendingByPlayer = [false, false, false, false];
    applyCountHint(snapshot, event);
  } else if (type === "dahai" && actor !== undefined && typeof event.pai === "string") {
    const seat = SEATS[actor]!;
    const river = snapshot.riversByPlayer[actor] ?? [];
    const discard: RiverTileView = {
      tile: event.pai,
      tsumogiri: event.tsumogiri === true,
      riichi: snapshot.pendingRiichiPlayer === actor,
    };
    river.push(discard);
    snapshot.riversByPlayer[actor] = river;
    snapshot.discards[seat]?.push(event.pai);
    snapshot.latestDiscard = { playerIndex: actor, riverIndex: river.length - 1 };
    snapshot.pendingRiichiPlayer = null;
    snapshot.currentSeat = actor;
    applyCountHint(snapshot, event);
  } else if (["chi", "pon", "daiminkan", "ankan", "kakan"].includes(type) && actor !== undefined) {
    const seat = SEATS[actor]!;
    const view = meldView(event, actor);
    if (view) {
      const melds = snapshot.meldsByPlayer[actor] ?? [];
      if (view.type === "kakan") {
        const addedTile = typeof event.pai === "string" ? event.pai : undefined;
        const addedKind = addedTile ? tileKind(addedTile) : undefined;
        const existing = addedKind === undefined ? undefined : melds.find((meld) => meld.type === "pon" && meld.tiles.some((tile) => tileKind(tile) === addedKind));
        if (existing && addedTile) {
          existing.type = "kakan";
          existing.tiles = [...existing.tiles, addedTile];
        } else {
          melds.push(view);
        }
      } else {
        melds.push(view);
      }
      snapshot.meldsByPlayer[actor] = melds;
      snapshot.melds[seat]?.push(JSON.stringify(view));
    }
    snapshot.currentSeat = actor;
    applyCountHint(snapshot, event);
  } else if (type === "dora" && typeof event.dora_marker === "string") {
    snapshot.doraIndicators.push(event.dora_marker);
  } else if ((type === "reach" || type === "riichi") && actor !== undefined) {
    const seat = SEATS[actor]!;
    snapshot.riichi[seat] = true;
    snapshot.riichiByPlayer[actor] = true;
    snapshot.pendingRiichiPlayer = actor;
    snapshot.currentSeat = actor;
  } else if (type === "tsumo" && actor !== undefined) {
    snapshot.currentSeat = actor;
    applyCountHint(snapshot, event);
  }
  if (Array.isArray(event.scores)) snapshot.scores = event.scores.map((value) => numberValue(value));
  if (Array.isArray(event.new_scores)) snapshot.scores = event.new_scores.map((value) => numberValue(value));
  snapshot.recentEvents.push(clone(event));
  if (snapshot.recentEvents.length > RECENT_EVENT_LIMIT) snapshot.recentEvents.shift();
}

function removeDebugTile(hand: string[], tile: string): void {
  const exact = hand.indexOf(tile);
  if (exact >= 0) {
    hand.splice(exact, 1);
    return;
  }
  const kind = tileKind(tile);
  const equivalent = hand.findIndex((candidate) => tileKind(candidate) === kind);
  if (equivalent >= 0) hand.splice(equivalent, 1);
}

function updateDebugPrivate(snapshot: MutableSnapshot, event: Record<string, unknown>): void {
  const type = typeof event.type === "string" ? event.type : "unknown";
  const actor = playerIndex(event.actor);
  if (type === "start_kyoku" && Array.isArray(event.tehais)) {
    const tehais = event.tehais as unknown[];
    snapshot.debugHands = Array.from({ length: 4 }, (_, index) => Array.isArray(tehais[index])
      ? tehais[index].filter((tile): tile is string => typeof tile === "string")
      : undefined);
    snapshot.debugDrawnTiles = emptyPlayerValues<string | undefined>(undefined);
    snapshot.handCounts = snapshot.debugHands.map((hand) => hand?.length ?? 0);
    snapshot.drawnTilePendingByPlayer = [false, false, false, false];
    return;
  }
  if (actor === undefined) return;
  const hand = snapshot.debugHands[actor];
  if (!hand) return;
  if (type === "tsumo" && typeof event.pai === "string") {
    hand.push(event.pai);
    snapshot.debugDrawnTiles[actor] = event.pai;
  } else if (type === "dahai" && typeof event.pai === "string") {
    removeDebugTile(hand, event.pai);
    snapshot.debugDrawnTiles[actor] = undefined;
  } else if (["chi", "pon", "daiminkan", "ankan", "kakan"].includes(type)) {
    if (type === "kakan" && typeof event.pai === "string") {
      removeDebugTile(hand, event.pai);
    } else if (Array.isArray(event.consumed)) {
      for (const tile of event.consumed) if (typeof tile === "string") removeDebugTile(hand, tile);
    }
    snapshot.debugDrawnTiles[actor] = undefined;
  }
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

function applyPublicDecisionEnd(snapshot: MutableSnapshot, event: PublicLiveEvent & { type: "decision:end" }): void {
  if (event.agentId && !snapshot.agents[event.agentId]) snapshot.agents[event.agentId] = emptyAgent();
  const seat = seatKey(event.player);
  const view: LiveDecisionView = {
    ...(event.player !== undefined ? { player: event.player } : {}),
    ...(event.agentId ? { agentId: event.agentId } : {}),
    pending: false,
    actionType: event.actionType,
    appliedActionId: event.appliedActionId,
  };
  if (seat) snapshot.decisionsBySeat[seat] = view;
  snapshot.lastDecisions.unshift(view);
  snapshot.lastDecisions = snapshot.lastDecisions.slice(0, 20);
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
      snapshot.playerAgents = [...event.seats];
      snapshot.seatAgents = Object.fromEntries(event.seats.map((agentId, seat) => [SEATS[seat]!, agentId]));
      resetBoard(snapshot);
      break;
    case "mjai":
      updateMjai(snapshot, {
        ...event.event,
        ...(event.presentation ? { presentation: event.presentation } : {}),
      });
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
      applyPublicDecisionEnd(snapshot, event);
      break;
    case "game:end":
      snapshot.scores = [...event.scores];
      snapshot.ranks = [...event.ranks];
      snapshot.tournament.errorCount += event.errorCount;
      for (const player of event.players) {
        const aggregate = snapshot.agents[player.agentId] ?? emptyAgent();
        snapshot.agents[player.agentId] = aggregate;
        aggregate.completedGames += 1;
        aggregate.handCount += player.handCount;
        aggregate.wins += player.wins;
        aggregate.dealIns += player.dealIns;
        aggregate.riichi += player.riichi;
        aggregate.calls += player.calls;
      }
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
    updateDebugPrivate(snapshot, objectValue(mjai.event) ?? {});
    if (snapshot.debugState.rawEvents.length > RECENT_EVENT_LIMIT) snapshot.debugState.rawEvents.shift();
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

function tableView(source: MutableSnapshot, mode: LiveMode): TablePresentationState {
  const seats = {} as Record<PhysicalSeatPosition, TableSeatView>;
  for (let player = 0; player < 4; player += 1) {
    const position = POSITION_BY_PLAYER[player]!;
    const seat: TableSeatView = {
      playerIndex: player,
      position,
      agentId: source.playerAgents[player] ?? source.seatAgents[SEATS[player]!] ?? "—",
      currentWind: windForPlayer(player, source.oya),
      isDealer: source.oya === player,
      score: source.scores[player] ?? 0,
      ...(source.ranks[player] !== undefined ? { rank: source.ranks[player] } : {}),
      concealedTileCount: source.handCounts[player] ?? 0,
      drawnTilePending: source.drawnTilePendingByPlayer[player] ?? false,
      river: clone(source.riversByPlayer[player] ?? []),
      melds: clone(source.meldsByPlayer[player] ?? []),
      riichi: source.riichiByPlayer[player] ?? false,
    };
    if (mode === "debug") {
      const hand = source.debugHands[player];
      if (hand) seat.debugHand = [...hand];
      const drawnTile = source.debugDrawnTiles[player];
      if (drawnTile) seat.debugDrawnTile = drawnTile;
    }
    seats[position] = seat;
  }
  return {
    presentationVersion: PRESENTATION_VERSION,
    seats,
    pendingRiichiPlayer: source.pendingRiichiPlayer,
    latestDiscard: source.latestDiscard ? { ...source.latestDiscard } : null,
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
    applyDebugEvent(this.debugState, batch.debugEvent);
  }

  checkpoint(): SnapshotCheckpoint {
    return {
      presentationVersion: PRESENTATION_VERSION,
      spectator: this.getSnapshot("spectator"),
      debug: this.getSnapshot("debug"),
      latencyValuesByAgent: Object.fromEntries(
        Object.entries(this.debugState.agents).map(([agentId, aggregate]) => [agentId, [...aggregate.latencyValues]]),
      ),
    };
  }

  restore(checkpoint: SnapshotCheckpoint): boolean {
    if (checkpoint.presentationVersion !== PRESENTATION_VERSION) return false;
    if (checkpoint.spectator.streamId !== this.streamId || checkpoint.debug.streamId !== this.streamId) {
      throw new Error("snapshot checkpoint stream ID mismatch");
    }
    restoreMutableSnapshot(this.publicState, checkpoint.spectator, checkpoint.latencyValuesByAgent);
    restoreMutableSnapshot(this.debugState, checkpoint.debug, checkpoint.latencyValuesByAgent);
    return true;
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
      presentationVersion: PRESENTATION_VERSION,
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
      table: tableView(source, mode),
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
  const tableSeats = source.table?.seats ?? {};
  const playerAgents = Array.from({ length: 4 }, (_, index) => {
    const position = POSITION_BY_PLAYER[index]!;
    return tableSeats[position]?.agentId ?? source.seatAgents[SEATS[index]!] ?? "";
  });
  const handCounts = Array.from({ length: 4 }, (_, index) => tableSeats[POSITION_BY_PLAYER[index]!]?.concealedTileCount ?? 0);
  const drawnTilePendingByPlayer = Array.from({ length: 4 }, (_, index) => tableSeats[POSITION_BY_PLAYER[index]!]?.drawnTilePending ?? false);
  const riversByPlayer = Array.from({ length: 4 }, (_, index) => clone(tableSeats[POSITION_BY_PLAYER[index]!]?.river ?? []));
  const meldsByPlayer = Array.from({ length: 4 }, (_, index) => clone(tableSeats[POSITION_BY_PLAYER[index]!]?.melds ?? []));
  const riichiByPlayer = Array.from({ length: 4 }, (_, index) => tableSeats[POSITION_BY_PLAYER[index]!]?.riichi ?? false);
  const debugHands = Array.from({ length: 4 }, (_, index) => {
    const hand = tableSeats[POSITION_BY_PLAYER[index]!]?.debugHand;
    return hand ? [...hand] : undefined;
  });
  const debugDrawnTiles = Array.from({ length: 4 }, (_, index) => tableSeats[POSITION_BY_PLAYER[index]!]?.debugDrawnTile);
  Object.assign(target, {
    schemaVersion: 1,
    presentationVersion: PRESENTATION_VERSION,
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
    table: clone(source.table),
    playerAgents,
    handCounts,
    drawnTilePendingByPlayer,
    riversByPlayer,
    meldsByPlayer,
    riichiByPlayer,
    pendingRiichiPlayer: source.table?.pendingRiichiPlayer ?? null,
    latestDiscard: source.table?.latestDiscard ? { ...source.table.latestDiscard } : null,
    debugHands,
    debugDrawnTiles,
    debugState: clone(debugState),
  });
}
