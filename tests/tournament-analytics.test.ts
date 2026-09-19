import { describe, expect, it } from "vitest";
import { aggregateTournament, renderTournamentMarkdown, wilsonInterval } from "../src/tournament/metrics.js";
import { extractGameOutcomes } from "../src/tournament/outcomes.js";
import { buildTournamentSchedule } from "../src/tournament/run.js";
import type { SeatGameResult, TournamentGameResult } from "../src/types.js";

describe("paired tournament schedule", () => {
  it("runs every unique circular rotation with the same base seed", () => {
    const options = {
      seats: ["jev", "gpt", "mortal", "random"],
      pairedRuns: 2,
      mode: "4p-red-half",
      rule: "tenhou",
      seed: 42,
      seatPolicy: "rotate" as const,
      out: "results/test",
      timeoutMs: 100,
    };
    const schedule = buildTournamentSchedule(options);
    expect(schedule).toHaveLength(8);
    expect(schedule.slice(0, 4).map((game) => game.seed)).toEqual([42, 42, 42, 42]);
    expect(schedule.slice(4).map((game) => game.seed)).toEqual([43, 43, 43, 43]);
    expect(schedule.slice(0, 4).map((game) => game.rotationIndex)).toEqual([0, 1, 2, 3]);
    expect(new Set(schedule.map((game) => game.gameId)).size).toBe(8);
    expect(buildTournamentSchedule(options).map((game) => game.gameId)).toEqual(schedule.map((game) => game.gameId));
  });

  it("does not repeat identical rotations for duplicate agents", () => {
    const schedule = buildTournamentSchedule({
      seats: ["random", "random", "random", "random"],
      pairedRuns: 3,
      mode: "4p-red-east",
      rule: "tenhou",
      seed: 0,
      seatPolicy: "rotate" as const,
      out: "results/test",
      timeoutMs: 100,
    });
    expect(schedule).toHaveLength(3);
    expect(new Set(schedule.map((game) => game.seats.join(","))).size).toBe(1);
  });

  it("rejects games and paired-runs together", () => {
    expect(() => buildTournamentSchedule({
      seats: ["random", "random", "random", "random"],
      games: 1,
      pairedRuns: 1,
      mode: "4p-red-east",
      rule: "tenhou",
      seed: 0,
      seatPolicy: "rotate" as const,
      out: "results/test",
      timeoutMs: 100,
    })).toThrow(/mutually exclusive/);
  });
});

describe("MJAI tournament outcomes", () => {
  it("counts double ron once per winner and once for the discarder", () => {
    const outcomes = extractGameOutcomes([
      { type: "start_kyoku", oya: 0 },
      { type: "reach", actor: 2 },
      { type: "chi", actor: 1, target: 0 },
      { type: "hora", actor: 0, target: 2 },
      { type: "hora", actor: 3, target: 2 },
      { type: "start_kyoku", oya: 1 },
      { type: "pon", actor: 2, target: 1 },
      { type: "ankan", actor: 2 },
      { type: "kakan", actor: 2 },
      { type: "hora", actor: 2 },
      { type: "ryukyoku" },
    ]);
    expect(outcomes.handCount).toBe(2);
    expect(outcomes.seats[0]).toMatchObject({ wins: 1, dealIns: 0, calls: 0 });
    expect(outcomes.seats[1]).toMatchObject({ wins: 0, dealIns: 0, calls: 1 });
    expect(outcomes.seats[2]).toMatchObject({ wins: 1, dealIns: 1, riichi: 1, calls: 1 });
    expect(outcomes.seats[3]).toMatchObject({ wins: 1, dealIns: 0, calls: 0 });
    expect(outcomes.eventCounts).toMatchObject({ hora: 3, chi: 1, pon: 1, ankan: 1, kakan: 1, ryukyoku: 1 });
  });
});

function player(agentId: string, seat: number, score: number, rank: number): SeatGameResult {
  return {
    gameId: `game-${seat}`,
    seed: 0,
    pairId: "pair-test",
    baseSeed: 0,
    rotationIndex: seat,
    agentId,
    seat,
    score,
    rank,
    handCount: 2,
    wins: rank === 1 ? 1 : 0,
    dealIns: rank === 4 ? 1 : 0,
    riichi: 1,
    calls: 1,
    decisions: 10,
    legalDecisions: 10,
    fallbackCount: 0,
    errorCount: 0,
    latenciesMs: [10, 20],
    inputTokens: 100,
    outputTokens: 10,
    rawEventCounts: {},
  };
}

function game(pairId: string, index: number, aScore: number, bScore: number): TournamentGameResult {
  return {
    gameId: `game-${index}`,
    seed: index,
    baseSeed: index,
    pairId,
    rotationIndex: index,
    seats: ["a", "b", "random", "random"],
    scores: [aScore, bScore, 0, 0],
    ranks: [1, 2, 3, 4],
    handCount: 2,
    eventCounts: {},
    players: [player("a", 0, aScore, 1), player("b", 1, bScore, 2)],
    errorCount: 0,
  };
}

describe("tournament metrics", () => {
  it("computes pair-block confidence intervals and pairwise differences", () => {
    const metrics = aggregateTournament([
      game("pair-0", 0, 30_000, 20_000),
      game("pair-0", 1, 28_000, 22_000),
      game("pair-1", 2, 26_000, 24_000),
      game("pair-1", 3, 24_000, 26_000),
    ]);
    const scoreInterval = metrics.agents.find((agent) => agent.agentId === "a")?.scoreInterval;
    expect(scoreInterval).toMatchObject({ method: "student-t", standardError: 2_000 });
    expect(scoreInterval?.lower).toBeCloseTo(27_000 - (12.706 * 2_000), 6);
    expect(metrics.agents.find((agent) => agent.agentId === "a")?.winRateInterval).toBeDefined();
    expect(metrics.pairwise[0]).toMatchObject({ pairs: 2 });
    expect(metrics.pairwise[0]?.scoreDifferenceInterval).toBeDefined();
    expect(renderTournamentMarkdown(metrics)).toContain("Pairwise differences");
    expect(wilsonInterval(1, 2)?.method).toBe("wilson");
  });

  it("omits confidence intervals when there is only one pair", () => {
    const metrics = aggregateTournament([game("pair-0", 0, 30_000, 20_000)]);
    expect(metrics.agents[0]?.scoreInterval).toBeUndefined();
    expect(metrics.agents[0]?.winRateInterval).toBeUndefined();
    expect(metrics.pairwise[0]?.scoreDifferenceInterval).toBeUndefined();
  });
});
