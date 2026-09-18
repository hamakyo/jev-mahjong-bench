import { readFile } from "node:fs/promises";
import type { DecisionSample, MahjongState } from "../types.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((x) => typeof x !== "string")) {
    throw new Error(`${field} must be a non-empty string array`);
  }
}

export function parseDecisionSample(value: unknown, line?: number): DecisionSample {
  const p = line ? `line ${line}: ` : "";
  if (!record(value)) throw new Error(`${p}sample must be an object`);
  if (typeof value.id !== "string" || !value.id) throw new Error(`${p}id must be a non-empty string`);
  if (!record(value.state)) throw new Error(`${p}state must be an object`);
  if (typeof value.state.round !== "string") throw new Error(`${p}state.round must be a string`);
  stringArray(value.state.hand, `${p}state.hand`);
  stringArray(value.legalActions, `${p}legalActions`);

  const legal = new Set(value.legalActions);
  if (legal.size !== value.legalActions.length) throw new Error(`${p}legalActions must not contain duplicates`);
  if (value.referenceAction !== undefined && typeof value.referenceAction !== "string") {
    throw new Error(`${p}referenceAction must be a string when present`);
  }
  if (typeof value.referenceAction === "string" && !legal.has(value.referenceAction)) {
    throw new Error(`${p}referenceAction must be a legal action`);
  }

  return {
    id: value.id,
    state: value.state as unknown as MahjongState,
    legalActions: value.legalActions,
    ...(typeof value.referenceAction === "string" ? { referenceAction: value.referenceAction } : {}),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(Array.isArray(value.tags) && value.tags.every((x) => typeof x === "string")
      ? { tags: value.tags as string[] } : {}),
  };
}

export async function loadDataset(path: string): Promise<DecisionSample[]> {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error(`Dataset is empty: ${path}`);
  const ids = new Set<string>();
  return lines.map((text, i) => {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error(`line ${i + 1}: invalid JSON`); }
    const sample = parseDecisionSample(raw, i + 1);
    if (ids.has(sample.id)) throw new Error(`line ${i + 1}: duplicate id "${sample.id}"`);
    ids.add(sample.id);
    return sample;
  });
}
