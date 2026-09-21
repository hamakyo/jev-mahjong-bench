export type Locale = "en" | "ja";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "jev-mahjong.locale";

const en = {
  "title.live": "Jev Mahjong live tournament",
  "title.replay": "Jev Mahjong replay",
  "settings.language": "Language",
  "locale.en": "English",
  "locale.ja": "日本語",
  "mode.spectator": "SPECTATOR",
  "mode.debug": "DEBUG",
  "mode.localOnly": "local only",
  "connection.connecting": "Connecting…",
  "connection.loading": "Loading…",
  "connection.live": "Live · stream connected",
  "connection.reconnecting": "Reconnecting…",
  "connection.offlineReplay": "Offline replay",
  "connection.snapshotRequestFailed": "snapshot request failed",
  "connection.replaySnapshotRequestFailed": "replay snapshot request failed",
  "connection.controlStatusRequestFailed": "control status request failed",
  "connection.controlRequestFailed": "control request failed",
  "status.idle": "Idle",
  "status.running": "Running",
  "status.stepping": "Stepping",
  "status.paused": "Paused",
  "status.complete": "Complete",
  "status.failed": "Failed",
  "status.error": "Error",
  "controls.play": "Play",
  "controls.pause": "Pause",
  "controls.resume": "Resume",
  "controls.step": "Step",
  "controls.previous": "Previous",
  "controls.next": "Next",
  "controls.previousHand": "Previous hand",
  "controls.handStart": "Hand start",
  "controls.handEnd": "Hand end",
  "controls.nextHand": "Next hand",
  "controls.speed": "Speed",
  "controls.mode": "Mode",
  "table.round": "Round",
  "table.mahjongTable": "Mahjong table",
  "table.scores": "Scores",
  "table.honba": "Honba",
  "table.kyotaku": "Kyotaku",
  "table.games": "Games",
  "table.hand": "Hand",
  "replay.hand": "Hand",
  "table.status": "Status",
  "table.dealer": "Dealer",
  "table.currentTurn": "Current turn",
  "table.rank": "rank",
  "table.discards": "Discards",
  "table.handTiles": "Hand",
  "table.melds": "Melds",
  "table.dora": "Dora",
  "table.riichi": "riichi",
  "table.latestDiscard": "Latest discard",
  "table.concealed": "concealed tile",
  "table.events": "Events",
  "table.next": "next",
  "table.step": "step",
  "table.pauseRequested": "pause requested",
  "table.noEvents": "No events yet",
  "table.noAgentMetrics": "No agent metrics yet",
  "table.noPublicOutcomeMetrics": "No public outcome metrics yet",
  "table.noDecisions": "No decisions yet",
  "table.noPublicDecisions": "No public decisions yet",
  "sections.executionControl": "Execution control",
  "sections.liveMetrics": "Live metrics",
  "sections.liveAgents": "Live agents",
  "sections.recentDecisions": "Recent decisions",
  "sections.debugSnapshot": "Debug snapshot",
  "sections.debugInspector": "Inspector",
  "debug.legalActions": "Legal actions",
  "debug.confidence": "Confidence",
  "debug.probabilities": "Probabilities",
  "debug.totalTokens": "Total tokens",
  "debug.provider": "Provider",
  "debug.model": "Model",
  "metrics.agent": "Agent",
  "metrics.games": "Games",
  "metrics.hands": "Hands",
  "metrics.wins": "Wins",
  "metrics.dealIns": "Deal-ins",
  "metrics.riichi": "Riichi",
  "metrics.calls": "Calls",
  "metrics.decisionsLegal": "Decisions / legal",
  "metrics.fallback": "Fallback",
  "metrics.errors": "Errors",
  "metrics.hybridEscalations": "Hybrid escalations",
  "metrics.latency": "Latency mean / p50 / p95",
  "metrics.inputTokens": "Input tokens",
  "metrics.outputTokens": "Output tokens",
  "metrics.retries": "Retries",
  "agent.decisionsP50": "{count} decisions · {latency}ms p50",
  "agent.gamesHands": "{games} games · {hands} hands",
  "decision.seat": "Seat",
  "decision.agent": "Agent",
  "decision.requested": "Requested",
  "decision.applied": "Applied",
  "decision.action": "Action",
  "decision.validity": "Validity",
  "decision.latency": "Latency",
  "decision.inputOutputTokens": "Input / output tokens",
  "decision.retries": "Retries",
  "decision.note": "Note",
  "decision.legal": "legal",
  "decision.fallback": "fallback",
  "fallback.retry": "retry",
  "fallback.latency": "latency",
  "fallback.token": "token",
  "fallback.hybridEscalation": "Hybrid escalation",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

const ja = {
  "title.live": "Jev Mahjong ライブ対局",
  "title.replay": "Jev Mahjong Replay",
  "settings.language": "言語",
  "locale.en": "English",
  "locale.ja": "日本語",
  "mode.spectator": "観戦",
  "mode.debug": "デバッグ",
  "mode.localOnly": "ローカル専用",
  "connection.connecting": "接続中…",
  "connection.loading": "読み込み中…",
  "connection.live": "ライブ · ストリーム接続済み",
  "connection.reconnecting": "再接続中…",
  "connection.offlineReplay": "オフラインReplay",
  "connection.snapshotRequestFailed": "snapshotの取得に失敗しました",
  "connection.replaySnapshotRequestFailed": "Replay snapshotの取得に失敗しました",
  "connection.controlStatusRequestFailed": "制御状態の取得に失敗しました",
  "connection.controlRequestFailed": "制御要求に失敗しました",
  "status.idle": "待機中",
  "status.running": "進行中",
  "status.stepping": "ステップ実行中",
  "status.paused": "一時停止",
  "status.complete": "完了",
  "status.failed": "失敗",
  "status.error": "エラー",
  "controls.play": "再生",
  "controls.pause": "一時停止",
  "controls.resume": "再開",
  "controls.step": "ステップ",
  "controls.previous": "前へ",
  "controls.next": "次へ",
  "controls.previousHand": "前の局",
  "controls.handStart": "局の開始",
  "controls.handEnd": "局の終了",
  "controls.nextHand": "次の局",
  "controls.speed": "速度",
  "controls.mode": "モード",
  "table.round": "局",
  "table.mahjongTable": "麻雀卓",
  "table.scores": "点数",
  "table.honba": "本場",
  "table.kyotaku": "供託",
  "table.games": "対局数",
  "table.hand": "手牌",
  "replay.hand": "局",
  "table.status": "状態",
  "table.dealer": "親",
  "table.currentTurn": "手番",
  "table.rank": "順位",
  "table.discards": "河",
  "table.handTiles": "手牌",
  "table.melds": "副露",
  "table.dora": "ドラ",
  "table.riichi": "リーチ",
  "table.latestDiscard": "最新の捨て牌",
  "table.concealed": "伏せ牌",
  "table.events": "イベント",
  "table.next": "次",
  "table.step": "ステップ",
  "table.pauseRequested": "一時停止を要求済み",
  "table.noEvents": "イベントはまだありません",
  "table.noAgentMetrics": "agent集計はまだありません",
  "table.noPublicOutcomeMetrics": "公開成績はまだありません",
  "table.noDecisions": "判断はまだありません",
  "table.noPublicDecisions": "公開判断はまだありません",
  "sections.executionControl": "実行制御",
  "sections.liveMetrics": "ライブ集計",
  "sections.liveAgents": "ライブagent",
  "sections.recentDecisions": "直近の判断",
  "sections.debugSnapshot": "Debug snapshot",
  "sections.debugInspector": "インスペクター",
  "debug.legalActions": "合法手",
  "debug.confidence": "確信度",
  "debug.probabilities": "確率",
  "debug.totalTokens": "合計token",
  "debug.provider": "プロバイダー",
  "debug.model": "モデル",
  "metrics.agent": "agent",
  "metrics.games": "対局",
  "metrics.hands": "局数",
  "metrics.wins": "和了",
  "metrics.dealIns": "放銃",
  "metrics.riichi": "リーチ",
  "metrics.calls": "鳴き",
  "metrics.decisionsLegal": "判断 / 合法",
  "metrics.fallback": "fallback",
  "metrics.errors": "エラー",
  "metrics.hybridEscalations": "Hybridエスカレーション",
  "metrics.latency": "latency 平均 / p50 / p95",
  "metrics.inputTokens": "入力token",
  "metrics.outputTokens": "出力token",
  "metrics.retries": "retry",
  "agent.decisionsP50": "{count}件の判断 · p50 {latency}ms",
  "agent.gamesHands": "{games}対局 · {hands}局",
  "decision.seat": "席",
  "decision.agent": "agent",
  "decision.requested": "要求",
  "decision.applied": "適用",
  "decision.action": "操作",
  "decision.validity": "合法性",
  "decision.latency": "latency",
  "decision.inputOutputTokens": "入力 / 出力token",
  "decision.retries": "retry",
  "decision.note": "注記",
  "decision.legal": "合法",
  "decision.fallback": "fallback",
  "fallback.retry": "retry",
  "fallback.latency": "latency",
  "fallback.token": "token",
  "fallback.hybridEscalation": "Hybridエスカレーション",
} satisfies Messages;

export const messages = { en, ja } satisfies Record<Locale, Messages>;

export type TranslationParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

function interpolate(message: string, params: TranslationParams | undefined): string {
  if (!params) return message;
  return message.replace(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? placeholder : String(value);
  });
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ja";
}

export function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, value);
}

function localeFromCandidate(value: unknown): Locale | undefined {
  return isLocale(value) ? value : undefined;
}

function languageLocale(value: unknown): Locale | undefined {
  if (typeof value !== "string") return undefined;
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return localeFromCandidate(language);
}

export interface LocaleResolutionOptions {
  url?: string | URL;
  search?: string;
  storedLocale?: unknown;
  storageLocale?: unknown;
  storage?: Pick<Storage, "getItem">;
  localStorage?: Pick<Storage, "getItem">;
  languages?: readonly string[];
  browserLanguages?: readonly string[];
  navigator?: { languages?: readonly string[]; language?: string };
}

interface BrowserLocaleGlobals {
  location?: { href?: string };
  localStorage?: Pick<Storage, "getItem">;
  navigator?: { languages?: readonly string[]; language?: string };
}

function readUrlLocale(url: string | URL | undefined): Locale | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url.toString(), "http://127.0.0.1");
    return localeFromCandidate(parsed.searchParams.get("locale"));
  } catch {
    return undefined;
  }
}

/** Resolve the browser locale without ever throwing for unavailable browser APIs. */
export function resolveLocale(options: LocaleResolutionOptions | string | URL = {}): Locale {
  const normalized: LocaleResolutionOptions = typeof options === "string" || options instanceof URL
    ? ((options.toString().includes("locale=") || options.toString().includes("?") || options.toString().includes("/")) ? { url: options } : { languages: [options.toString()] })
    : options;
  const browser = globalThis as unknown as BrowserLocaleGlobals;
  const fromUrl = readUrlLocale(normalized.url ?? normalized.search ?? browser.location?.href);
  if (fromUrl) return fromUrl;

  let stored = normalized.storedLocale ?? normalized.storageLocale;
  if (stored === undefined) {
    try {
      stored = (normalized.storage ?? normalized.localStorage ?? browser.localStorage)?.getItem(LOCALE_STORAGE_KEY);
    } catch {
      stored = undefined;
    }
  }
  const fromStorage = localeFromCandidate(stored);
  if (fromStorage) return fromStorage;

  const navigatorValue = normalized.navigator ?? browser.navigator;
  const languages = normalized.languages ?? normalized.browserLanguages ?? navigatorValue?.languages ?? (navigatorValue?.language ? [navigatorValue.language] : []);
  for (const language of languages) {
    const resolved = languageLocale(language);
    if (resolved) return resolved;
  }
  return DEFAULT_LOCALE;
}

export function t(
  key: MessageKey,
  params?: TranslationParams | Locale,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const paramsLocale = params && typeof params === "object" && isLocale(params.locale) ? params.locale : undefined;
  const requestedLocale = typeof params === "string" && isLocale(params) ? params : paramsLocale ?? locale;
  const selectedLocale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  const interpolationParams = typeof params === "string" ? undefined : params;
  const message = messages[selectedLocale][key] ?? messages.en[key];
  return interpolate(message, interpolationParams);
}

/** Runtime boundary for untyped values; typed UI lookups should use t(). */
export function translateUnknown(
  key: string,
  params?: TranslationParams | Locale,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (isMessageKey(key)) return t(key, params, locale);
  return interpolate(key, typeof params === "string" ? undefined : params);
}

const SEATS = ["E", "S", "W", "N"] as const;
const SEAT_LABELS: Record<Locale, Record<(typeof SEATS)[number], string>> = {
  en: { E: "E", S: "S", W: "W", N: "N" },
  ja: { E: "東", S: "南", W: "西", N: "北" },
};

export function formatSeat(value: string | number | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  const raw = typeof value === "string" ? value : undefined;
  const canonical = typeof value === "number" ? SEATS[value] : raw?.toUpperCase();
  if (!canonical || !isLocale(locale)) return raw ?? canonical ?? "—";
  return canonical in SEAT_LABELS[locale]
    ? SEAT_LABELS[locale][canonical as (typeof SEATS)[number]]
    : raw ?? canonical;
}

export function formatRound(value: string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!value) return "—";
  const match = /^([ESWN])(\d+)$/.exec(value.toUpperCase());
  if (!match) return value;
  if (locale !== "ja") return value;
  return `${formatSeat(match[1], locale)}${match[2]}局`;
}

const ACTION_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    dahai: "Discard",
    chi: "Chi",
    pon: "Pon",
    ankan: "Closed kan",
    daiminkan: "Open kan",
    kakan: "Added kan",
    reach: "Riichi",
    riichi: "Riichi",
    hora: "Win",
    ron: "Ron",
    tsumo: "Tsumo",
    ryukyoku: "Exhaustive draw",
    kyushukyuhai: "Nine terminals and honors",
    none: "Pass",
  },
  ja: {
    dahai: "打牌",
    chi: "チー",
    pon: "ポン",
    ankan: "暗槓",
    daiminkan: "大明槓",
    kakan: "加槓",
    reach: "リーチ",
    riichi: "リーチ",
    hora: "和了",
    ron: "ロン",
    tsumo: "ツモ",
    ryukyoku: "流局",
    kyushukyuhai: "九種九牌",
    none: "パス",
  },
};

export function formatActionType(value: string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!value) return "—";
  return ACTION_LABELS[locale]?.[value.toLowerCase()] ?? value;
}

const STATUS_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    idle: "Idle",
    running: "Running",
    stepping: "Stepping",
    paused: "Paused",
    complete: "Complete",
    failed: "Failed",
    error: "Error",
  },
  ja: {
    idle: "待機中",
    running: "進行中",
    stepping: "ステップ実行中",
    paused: "一時停止",
    complete: "完了",
    failed: "失敗",
    error: "エラー",
  },
};

export function formatStatus(value: string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!value) return "—";
  return STATUS_LABELS[locale]?.[value.toLowerCase()] ?? value;
}

const browserRuntimePayload = JSON.stringify({
  defaultLocale: DEFAULT_LOCALE,
  storageKey: LOCALE_STORAGE_KEY,
  messages,
  seats: SEATS,
  seatLabels: SEAT_LABELS,
  actionLabels: ACTION_LABELS,
  statusLabels: STATUS_LABELS,
});

/** Standalone browser runtime shared by live, replay, and video-export pages. */
export const localeRuntimeJs = String.raw`
  const localeRuntime = (() => {
    const payload = ${browserRuntimePayload};
    let currentLocale;
    let lastSnapshot;
    let snapshotRenderer;

    const exactLocale = (value) => value === "en" || value === "ja" ? value : undefined;
    const languageLocale = (value) => {
      if (typeof value !== "string") return undefined;
      return exactLocale(value.trim().toLowerCase().split(/[-_]/, 1)[0]);
    };
    const readStorage = () => {
      try { return globalThis.localStorage?.getItem(payload.storageKey); } catch (_) { return undefined; }
    };
    const urlLocale = () => {
      try { return exactLocale(new URLSearchParams(globalThis.location?.search || "").get("locale")); } catch (_) { return undefined; }
    };
    const browserLocale = () => {
      const preferred = globalThis.navigator?.languages;
      const languages = preferred && preferred.length ? preferred : (globalThis.navigator?.language ? [globalThis.navigator.language] : []);
      for (const language of languages) {
        const resolved = languageLocale(language);
        if (resolved) return resolved;
      }
      return payload.defaultLocale;
    };
    const resolve = () => urlLocale() || exactLocale(readStorage()) || browserLocale() || payload.defaultLocale;
    const interpolate = (message, params) => !params ? message : message.replace(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder, name) => {
      const value = params[name];
      return value === undefined || value === null ? placeholder : String(value);
    });
    const translate = (key, params) => {
      const selected = payload.messages[currentLocale] || payload.messages[payload.defaultLocale];
      return interpolate(selected[key] || payload.messages[payload.defaultLocale][key] || String(key), params);
    };
    const formatSeatValue = (value) => {
      const raw = typeof value === "string" ? value : undefined;
      const canonical = typeof value === "number" ? payload.seats[value] : raw?.toUpperCase();
      return canonical ? (payload.seatLabels[currentLocale]?.[canonical] || raw || canonical) : "—";
    };
    const formatRoundValue = (value) => {
      if (!value) return "—";
      const match = /^([ESWN])(\d+)$/.exec(String(value).toUpperCase());
      if (!match || currentLocale !== "ja") return String(value);
      return formatSeatValue(match[1]) + match[2] + "局";
    };
    const formatActionValue = (value) => !value ? "—" : payload.actionLabels[currentLocale]?.[String(value).toLowerCase()] || String(value);
    const formatStatusValue = (value) => !value ? "—" : payload.statusLabels[currentLocale]?.[String(value).toLowerCase()] || String(value);
    const applyStaticTranslations = () => {
      if (!globalThis.document) return;
      globalThis.document.documentElement.lang = currentLocale;
      globalThis.document.querySelectorAll("[data-i18n]").forEach((node) => {
        const key = node.getAttribute("data-i18n");
        if (key) node.textContent = translate(key);
      });
      globalThis.document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
        const key = node.getAttribute("data-i18n-aria-label");
        if (key) node.setAttribute("aria-label", translate(key));
      });
      const selector = globalThis.document.getElementById("locale-select");
      if (selector) selector.value = currentLocale;
    };
    const setLocale = (value) => {
      const next = exactLocale(value) || payload.defaultLocale;
      currentLocale = next;
      try { globalThis.localStorage?.setItem(payload.storageKey, next); } catch (_) { /* storage is optional */ }
      applyStaticTranslations();
      if (snapshotRenderer && lastSnapshot !== undefined) snapshotRenderer(lastSnapshot);
    };
    currentLocale = resolve();
    applyStaticTranslations();
    const selector = globalThis.document?.getElementById("locale-select");
    selector?.addEventListener("change", (event) => setLocale(event.target?.value));

    return {
      locale: () => currentLocale,
      t: translate,
      formatSeat: formatSeatValue,
      formatRound: formatRoundValue,
      formatActionType: formatActionValue,
      formatStatus: formatStatusValue,
      rememberSnapshot: (snapshot) => { lastSnapshot = snapshot; },
      setSnapshotRenderer: (renderer) => { snapshotRenderer = renderer; },
      applyStaticTranslations,
    };
  })();
`;
