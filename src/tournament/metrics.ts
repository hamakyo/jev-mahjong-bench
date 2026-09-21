import type {
  ConfidenceInterval,
  GameDecisionRecord,
  PairwiseComparison,
  TournamentAgentSummary,
  TournamentGameResult,
} from "../types.js";

const Z95 = 1.96;
const STUDENT_T_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
  2.040, 2.037, 2.034, 2.032, 2.030, 2.028, 2.026, 2.024, 2.023, 2.021,
] as const;

export interface TournamentMetrics {
  agents: TournamentAgentSummary[];
  pairwise: PairwiseComparison[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return lower === upper ? low : low + (high - low) * (position - lower);
}

function studentTCritical(degreesOfFreedom: number): number {
  if (degreesOfFreedom <= STUDENT_T_95.length) return STUDENT_T_95[degreesOfFreedom - 1]!;
  if (degreesOfFreedom <= 60) return 2.021;
  if (degreesOfFreedom <= 120) return 2.000;
  return 1.98;
}

function studentInterval(values: number[]): ConfidenceInterval | undefined {
  if (values.length < 2) return undefined;
  const estimate = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - estimate) ** 2, 0) / (values.length - 1);
  const standardDeviation = Math.sqrt(variance);
  const standardError = standardDeviation / Math.sqrt(values.length);
  const critical = studentTCritical(values.length - 1);
  return {
    estimate,
    lower: estimate - critical * standardError,
    upper: estimate + critical * standardError,
    level: 0.95,
    sampleCount: values.length,
    standardDeviation,
    standardError,
    method: "student-t",
  };
}

export function wilsonInterval(successes: number, trials: number): ConfidenceInterval | undefined {
  if (trials < 1) return undefined;
  const estimate = successes / trials;
  const denominator = 1 + (Z95 ** 2) / trials;
  const center = (estimate + (Z95 ** 2) / (2 * trials)) / denominator;
  const margin = (Z95 / denominator) * Math.sqrt(
    (estimate * (1 - estimate) / trials) + (Z95 ** 2) / (4 * trials ** 2),
  );
  return {
    estimate,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    level: 0.95,
    sampleCount: trials,
    successes,
    trials,
    method: "wilson",
  };
}

function blockMeans(games: TournamentGameResult[], agentId: string, field: "score" | "rank"): number[] {
  const grouped = new Map<string, number[]>();
  for (const game of games) {
    const playerValues = game.players.filter((player) => player.agentId === agentId).map((player) => player[field]);
    if (!playerValues.length) continue;
    const values = grouped.get(game.pairId) ?? [];
    values.push(mean(playerValues));
    grouped.set(game.pairId, values);
  }
  return [...grouped.values()].map((values) => mean(values));
}

function summaryFor(agentId: string, games: TournamentGameResult[]): TournamentAgentSummary {
  const players = games.flatMap((game) => game.players.filter((player) => player.agentId === agentId));
  const decisionCount = players.reduce((sum, player) => sum + player.decisions, 0);
  const hands = players.reduce((sum, player) => sum + player.handCount, 0);
  const gameCount = players.length;
  const scoreValues = players.map((player) => player.score);
  const rankValues = players.map((player) => player.rank);
  const latencyValues = players.flatMap((player) => player.latenciesMs);
  const inputByteValues = players.flatMap((player) => player.decisionInputBytes);
  const wins = players.reduce((sum, player) => sum + player.wins, 0);
  const dealIns = players.reduce((sum, player) => sum + player.dealIns, 0);
  const riichi = players.reduce((sum, player) => sum + player.riichi, 0);
  const calls = players.reduce((sum, player) => sum + player.calls, 0);
  const legal = players.reduce((sum, player) => sum + player.legalDecisions, 0);
  const fallbackCount = players.reduce((sum, player) => sum + player.fallbackCount, 0);
  const errorCount = players.reduce((sum, player) => sum + player.errorCount, 0);
  const inputTokens = players.reduce((sum, player) => sum + player.inputTokens, 0);
  const outputTokens = players.reduce((sum, player) => sum + player.outputTokens, 0);
  const escalationCount = players.reduce((sum, player) => sum + player.escalationCount, 0);
  const retryCount = players.reduce((sum, player) => sum + player.retryCount, 0);
  const jevFallbackCount = players.reduce((sum, player) => sum + player.jevFallbackCount, 0);
  const jevInputTokens = players.reduce((sum, player) => sum + player.jevInputTokens, 0);
  const jevOutputTokens = players.reduce((sum, player) => sum + player.jevOutputTokens, 0);
  const gptInputTokens = players.reduce((sum, player) => sum + player.gptInputTokens, 0);
  const gptOutputTokens = players.reduce((sum, player) => sum + player.gptOutputTokens, 0);
  const gptRetryCount = players.reduce((sum, player) => sum + player.gptRetryCount, 0);
  const scoreBlocks = blockMeans(games, agentId, "score");
  const rankBlocks = blockMeans(games, agentId, "rank");
  const enoughPairsForIntervals = scoreBlocks.length >= 2 && rankBlocks.length >= 2;
  const first = players.filter((player) => player.rank === 1).length;
  const fourth = players.filter((player) => player.rank === 4).length;
  const scoreInterval = studentInterval(scoreBlocks);
  const rankInterval = studentInterval(rankBlocks);
  const firstRateInterval = enoughPairsForIntervals ? wilsonInterval(first, gameCount) : undefined;
  const fourthRateInterval = enoughPairsForIntervals ? wilsonInterval(fourth, gameCount) : undefined;
  const winRateInterval = enoughPairsForIntervals ? wilsonInterval(wins, hands) : undefined;
  const dealInRateInterval = enoughPairsForIntervals ? wilsonInterval(dealIns, hands) : undefined;
  const riichiRateInterval = enoughPairsForIntervals ? wilsonInterval(riichi, hands) : undefined;
  const callRateInterval = enoughPairsForIntervals ? wilsonInterval(calls, hands) : undefined;
  const result: TournamentAgentSummary = {
    agentId,
    games: gameCount,
    hands,
    decisions: decisionCount,
    legalDecisions: legal,
    meanScore: mean(scoreValues),
    meanRank: mean(rankValues),
    firstRate: gameCount ? first / gameCount : 0,
    fourthRate: gameCount ? fourth / gameCount : 0,
    winRate: hands ? wins / hands : 0,
    dealInRate: hands ? dealIns / hands : 0,
    riichiRate: hands ? riichi / hands : 0,
    callRate: hands ? calls / hands : 0,
    decisionsPerGame: gameCount ? decisionCount / gameCount : 0,
    meanLatencyMs: mean(latencyValues),
    p50LatencyMs: percentile(latencyValues, 0.5),
    p95LatencyMs: percentile(latencyValues, 0.95),
    meanInputBytes: mean(inputByteValues),
    maxInputBytes: inputByteValues.length ? Math.max(...inputByteValues) : 0,
    escalationCount,
    escalationRate: decisionCount ? escalationCount / decisionCount : 0,
    retryCount,
    jevFallbackCount,
    jevInputTokens,
    jevOutputTokens,
    gptInputTokens,
    gptOutputTokens,
    gptRetryCount,
    inputTokens,
    outputTokens,
    inputTokensPerGame: gameCount ? inputTokens / gameCount : 0,
    outputTokensPerGame: gameCount ? outputTokens / gameCount : 0,
    inputTokensPerDecision: decisionCount ? inputTokens / decisionCount : 0,
    outputTokensPerDecision: decisionCount ? outputTokens / decisionCount : 0,
    fallbackCount,
    errorCount,
    fallbackRate: decisionCount ? fallbackCount / decisionCount : 0,
    errorRate: decisionCount ? errorCount / decisionCount : 0,
    ...(scoreInterval ? { scoreInterval } : {}),
    ...(rankInterval ? { rankInterval } : {}),
    ...(firstRateInterval ? { firstRateInterval } : {}),
    ...(fourthRateInterval ? { fourthRateInterval } : {}),
    ...(winRateInterval ? { winRateInterval } : {}),
    ...(dealInRateInterval ? { dealInRateInterval } : {}),
    ...(riichiRateInterval ? { riichiRateInterval } : {}),
    ...(callRateInterval ? { callRateInterval } : {}),
  };
  return result;
}

function pairValues(games: TournamentGameResult[], leftAgentId: string, rightAgentId: string, field: "score" | "rank"): number[] {
  const grouped = new Map<string, { left: number[]; right: number[] }>();
  for (const game of games) {
    const left = game.players.filter((player) => player.agentId === leftAgentId).map((player) => player[field]);
    const right = game.players.filter((player) => player.agentId === rightAgentId).map((player) => player[field]);
    if (!left.length || !right.length) continue;
    const current = grouped.get(game.pairId) ?? { left: [], right: [] };
    current.left.push(mean(left));
    current.right.push(mean(right));
    grouped.set(game.pairId, current);
  }
  return [...grouped.values()].map((value) => mean(value.left) - mean(value.right));
}

export function aggregateTournament(games: TournamentGameResult[], _records: GameDecisionRecord[] = []): TournamentMetrics {
  const agentIds = [...new Set(games.flatMap((game) => game.players.map((player) => player.agentId)))].sort();
  const agents = agentIds.map((agentId) => summaryFor(agentId, games));
  const pairwise: PairwiseComparison[] = [];
  for (let leftIndex = 0; leftIndex < agentIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < agentIds.length; rightIndex += 1) {
      const leftAgentId = agentIds[leftIndex]!;
      const rightAgentId = agentIds[rightIndex]!;
      const scoreDifferences = pairValues(games, leftAgentId, rightAgentId, "score");
      const rankDifferences = pairValues(games, leftAgentId, rightAgentId, "rank");
      const scoreDifferenceInterval = studentInterval(scoreDifferences);
      const rankDifferenceInterval = studentInterval(rankDifferences);
      pairwise.push({
        leftAgentId,
        rightAgentId,
        pairs: Math.min(scoreDifferences.length, rankDifferences.length),
        meanScoreDifference: mean(scoreDifferences),
        meanRankDifference: mean(rankDifferences),
        ...(scoreDifferenceInterval ? { scoreDifferenceInterval } : {}),
        ...(rankDifferenceInterval ? { rankDifferenceInterval } : {}),
      });
    }
  }
  return { agents, pairwise };
}

function estimateIntervalText(estimate: number, interval: ConfidenceInterval | undefined, digits = 1): string {
  if (!interval) return `${estimate.toFixed(digits)} [—]`;
  return `${estimate.toFixed(digits)} [${interval.lower.toFixed(digits)}, ${interval.upper.toFixed(digits)}]`;
}

function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }

export function renderTournamentMarkdown(metrics: TournamentMetrics): string {
  const rows = metrics.agents.map((agent) =>
    `| ${agent.agentId} | ${agent.games} | ${estimateIntervalText(agent.meanScore, agent.scoreInterval)} | ${estimateIntervalText(agent.meanRank, agent.rankInterval)} | ${percent(agent.firstRate)} | ${percent(agent.fourthRate)} | ${percent(agent.winRate)} | ${percent(agent.dealInRate)} | ${percent(agent.riichiRate)} | ${percent(agent.callRate)} | ${agent.decisions} | ${agent.p50LatencyMs.toFixed(1)} / ${agent.p95LatencyMs.toFixed(1)} | ${agent.meanInputBytes.toFixed(0)} / ${agent.maxInputBytes} | ${percent(agent.escalationRate)} | ${percent(agent.fallbackRate)} | ${percent(agent.errorRate)} | ${agent.retryCount} | ${agent.jevInputTokens} / ${agent.jevOutputTokens} | ${agent.gptInputTokens} / ${agent.gptOutputTokens} | ${agent.inputTokens} / ${agent.outputTokens} |`);
  const pairRows = metrics.pairwise.map((pair) =>
    `| ${pair.leftAgentId} − ${pair.rightAgentId} | ${pair.pairs} | ${estimateIntervalText(pair.meanScoreDifference, pair.scoreDifferenceInterval)} | ${estimateIntervalText(pair.meanRankDifference, pair.rankDifferenceInterval)} |`);
  return `# Tournament report

Score/rank columns show pair-block mean and 95% interval. Rates are Wilson 95% intervals in JSON.

| Agent | Games | Score mean [95% CI] | Rank mean [95% CI] | 1st | 4th | Win | Deal-in | Riichi | Call | Decisions | p50 / p95 ms | Input bytes avg / max | Escalation | Fallback | Error | Retries | Jev in / out | GPT in / out | Total in / out |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

## Pairwise differences

| Left − right | Pairs | Score difference [95% CI] | Rank difference [95% CI] |
| --- | ---: | ---: | ---: |
${pairRows.length ? pairRows.join("\n") : "—"}
`;
}
