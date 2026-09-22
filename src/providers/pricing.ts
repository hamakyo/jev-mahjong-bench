import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { canonicalJson } from "../mjai/tiles.js";
import type { ProviderCallRecord } from "./types.js";

export interface ModelPricing {
  inputPer1kTokens?: number;
  outputPer1kTokens?: number;
  /** Legacy name retained as an alias for cacheReadInput*. */
  cachedInputPer1kTokens?: number;
  cacheReadInputPer1kTokens?: number;
  cacheCreationInputPer1kTokens?: number;
  inputPerMillionTokens?: number;
  outputPerMillionTokens?: number;
  /** Legacy name retained as an alias for cacheReadInput*. */
  cachedInputPerMillionTokens?: number;
  cacheReadInputPerMillionTokens?: number;
  cacheCreationInputPerMillionTokens?: number;
}

export interface PricingSnapshot {
  snapshotId: string;
  asOf: string;
  currency: string;
  models: Record<string, ModelPricing>;
  sha256: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
  return value;
}

function parseModelPricing(value: unknown, label: string): ModelPricing {
  const raw = object(value, label);
  const allowed = new Set([
    "inputPer1kTokens",
    "outputPer1kTokens",
    "cachedInputPer1kTokens",
    "cacheReadInputPer1kTokens",
    "cacheCreationInputPer1kTokens",
    "inputPerMillionTokens",
    "outputPerMillionTokens",
    "cachedInputPerMillionTokens",
    "cacheReadInputPerMillionTokens",
    "cacheCreationInputPerMillionTokens",
  ]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`${label} has unknown field "${key}"`);
  const result: ModelPricing = {};
  for (const key of allowed) if (raw[key] !== undefined) (result as Record<string, unknown>)[key] = number(raw[key], `${label}.${key}`);
  if (!Object.keys(result).length) throw new Error(`${label} must contain at least one price`);
  return result;
}

export function parsePricingSnapshot(text: string, source = "pricing.yaml"): PricingSnapshot {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${source}: ${document.errors[0]?.message ?? "invalid YAML"}`);
  const root = object(document.toJS(), source);
  if (root.pricing !== undefined) {
    for (const key of Object.keys(root)) if (key !== "pricing") throw new Error(`${source} has unknown field "${key}"`);
  }
  const config = root.pricing === undefined ? root : object(root.pricing, `${source}.pricing`);
  const allowed = new Set(["snapshotId", "id", "asOf", "date", "currency", "models"]);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`${source} has unknown field "${key}"`);
  const snapshotId = string(config.snapshotId ?? config.id, `${source}.snapshotId`);
  const asOf = string(config.asOf ?? config.date, `${source}.asOf`);
  const currency = string(config.currency, `${source}.currency`).toUpperCase();
  const modelsRaw = object(config.models, `${source}.models`);
  const models: Record<string, ModelPricing> = {};
  for (const [key, value] of Object.entries(modelsRaw)) models[key] = parseModelPricing(value, `${source}.models.${key}`);
  const normalized = { snapshotId, asOf, currency, models };
  const sha256 = createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex");
  return { ...normalized, sha256 };
}

export async function loadPricingSnapshot(path: string): Promise<PricingSnapshot> {
  const source = resolve(path);
  return parsePricingSnapshot(await readFile(source, "utf8"), source);
}

function per1k(price: ModelPricing, field: "input" | "output" | "cacheRead" | "cacheCreation"): number | undefined {
  const per1kKeys: Record<typeof field, (keyof ModelPricing)[]> = {
    input: ["inputPer1kTokens"],
    output: ["outputPer1kTokens"],
    cacheRead: ["cacheReadInputPer1kTokens", "cachedInputPer1kTokens"],
    cacheCreation: ["cacheCreationInputPer1kTokens"],
  };
  const perMillionKeys: Record<typeof field, (keyof ModelPricing)[]> = {
    input: ["inputPerMillionTokens"],
    output: ["outputPerMillionTokens"],
    cacheRead: ["cacheReadInputPerMillionTokens", "cachedInputPerMillionTokens"],
    cacheCreation: ["cacheCreationInputPerMillionTokens"],
  };
  const value = per1kKeys[field].map((key) => price[key]).find((candidate) => candidate !== undefined);
  if (value !== undefined) return value;
  const million = perMillionKeys[field].map((key) => price[key]).find((candidate) => candidate !== undefined);
  return million === undefined ? undefined : million / 1_000;
}

function priceForCall(call: ProviderCallRecord, price: ModelPricing): number | undefined {
  const usage = call.usage;
  if (!usage) return undefined;
  const inputPrice = per1k(price, "input");
  const outputPrice = per1k(price, "output");
  const uncachedInputTokens = usage.uncachedInputTokens
    ?? ((call.providerId === "openai" || call.providerId === "openai-compatible") && usage.inputTokens !== undefined
      ? Math.max(0, usage.inputTokens - (usage.cachedInputTokens ?? 0) - (usage.cacheCreationInputTokens ?? 0))
      : usage.inputTokens);
  if (uncachedInputTokens !== undefined && inputPrice === undefined) return undefined;
  if (usage.outputTokens !== undefined && outputPrice === undefined) return undefined;
  const cacheReadPrice = per1k(price, "cacheRead");
  const cacheCreationPrice = per1k(price, "cacheCreation");
  if (usage.cachedInputTokens !== undefined && cacheReadPrice === undefined) return undefined;
  if (usage.cacheCreationInputTokens !== undefined && cacheCreationPrice === undefined) return undefined;
  // Providers such as Anthropic report base input, cache reads, and cache
  // writes as independent counters. Never subtract one from another.
  const inputCost = (uncachedInputTokens ?? 0) * (inputPrice ?? 0) / 1_000;
  const cacheReadCost = (usage.cachedInputTokens ?? 0) * (cacheReadPrice ?? 0) / 1_000;
  const cacheCreationCost = (usage.cacheCreationInputTokens ?? 0) * (cacheCreationPrice ?? 0) / 1_000;
  const outputCost = (usage.outputTokens ?? 0) * (outputPrice ?? 0) / 1_000;
  return inputCost + cacheReadCost + cacheCreationCost + outputCost;
}

export function costPerDecisionUsd(
  calls: readonly ProviderCallRecord[],
  snapshot: PricingSnapshot,
  decisionCount: number,
): number | undefined {
  if (!calls.length || !Number.isInteger(decisionCount) || decisionCount < 1) return undefined;
  let total = 0;
  for (const call of calls) {
    const price = snapshot.models[call.modelId] ?? snapshot.models[`${call.providerId}:${call.model}`] ?? snapshot.models[call.model];
    if (!price) return undefined;
    const cost = priceForCall(call, price);
    if (cost === undefined) return undefined;
    total += cost;
  }
  return total / decisionCount;
}
