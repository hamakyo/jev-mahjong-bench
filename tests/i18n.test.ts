import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { replayDashboardHtml, replayDashboardJs } from "../src/replay/server.js";
import { dashboardHtml, dashboardJs } from "../src/live/dashboard/index.js";
import { decisionTableRendererJs } from "../src/live/dashboard/renderer.js";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  messages,
  formatActionType,
  formatRound,
  formatSeat,
  formatStatus,
  isLocale,
  isMessageKey,
  localeRuntimeJs,
  resolveLocale,
  t,
  type MessageKey,
} from "../src/live/dashboard/i18n.js";

function literalKeys(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)]
    .map((match) => match[1])
    .filter((key): key is string => key !== undefined);
}

function generatedMessageKeys(source: string): string[] {
  return [
    ...literalKeys(source, /\b(?:label|localeRuntime\.t)\(\s*["'`]([^"'`]+)["'`]/g),
    ...literalKeys(source, /["'`](metrics\.[A-Za-z0-9_.-]+)["'`]/g),
  ];
}

describe("dashboard i18n", () => {
  it("keeps the English and Japanese key sets identical", () => {
    expect(Object.keys(messages.ja).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it("contains the required Japanese mahjong terms", () => {
    expect(messages.ja["table.discards"]).toBe("河");
    expect(messages.ja["table.hand"]).toBe("手牌");
    expect(messages.ja["replay.hand"]).toBe("局");
    expect(formatActionType("dahai", "ja")).toBe("打牌");
    expect(formatActionType("ankan", "ja")).toBe("暗槓");
    expect(formatActionType("none", "ja")).toBe("パス");
    expect(formatStatus("running", "ja")).toBe("進行中");
  });

  it("contains the required Debug Inspector labels", () => {
    expect(messages.en["debug.legalActions"]).toBe("Legal actions");
    expect(messages.en["debug.confidence"]).toBe("Confidence");
    expect(messages.en["debug.probabilities"]).toBe("Probabilities");
    expect(messages.en["debug.totalTokens"]).toBe("Total tokens");
    expect(messages.en["debug.provider"]).toBe("Provider");
    expect(messages.en["debug.model"]).toBe("Model");
    expect(messages.ja["debug.legalActions"]).toBe("合法手");
    expect(messages.ja["debug.confidence"]).toBe("確信度");
    expect(messages.ja["debug.probabilities"]).toBe("確率");
    expect(messages.ja["debug.totalTokens"]).toBe("合計トークン");
    expect(messages.ja["debug.provider"]).toBe("プロバイダー");
    expect(messages.ja["debug.model"]).toBe("モデル");
  });

  it("keeps t() restricted to dictionary keys", () => {
    const key: MessageKey = "controls.play";
    expect(t(key)).toBe("Play");
    if (false) {
      // @ts-expect-error Unknown message keys must be rejected by TypeScript.
      t("controls.typo");
    }
  });

  it("falls back to English for an unsupported locale", () => {
    expect(isLocale("fr")).toBe(false);
    expect(t("controls.play", undefined, "fr" as never)).toBe(messages.en["controls.play"]);
    expect(t("controls.play", "fr" as never)).toBe(messages.en["controls.play"]);
  });

  it("resolves URL, storage, browser language, then English", () => {
    const storage = { getItem: () => "ja" };
    expect(resolveLocale({ url: "https://example.test/?locale=en", storage, navigator: { languages: ["ja-JP"] } })).toBe("en");
    expect(resolveLocale({ url: "https://example.test/?locale=fr", storage, navigator: { languages: ["en-US"] } })).toBe("ja");
    expect(resolveLocale({ storedLocale: "fr", navigator: { languages: ["ja-JP"] } })).toBe("ja");
    expect(resolveLocale({ navigator: { languages: ["ja-JP"] } })).toBe("ja");
    expect(resolveLocale({ navigator: { languages: ["fr-FR"] } })).toBe(DEFAULT_LOCALE);
  });

  it("formats seats, rounds, actions, and statuses without changing unknown IDs", () => {
    expect(formatSeat("E", "ja")).toBe("東");
    expect(formatSeat(3, "ja")).toBe("北");
    expect(formatSeat("agent-id", "ja")).toBe("agent-id");
    expect(formatRound("E1", "ja")).toBe("東1局");
    expect(formatActionType("reach", "ja")).toBe("リーチ");
    expect(formatActionType("custom-action", "ja")).toBe("custom-action");
    expect(formatStatus("complete", "ja")).toBe("完了");
  });

  it("leaves missing interpolation values visible and safe", () => {
    expect(t("agent.gamesHands", { games: 2 }, "ja")).toContain("{hands}");
    expect(t("agent.gamesHands", { games: 2, hands: 3 }, "ja")).toContain("2");
  });

  it("embeds the same locale runtime in both dashboards and keeps static keys valid", () => {
    for (const source of [dashboardJs, replayDashboardJs]) new Function(source);
    const staticKeys = [
      ...[...dashboardHtml.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]),
      ...[...replayDashboardHtml.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]),
    ].filter((key): key is string => key !== undefined);
    const generatedKeys = [
      ...generatedMessageKeys(dashboardJs),
      ...generatedMessageKeys(replayDashboardJs),
    ];
    const missing = [...new Set([...staticKeys, ...generatedKeys].filter((key) => !isMessageKey(key)))];
    expect(missing).toEqual([]);
    expect(dashboardJs.indexOf("const localeRuntime")).toBeLessThan(dashboardJs.indexOf("function renderTableState"));
    expect(dashboardJs.indexOf("function renderTableState")).toBeLessThan(dashboardJs.indexOf("function renderDecisionTable"));
    expect(replayDashboardJs.indexOf("const localeRuntime")).toBeLessThan(replayDashboardJs.indexOf("function renderTableState"));
    expect(replayDashboardJs.indexOf("function renderTableState")).toBeLessThan(replayDashboardJs.indexOf("function renderDecisionTable"));
  });

  it("runs the browser locale runtime without fetching or changing the replay cursor", () => {
    type Runtime = {
      locale: () => string;
      t: (key: string) => string;
      rememberSnapshot: (snapshot: unknown) => void;
      setSnapshotRenderer: (renderer: (snapshot: unknown) => void) => void;
    };
    const attributes = (key: string) => new Map<string, string>([["data-i18n", key]]);
    const node = (key: string) => {
      const values = attributes(key);
      return {
        textContent: "",
        getAttribute: (name: string) => values.get(name) ?? null,
        setAttribute: (name: string, value: string) => values.set(name, value),
      };
    };
    const title = node("title.replay");
    const language = node("settings.language");
    const play = node("controls.play");
    const staticNodes = [title, language, play];
    const selector = {
      value: "",
      addEventListener: (type: string, handler: (event: { target?: { value?: string } }) => void) => {
        if (type === "change") onChange = handler;
      },
    };
    let onChange: ((event: { target?: { value?: string } }) => void) | undefined;
    const writes: Array<[string, string]> = [];
    let fetchCalls = 0;
    const context: Record<string, unknown> = {
      URL,
      URLSearchParams,
      location: { search: "" },
      navigator: { languages: ["en-US"] },
      localStorage: {
        getItem: () => null,
        setItem: (key: string, value: string) => writes.push([key, value]),
      },
      fetch: () => { fetchCalls += 1; throw new Error("fetch should not be called"); },
      document: {
        documentElement: { lang: "" },
        querySelectorAll: (selectorName: string) => selectorName === "[data-i18n]" ? staticNodes : [],
        getElementById: (id: string) => id === "locale-select" ? selector : null,
      },
    };
    runInNewContext(`${localeRuntimeJs}\nglobalThis.__localeRuntime = localeRuntime;`, context);
    const runtime = context.__localeRuntime as Runtime;
    const snapshot = { replay: { cursor: 17, eventCount: 42 }, marker: "same-snapshot" };
    const rendered: unknown[] = [];
    runtime.rememberSnapshot(snapshot);
    runtime.setSnapshotRenderer((value) => rendered.push(value));

    expect(runtime.locale()).toBe("en");
    expect(selector.value).toBe("en");
    onChange?.({ target: { value: "ja" } });

    expect(runtime.locale()).toBe("ja");
    expect((context.document as { documentElement: { lang: string } }).documentElement.lang).toBe("ja");
    expect(title.textContent).toBe(messages.ja["title.replay"]);
    expect(language.textContent).toBe(messages.ja["settings.language"]);
    expect(play.textContent).toBe(messages.ja["controls.play"]);
    expect(runtime.t("controls.play")).toBe("再生");
    expect(writes).toEqual([[LOCALE_STORAGE_KEY, "ja"]]);
    expect(fetchCalls).toBe(0);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBe(snapshot);
    expect((rendered[0] as typeof snapshot).replay.cursor).toBe(17);
  });

  it("resolves Hybrid Inspector provider metadata from the final source", () => {
    const inspector = { innerHTML: "" };
    const context: Record<string, unknown> = {
      seats: ["E", "S", "W", "N"],
      $: (id: string) => id === "debug-inspector-content" ? inspector : null,
      escapeHtml: (value: unknown) => String(value ?? ""),
      localeRuntime: {
        t: (key: string) => key,
        formatActionType: (value: string) => value === "dahai" ? "打牌" : value,
      },
    };
    runInNewContext(`${decisionTableRendererJs}\nglobalThis.__renderDebugInspector = renderDebugInspector;`, context);
    const renderDebugInspector = context.__renderDebugInspector as (snapshot: unknown) => void;
    const snapshot = {
      currentSeat: 0,
      decisionsBySeat: { E: { inputTokens: 12, outputTokens: 4 } },
      lastDecisions: [],
      debug: {
        legalActionsBySeat: { E: [{ id: "dahai:1m", type: "dahai" }] },
        providerMetadataBySeat: { E: { hybrid: { finalSource: "gpt" } } },
        diagnosticsBySeat: {
          E: {
            confidence: 0.9,
            probabilities: { "dahai:1m": 0.9 },
            hybridTrace: { finalSource: "gpt" },
            providerMetadata: {
              jev: { metadata: { provider: "typesafe", modelId: "jev-model" } },
              gpt: { metadata: { provider: "openai", modelId: "gpt-model" } },
            },
          },
        },
      },
    };
    renderDebugInspector(snapshot);
    expect(inspector.innerHTML).toContain("openai");
    expect(inspector.innerHTML).toContain("gpt-model");
    expect(inspector.innerHTML).not.toContain("jev-model");

    (snapshot.debug.diagnosticsBySeat.E.hybridTrace as { finalSource: string }).finalSource = "jev-fallback";
    renderDebugInspector(snapshot);
    expect(inspector.innerHTML).toContain("typesafe");
    expect(inspector.innerHTML).toContain("jev-model");
    expect(inspector.innerHTML).not.toContain("gpt-model");
  });
});
