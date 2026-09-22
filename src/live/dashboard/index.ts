import { localeRuntimeJs } from "./i18n.js";
import { decisionTableRendererJs, tableStateRendererJs } from "./renderer.js";

export const dashboardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title data-i18n="title.live">Jev Mahjong live tournament</title>
    <link rel="stylesheet" href="/assets/styles.css">
  </head>
  <body>
    <header>
      <div>
        <h1 data-i18n="title.live">Jev Mahjong live tournament</h1>
        <p id="connection" data-i18n="connection.connecting">Connecting…</p>
      </div>
      <div class="header-tools">
        <div id="mode" class="mode"></div>
        <label class="locale-control"><span data-i18n="settings.language">Language</span><select id="locale-select"><option value="en" data-i18n="locale.en">English</option><option value="ja" data-i18n="locale.ja">日本語</option></select></label>
      </div>
    </header>
    <main>
      <section class="summary grid">
        <article><span data-i18n="table.round">Round</span><strong id="round">—</strong></article>
        <article><span data-i18n="table.honba">Honba</span><strong id="honba">0</strong></article>
        <article><span data-i18n="table.kyotaku">Kyotaku</span><strong id="kyotaku">0</strong></article>
        <article><span data-i18n="table.games">Games</span><strong id="games">0 / 0</strong></article>
        <article><span data-i18n="table.dealer">Dealer</span><strong id="dealer">—</strong></article>
        <article><span data-i18n="table.currentTurn">Current turn</span><strong id="current-turn">—</strong></article>
        <article><span data-i18n="table.status">Status</span><strong id="status">idle</strong></article>
      </section>
      <section id="control-panel" hidden>
        <h2 data-i18n="sections.executionControl">Execution control</h2>
        <div class="control-row">
          <strong id="control-state">—</strong>
          <span><span data-i18n="table.next">next</span>: <code id="control-next">—</code></span>
          <span><span data-i18n="table.step">step</span>: <code id="control-step">0</code></span>
          <span id="control-pause-requested" class="muted"></span>
          <button id="control-pause" type="button" data-i18n="controls.pause">Pause</button>
          <button id="control-resume" type="button" data-i18n="controls.resume">Resume</button>
          <button id="control-step-button" type="button" data-i18n="controls.step">Step</button>
        </div>
        <p id="control-error" class="error"></p>
      </section>
      <section class="table-section">
        <h2 data-i18n="table.mahjongTable">Mahjong table</h2>
        <div id="mahjong-table" class="mahjong-table"></div>
      </section>
      <section>
        <h2 data-i18n="sections.liveMetrics">Live metrics</h2>
        <div id="metrics" class="table-wrap"></div>
      </section>
      <section><h2 data-i18n="sections.liveAgents">Live agents</h2><div id="agents"></div></section>
      <section id="debug-section" class="debug-section" hidden>
        <h2 data-i18n="sections.debugSnapshot">Debug snapshot</h2>
        <div id="debug-inspector" class="debug-inspector" hidden>
          <h3 data-i18n="sections.debugInspector">Inspector</h3>
          <div id="debug-inspector-content"></div>
        </div>
        <pre id="debug"></pre>
      </section>
    </main>
    <script src="/assets/app.js" defer></script>
  </body>
</html>`;

export const dashboardCss = `:root {
  color-scheme: dark;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  background: #10151d;
  color: #edf2f7;
}
* { box-sizing: border-box; }
body { margin: 0; background: radial-gradient(circle at top, #1a2634, #10151d 45%); min-height: 100vh; }
header { display: flex; justify-content: space-between; gap: 1rem; align-items: center; flex-wrap: wrap; padding: 1.5rem clamp(1rem, 4vw, 4rem); border-bottom: 1px solid #2a394b; }
header > div:first-child { min-width: 0; }
.header-tools { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: .75rem; min-width: 0; }
.locale-control { display: inline-flex; align-items: center; flex-wrap: wrap; gap: .4rem; overflow-wrap: anywhere; }
h1 { margin: 0; font-size: clamp(1.25rem, 3vw, 2rem); overflow-wrap: anywhere; }
h2 { font-size: 1rem; margin: 0 0 .75rem; color: #9fb6ca; overflow-wrap: anywhere; }
p { margin: .35rem 0 0; color: #91a3b5; overflow-wrap: anywhere; }
main { width: min(1200px, calc(100% - 2rem)); margin: 1.25rem auto 3rem; display: grid; gap: 1rem; }
.grid, .board-grid { display: grid; gap: .75rem; }
.grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
.board-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
article, section { min-width: 0; background: #18222e; border: 1px solid #2a394b; border-radius: .75rem; padding: 1rem; }
.summary article { display: grid; gap: .3rem; min-width: 0; }
.summary span { color: #91a3b5; font-size: .8rem; overflow-wrap: anywhere; }
.summary strong { font-size: 1.35rem; overflow-wrap: anywhere; }
.score-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .65rem; }
.score { display: flex; justify-content: space-between; align-items: center; gap: .5rem; min-width: 0; padding: .7rem; border-radius: .5rem; background: #202e3c; }
.score span { min-width: 0; overflow-wrap: anywhere; }
.score.current { outline: 2px solid #e1b866; }
.seat { color: #e1b866; font-weight: 700; }
.tiles { display: flex; flex-wrap: wrap; gap: .3rem; min-height: 2rem; }
.tile { display: inline-flex; min-width: 1.65rem; height: 2rem; align-items: center; justify-content: center; padding: 0 .25rem; border-radius: .25rem; background: #f1f0e9; color: #18222e; font-family: ui-monospace, monospace; font-size: .8rem; }
.tile.unknown { background: #69798a; color: #fff; }
.meld { display: block; color: #c6d3df; font-size: .8rem; margin: .3rem 0; word-break: break-word; overflow-wrap: anywhere; }
.agent { display: flex; justify-content: space-between; gap: .5rem; min-width: 0; border-bottom: 1px solid #2a394b; padding: .45rem 0; font-size: .85rem; }
.agent > * { min-width: 0; overflow-wrap: anywhere; }
.agent:last-child { border-bottom: 0; }
.muted { color: #91a3b5; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .82rem; }
th, td { text-align: left; padding: .55rem .45rem; border-bottom: 1px solid #2a394b; white-space: nowrap; }
th { color: #9fb6ca; }
.action-cell { max-width: 20rem; white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
.control-row, .replay-controls { display: flex; align-items: center; flex-wrap: wrap; gap: .65rem; }
.control-row > *, .replay-controls > * { min-width: 0; overflow-wrap: anywhere; }
.replay-controls input[type="range"] { flex: 1 1 14rem; min-width: 10rem; }
button, select { border: 1px solid #4e6d84; border-radius: .4rem; padding: .4rem .7rem; background: #223746; color: #edf2f7; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .45; }
.mode { padding: .35rem .6rem; border-radius: 999px; background: #275b70; font-size: .78rem; overflow-wrap: anywhere; }
.mode.debug { background: #875e29; }
.debug-section pre { max-height: 38rem; overflow: auto; white-space: pre-wrap; word-break: break-word; color: #c6d3df; }
.debug-inspector { margin-bottom: 1rem; }
.debug-inspector h3 { margin: 0 0 .6rem; color: #9fb6ca; font-size: .9rem; overflow-wrap: anywhere; }
.debug-inspector-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; margin: 0; }
.debug-inspector-grid > div { min-width: 0; padding: .6rem; border-radius: .45rem; background: #202e3c; }
.debug-inspector-grid dt { color: #9fb6ca; font-size: .78rem; overflow-wrap: anywhere; }
.debug-inspector-grid dd { margin: .25rem 0 0; overflow-wrap: anywhere; word-break: break-word; }
.error { color: #ff9c9c; }
.table-section { overflow: hidden; }
.replay-stage { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.replay-stage.debug-mode { grid-template-columns: minmax(0, 1.45fr) minmax(18rem, .65fr); align-items: start; }
.selection-label { color: #e1b866; min-width: 12rem; overflow-wrap: anywhere; }
.raw-debug { min-width: 0; }
.raw-debug-header { display: flex; justify-content: space-between; gap: .5rem; color: #9fb6ca; font-size: .8rem; }
.raw-debug input[type="range"] { width: 100%; margin: .6rem 0; }
.mahjong-table { position: relative; container-type: inline-size; width: 100%; max-width: 46rem; aspect-ratio: 1 / 1; min-height: 0; margin-inline: auto; border-radius: .75rem; background: radial-gradient(circle, #1f684e, #124033 70%); border: .4rem solid #6f4c2b; box-shadow: inset 0 0 0 .2rem #9a6a39; }
.table-center { position: absolute; inset: 39%; display: flex; flex-direction: column; justify-content: center; gap: .6cqw; padding: 1cqw; border-radius: 1cqw; background: rgba(9, 28, 26, .82); border: 1px solid rgba(255,255,255,.2); text-align: center; }
.center-round { font-size: 2.4cqw; font-weight: 800; }
.center-meta, .center-turn { display: flex; justify-content: center; flex-wrap: wrap; gap: .6cqw; color: #c6d3df; font-size: 1.4cqw; }
.center-dora { display: grid; gap: .3cqw; justify-items: center; color: #e1b866; font-size: 1.4cqw; }
.center-dora-tiles { display: flex; justify-content: center; gap: .15cqw; }
/* Each seat uses the same square coordinate system, rotated once around the table. */
.seat-zone { position: absolute; inset: 0; pointer-events: none; }
.seat-zone.dealer .seat-labels { color: #ffe0a0; }
.seat-labels { position: absolute; bottom: .8%; left: 25%; width: 50%; display: flex; align-items: center; justify-content: center; gap: .6cqw; color: #f3f6f8; font-size: 1.6cqw; white-space: nowrap; }
.seat-labels strong { overflow: hidden; text-overflow: ellipsis; max-width: 55%; }
.seat-zone.position-top .seat-labels { top: .8%; bottom: auto; }
.seat-zone.position-left .seat-labels { left: 1.8%; top: 50%; bottom: auto; width: auto; transform-origin: center; transform: translate(-50%, -50%) rotate(90deg); }
.seat-zone.position-right .seat-labels { left: auto; right: 1.8%; top: 50%; bottom: auto; width: auto; transform-origin: center; transform: translate(50%, -50%) rotate(-90deg); }
.oriented-frame { position: absolute; inset: 0; transform: rotate(var(--seat-rotation)); transform-origin: center; }
.oriented-tiles { display: contents; }
.hand-area { display: flex; position: absolute; bottom: 4%; left: 24%; width: 52%; justify-content: center; }
.table-hand { display: flex; flex-wrap: nowrap; align-items: flex-end; justify-content: center; gap: .15cqw; width: max-content; max-width: 100%; min-width: 0; }
.current-actor .table-hand { border-radius: .5cqw; outline: .2cqw solid #e1b866; outline-offset: .6cqw; }
.river { display: grid; grid-template-columns: repeat(6, max-content); position: absolute; top: 64%; left: 50%; transform: translateX(-50%); align-items: end; gap: .15cqw; }
.meld-slot { position: absolute; bottom: 12%; inset-inline-end: 3%; max-width: 65%; }
.table-melds { display: flex; flex-direction: row-reverse; flex-wrap: nowrap; align-items: flex-end; gap: .7cqw; }
.meld-set { position: relative; display: inline-flex; align-items: flex-end; gap: .1cqw; }
.tile-image { position: relative; display: inline-flex; flex: 0 0 auto; width: 2.9cqw; height: 4.14cqw; align-items: center; justify-content: center; }
.tile-body { display: flex; width: 100%; height: 100%; min-width: 0; align-items: center; justify-content: center; overflow: hidden; background: #f4f0df; border: 1px solid #b7ad91; border-radius: .3cqw; box-shadow: 0 .15cqw .2cqw rgba(0,0,0,.35); }
.tile-face { display: block; width: 100%; height: 100%; object-fit: contain; }
.tile-image.concealed { opacity: .92; }
/* The sideways footprint stays in normal flow; added kan tiles share its column. */
.called-stack { position: relative; display: inline-block; width: 4.14cqw; height: 2.9cqw; flex: 0 0 auto; }
.called-stack .tile-image { position: absolute; left: 50%; bottom: 50%; transform: translate(-50%, 50%) rotate(90deg); }
.kakan-stack { height: 5.9cqw; }
.kakan-stack .tile-image { bottom: 1.45cqw; }
.kakan-stack .kakan-added { bottom: 4.45cqw; }
.tile-image.riichi-discard { width: 4.14cqw; height: 2.9cqw; }
.tile-image.riichi-discard .tile-body { position: absolute; width: 2.9cqw; height: 4.14cqw; transform: rotate(90deg); }
.tile-image.latest-discard { outline: 2px solid #ffe08a; outline-offset: 1px; border-radius: .3cqw; }
.draw-gap { display: inline-flex; margin-left: .8cqw; }
@media (max-width: 760px) { .grid, .board-grid, .score-grid, .debug-inspector-grid { grid-template-columns: 1fr 1fr; } .board-grid article:last-child { grid-column: 1 / -1; } }
@media (max-width: 900px) { .replay-stage.debug-mode { grid-template-columns: 1fr; } }
@media (max-width: 460px) { header { align-items: flex-start; } .header-tools { width: 100%; justify-content: space-between; } .grid, .board-grid, .score-grid, .debug-inspector-grid { grid-template-columns: 1fr; } .table-section { padding: .5rem; } }
`;

export const dashboardJs = `(function () {
${localeRuntimeJs}
${tableStateRendererJs}
${decisionTableRendererJs}
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "debug" ? "debug" : "spectator";
  const seats = ["E", "S", "W", "N"];
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char.charCodeAt(0) === 34 ? "&quot;" : "&#39;");
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = String(value ?? "—"); };
  const label = (key, params) => localeRuntime.t(key, params);
  const metricHeader = (key) => '<th>' + label(key) + '</th>';
  let connectionKey = "connection.connecting";
  let connectionError;
  const setConnection = (key) => { connectionKey = key; connectionError = undefined; setText("connection", label(key)); $("connection").classList.remove("error"); };
  const setConnectionError = (error) => { connectionError = error instanceof Error ? error.message : String(error); setText("connection", connectionError); $("connection").classList.add("error"); };
  const refreshConnection = () => { if (!connectionError) setText("connection", label(connectionKey)); };
  function modeLabel() {
    return label(mode === "debug" ? "mode.debug" : "mode.spectator") + (mode === "debug" ? " · " + label("mode.localOnly") : "");
  }
  function render(snapshot) {
    setText("round", localeRuntime.formatRound(snapshot.round));
    setText("honba", snapshot.honba);
    setText("kyotaku", snapshot.kyotaku);
    setText("games", (snapshot.tournament?.completedGames || 0) + " / " + (snapshot.tournament?.totalGames || 0));
    setText("dealer", localeRuntime.formatSeat(tableWindForPlayer(snapshot, snapshot.oya)));
    setText("current-turn", localeRuntime.formatSeat(tableWindForPlayer(snapshot, snapshot.currentSeat)));
    setText("status", localeRuntime.formatStatus(snapshot.status));
    renderTableState(snapshot, mode);
    const agents = $("agents");
    const agentEntries = Object.entries(snapshot.agents || {});
    agents.innerHTML = agentEntries.length ? agentEntries.map(([id, value]) => mode === "debug"
      ? '<div class="agent"><b>' + escapeHtml(id) + '</b><span>' + escapeHtml(label('agent.decisionsP50', { count: value.decisions || 0, latency: Number(value.latency?.p50Ms || 0).toFixed(1) })) + '</span></div>'
      : '<div class="agent"><b>' + escapeHtml(id) + '</b><span>' + escapeHtml(label('agent.gamesHands', { games: value.completedGames || 0, hands: value.handCount || 0 })) + '</span></div>').join("") : '<span class="muted">' + label('table.noAgentMetrics') + '</span>';
    const rate = (count, total) => total ? (Number(count || 0) / total * 100).toFixed(1) + '%' : '—';
    const publicMetricRows = agentEntries.map(([id, value]) => {
      const hands = Number(value.handCount || 0);
      return '<tr><td>' + escapeHtml(id) + '</td><td>' + escapeHtml(value.completedGames || 0) + '</td><td>' + escapeHtml(hands) + '</td><td>' + escapeHtml(value.wins || 0) + ' (' + rate(value.wins, hands) + ')</td><td>' + escapeHtml(value.dealIns || 0) + ' (' + rate(value.dealIns, hands) + ')</td><td>' + escapeHtml(value.riichi || 0) + ' (' + rate(value.riichi, hands) + ')</td><td>' + escapeHtml(value.calls || 0) + ' (' + rate(value.calls, hands) + ')</td></tr>';
    }).join("");
    const debugMetricRows = agentEntries.map(([id, value]) => {
      const latency = value.latency || {};
      const hands = Number(value.handCount || 0);
      const decisions = Number(value.decisions || 0);
      return '<tr><td>' + escapeHtml(id) + '</td><td>' + escapeHtml(value.completedGames || 0) + '</td><td>' + escapeHtml(hands) + '</td><td>' + escapeHtml(value.wins || 0) + ' (' + rate(value.wins, hands) + ')</td><td>' + escapeHtml(value.dealIns || 0) + ' (' + rate(value.dealIns, hands) + ')</td><td>' + escapeHtml(value.riichi || 0) + ' (' + rate(value.riichi, hands) + ')</td><td>' + escapeHtml(value.calls || 0) + ' (' + rate(value.calls, hands) + ')</td><td>' + escapeHtml(decisions) + ' / ' + escapeHtml(value.legalDecisions || 0) + '</td><td>' + escapeHtml(value.fallbackCount || 0) + ' (' + rate(value.fallbackCount, decisions) + ')</td><td>' + escapeHtml(value.errorCount || 0) + ' (' + rate(value.errorCount, decisions) + ')</td><td>' + escapeHtml(value.escalationCount || 0) + ' (' + rate(value.escalationCount, decisions) + ')</td><td>' + escapeHtml(Number(latency.meanMs || 0).toFixed(1)) + ' / ' + escapeHtml(Number(latency.p50Ms || 0).toFixed(1)) + ' / ' + escapeHtml(Number(latency.p95Ms || 0).toFixed(1)) + 'ms</td><td>' + escapeHtml(value.inputTokens || 0) + '</td><td>' + escapeHtml(value.outputTokens || 0) + '</td><td>' + escapeHtml(value.retryCount || 0) + '</td></tr>';
    }).join("");
    const publicHeaders = ["metrics.agent", "metrics.games", "metrics.hands", "metrics.wins", "metrics.dealIns", "metrics.riichi", "metrics.calls"].map(metricHeader).join("");
    const debugHeaders = ["metrics.agent", "metrics.games", "metrics.hands", "metrics.wins", "metrics.dealIns", "metrics.riichi", "metrics.calls", "metrics.decisionsLegal", "metrics.fallback", "metrics.errors", "metrics.hybridEscalations", "metrics.latency", "metrics.inputTokens", "metrics.outputTokens", "metrics.retries"].map(metricHeader).join("");
    $("metrics").innerHTML = mode === "debug"
      ? '<table><thead><tr>' + debugHeaders + '</tr></thead><tbody>' + (debugMetricRows || '<tr><td colspan="15" class="muted">' + label('table.noAgentMetrics') + '</td></tr>') + '</tbody></table>'
      : '<table><thead><tr>' + publicHeaders + '</tr></thead><tbody>' + (publicMetricRows || '<tr><td colspan="7" class="muted">' + label('table.noPublicOutcomeMetrics') + '</td></tr>') + '</tbody></table>';
    renderDecisionTable(snapshot, mode);
    const debugSection = $("debug-section");
    debugSection.hidden = mode !== "debug";
    const debugInspector = $("debug-inspector");
    debugInspector.hidden = mode !== "debug";
    if (mode === "debug") {
      renderDebugInspector(snapshot);
      $("debug").textContent = JSON.stringify(snapshot.debug || {}, null, 2);
    }
  }
  const controlPanel = $("control-panel");
  const controlError = $("control-error");
  let lastControl;
  function renderControl(control) {
    controlPanel.hidden = false;
    setText("control-state", localeRuntime.formatStatus(control.state));
    setText("control-next", control.nextStep || "—");
    setText("control-step", control.stepNumber || 0);
    setText("control-pause-requested", control.pauseRequested ? label("table.pauseRequested") : "");
    $("control-pause").disabled = control.state !== "running" && control.state !== "stepping";
    $("control-resume").disabled = control.state !== "paused";
    $("control-step-button").disabled = control.state !== "paused";
    controlError.textContent = "";
  }
  localeRuntime.setSnapshotRenderer((snapshot) => {
    $("mode").textContent = modeLabel();
    refreshConnection();
    render(snapshot);
    if (lastControl) renderControl(lastControl);
  });
  async function refreshControl() {
    const response = await fetch("/api/control", { cache: "no-store" });
    if (response.status === 404) {
      controlPanel.hidden = true;
      lastControl = undefined;
      return;
    }
    if (!response.ok) throw new Error(label("connection.controlStatusRequestFailed"));
    const control = await response.json();
    lastControl = control;
    renderControl(control);
  }
  async function sendControl(path) {
    try {
      const response = await fetch(path, { method: "POST", cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || label("connection.controlRequestFailed"));
      await refreshControl();
    } catch (error) {
      controlError.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  $("control-pause").addEventListener("click", () => { void sendControl("/api/control/pause"); });
  $("control-resume").addEventListener("click", () => { void sendControl("/api/control/resume"); });
  $("control-step-button").addEventListener("click", () => { void sendControl("/api/control/step"); });
  $("mode").textContent = modeLabel();
  if (mode === "debug") $("mode").classList.add("debug");
  let source;
  let lastEventId = 0;
  async function refresh() {
    const response = await fetch("/api/snapshot?mode=" + mode, { cache: "no-store" });
    if (!response.ok) throw new Error(label("connection.snapshotRequestFailed"));
    const snapshot = await response.json();
    lastEventId = snapshot.lastEventId || lastEventId;
    localeRuntime.rememberSnapshot(snapshot);
    render(snapshot);
  }
  function connect() {
    if (source) source.close();
    source = new EventSource("/api/events?mode=" + mode + "&after=" + lastEventId);
    const onEvent = (event) => {
      try { const envelope = JSON.parse(event.data); lastEventId = envelope.id || lastEventId; } catch (_) { /* snapshot refresh is authoritative */ }
      refresh().catch((error) => { setConnectionError(error); });
    };
    ["tournament:start", "tournament:progress", "game:start", "mjai", "decision:start", "decision:end", "game:end", "tournament:end", "tournament:error"].forEach((name) => source.addEventListener(name, onEvent));
    source.addEventListener("reset", () => { refresh().then(connect).catch(() => connect()); });
    source.onopen = () => { setConnection("connection.live"); };
    source.onerror = () => { setConnection("connection.reconnecting"); };
  }
  setInterval(() => { void refreshControl().catch((error) => { controlError.textContent = error.message; }); }, 1_000);
  void refreshControl().catch((error) => { controlError.textContent = error.message; });
  setConnection("connection.connecting");
  refresh().then(connect).catch((error) => { setConnectionError(error); });
})();`;
