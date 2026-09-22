import type { TournamentEvent } from "../live/events.js";
import type { ReplayEventRecord, ReplayGameIndexEntry } from "./schema.js";

export interface ReplayNavigationDecision {
  index: number;
  gameId: string;
  handIndex: number;
  turnIndex: number;
  player?: number;
  agentId?: string;
  startSequence: number;
  endSequence?: number;
  snapshotSequence: number;
  handDecisionNumber: number;
  handDecisionCount: number;
  actionType?: string;
}

export interface ReplayNavigationHand {
  handIndex: number;
  startSequence: number;
  endSequence?: number;
  decisionIndices: number[];
  decisionCount: number;
}

export interface ReplayNavigationGame {
  gameId: string;
  startSequence: number;
  endSequence?: number;
  hands: ReplayNavigationHand[];
}

/**
 * Runtime-only replay index.  It is intentionally separate from ReplayIndex:
 * events.jsonl, checkpoints and the existing persisted index remain stable.
 */
export interface ReplayNavigationIndex {
  eventCount: number;
  games: ReplayNavigationGame[];
  decisions: ReplayNavigationDecision[];
}

export interface ReplaySelection {
  rawCursor: number;
  gameId: string | null;
  handIndex: number | null;
  decisionIndex: number | null;
  handDecisionNumber: number | null;
  handDecisionCount: number;
  player: number | null;
  agentId: string | null;
  actionType: string | null;
  hasPreviousDecision: boolean;
  hasNextDecision: boolean;
  hasPreviousHand: boolean;
  hasNextHand: boolean;
}

export interface ReplayDecisionDebugDetails {
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
  diagnostics?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  legalActions: unknown[];
  observation?: Record<string, unknown>;
  rawEvents: Array<{ sequence: number; event: TournamentEvent }>;
}

export interface ReplaySelectionResult {
  selection: ReplaySelection;
  debug?: ReplayDecisionDebugDetails;
}

type MutableDecision = ReplayNavigationDecision;

interface MutableHand extends ReplayNavigationHand {
  decisions: MutableDecision[];
}

interface MutableGame extends ReplayNavigationGame {
  hands: MutableHand[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function eventGameId(event: TournamentEvent | undefined): string | undefined {
  return typeof event?.gameId === "string" ? event.gameId : undefined;
}

function innerMjaiType(event: TournamentEvent): string | undefined {
  if (event.type !== "mjai") return undefined;
  const value = objectValue(event.event)?.type;
  return typeof value === "string" ? value : undefined;
}

function decisionKey(event: TournamentEvent): string {
  return [
    event.gameId ?? "",
    event.turnIndex ?? "",
    event.player ?? "",
    event.agentId ?? "",
  ].join("\u0000");
}

function eventActionType(event: TournamentEvent | undefined): string | undefined {
  if (event?.type !== "decision:end") return undefined;
  const type = event.appliedAction?.type;
  return typeof type === "string" ? type : undefined;
}

function gameFromPersistedIndex(index: ReplayGameIndexEntry | undefined): MutableGame | undefined {
  if (!index) return undefined;
  return {
    gameId: index.gameId,
    startSequence: index.startSequence,
    ...(index.endSequence !== undefined ? { endSequence: index.endSequence } : {}),
    hands: index.hands.map((hand) => ({
      handIndex: hand.handIndex,
      startSequence: hand.startSequence,
      ...(hand.endSequence !== undefined ? { endSequence: hand.endSequence } : {}),
      decisionIndices: [],
      decisionCount: 0,
      decisions: [],
    })),
  };
}

function ensureGame(games: MutableGame[], event: TournamentEvent, sequence: number): MutableGame {
  const gameId = eventGameId(event) ?? "";
  const existing = games.find((game) => game.gameId === gameId && game.startSequence <= sequence);
  if (existing) return existing;
  const game: MutableGame = { gameId, startSequence: sequence, hands: [] };
  games.push(game);
  return game;
}

function ensureHand(game: MutableGame, handIndex: number, sequence: number): MutableHand {
  const existing = game.hands.find((hand) => hand.handIndex === handIndex);
  if (existing) return existing;
  const hand: MutableHand = {
    handIndex,
    startSequence: sequence,
    decisionIndices: [],
    decisionCount: 0,
    decisions: [],
  };
  game.hands.push(hand);
  game.hands.sort((left, right) => left.handIndex - right.handIndex || left.startSequence - right.startSequence);
  return hand;
}

function finalizeBatch(batch: MutableDecision[], lastMjaiSequence: number | undefined, fallbackSequence: number): void {
  if (!batch.length) return;
  const snapshotSequence = lastMjaiSequence ?? Math.max(...batch.map((decision) => decision.endSequence ?? decision.startSequence), fallbackSequence);
  for (const decision of batch) decision.snapshotSequence = snapshotSequence;
}

function publicDecision(decision: MutableDecision): ReplayNavigationDecision {
  return {
    index: decision.index,
    gameId: decision.gameId,
    handIndex: decision.handIndex,
    turnIndex: decision.turnIndex,
    ...(decision.player !== undefined ? { player: decision.player } : {}),
    ...(decision.agentId !== undefined ? { agentId: decision.agentId } : {}),
    startSequence: decision.startSequence,
    ...(decision.endSequence !== undefined ? { endSequence: decision.endSequence } : {}),
    snapshotSequence: decision.snapshotSequence,
    handDecisionNumber: decision.handDecisionNumber,
    handDecisionCount: decision.handDecisionCount,
    ...(decision.actionType !== undefined ? { actionType: decision.actionType } : {}),
  };
}

function handForSequence(index: ReplayNavigationIndex, sequence: number): ReplayNavigationHand | undefined {
  const games = index.games;
  for (const game of games) {
    const gameEnd = game.endSequence ?? index.eventCount;
    if (sequence < game.startSequence || sequence > gameEnd) continue;
    const hands = game.hands;
    for (const hand of hands) {
      const handEnd = hand.endSequence ?? gameEnd;
      if (hand.startSequence <= sequence && sequence <= handEnd) return hand;
    }
  }
  return undefined;
}

function gameForHand(index: ReplayNavigationIndex, hand: ReplayNavigationHand | undefined): ReplayNavigationGame | undefined {
  if (!hand) return undefined;
  return index.games.find((game) => game.hands.includes(hand));
}

export function buildReplayNavigationIndex(
  events: readonly ReplayEventRecord[],
  persistedIndex?: { games?: ReplayGameIndexEntry[] },
): ReplayNavigationIndex {
  const games: MutableGame[] = [];
  const persistedGames = persistedIndex?.games ?? [];
  let currentGame: MutableGame | undefined;
  let currentHand: MutableHand | undefined;
  let currentBatch: MutableDecision[] = [];
  let currentBatchKey: string | undefined;
  let lastMjaiSequence: number | undefined;
  const pending = new Map<string, MutableDecision[]>();
  const decisions: MutableDecision[] = [];

  for (const record of events) {
    const event = record.event;
    if (event.type === "game:start") {
      currentGame = gameFromPersistedIndex(persistedGames.find((game) => game.gameId === event.gameId))
        ?? ensureGame(games, event, record.sequence);
      // A persisted game entry may not carry a running hand boundary, but it
      // must still be part of the runtime index.
      if (!games.includes(currentGame)) games.push(currentGame);
      currentHand = undefined;
      currentBatch = [];
      currentBatchKey = undefined;
      lastMjaiSequence = undefined;
      continue;
    }

    if (!currentGame && (event.type === "decision:start" || event.type === "decision:end" || event.type === "mjai")) {
      currentGame = ensureGame(games, event, record.sequence);
    }
    if (event.type === "game:end") {
      finalizeBatch(currentBatch, lastMjaiSequence, record.sequence - 1);
      currentBatch = [];
      currentBatchKey = undefined;
      if (currentGame && event.gameId === currentGame.gameId) currentGame.endSequence = record.sequence;
      continue;
    }

    const innerType = innerMjaiType(event);
    if (innerType === "start_kyoku") {
      finalizeBatch(currentBatch, lastMjaiSequence, record.sequence - 1);
      currentBatch = [];
      currentBatchKey = undefined;
      const rawHandIndex = integer(event.handIndex);
      const persistedHand = currentGame!.hands.find((hand) => hand.startSequence === record.sequence);
      const inferredHandIndex = currentGame!.hands.filter((hand) => hand.startSequence < record.sequence).length;
      currentHand = ensureHand(currentGame!, rawHandIndex ?? persistedHand?.handIndex ?? inferredHandIndex, record.sequence);
      lastMjaiSequence = record.sequence;
      continue;
    }
    if (innerType === "end_kyoku") {
      lastMjaiSequence = record.sequence;
      if (currentHand) currentHand.endSequence = record.sequence;
      continue;
    }
    if (event.type === "decision:start") {
      // Every decision:start emitted by one Promise.all batch comes before the
      // corresponding decision:end events. A different turn closes the
      // preceding environment-step batch; same-turn starts stay together.
      const nextBatchKey = `${event.gameId ?? currentGame?.gameId ?? ""}\u0000${event.turnIndex ?? ""}`;
      if (currentBatch.length && currentBatchKey !== nextBatchKey) {
        finalizeBatch(currentBatch, lastMjaiSequence, record.sequence - 1);
        currentBatch = [];
        currentBatchKey = undefined;
        lastMjaiSequence = undefined;
      }
      if (!currentBatch.length) {
        currentBatchKey = nextBatchKey;
        lastMjaiSequence = undefined;
      }
      const handIndex = integer(event.handIndex) ?? currentHand?.handIndex ?? 0;
      if (!currentHand || currentHand.handIndex !== handIndex) currentHand = ensureHand(currentGame!, handIndex, record.sequence);
      const decision: MutableDecision = {
        index: decisions.length,
        gameId: event.gameId ?? currentGame?.gameId ?? "",
        handIndex,
        turnIndex: integer(event.turnIndex) ?? currentBatch.length,
        ...(event.player !== undefined ? { player: event.player } : {}),
        ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
        startSequence: record.sequence,
        snapshotSequence: record.sequence,
        handDecisionNumber: 0,
        handDecisionCount: 0,
      };
      decisions.push(decision);
      currentBatch.push(decision);
      currentHand.decisions.push(decision);
      pending.set(decisionKey(event), [...(pending.get(decisionKey(event)) ?? []), decision]);
      continue;
    }
    if (event.type === "decision:end") {
      const key = decisionKey(event);
      const queue = pending.get(key) ?? [];
      const decision = queue.shift();
      if (queue.length) pending.set(key, queue);
      else pending.delete(key);
      if (decision) {
        decision.endSequence = record.sequence;
        const actionType = eventActionType(event);
        if (actionType !== undefined) decision.actionType = actionType;
      } else {
        // Preserve a usable navigation entry even for a partially written
        // replay whose decision:start line was lost.
        if (!currentBatch.length) lastMjaiSequence = undefined;
        const handIndex = integer(event.handIndex) ?? currentHand?.handIndex ?? 0;
        const hand = currentHand ?? ensureHand(currentGame!, handIndex, record.sequence);
        const actionType = eventActionType(event);
        const orphan: MutableDecision = {
          index: decisions.length,
          gameId: event.gameId ?? currentGame?.gameId ?? "",
          handIndex,
          turnIndex: integer(event.turnIndex) ?? 0,
          ...(event.player !== undefined ? { player: event.player } : {}),
          ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
          startSequence: record.sequence,
          endSequence: record.sequence,
          snapshotSequence: record.sequence,
          handDecisionNumber: 0,
          handDecisionCount: 0,
          ...(actionType !== undefined ? { actionType } : {}),
        };
        decisions.push(orphan);
        currentBatch.push(orphan);
        hand.decisions.push(orphan);
      }
      continue;
    }
    if (event.type === "mjai") lastMjaiSequence = record.sequence;
  }
  finalizeBatch(currentBatch, lastMjaiSequence, events.at(-1)?.sequence ?? 0);

  for (const game of games) {
    for (const hand of game.hands) {
      hand.decisions.sort((left, right) => left.index - right.index);
      hand.decisionCount = hand.decisions.length;
      hand.decisionIndices = hand.decisions.map((decision) => decision.index);
      hand.decisions.forEach((decision, position) => {
        decision.handDecisionNumber = position + 1;
        decision.handDecisionCount = hand.decisionCount;
      });
    }
    game.hands.sort((left, right) => left.handIndex - right.handIndex || left.startSequence - right.startSequence);
  }

  return {
    eventCount: events.length,
    games: games
      .sort((left, right) => left.startSequence - right.startSequence)
      .map((game) => ({
        gameId: game.gameId,
        startSequence: game.startSequence,
        ...(game.endSequence !== undefined ? { endSequence: game.endSequence } : {}),
        hands: game.hands.map((hand) => ({
          handIndex: hand.handIndex,
          startSequence: hand.startSequence,
          ...(hand.endSequence !== undefined ? { endSequence: hand.endSequence } : {}),
          decisionIndices: [...hand.decisionIndices],
          decisionCount: hand.decisionCount,
        })),
      })),
    decisions: decisions.map(publicDecision),
  };
}

export function selectReplayDecision(
  index: ReplayNavigationIndex,
  cursor: number,
  requestedDecisionIndex?: number,
): ReplayNavigationDecision | undefined {
  if (requestedDecisionIndex !== undefined) return index.decisions[requestedDecisionIndex];
  return index.decisions
    .filter((decision) => decision.snapshotSequence <= cursor)
    .at(-1);
}

export function createReplaySelection(
  index: ReplayNavigationIndex,
  cursor: number,
  requestedDecisionIndex?: number,
): ReplaySelectionResult {
  const decision = selectReplayDecision(index, cursor, requestedDecisionIndex);
  const rawCursor = cursor;
  const decisionHand = decision
    ? index.games.flatMap((game) => game.hands).find((candidate) => candidate.decisionIndices.includes(decision.index))
    : undefined;
  const hand = handForSequence(index, rawCursor) ?? decisionHand;
  const game = gameForHand(index, hand);
  const decisionPosition = decision ? index.decisions.findIndex((candidate) => candidate.index === decision.index) : -1;
  const handPosition = game && hand ? game.hands.findIndex((candidate) => candidate.handIndex === hand.handIndex) : -1;
  const selection: ReplaySelection = {
    rawCursor,
    gameId: game?.gameId ?? decision?.gameId ?? null,
    handIndex: hand?.handIndex ?? decision?.handIndex ?? null,
    decisionIndex: decision?.index ?? null,
    handDecisionNumber: decision?.handDecisionNumber ?? null,
    handDecisionCount: decision?.handDecisionCount ?? hand?.decisionCount ?? 0,
    player: decision?.player ?? null,
    agentId: decision?.agentId ?? null,
    actionType: decision?.actionType ?? null,
    hasPreviousDecision: decisionPosition > 0,
    hasNextDecision: decisionPosition >= 0 && decisionPosition < index.decisions.length - 1,
    hasPreviousHand: handPosition > 0,
    hasNextHand: Boolean(game && handPosition >= 0 && handPosition < game.hands.length - 1),
  };
  return { selection };
}

export function debugDetailsForDecision(
  events: readonly ReplayEventRecord[],
  decision: ReplayNavigationDecision | undefined,
): ReplayDecisionDebugDetails | undefined {
  if (!decision) return undefined;
  const startRecord = events.find((record) => record.sequence === decision.startSequence);
  const endRecord = decision.endSequence === undefined
    ? undefined
    : events.find((record) => record.sequence === decision.endSequence);
  const start = startRecord?.event.type === "decision:start" ? startRecord.event : undefined;
  const end = endRecord?.event.type === "decision:end" ? endRecord.event : undefined;
  if (!start && !end) return undefined;
  return {
    ...(end?.requestedActionId ? { requestedActionId: end.requestedActionId } : {}),
    ...(end?.requestedAction ? { requestedAction: clone(end.requestedAction) } : {}),
    ...(end?.appliedActionId ? { appliedActionId: end.appliedActionId } : {}),
    ...(end?.appliedAction ? { appliedAction: clone(end.appliedAction) } : {}),
    ...(end?.isLegal !== undefined ? { isLegal: end.isLegal } : {}),
    ...(end?.fallbackReason ? { fallbackReason: end.fallbackReason } : {}),
    ...(end?.latencyMs !== undefined ? { latencyMs: end.latencyMs } : {}),
    ...(end?.inputTokens !== undefined ? { inputTokens: end.inputTokens } : {}),
    ...(end?.outputTokens !== undefined ? { outputTokens: end.outputTokens } : {}),
    ...(end?.retryCount !== undefined ? { retryCount: end.retryCount } : {}),
    ...(end?.error ? { error: end.error } : {}),
    ...(end?.diagnostics ? { diagnostics: clone(end.diagnostics) as unknown as Record<string, unknown> } : {}),
    ...(end?.metadata ? { metadata: clone(end.metadata) } : {}),
    legalActions: start?.observation.legalActions ? clone(start.observation.legalActions) : [],
    ...(start?.observation.state ? { observation: clone(start.observation.state) as Record<string, unknown> } : {}),
    rawEvents: events
      .filter((record) => record.sequence >= decision.startSequence && record.sequence <= decision.snapshotSequence)
      .map((record) => ({ sequence: record.sequence, event: clone(record.event) })),
  };
}
