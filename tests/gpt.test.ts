import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GptAgent, GptRequestError } from "../src/agents/gpt.js";
import type { GameAction, GameDecisionInput } from "../src/types.js";

const action: GameAction = {
  id: "action-a",
  type: "dahai",
  mjai: { type: "dahai", actor: 0, pai: "1m" },
};

const input: GameDecisionInput = {
  id: "game/0/0",
  state: { round: "E1", hand: ["1m"] },
  legalActions: [action],
};

function response(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("GptAgent retry policy", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("retries temporary 429 responses and records request metadata", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, { error: { code: "rate_limit_error", message: "slow down" } }, { "retry-after": "0", "x-request-id": "r1" }))
      .mockResolvedValueOnce(response(429, { error: { code: "rate_limit_error", message: "slow down" } }, { "retry-after": "0", "x-request-id": "r2" }))
      .mockResolvedValueOnce(response(200, { output_text: JSON.stringify({ action: "action-a" }), usage: { input_tokens: 10, output_tokens: 2 } }, { "x-request-id": "r3" }));
    vi.stubGlobal("fetch", fetchMock);

    const decision = await new GptAgent({ initialBackoffMs: 0, jitterMs: 0 }).decideGame(input);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(decision.metadata).toMatchObject({
      attempts: 3,
      retryCount: 2,
      totalBackoffMs: 0,
      statuses: [429, 429, 200],
      requestIds: ["r1", "r2", "r3"],
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.max_output_tokens).toBe(128);
  });

  it("uses Retry-After and exponential fallback backoff", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, { error: { code: "rate_limit_error", message: "slow down" } }, { "retry-after": "0.001" }))
      .mockResolvedValueOnce(response(429, { error: { code: "rate_limit_error", message: "slow down" } }))
      .mockResolvedValueOnce(response(200, { output_text: JSON.stringify({ action: "action-a" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const decision = await new GptAgent({ initialBackoffMs: 2, jitterMs: 0 }).decideGame(input);
    expect(decision.metadata).toMatchObject({ attempts: 3, retryCount: 2, statuses: [429, 429, 200] });
    expect(Number(decision.metadata?.totalBackoffMs)).toBeGreaterThanOrEqual(3);
  });

  it("retries a non-JSON 503 response by status", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("still overloaded", { status: 503 }))
      .mockResolvedValueOnce(response(200, { output_text: JSON.stringify({ action: "action-a" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const decision = await new GptAgent({ maxRetries: 2, initialBackoffMs: 0, jitterMs: 0 }).decideGame(input);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(decision.metadata).toMatchObject({ attempts: 3, retryCount: 2, statuses: [503, 503, 200] });
  });

  it("does not retry quota or billing failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(429, {
      error: { code: "insufficient_quota", message: "billing quota exceeded" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new GptAgent({ initialBackoffMs: 0, jitterMs: 0 }).decideGame(input))
      .rejects.toMatchObject({ name: "GptRequestError", status: 429, code: "insufficient_quota" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at the finite retry limit", async () => {
    const fetchMock = vi.fn()
      .mockImplementation(() => Promise.resolve(response(429, { error: { code: "rate_limit_error", message: "slow down" } })));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new GptAgent({ maxRetries: 2, initialBackoffMs: 0, jitterMs: 0 }).decideGame(input)
      .catch((value: unknown) => value as GptRequestError);
    expect(error).toMatchObject({ name: "GptRequestError", status: 429 });
    expect(error.metadata).toMatchObject({ attempts: 3, retryCount: 2, statuses: [429, 429, 429] });
  });

  it("aborts while waiting between retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(429, { error: { code: "rate_limit_error", message: "slow down" } }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const promise = new GptAgent({ initialBackoffMs: 1_000, jitterMs: 0 }).decideGame(input, controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(promise).rejects.toMatchObject({
      name: "AbortError",
      metadata: { attempts: 1, retryCount: 1, statuses: [429] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
