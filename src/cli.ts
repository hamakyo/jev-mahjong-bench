import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgents } from "./agents/registry.js";
import { GptAgent } from "./agents/gpt.js";
import { JevAgent } from "./agents/jev.js";
import { loadMortalConfig } from "./agents/mortal.js";
import { loadDataset } from "./benchmark/dataset.js";
import { datasetStats, validateDataset, writeStats } from "./benchmark/dataset-tools.js";
import { evaluateHybridSweep, writeHybridSweep } from "./benchmark/hybrid-sweep.js";
import { addMortalReferences } from "./benchmark/reference-mortal.js";
import { summarize } from "./benchmark/metrics.js";
import { writeReport, type ReferencePolicyCount } from "./benchmark/report.js";
import { runAgent } from "./benchmark/run.js";
import { runTournament, type TournamentOptions } from "./tournament/run.js";
import type { DecisionRecord } from "./types.js";

interface Flags { [key: string]: string; }

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) throw new Error(`Unexpected argument: ${flag ?? ""}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    flags[flag.slice(2)] = value;
    index += 1;
  }
  return flags;
}

function integer(flags: Flags, name: string, fallback: number): number {
  const value = flags[name] === undefined ? fallback : Number.parseInt(flags[name]!, 10);
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function required(flags: Flags, name: string): string {
  const value = flags[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function runBench(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const agentsArg = flags.agents ?? "random";
  const agentNames = agentsArg.split(",").map((value) => value.trim()).filter(Boolean);
  if (!agentNames.length) throw new Error("At least one agent is required");
  const concurrency = integer(flags, "concurrency", 1);
  if (concurrency < 1) throw new Error("--concurrency must be a positive integer");
  const seed = integer(flags, "seed", 42);
  const datasetPath = resolve(flags.dataset ?? "datasets/sample.jsonl");
  const samples = await loadDataset(datasetPath);
  const mortalConfig = flags["mortal-config"] ? await loadMortalConfig(resolve(flags["mortal-config"]!)) : undefined;
  const effectiveConcurrency = agentNames.includes("mortal") ? 1 : concurrency;
  const hybridThreshold = flags["hybrid-threshold"] === undefined
    ? 0.75
    : Number.parseFloat(flags["hybrid-threshold"]!);
  if (!Number.isFinite(hybridThreshold) || hybridThreshold < 0 || hybridThreshold > 1) {
    throw new Error("--hybrid-threshold must be a finite number between 0 and 1");
  }
  const agents = createAgents(agentNames, seed, {
    hybridThreshold,
    ...(mortalConfig ? { mortalConfig } : {}),
  });
  const records: DecisionRecord[] = [];
  const summaries = [];
  try {
    for (const agent of agents) {
      console.log(`Running ${agent.id} on ${samples.length} states (concurrency=${effectiveConcurrency})...`);
      const rows = await runAgent(agent, samples, effectiveConcurrency);
      records.push(...rows);
      summaries.push(summarize(agent.id, rows));
    }
    const refs = samples.filter((sample) => sample.referenceAction !== undefined);
    const mortalOnly = refs.length > 0 && refs.every((sample) => sample.referenceMetadata?.name.toLowerCase().startsWith("mortal"));
    const referenceLabel = mortalOnly ? "Mortal agreement" : "Reference agreement";
    const policyCounts = new Map<string, number>();
    for (const sample of refs) {
      const policy = sample.referenceMetadata?.name ?? "unknown";
      policyCounts.set(policy, (policyCounts.get(policy) ?? 0) + 1);
    }
    const referencePolicies: ReferencePolicyCount[] = [...policyCounts.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([policy, sampleCount]) => ({ policy, samples: sampleCount }));
    const out = resolve(flags.out ?? "results/latest");
    await writeReport(out, summaries, records, {
      dataset: flags.dataset ?? "datasets/sample.jsonl",
      sampleCount: samples.length,
      concurrency: effectiveConcurrency,
      requestedConcurrency: concurrency,
      seed,
      requestedAgents: agentNames,
      referenceLabel,
      referencePolicies,
      openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      openaiReasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? "none",
    }, referenceLabel, referencePolicies);
    console.log(`Wrote ${out}/report.json and report.md`);
    for (const summary of summaries) {
      const match = summary.exactMatchRate === undefined ? "n/a" : `${(summary.exactMatchRate * 100).toFixed(1)}%`;
      console.log(`${summary.agentId}: match=${match}, p50=${summary.p50LatencyMs.toFixed(1)}ms, p95=${summary.p95LatencyMs.toFixed(1)}ms`);
    }
  } finally {
    await Promise.all(agents.map((agent) => agent.close?.()));
  }
}

function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

async function runPython(module: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("uv", ["run", "--project", projectRoot(), "python", "-m", module, ...args], {
      cwd: projectRoot(),
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${module} exited with code ${code ?? "unknown"}`)));
  });
}

async function runPythonJson(module: string, args: string[]): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolvePromise, reject) => {
    const child = spawn("uv", ["run", "--project", projectRoot(), "python", "-m", module, ...args], {
      cwd: projectRoot(),
      shell: false,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer | string) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${module} exited with code ${code ?? "unknown"}`));
        return;
      }
      try {
        const value: unknown = JSON.parse(output.trim());
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
        resolvePromise(value as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`${module} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

async function runDatasetImport(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const args = ["--input", required(flags, "input"), "--platform", required(flags, "platform"), "--out", required(flags, "out")];
  if (flags["game-id"]) args.push("--game-id", flags["game-id"]!);
  await runPython("jev_mahjong_bench.importer", args);
}

async function runDatasetValidate(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const dataset = resolve(required(flags, "dataset"));
  const summary = await validateDataset(dataset);
  const replay = await runPythonJson("jev_mahjong_bench.validator", ["--dataset", dataset]);
  console.log(JSON.stringify({ valid: true, ...summary, ...replay }));
}

async function runDatasetStats(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const stats = await datasetStats(resolve(required(flags, "dataset")));
  if (flags.out) {
    const output = resolve(flags.out);
    const target = output.toLowerCase().endsWith(".json") ? output : join(output, "stats.json");
    await mkdir(dirname(target), { recursive: true });
    await writeStats(target, stats);
  }
  console.log(JSON.stringify(stats, null, 2));
}

async function runReferenceMortal(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const result = await addMortalReferences(required(flags, "dataset"), required(flags, "out"), required(flags, "config"));
  console.log(JSON.stringify({ samples: result.samples, referenceMetadata: result.policy }, null, 2));
}

async function runHybridSweep(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const samples = await loadDataset(resolve(required(flags, "dataset")));
  const thresholds = required(flags, "thresholds").split(",").map((value) => Number.parseFloat(value.trim()));
  if (thresholds.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("--thresholds must be comma-separated finite numbers between 0 and 1");
  }
  const jev = new JevAgent();
  const gpt = new GptAgent();
  const result = await evaluateHybridSweep(samples, thresholds, { jev, gpt });
  await writeHybridSweep(resolve(required(flags, "out")), result);
  console.log(JSON.stringify({ thresholds: result.thresholds, samples: result.totalSamples, usage: result.usage }, null, 2));
}

async function runTournamentCommand(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const seats = required(flags, "seats").split(",").map((value) => value.trim()).filter(Boolean);
  const mortalConfig = flags["mortal-config"] ? await loadMortalConfig(resolve(flags["mortal-config"]!)) : undefined;
  const hasGames = flags.games !== undefined;
  const hasPairedRuns = flags["paired-runs"] !== undefined;
  if (hasGames && hasPairedRuns) throw new Error("--games and --paired-runs are mutually exclusive");
  const hybridThreshold = flags["hybrid-threshold"] === undefined
    ? 0.75
    : Number.parseFloat(flags["hybrid-threshold"]!);
  if (!Number.isFinite(hybridThreshold) || hybridThreshold < 0 || hybridThreshold > 1) {
    throw new Error("--hybrid-threshold must be a finite number between 0 and 1");
  }
  const options: TournamentOptions = {
    seats,
    ...(hasPairedRuns ? { pairedRuns: integer(flags, "paired-runs", 0) } : { games: integer(flags, "games", 1) }),
    mode: flags.mode ?? "4p-red-half",
    rule: flags.rule ?? "tenhou",
    seed: integer(flags, "seed", 42),
    seatPolicy: (flags["seat-policy"] ?? "rotate") as "rotate" | "fixed",
    out: required(flags, "out"),
    timeoutMs: integer(flags, "timeout-ms", 60_000),
    hybridThreshold,
    ...(mortalConfig ? { mortalConfig } : {}),
  };
  await runTournament(options);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((argument) => argument !== "--");
  const command = argv[0];
  if (!command || command.startsWith("--") || command === "bench") return runBench(command === "bench" ? argv.slice(1) : argv);
  if (command === "dataset:import") return runDatasetImport(argv.slice(1));
  if (command === "dataset:validate") return runDatasetValidate(argv.slice(1));
  if (command === "dataset:stats") return runDatasetStats(argv.slice(1));
  if (command === "reference:mortal") return runReferenceMortal(argv.slice(1));
  if (command === "tournament") return runTournamentCommand(argv.slice(1));
  if (command === "hybrid:sweep") return runHybridSweep(argv.slice(1));
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
