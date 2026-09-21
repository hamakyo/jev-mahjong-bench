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
      <section>
        <h2 data-i18n="table.scores">Scores</h2>
        <div id="scores" class="score-grid"></div>
      </section>
      <section>
        <h2 data-i18n="sections.liveMetrics">Live metrics</h2>
        <div id="metrics" class="table-wrap"></div>
      </section>
      <section class="board-grid">
        <article><h2 data-i18n="table.discards">Discards</h2><div id="discards"></div></article>
        <article><h2 data-i18n="table.melds">Melds</h2><div id="melds"></div></article>
        <article><h2 data-i18n="table.dora">Dora</h2><div id="dora" class="tiles"></div><div id="events" class="muted"></div></article>
        <article><h2 data-i18n="sections.liveAgents">Live agents</h2><div id="agents"></div></article>
      </section>
      <section>
        <h2 data-i18n="sections.recentDecisions">Recent decisions</h2>
        <div id="decisions" class="table-wrap"></div>
      </section>
      <section id="debug-section" class="debug-section" hidden>
        <h2 data-i18n="sections.debugSnapshot">Debug snapshot</h2>
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
.error { color: #ff9c9c; }
@media (max-width: 760px) { .grid, .board-grid, .score-grid { grid-template-columns: 1fr 1fr; } .board-grid article:last-child { grid-column: 1 / -1; } }
@media (max-width: 460px) { header { align-items: flex-start; } .header-tools { width: 100%; justify-content: space-between; } .grid, .board-grid, .score-grid { grid-template-columns: 1fr; } }
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
    setText("dealer", localeRuntime.formatSeat(snapshot.oya));
    setText("current-turn", localeRuntime.formatSeat(snapshot.currentSeat));
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
    if (mode === "debug") $("debug").textContent = JSON.stringify(snapshot.debug || {}, null, 2);
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
