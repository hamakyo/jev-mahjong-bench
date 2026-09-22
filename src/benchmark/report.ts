import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSummary, DecisionRecord } from "../types.js";

const pct = (v?: number) => v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;
const num = (v?: number, d = 1) => v === undefined ? "—" : v.toFixed(d);

export interface ReferencePolicyCount {
  policy: string;
  samples: number;
}

export function renderMarkdown(
  summaries: AgentSummary[],
  referenceLabel = "Reference agreement",
  referencePolicies: ReferencePolicyCount[] = [],
): string {
  const rows = summaries.map((s) =>
    `| ${s.agentId} | ${s.decisions} | ${pct(s.successRate)} | ${pct(s.legalActionRate)} | ${pct(s.exactMatchRate)} | ${num(s.meanLatencyMs)} | ${num(s.p50LatencyMs)} | ${num(s.p95LatencyMs)} | ${num(s.averageConfidence, 3)} | ${num(s.referenceEce, 3)} | ${num(s.brierScore, 3)} | ${s.inputTokens} / ${s.outputTokens} | ${num(s.modelDecisionCount)} / ${num(s.usageReportedDecisionCount)} | ${num(s.inputTokensPerDecision)} / ${num(s.outputTokensPerDecision)} / ${num(s.totalTokensPerDecision)} | ${num(s.cachedInputTokensPerDecision)} / ${num(s.reasoningTokensPerDecision)} | ${num(s.canonicalInputBytesPerDecision, 0)} | ${num(s.costPerDecisionUsd, 6)} |`);
  const policySection = referencePolicies.length === 0 ? "" : `
## Reference policy breakdown

| Policy | Samples |
| --- | ---: |
${referencePolicies.map((item) => `| ${item.policy} | ${item.samples} |`).join("\n")}
`;
  return `# Benchmark report

| Agent | N | Success | Legal | ${referenceLabel} | Mean ms | p50 ms | p95 ms | Avg conf | Ref ECE | Brier | Tokens in/out | Calls / usage | In / out / total per decision | Cached / reasoning per decision | Canonical bytes/decision | Cost/decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

> ${referenceLabel} is agreement with the dataset's \`referenceAction\`, not absolute mahjong accuracy.
${policySection}`;
}

export async function writeReport(
  outDir: string,
  summaries: AgentSummary[],
  records: DecisionRecord[],
  metadata: Record<string, unknown>,
  referenceLabel = "Reference agreement",
  referencePolicies: ReferencePolicyCount[] = [],
) {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(join(outDir, "report.json"), JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), referenceLabel, referencePolicies, metadata, summaries, records }, null, 2) + "\n"),
    writeFile(join(outDir, "report.md"), renderMarkdown(summaries, referenceLabel, referencePolicies)),
  ]);
}
