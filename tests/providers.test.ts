import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenericLlmGameAgent } from "../src/agents/llm.js";
import { inspectGameDecisionInput, MAX_LLM_INPUT_BYTES } from "../src/game/input.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { loadModelRegistryFromYaml } from "../src/providers/registry.js";
import { costPerDecisionUsd, parsePricingSnapshot } from "../src/providers/pricing.js";
import { createProviderDecisionRequest } from "../src/providers/prompt.js";
import type { DecisionSample, GameAction, GameDecisionInput } from "../src/types.js";
import type { ProviderCallRecord } from "../src/providers/types.js";

const action: GameAction = { id: "discard", type: "dahai", mjai: { type: "dahai", actor: 0, pai: "1m" } };
const input: GameDecisionInput = { id: "game/0/0", state: { round: "E1", hand: ["1m"] }, legalActions: [action] };

function model(text: string, id: string) {
  return loadModelRegistryFromYaml(`models:\n  ${id}:\n${text.split("\n").map((line) => `    ${line}`).join("\n")}`).resolve(id);
}

function response(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

describe("model registry", () => {
  it("hashes normalized definitions without reading secret values", () => {
    const first = loadModelRegistryFromYaml("models:\n  demo:\n    provider: openai-compatible\n    baseUrl: https://example.com/v1\n    model: demo\n    apiKeyEnv: DEMO_KEY");
    const second = loadModelRegistryFromYaml("models:\n  demo:\n    apiKeyEnv: DEMO_KEY\n    model: demo\n    baseUrl: https://example.com/v1\n    provider: openai-compatible");
    expect(first.hash).toBe(second.hash);
    expect(first.resolve("demo")).not.toHaveProperty("apiKey");
    expect(() => loadModelRegistryFromYaml("models:\n  random:\n    provider: openai\n    model: x")).toThrow(/reserved/);
    expect(() => loadModelRegistryFromYaml("models:\n  demo:\n    provider: openai\n    model: x\n    unknown: true")).toThrow(/unknown field/);
  });

  it("ships the documented GPT Luna and DeepSeek model IDs", async () => {
    const registry = loadModelRegistryFromYaml(await readFile("models.example.yaml", "utf8"));
    expect(registry.resolve("gptluna")).toMatchObject({ provider: "openai", model: "gpt-5.6-luna" });
    expect(registry.resolve("deepseek")).toMatchObject({ provider: "openai-compatible", model: "deepseek-chat" });
  });
});

describe("provider adapters", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "openai-secret");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-secret");
    vi.stubEnv("COMPAT_API_KEY", "compat-secret");
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("uses canonical input bytes and normalizes OpenAI Responses usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      output_text: JSON.stringify({ action: "discard" }),
      model: "returned-model",
      status: "completed",
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 1 }, output_tokens_details: { reasoning_tokens: 1 } },
    }, { "x-request-id": "openai-request" }));
    vi.stubGlobal("fetch", fetchMock);
    const resolved = model("provider: openai\nmodel: demo", "openai-demo");
    const request = createProviderDecisionRequest(input);
    const result = await new OpenAIProvider({ initialBackoffMs: 0, jitterMs: 0 }).decide(request, resolved);
    expect(result.action).toBe("discard");
    expect(result.providerCall).toMatchObject({ providerId: "openai", modelId: "openai-demo", canonicalInputBytes: request.canonicalInputBytes, httpAttemptCount: 1, retryCount: 0, requestIds: ["openai-request"], finishReason: "completed" });
    expect(result.usage).toMatchObject({ uncachedInputTokens: 6, inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 3, cacheCreationInputTokens: 1, reasoningTokens: 1 });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.store).toBe(false);
    expect(body.input).toBe(request.canonicalInput);
    expect(String(JSON.stringify(result))).not.toContain("openai-secret");
  });

  it("parses Anthropic select_action tool use", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      content: [{ type: "tool_use", name: "select_action", input: { action: "discard" } }],
      model: "claude-returned",
      stop_reason: "tool_use",
      usage: { input_tokens: 8, output_tokens: 3, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
    }, { "request-id": "anthropic-request" })));
    const resolved = model("provider: anthropic\nmodel: claude", "claude");
    const result = await new AnthropicProvider({ initialBackoffMs: 0, jitterMs: 0 }).decide(createProviderDecisionRequest(input), resolved);
    expect(result.action).toBe("discard");
    expect(result.providerCall).toMatchObject({ providerId: "anthropic", requestIds: ["anthropic-request"], finishReason: "tool_use" });
    expect(result.usage).toMatchObject({ uncachedInputTokens: 8, inputTokens: 8, outputTokens: 3, cachedInputTokens: 2, cacheCreationInputTokens: 1 });
  });

  it("supports JSON and tool modes for OpenAI-compatible endpoints", async () => {
    const jsonFetch = vi.fn().mockResolvedValue(response({ choices: [{ message: { content: JSON.stringify({ action: "discard" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }));
    vi.stubGlobal("fetch", jsonFetch);
    const jsonModel = model("provider: openai-compatible\nbaseUrl: https://example.com/v1\nmodel: json\napiKeyEnv: COMPAT_API_KEY\nrequestMode: json", "json");
    const result = await new OpenAICompatibleProvider({ initialBackoffMs: 0, jitterMs: 0 }).decide(createProviderDecisionRequest(input), jsonModel);
    expect(result.action).toBe("discard");
    expect(JSON.parse(String(jsonFetch.mock.calls[0]?.[1]?.body)).response_format).toEqual({ type: "json_object" });

    const toolFetch = vi.fn().mockResolvedValue(response({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "select_action", arguments: JSON.stringify({ action: "discard" }) } }] }, finish_reason: "tool_calls" }] }));
    vi.stubGlobal("fetch", toolFetch);
    const toolModel = model("provider: openai-compatible\nbaseUrl: https://example.com/v1\nmodel: tool\napiKeyEnv: COMPAT_API_KEY\nrequestMode: tool", "tool");
    await expect(new OpenAICompatibleProvider({ initialBackoffMs: 0, jitterMs: 0 }).decide(createProviderDecisionRequest(input), toolModel)).resolves.toMatchObject({ action: "discard" });
  });

  it("rejects oversized game input before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const oversized = { ...input, state: { ...input.state, extra: { padding: "x".repeat(MAX_LLM_INPUT_BYTES) } } };
    expect(() => inspectGameDecisionInput(oversized)).toThrow(/maximum is 16384/);
    const resolved = model("provider: openai\nmodel: demo", "oversized");
    const agent = new GenericLlmGameAgent(new OpenAIProvider(), resolved);
    await expect(agent.decideGame(oversized)).rejects.toThrow(/maximum is 16384/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized dataset input before fetch", () => {
    const oversized: DecisionSample = {
      id: "sample/oversized",
      state: { round: "E1", hand: ["1m"], extra: { padding: "x".repeat(MAX_LLM_INPUT_BYTES) } },
      legalActions: ["discard"],
    };
    expect(() => createProviderDecisionRequest(oversized)).toThrow(/maximum is 16384/);
  });

  it("rejects reasoning settings that a generic provider cannot transmit", () => {
    expect(() => loadModelRegistryFromYaml(`models:\n  claude:\n    provider: anthropic\n    model: claude\n    reasoningEffort: high`)).toThrow(/not supported/);
    expect(() => loadModelRegistryFromYaml(`models:\n  compatible:\n    provider: openai-compatible\n    baseUrl: https://example.com/v1\n    model: compatible\n    reasoningEffort: high`)).toThrow(/not supported/);
  });

  it("performs the single central legality check for generic game agents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ output_text: JSON.stringify({ action: "not-legal" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const resolved = model("provider: openai\nmodel: demo", "illegal-action");
    const agent = new GenericLlmGameAgent(new OpenAIProvider(), resolved);
    await expect(agent.decideGame(input)).rejects.toMatchObject({
      category: "invalid-response",
      providerCall: { errorCategory: "invalid-response", canonicalInputBytes: expect.any(Number) },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pricing snapshots", () => {
  it("calculates pinned cost and stays undefined when pricing is incomplete", () => {
    const snapshot = parsePricingSnapshot(`
snapshotId: test-snapshot
asOf: 2026-09-22
currency: USD
models:
  demo:
    inputPer1kTokens: 0.001
    outputPer1kTokens: 0.004
    cachedInputPer1kTokens: 0.0005
`);
    const call: ProviderCallRecord = {
      providerId: "openai",
      modelId: "demo",
      model: "demo-model",
      endpointFamily: "test",
      canonicalInputBytes: 100,
      latencyMs: 1,
      logicalCallCount: 1,
      httpAttemptCount: 2,
      retryCount: 1,
      usage: { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 100 },
    };
    expect(costPerDecisionUsd([call], snapshot, 1)).toBeCloseTo(0.00295, 8);
    expect(costPerDecisionUsd([{ ...call, modelId: "missing" }], snapshot, 1)).toBeUndefined();
    expect(() => parsePricingSnapshot("pricing:\n  snapshotId: x\n  asOf: 2026-09-22\n  currency: USD\n  models: {}\nextra: true")).toThrow(/unknown field/);
  });

  it("prices Anthropic base input, cache reads, and cache creation independently", () => {
    const snapshot = parsePricingSnapshot(`
snapshotId: anthropic-cache
asOf: 2026-09-22
currency: USD
models:
  claude:
    inputPer1kTokens: 0.001
    outputPer1kTokens: 0.004
    cacheReadInputPer1kTokens: 0.0002
    cacheCreationInputPer1kTokens: 0.003
`);
    const call: ProviderCallRecord = {
      providerId: "anthropic",
      modelId: "claude",
      model: "claude-sonnet",
      endpointFamily: "anthropic-messages",
      canonicalInputBytes: 100,
      latencyMs: 1,
      logicalCallCount: 1,
      httpAttemptCount: 1,
      retryCount: 0,
      usage: { inputTokens: 1_000, cachedInputTokens: 100, cacheCreationInputTokens: 50, outputTokens: 500 },
    };
    expect(costPerDecisionUsd([call], snapshot, 1)).toBeCloseTo(0.00317, 8);
    const incomplete = parsePricingSnapshot(`
snapshotId: anthropic-cache-incomplete
asOf: 2026-09-22
currency: USD
models:
  claude:
    inputPer1kTokens: 0.001
    outputPer1kTokens: 0.004
    cacheReadInputPer1kTokens: 0.0002
`);
    expect(costPerDecisionUsd([call], incomplete, 1)).toBeUndefined();
  });

  it("maps OpenAI cache writes and charges each input bucket once", () => {
    const snapshot = parsePricingSnapshot(`
snapshotId: openai-cache
asOf: 2026-09-22
currency: USD
models:
  demo:
    inputPer1kTokens: 0.001
    outputPer1kTokens: 0.004
    cacheReadInputPer1kTokens: 0.0005
    cacheCreationInputPer1kTokens: 0.002
`);
    const call: ProviderCallRecord = {
      providerId: "openai",
      modelId: "demo",
      model: "demo-model",
      endpointFamily: "openai-responses",
      canonicalInputBytes: 100,
      latencyMs: 1,
      logicalCallCount: 1,
      httpAttemptCount: 1,
      retryCount: 0,
      usage: { inputTokens: 1_000, cachedInputTokens: 100, cacheCreationInputTokens: 50 },
    };
    expect(costPerDecisionUsd([call], snapshot, 1)).toBeCloseTo(0.001, 8);
  });
});
