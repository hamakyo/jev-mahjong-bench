import { createServer, type Server, type ServerResponse } from "node:http";
import { dashboardCss } from "../live/dashboard/index.js";
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
    <title>Jev Mahjong replay</title>
    <link rel="stylesheet" href="/assets/styles.css">
  </head>
  <body>
    <header><div><h1>Jev Mahjong replay</h1><p id="connection">Loading…</p></div><div id="mode" class="mode"></div></header>
    <main>
      <section class="replay-controls">
        <button id="play" type="button">Play</button>
        <button id="previous" type="button">◀</button>
        <button id="next" type="button">▶</button>
        <label>Speed <select id="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        <label>Mode <select id="mode-select"><option value="spectator">Spectator</option><option value="debug">Debug</option></select></label>
        <span id="cursor-label">0 / 0</span>
        <input id="cursor" type="range" min="0" max="0" value="0">
      </section>
      <section class="summary grid">
        <article><span>Round</span><strong id="round">—</strong></article>
        <article><span>Honba</span><strong id="honba">0</strong></article>
        <article><span>Kyotaku</span><strong id="kyotaku">0</strong></article>
        <article><span>Status</span><strong id="status">idle</strong></article>
      </section>
      <section><h2>Scores</h2><div id="scores" class="score-grid"></div></section>
      <section class="board-grid">
        <article><h2>Discards</h2><div id="discards"></div></article>
        <article><h2>Melds</h2><div id="melds"></div></article>
        <article><h2>Dora</h2><div id="dora" class="tiles"></div><div id="events" class="muted"></div></article>
      </section>
      <section id="debug-section" class="debug-section" hidden><h2>Debug snapshot</h2><pre id="debug"></pre></section>
    </main>
    <script src="/assets/app.js" defer></script>
  </body>
</html>`;

export const replayDashboardJs = `(function () {
  const seats = ["E", "S", "W", "N"];
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let mode = params.get("mode") === "debug" ? "debug" : "spectator";
  let cursor = Number(params.get("cursor") || 0);
  let eventCount = 0;
  let playing = false;
  let timer;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char.charCodeAt(0) === 34 ? "&quot;" : "&#39;");
  const tile = (value) => '<span class="tile">' + escapeHtml(value || "?") + '</span>';
  const tileList = (values) => (Array.isArray(values) ? values : []).map(tile).join("") || '<span class="muted">—</span>';
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = String(value ?? "—"); };
  function render(snapshot, metadata) {
    setText("round", snapshot.round || "—");
    setText("honba", snapshot.honba);
    setText("kyotaku", snapshot.kyotaku);
    setText("status", snapshot.status);
    setText("cursor-label", metadata.cursor + " / " + metadata.eventCount);
    $("cursor").value = metadata.cursor;
    const scoreNode = $("scores");
    scoreNode.innerHTML = seats.map((seat, index) => '<div class="score ' + (snapshot.currentSeat === index ? 'current' : '') + '"><span><b class="seat">' + seat + '</b> ' + escapeHtml(snapshot.seatAgents?.[seat] || '—') + '<br><small>rank ' + escapeHtml(snapshot.ranks?.[index] ?? '—') + '</small></span><strong>' + escapeHtml(snapshot.scores?.[index] ?? '—') + '</strong></div>').join("");
    const renderBySeat = (id, values, formatter) => { const node = $(id); node.innerHTML = seats.map((seat) => '<div><div class="seat">' + seat + (snapshot.riichi?.[seat] ? ' · riichi' : '') + '</div>' + formatter(values?.[seat] || []) + '</div>').join(""); };
    renderBySeat("discards", snapshot.discards, (values) => '<div class="tiles">' + tileList(values) + '</div>');
    renderBySeat("melds", snapshot.melds, (values) => values.length ? values.map((value) => '<span class="meld">' + escapeHtml(value) + '</span>').join("") : '<span class="muted">—</span>');
    $("dora").innerHTML = tileList(snapshot.doraIndicators);
    $("events").innerHTML = (snapshot.recentEvents || []).slice(-8).reverse().map((event) => '<div>' + escapeHtml(event.type || "unknown") + '</div>').join("") || "No events yet";
    const debugSection = $("debug-section");
    debugSection.hidden = mode !== "debug";
    if (mode === "debug") $("debug").textContent = JSON.stringify(snapshot.debug || {}, null, 2);
  }
  async function refresh() {
    const response = await fetch("/api/replay/snapshot?cursor=" + cursor + "&mode=" + mode, { cache: "no-store" });
    if (!response.ok) throw new Error("replay snapshot request failed");
    const body = await response.json();
    cursor = body.replay.cursor;
    eventCount = body.replay.eventCount;
    $("cursor").max = eventCount;
    render(body, body.replay);
    $("connection").textContent = "Offline replay";
  }
  function schedule() {
    clearTimeout(timer);
    if (!playing) return;
    timer = setTimeout(async () => {
      if (cursor >= eventCount) { playing = false; $("play").textContent = "Play"; return; }
      cursor += 1;
      await refresh().catch((error) => { $("connection").textContent = error.message; });
      schedule();
    }, 1000 / (Number($("speed").value) * 10));
  }
  $("play").addEventListener("click", () => { playing = !playing; $("play").textContent = playing ? "Pause" : "Play"; schedule(); });
  $("previous").addEventListener("click", () => { cursor = Math.max(0, cursor - 1); void refresh(); });
  $("next").addEventListener("click", () => { cursor = Math.min(eventCount, cursor + 1); void refresh(); });
  $("cursor").addEventListener("input", (event) => { cursor = Number(event.target.value); void refresh(); });
  $("mode-select").value = mode;
  $("mode").textContent = mode === "debug" ? "DEBUG · local only" : "SPECTATOR";
  if (mode === "debug") $("mode").classList.add("debug");
  $("mode-select").addEventListener("change", (event) => { mode = event.target.value === "debug" ? "debug" : "spectator"; $("mode").textContent = mode === "debug" ? "DEBUG · local only" : "SPECTATOR"; $("mode").classList.toggle("debug", mode === "debug"); void refresh(); });
  fetch("/api/replay/manifest", { cache: "no-store" }).then((response) => response.json()).then((manifest) => { eventCount = manifest.eventCount; $("cursor").max = eventCount; return refresh(); }).catch((error) => { $("connection").textContent = error.message; });
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
  if (url.pathname === "/api/health") return jsonResponse(response, 200, { ok: true, eventCount: options.timeline.eventCount });
  if (url.pathname === "/api/replay/manifest") return jsonResponse(response, 200, options.timeline.data.manifest);
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
