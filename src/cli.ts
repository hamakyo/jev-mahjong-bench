import { resolve } from "node:path";
import { createAgents } from "./agents/registry.js";
import { loadDataset } from "./benchmark/dataset.js";
import { summarize } from "./benchmark/metrics.js";
import { writeReport } from "./benchmark/report.js";
import { runAgent } from "./benchmark/run.js";
import type { DecisionRecord } from "./types.js";

interface Options { agents: string[]; dataset: string; out: string; concurrency: number; seed: number; }

function args(argv: string[]): Options {
  const o: Options = { agents: ["random"], dataset: "datasets/sample.jsonl", out: "results/latest", concurrency: 1, seed: 42 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i], value = argv[i + 1];
    if (!flag?.startsWith("--")) continue;
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--agents") o.agents = value.split(",").map((x) => x.trim()).filter(Boolean);
    else if (flag === "--dataset") o.dataset = value;
    else if (flag === "--out") o.out = value;
    else if (flag === "--concurrency") o.concurrency = Number.parseInt(value, 10);
    else if (flag === "--seed") o.seed = Number.parseInt(value, 10);
    else throw new Error(`Unknown option: ${flag}`);
    i += 1;
  }
  if (!o.agents.length) throw new Error("At least one agent is required");
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) throw new Error("--concurrency must be a positive integer");
  if (!Number.isInteger(o.seed)) throw new Error("--seed must be an integer");
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const samples = await loadDataset(resolve(o.dataset));
  const agents = createAgents(o.agents, o.seed);
  const records: DecisionRecord[] = [];
  const summaries = [];

  for (const agent of agents) {
    console.log(`Running ${agent.id} on ${samples.length} states (concurrency=${o.concurrency})...`);
    const rs = await runAgent(agent, samples, o.concurrency);
    records.push(...rs);
    summaries.push(summarize(agent.id, rs));
  }

  const out = resolve(o.out);
  await writeReport(out, summaries, records, {
    dataset: o.dataset,
    sampleCount: samples.length,
    concurrency: o.concurrency,
    seed: o.seed,
    requestedAgents: o.agents,
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
    openaiReasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "none",
  });

  console.log(`Wrote ${out}/report.json and report.md`);
  for (const s of summaries) {
    const match = s.exactMatchRate === undefined ? "n/a" : `${(s.exactMatchRate * 100).toFixed(1)}%`;
    console.log(`${s.agentId}: match=${match}, p50=${s.p50LatencyMs.toFixed(1)}ms, p95=${s.p95LatencyMs.toFixed(1)}ms`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
