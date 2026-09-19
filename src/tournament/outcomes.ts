export interface SeatOutcome {
  wins: number;
  dealIns: number;
  riichi: number;
  calls: number;
  rawEventCounts: Record<string, number>;
}

export interface GameOutcomes {
  handCount: number;
  eventCounts: Record<string, number>;
  seats: SeatOutcome[];
}

interface HandOutcome {
  winners: Set<number>;
  discarder?: number;
  riichi: Set<number>;
  calls: Set<number>;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function eventObject(event: unknown): Record<string, unknown> | undefined {
  if (typeof event === "string") {
    try { return objectValue(JSON.parse(event) as unknown); } catch { return undefined; }
  }
  return objectValue(event);
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Extract per-hand outcomes from a complete RiichiEnv MJAI event log. */
export function extractGameOutcomes(events: readonly unknown[]): GameOutcomes {
  const eventCounts: Record<string, number> = {};
  const rawBySeat = Array.from({ length: 4 }, () => ({} as Record<string, number>));
  const hands: HandOutcome[] = [];
  let current: HandOutcome | undefined;

  for (const raw of events) {
    const event = eventObject(raw);
    if (!event) continue;
    const type = event?.type;
    if (typeof type !== "string") continue;
    increment(eventCounts, type);
    const actor = typeof event.actor === "number" && Number.isInteger(event.actor) ? event.actor : undefined;
    if (actor !== undefined && actor >= 0 && actor < 4) increment(rawBySeat[actor]!, type);

    if (type === "start_kyoku") {
      current = { winners: new Set<number>(), riichi: new Set<number>(), calls: new Set<number>() };
      hands.push(current);
      continue;
    }
    if (!current) continue;
    if (type === "hora" && actor !== undefined && actor >= 0 && actor < 4) {
      current.winners.add(actor);
      const target = typeof event.target === "number" && Number.isInteger(event.target) ? event.target : undefined;
      if (target !== undefined && target >= 0 && target < 4 && target !== actor) current.discarder = target;
    } else if ((type === "reach" || type === "riichi") && actor !== undefined && actor >= 0 && actor < 4) {
      current.riichi.add(actor);
    } else if ((type === "chi" || type === "pon" || type === "daiminkan") && actor !== undefined && actor >= 0 && actor < 4) {
      current.calls.add(actor);
    }
  }

  const seats: SeatOutcome[] = Array.from({ length: 4 }, (_, seat) => ({
    wins: hands.filter((hand) => hand.winners.has(seat)).length,
    dealIns: hands.filter((hand) => hand.discarder === seat).length,
    riichi: hands.filter((hand) => hand.riichi.has(seat)).length,
    calls: hands.filter((hand) => hand.calls.has(seat)).length,
    rawEventCounts: rawBySeat[seat]!,
  }));
  return { handCount: hands.length, eventCounts, seats };
}
