import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSummary, DecisionRecord } from "../types.js";

const pct = (v?: number) => v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;
const num = (v?: number, d = 1) => v === undefined ? "—" : v.toFixed(d);

export function renderMarkdown(summaries: AgentSummary[]): string {
  const rows = summaries.map((s) =>
    `| ${s.agentId} | ${s.decisions} | ${pct(s.successRate)} | ${pct(s.legalActionRate)} | ${pct(s.exactMatchRate)} | ${num(s.meanLatencyMs)} | ${num(s.p50LatencyMs)} | ${num(s.p95LatencyMs)} | ${num(s.averageConfidence, 3)} | ${num(s.referenceEce, 3)} | ${num(s.brierScore, 3)} | ${s.inputTokens} / ${s.outputTokens} |`);
  return `# Benchmark report

| Agent | N | Success | Legal | Ref match | Mean ms | p50 ms | p95 ms | Avg conf | Ref ECE | Brier | Tokens in/out |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

> Reference match is agreement with the dataset's \`referenceAction\`, not absolute mahjong accuracy.
`;
}

export async function writeReport(outDir: string, summaries: AgentSummary[], records: DecisionRecord[], metadata: Record<string, unknown>) {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(join(outDir, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), metadata, summaries, records }, null, 2) + "\n"),
    writeFile(join(outDir, "report.md"), renderMarkdown(summaries)),
  ]);
}
