import { createServer, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dashboardCss } from "../live/dashboard/index.js";
import { tileAssetPath } from "../live/dashboard/tiles.js";
import { localeRuntimeJs } from "../live/dashboard/i18n.js";
import { decisionTableRendererJs, tableStateRendererJs } from "../live/dashboard/renderer.js";
import type { LiveMode } from "../live/events.js";
import { ReplayTimeline } from "./timeline.js";

export interface ReplayServerOptions {
  timeline: ReplayTimeline;
  host?: string;
  port?: number;
}

export interface ReplayServer {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  listen(): Promise<number>;
  close(): Promise<void>;
}

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

function mode(value: string | null): LiveMode {
  if (value === "debug") return "debug";
  if (value === "spectator" || value === null || value === "") return "spectator";
  throw new Error("mode must be spectator or debug");
}

function integer(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("cursor must be an integer");
  return parsed;
}

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": CSP,
  });
  response.end(body);
}

function textResponse(response: ServerResponse, contentType: string, body: string): void {
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Content-Security-Policy": CSP,
  });
  response.end(body);
}

export const replayDashboardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title data-i18n="title.replay">Jev Mahjong replay</title>
    <link rel="stylesheet" href="/assets/styles.css">
  </head>
  <body>
    <header><div><h1 data-i18n="title.replay">Jev Mahjong replay</h1><p id="connection" data-i18n="connection.loading">Loading…</p></div><div class="header-tools"><div id="mode" class="mode"></div><label class="locale-control"><span data-i18n="settings.language">Language</span><select id="locale-select"><option value="en" data-i18n="locale.en">English</option><option value="ja" data-i18n="locale.ja">日本語</option></select></label></div></header>
    <main>
      <section class="replay-controls">
        <button id="play" type="button" data-i18n="controls.play">Play</button>
        <button id="previous" type="button" data-i18n="controls.previous">Previous</button>
        <button id="next" type="button" data-i18n="controls.next">Next</button>
        <button id="previous-hand" type="button" data-i18n="controls.previousHand">Previous hand</button>
        <button id="hand-start" type="button" data-i18n="controls.handStart">Hand start</button>
        <button id="hand-end" type="button" data-i18n="controls.handEnd">Hand end</button>
        <button id="next-hand" type="button" data-i18n="controls.nextHand">Next hand</button>
        <label><span data-i18n="controls.speed">Speed</span> <select id="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        <label><span data-i18n="controls.mode">Mode</span> <select id="mode-select"><option value="spectator" data-i18n="mode.spectator">Spectator</option><option value="debug" data-i18n="mode.debug">Debug</option></select></label>
        <span id="cursor-label">0 / 0</span>
        <input id="cursor" type="range" min="0" max="0" value="0">
      </section>
      <section class="summary grid">
        <article><span data-i18n="table.round">Round</span><strong id="round">—</strong></article>
        <article><span data-i18n="table.honba">Honba</span><strong id="honba">0</strong></article>
        <article><span data-i18n="table.kyotaku">Kyotaku</span><strong id="kyotaku">0</strong></article>
        <article><span data-i18n="replay.hand">Hand</span><strong id="hand">—</strong></article>
        <article><span data-i18n="table.dealer">Dealer</span><strong id="dealer">—</strong></article>
        <article><span data-i18n="table.currentTurn">Current turn</span><strong id="current-turn">—</strong></article>
        <article><span data-i18n="table.status">Status</span><strong id="status">idle</strong></article>
      </section>
      <section class="table-section"><h2 data-i18n="table.mahjongTable">Mahjong table</h2><div id="mahjong-table" class="mahjong-table"></div></section>
      <section><h2 data-i18n="sections.recentDecisions">Recent decisions</h2><div id="decisions" class="table-wrap"></div></section>
      <section id="debug-section" class="debug-section" hidden><h2 data-i18n="sections.debugSnapshot">Debug snapshot</h2><pre id="debug"></pre></section>
    </main>
    <script src="/assets/app.js" defer></script>
  </body>
</html>`;

export const replayDashboardJs = `(function () {
${localeRuntimeJs}
${tableStateRendererJs}
${decisionTableRendererJs}
  const seats = ["E", "S", "W", "N"];
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let mode = params.get("mode") === "debug" ? "debug" : "spectator";
  let cursor = Number(params.get("cursor") || 0);
  let eventCount = 0;
  let replayIndex = { games: [] };
  let playing = false;
  let timer;
  let requestGeneration = 0;
  let requestController;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char.charCodeAt(0) === 34 ? "&quot;" : "&#39;");
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = String(value ?? "—"); };
  const label = (key, params) => localeRuntime.t(key, params);
  function modeLabel() {
    return label(mode === "debug" ? "mode.debug" : "mode.spectator") + (mode === "debug" ? " · " + label("mode.localOnly") : "");
  }
  function hands() {
    return replayIndex.games.flatMap((game) => (game.hands || []).map((hand) => ({ game, hand }))).sort((left, right) => left.hand.startSequence - right.hand.startSequence);
  }
  function handEnd(entry, all) {
    if (entry.hand.endSequence != null) return entry.hand.endSequence;
    const index = all.findIndex((candidate) => candidate.hand.startSequence === entry.hand.startSequence);
    const next = all[index + 1];
    const gameEnd = entry.game.endSequence ?? eventCount;
    return Math.min(gameEnd, next ? next.hand.startSequence - 1 : gameEnd);
  }
  function handContaining(value, all) {
    return all.find((entry) => entry.hand.startSequence <= value && value <= handEnd(entry, all));
  }
  function previousHand(value, all) {
    return all.filter((entry) => handEnd(entry, all) < value).at(-1);
  }
  function nextHand(value, all) {
    return all.find((entry) => entry.hand.startSequence > value);
  }
  function updateHandControls() {
    const all = hands();
    const current = handContaining(cursor, all);
    setText("hand", current ? String(current.hand.handIndex + 1) + " / " + String(current.game.hands.length) : "—");
    $("hand-start").disabled = !current;
    $("hand-end").disabled = !current;
    $("previous-hand").disabled = !previousHand(cursor, all);
    $("next-hand").disabled = !nextHand(cursor, all);
  }
  function goTo(value) {
    cursor = Math.max(0, Math.min(eventCount, value));
    void refresh().catch((error) => { $("connection").textContent = error.message; });
  }
  function render(snapshot, metadata) {
    setText("round", localeRuntime.formatRound(snapshot.round));
    setText("honba", snapshot.honba);
    setText("kyotaku", snapshot.kyotaku);
    setText("dealer", localeRuntime.formatSeat(tableWindForPlayer(snapshot, snapshot.oya)));
    setText("current-turn", localeRuntime.formatSeat(tableWindForPlayer(snapshot, snapshot.currentSeat)));
    setText("status", localeRuntime.formatStatus(snapshot.status));
    updateHandControls();
    setText("cursor-label", metadata.cursor + " / " + metadata.eventCount);
    $("cursor").value = metadata.cursor;
    renderTableState(snapshot, mode);
    renderDecisionTable(snapshot, mode);
    const debugSection = $("debug-section");
    debugSection.hidden = mode !== "debug";
    if (mode === "debug") $("debug").textContent = JSON.stringify(snapshot.debug || {}, null, 2);
  }
  localeRuntime.setSnapshotRenderer((body) => {
    $("mode").textContent = modeLabel();
    $("mode").classList.toggle("debug", mode === "debug");
    $("play").textContent = playing ? label("controls.pause") : label("controls.play");
    if (body?.replay) {
      render(body, body.replay);
      $("connection").textContent = label("connection.offlineReplay");
    }
  });
  async function refresh() {
    const generation = ++requestGeneration;
    if (requestController) requestController.abort();
    const controller = new AbortController();
    requestController = controller;
    try {
      const response = await fetch("/api/replay/snapshot?cursor=" + cursor + "&mode=" + mode, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(label("connection.replaySnapshotRequestFailed"));
      const body = await response.json();
      if (generation !== requestGeneration) return;
      cursor = body.replay.cursor;
      eventCount = body.replay.eventCount;
      $("cursor").max = eventCount;
      localeRuntime.rememberSnapshot(body);
      render(body, body.replay);
      $("connection").textContent = label("connection.offlineReplay");
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return;
      throw error;
    } finally {
      if (generation === requestGeneration) requestController = undefined;
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (!playing) return;
    timer = setTimeout(async () => {
      if (cursor >= eventCount) { playing = false; $("play").textContent = label("controls.play"); return; }
      cursor += 1;
      await refresh().catch((error) => { $("connection").textContent = error.message; });
      schedule();
    }, 1000 / (Number($("speed").value) * 10));
  }
  $("play").addEventListener("click", () => { playing = !playing; $("play").textContent = playing ? label("controls.pause") : label("controls.play"); schedule(); });
  $("previous").addEventListener("click", () => goTo(cursor - 1));
  $("next").addEventListener("click", () => goTo(cursor + 1));
  $("cursor").addEventListener("input", (event) => goTo(Number(event.target.value)));
  $("hand-start").addEventListener("click", () => { const all = hands(); const current = handContaining(cursor, all); if (current) goTo(current.hand.startSequence); });
  $("hand-end").addEventListener("click", () => { const all = hands(); const current = handContaining(cursor, all); if (current) goTo(handEnd(current, all)); });
  $("previous-hand").addEventListener("click", () => { const entry = previousHand(cursor, hands()); if (entry) goTo(entry.hand.startSequence); });
  $("next-hand").addEventListener("click", () => { const entry = nextHand(cursor, hands()); if (entry) goTo(entry.hand.startSequence); });
  $("mode-select").value = mode;
  $("mode").textContent = modeLabel();
  if (mode === "debug") $("mode").classList.add("debug");
  $("mode-select").addEventListener("change", (event) => { mode = event.target.value === "debug" ? "debug" : "spectator"; $("mode").textContent = modeLabel(); $("mode").classList.toggle("debug", mode === "debug"); void refresh(); });
  Promise.all([
    fetch("/api/replay/manifest", { cache: "no-store" }).then((response) => response.json()),
    fetch("/api/replay/index", { cache: "no-store" }).then((response) => response.json()),
  ]).then(([manifest, index]) => {
    eventCount = manifest.eventCount;
    replayIndex = index;
    $("cursor").max = eventCount;
    updateHandControls();
    return refresh();
  }).catch((error) => { $("connection").textContent = error.message; });
})();`;

export function createReplayServer(options: ReplayServerOptions): ReplayServer {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3_000;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("replay server port must be an integer from 0 to 65535");
  const server = createServer((request, response) => {
    void handleReplayRequest(request, response, options).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      jsonResponse(response, 400, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  let actualPort = port;
  return {
    server,
    host,
    get port() { return actualPort; },
    listen: () => new Promise<number>((resolvePromise, reject) => {
      const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("replay server did not expose a TCP address"));
        actualPort = address.port;
        resolvePromise(actualPort);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    }),
    close: () => new Promise<void>((resolvePromise, reject) => {
      if (!server.listening) return resolvePromise();
      server.closeAllConnections?.();
      server.close((error) => error ? reject(error) : resolvePromise());
    }),
  };
}

async function handleReplayRequest(
  request: import("node:http").IncomingMessage,
  response: ServerResponse,
  options: ReplayServerOptions,
): Promise<void> {
  if (request.method !== "GET") {
    jsonResponse(response, 405, { error: "method not allowed" });
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/") return textResponse(response, "text/html; charset=utf-8", replayDashboardHtml);
  if (url.pathname === "/assets/app.js") return textResponse(response, "text/javascript; charset=utf-8", replayDashboardJs);
  if (url.pathname === "/assets/styles.css") return textResponse(response, "text/css; charset=utf-8", dashboardCss);
  if (url.pathname.startsWith("/assets/tiles/")) {
    const filename = decodeURIComponent(url.pathname.slice("/assets/tiles/".length));
    const path = tileAssetPath(filename);
    if (!path) return jsonResponse(response, 404, { error: "tile asset not found" });
    return textResponse(response, "image/svg+xml; charset=utf-8", await readFile(path, "utf8"));
  }
  if (url.pathname === "/api/health") return jsonResponse(response, 200, { ok: true, eventCount: options.timeline.eventCount });
  if (url.pathname === "/api/replay/manifest") return jsonResponse(response, 200, options.timeline.data.manifest);
  if (url.pathname === "/api/replay/index") return jsonResponse(response, 200, options.timeline.data.index);
  if (url.pathname === "/api/replay/snapshot") {
    const cursor = integer(url.searchParams.get("cursor"), 0);
    const snapshot = options.timeline.snapshot(cursor, mode(url.searchParams.get("mode")));
    return jsonResponse(response, 200, {
      ...snapshot.snapshot,
      replay: {
        cursor: snapshot.cursor,
        eventCount: options.timeline.eventCount,
        checkpointSequence: snapshot.checkpointSequence,
        appliedDeltaCount: snapshot.appliedDeltaCount,
      },
    });
  }
  if (url.pathname === "/api/replay/events") {
    const from = integer(url.searchParams.get("from"), 1);
    const to = integer(url.searchParams.get("to"), options.timeline.eventCount);
    return jsonResponse(response, 200, options.timeline.events(from, to, mode(url.searchParams.get("mode"))));
  }
  jsonResponse(response, 404, { error: "not found" });
}
