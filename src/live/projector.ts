import type {
  DebugLiveEvent,
  LiveEventBatch,
  LiveEventBase,
  PublicLiveEvent,
  TournamentEvent,
} from "./events.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function baseOf(event: LiveEventBase): LiveEventBase {
  const base: LiveEventBase = { schemaVersion: event.schemaVersion };
  if (event.gameId !== undefined) base.gameId = event.gameId;
  if (event.pairId !== undefined) base.pairId = event.pairId;
  if (event.rotationIndex !== undefined) base.rotationIndex = event.rotationIndex;
  if (event.handIndex !== undefined) base.handIndex = event.handIndex;
  if (event.turnIndex !== undefined) base.turnIndex = event.turnIndex;
  if (event.player !== undefined) base.player = event.player;
  if (event.agentId !== undefined) base.agentId = event.agentId;
  return base;
}

const MJAI_PUBLIC_KEYS: Record<string, readonly string[]> = {
  start_game: ["type"],
  start_kyoku: ["type", "bakaze", "kyoku", "honba", "kyotaku", "oya", "dora_marker", "scores"],
  tsumo: ["type", "actor"],
  dahai: ["type", "actor", "pai", "tsumogiri"],
  chi: ["type", "actor", "target", "pai", "consumed"],
  pon: ["type", "actor", "target", "pai", "consumed"],
  daiminkan: ["type", "actor", "target", "pai", "consumed"],
  ankan: ["type", "actor", "consumed"],
  kakan: ["type", "actor", "pai", "consumed"],
  reach: ["type", "actor"],
  hora: ["type", "actor", "target", "pai"],
  ryukyoku: ["type", "actor", "reason", "scores"],
  dora: ["type", "dora_marker"],
  end_kyoku: ["type", "scores"],
  end_game: ["type", "scores"],
  none: ["type", "actor"],
};

/**
 * Rebuild an MJAI event from an explicit public allowlist.  In particular,
 * `start_kyoku.tehais` and `tsumo.pai` are never copied to the spectator
 * stream.  Unknown event types intentionally degrade to `{type}`.
 */
export function projectPublicMjai(value: unknown): Record<string, unknown> {
  const raw = typeof value === "string"
    ? (() => {
      try { return JSON.parse(value) as unknown; } catch { return undefined; }
    })()
    : value;
  const source = objectValue(raw);
  const type = typeof source?.type === "string" ? source.type : "unknown";
  const keys = MJAI_PUBLIC_KEYS[type];
  if (!keys) return { type };
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (!source || !(key in source)) continue;
    // This is defensive in addition to the per-type allowlist: an accidental
    // future addition to the tsumo key list must not reveal the drawn tile.
    if (type === "tsumo" && key === "pai") continue;
    result[key] = clone(source[key]);
  }
  return result;
}

function debugEvent(event: TournamentEvent): DebugLiveEvent {
  return clone(event) as DebugLiveEvent;
}

function publicEvent(event: TournamentEvent): PublicLiveEvent {
  const base = baseOf(event);
  switch (event.type) {
    case "tournament:start":
      return {
        ...base,
        type: "tournament:start",
        totalGames: event.totalGames,
        settings: clone(event.settings),
      };
    case "tournament:progress":
      return {
        ...base,
        type: "tournament:progress",
        completedGames: event.completedGames,
        totalGames: event.totalGames,
      };
    case "game:start":
      return {
        ...base,
        type: "game:start",
        seed: event.seed,
        baseSeed: event.baseSeed,
        seats: [...event.seats],
        gameIndex: event.gameIndex,
        totalGames: event.totalGames,
      };
    case "mjai": {
      const presentation = publicMjaiPresentationHint(event.event);
      return {
        ...base,
        type: "mjai",
        source: "bridge",
        event: projectPublicMjai(event.event),
        ...(presentation ? { presentation } : {}),
      };
    }
    case "decision:start":
      return { ...base, type: "decision:start" };
    case "decision:end": {
      const actionType = typeof event.appliedAction.type === "string" ? event.appliedAction.type : "unknown";
      return {
        ...base,
        type: "decision:end",
        appliedActionId: event.appliedActionId,
        actionType,
      };
    }
    case "game:end":
      return {
        ...base,
        type: "game:end",
        scores: [...event.scores],
        ranks: [...event.ranks],
        handCount: event.handCount,
        errorCount: event.errorCount,
        players: event.result.players.map((player) => ({
          agentId: player.agentId,
          handCount: player.handCount,
          wins: player.wins,
          dealIns: player.dealIns,
          riichi: player.riichi,
          calls: player.calls,
        })),
      };
    case "tournament:end":
      return {
        ...base,
        type: "tournament:end",
        completedGames: event.completedGames,
        totalGames: event.totalGames,
        errorCount: event.errorCount,
      };
    case "tournament:error":
      return {
        ...base,
        type: "tournament:error",
        message: event.message,
        completedGames: event.completedGames,
        totalGames: event.totalGames,
      };
  }
}

function publicMjaiPresentationHint(value: unknown): {
  concealedTileCountByPlayer?: number[];
  handCountDelta?: number;
  drawnTilePending?: boolean;
  tsumogiri?: boolean;
} | undefined {
  const raw = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  const type = typeof raw?.type === "string" ? raw.type : undefined;
  if (!type) return undefined;
  if (type === "start_kyoku" && Array.isArray(raw?.tehais)) {
    return {
      concealedTileCountByPlayer: raw.tehais.map((hand) => Array.isArray(hand) ? hand.length : 0),
      drawnTilePending: false,
    };
  }
  if (typeof raw?.actor !== "number" || !Number.isInteger(raw.actor) || raw.actor < 0 || raw.actor > 3) return undefined;
  if (type === "tsumo") return { handCountDelta: 1, drawnTilePending: true };
  if (type === "dahai") return {
    handCountDelta: -1,
    drawnTilePending: false,
    tsumogiri: raw.tsumogiri === true,
  };
  if (["chi", "pon", "daiminkan", "ankan", "kakan"].includes(type)) {
    const handCountDelta = type === "chi" || type === "pon"
      ? -2
      : type === "daiminkan"
        ? -3
        : type === "ankan"
          ? -4
          : -1;
    return {
      handCountDelta,
      drawnTilePending: false,
    };
  }
  return undefined;
}

export function projectTournamentEvent(event: TournamentEvent): {
  publicEvent: PublicLiveEvent;
  debugEvent: DebugLiveEvent;
} {
  // Both projections are made independently.  A subscriber or reducer can
  // mutate either result without changing the other projection or the runner.
  return {
    publicEvent: publicEvent(clone(event)),
    debugEvent: debugEvent(clone(event)),
  };
}

export function createLiveEventBatch(
  streamId: string,
  id: number,
  emittedAt: string,
  event: TournamentEvent,
): LiveEventBatch {
  const projections = projectTournamentEvent(event);
  return {
    streamId,
    id,
    emittedAt,
    publicEvent: projections.publicEvent,
    debugEvent: projections.debugEvent,
  };
}
