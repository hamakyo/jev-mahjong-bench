import { describe, expect, it } from "vitest";
import { replayDashboardHtml, replayDashboardJs } from "../src/replay/server.js";
import { dashboardHtml, dashboardJs } from "../src/live/dashboard/index.js";
import {
  DEFAULT_LOCALE,
  messages,
  formatActionType,
  formatRound,
  formatSeat,
  formatStatus,
  isLocale,
  resolveLocale,
  t,
} from "../src/live/dashboard/i18n.js";

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
    const keys = [
      ...[...dashboardHtml.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]),
      ...[...replayDashboardHtml.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]),
    ].filter((key): key is string => key !== undefined);
    expect(keys.every((key) => key in messages.en)).toBe(true);
    expect(dashboardJs.indexOf("const localeRuntime")).toBeLessThan(dashboardJs.indexOf("function renderTableState"));
    expect(dashboardJs.indexOf("function renderTableState")).toBeLessThan(dashboardJs.indexOf("function renderDecisionTable"));
    expect(replayDashboardJs.indexOf("const localeRuntime")).toBeLessThan(replayDashboardJs.indexOf("function renderTableState"));
    expect(replayDashboardJs.indexOf("function renderTableState")).toBeLessThan(replayDashboardJs.indexOf("function renderDecisionTable"));
  });
});
