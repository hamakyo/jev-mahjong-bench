import { DEFAULT_HYBRID_THRESHOLDS } from "../benchmark/hybrid-sweep.js";
import type { RunType } from "./run-store.js";

export interface ExperimentTemplate {
  id: string;
  type: RunType;
  config: Record<string, unknown>;
}

export const EXPERIMENT_TEMPLATES: readonly ExperimentTemplate[] = [
  {
    id: "decision-benchmark",
    type: "benchmark",
    config: { agents: ["jev", "gpt"], dataset: "datasets/sample.jsonl", concurrency: 1, seed: 42 },
  },
  {
    id: "jev-vs-gpt",
    type: "tournament",
    config: { seats: ["jev", "gpt", "random", "random"], games: 4, mode: "4p-red-east", rule: "tenhou", seatPolicy: "rotate", seed: 42, timeoutMs: 60_000 },
  },
  {
    id: "hybrid-calibration",
    type: "hybrid-sweep",
    config: { dataset: "datasets/sample.jsonl", thresholds: [...DEFAULT_HYBRID_THRESHOLDS] },
  },
  {
    id: "provider-arena",
    type: "tournament",
    config: { seats: ["jev", "gptluna", "deepseek", "hybrid"], games: 4, mode: "4p-red-east", rule: "tenhou", seatPolicy: "rotate", seed: 42, timeoutMs: 60_000, models: "models.example.yaml", hybridFallback: "gptluna" },
  },
  {
    id: "paired-full-game",
    type: "tournament",
    config: { seats: ["jev", "gpt", "random", "random"], pairedRuns: 25, mode: "4p-red-half", rule: "tenhou", seatPolicy: "rotate", seed: 42, timeoutMs: 60_000 },
  },
  {
    id: "local-model-benchmark",
    type: "benchmark",
    config: { agents: ["local-model"], dataset: "datasets/sample.jsonl", concurrency: 1, seed: 42, models: "models.yaml" },
  },
];
