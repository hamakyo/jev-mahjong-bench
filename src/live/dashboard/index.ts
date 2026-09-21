export const dashboardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Jev Mahjong live tournament</title>
    <link rel="stylesheet" href="/assets/styles.css">
  </head>
  <body>
    <header>
      <div>
        <h1>Jev Mahjong live tournament</h1>
        <p id="connection">Connecting…</p>
      </div>
      <div id="mode" class="mode"></div>
    </header>
    <main>
      <section class="summary grid">
        <article><span>Round</span><strong id="round">—</strong></article>
        <article><span>Honba</span><strong id="honba">0</strong></article>
        <article><span>Kyotaku</span><strong id="kyotaku">0</strong></article>
        <article><span>Games</span><strong id="games">0 / 0</strong></article>
        <article><span>Status</span><strong id="status">idle</strong></article>
      </section>
      <section id="control-panel" hidden>
        <h2>Execution control</h2>
        <div class="control-row">
          <strong id="control-state">—</strong>
          <span>next: <code id="control-next">—</code></span>
          <span>step: <code id="control-step">0</code></span>
          <span id="control-pause-requested" class="muted"></span>
          <button id="control-pause" type="button">Pause</button>
          <button id="control-resume" type="button">Resume</button>
          <button id="control-step-button" type="button">Step</button>
        </div>
        <p id="control-error" class="error"></p>
      </section>
      <section>
        <h2>Scores</h2>
        <div id="scores" class="score-grid"></div>
      </section>
      <section>
        <h2>Live metrics</h2>
        <div id="metrics" class="table-wrap"></div>
      </section>
      <section class="board-grid">
        <article><h2>Discards</h2><div id="discards"></div></article>
        <article><h2>Melds</h2><div id="melds"></div></article>
        <article><h2>Dora</h2><div id="dora" class="tiles"></div><div id="events" class="muted"></div></article>
        <article><h2>Live agents</h2><div id="agents"></div></article>
      </section>
      <section>
        <h2>Recent decisions</h2>
        <div id="decisions" class="table-wrap"></div>
      </section>
      <section id="debug-section" class="debug-section" hidden>
        <h2>Debug snapshot</h2>
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
header { display: flex; justify-content: space-between; gap: 1rem; align-items: center; padding: 1.5rem clamp(1rem, 4vw, 4rem); border-bottom: 1px solid #2a394b; }
h1 { margin: 0; font-size: clamp(1.25rem, 3vw, 2rem); }
h2 { font-size: 1rem; margin: 0 0 .75rem; color: #9fb6ca; }
p { margin: .35rem 0 0; color: #91a3b5; }
main { width: min(1200px, 100% - 2rem); margin: 1.25rem auto 3rem; display: grid; gap: 1rem; }
.grid, .board-grid { display: grid; gap: .75rem; }
.grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.board-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
article, section { background: #18222e; border: 1px solid #2a394b; border-radius: .75rem; padding: 1rem; }
.summary article { display: grid; gap: .3rem; }
.summary span { color: #91a3b5; font-size: .8rem; }
.summary strong { font-size: 1.35rem; }
.score-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .65rem; }
.score { display: flex; justify-content: space-between; align-items: center; padding: .7rem; border-radius: .5rem; background: #202e3c; }
.score.current { outline: 2px solid #e1b866; }
.seat { color: #e1b866; font-weight: 700; }
.tiles { display: flex; flex-wrap: wrap; gap: .3rem; min-height: 2rem; }
.tile { display: inline-flex; min-width: 1.65rem; height: 2rem; align-items: center; justify-content: center; padding: 0 .25rem; border-radius: .25rem; background: #f1f0e9; color: #18222e; font-family: ui-monospace, monospace; font-size: .8rem; }
.tile.unknown { background: #69798a; color: #fff; }
.meld { display: block; color: #c6d3df; font-size: .8rem; margin: .3rem 0; word-break: break-word; }
.agent { display: flex; justify-content: space-between; gap: .5rem; border-bottom: 1px solid #2a394b; padding: .45rem 0; font-size: .85rem; }
.agent:last-child { border-bottom: 0; }
.muted { color: #91a3b5; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .82rem; }
th, td { text-align: left; padding: .55rem .45rem; border-bottom: 1px solid #2a394b; white-space: nowrap; }
th { color: #9fb6ca; }
.action-cell { max-width: 20rem; white-space: normal; word-break: break-word; }
.control-row { display: flex; align-items: center; flex-wrap: wrap; gap: .65rem; }
button { border: 1px solid #4e6d84; border-radius: .4rem; padding: .4rem .7rem; background: #223746; color: #edf2f7; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .45; }
.mode { padding: .35rem .6rem; border-radius: 999px; background: #275b70; font-size: .78rem; }
.mode.debug { background: #875e29; }
.debug-section pre { max-height: 38rem; overflow: auto; white-space: pre-wrap; word-break: break-word; color: #c6d3df; }
.error { color: #ff9c9c; }
@media (max-width: 760px) { .grid, .board-grid, .score-grid { grid-template-columns: 1fr 1fr; } .board-grid article:last-child { grid-column: 1 / -1; } }
@media (max-width: 460px) { .grid, .board-grid, .score-grid { grid-template-columns: 1fr; } }
`;

export const dashboardJs = `(function () {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "debug" ? "debug" : "spectator";
  const seats = ["E", "S", "W", "N"];
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : char.charCodeAt(0) === 34 ? "&quot;" : "&#39;");
  const tile = (value) => {
    const text = String(value ?? "?");
    const known = /^[0-9][mpsz]$/.test(text) || /^[1-7]z$/.test(text);
    return '<span class="tile ' + (known ? '' : 'unknown') + '">' + escapeHtml(text) + '</span>';
  };
  const tileList = (values) => (Array.isArray(values) ? values : []).map(tile).join("") || '<span class="muted">—</span>';
  const setText = (id, value) => { const node = $(id); if (node) node.textContent = String(value ?? "—"); };
  function render(snapshot) {
    setText("round", snapshot.round || "—");
    setText("honba", snapshot.honba);
    setText("kyotaku", snapshot.kyotaku);
    setText("games", (snapshot.tournament?.completedGames || 0) + " / " + (snapshot.tournament?.totalGames || 0));
    setText("status", snapshot.status + (snapshot.currentSeat == null ? "" : " · " + seats[snapshot.currentSeat]));
    const scoreNode = $("scores");
    scoreNode.innerHTML = seats.map((seat, index) => '<div class="score ' + (snapshot.currentSeat === index ? 'current' : '') + '"><span><b class="seat">' + seat + '</b> ' + escapeHtml(snapshot.seatAgents?.[seat] || '—') + '<br><small>rank ' + escapeHtml(snapshot.ranks?.[index] ?? '—') + '</small></span><strong>' + escapeHtml(snapshot.scores?.[index] ?? '—') + '</strong></div>').join("");
    const renderBySeat = (id, values, formatter) => {
      const node = $(id);
      node.innerHTML = seats.map((seat) => '<div><div class="seat">' + seat + (snapshot.riichi?.[seat] ? ' · riichi' : '') + '</div>' + formatter(values?.[seat] || []) + '</div>').join("");
    };
    renderBySeat("discards", snapshot.discards, (values) => '<div class="tiles">' + tileList(values) + '</div>');
    renderBySeat("melds", snapshot.melds, (values) => values.length ? values.map((value) => '<span class="meld">' + escapeHtml(value) + '</span>').join("") : '<span class="muted">—</span>');
    $("dora").innerHTML = tileList(snapshot.doraIndicators);
    $("events").innerHTML = (snapshot.recentEvents || []).slice(-8).reverse().map((event) => '<div>' + escapeHtml(event.type || 'unknown') + (event.actor == null ? '' : ' · ' + escapeHtml(seats[event.actor] || event.actor)) + '</div>').join('') || 'No events yet';
    const agents = $("agents");
    const agentEntries = Object.entries(snapshot.agents || {});
    agents.innerHTML = agentEntries.length ? agentEntries.map(([id, value]) => mode === "debug"
      ? '<div class="agent"><b>' + escapeHtml(id) + '</b><span>' + value.decisions + ' decisions · ' + Number(value.latency?.p50Ms || 0).toFixed(1) + 'ms p50</span></div>'
      : '<div class="agent"><b>' + escapeHtml(id) + '</b><span>' + (value.completedGames || 0) + ' games · ' + (value.handCount || 0) + ' hands</span></div>').join("") : '<span class="muted">No agent metrics yet</span>';
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
    $("metrics").innerHTML = mode === "debug"
      ? '<table><thead><tr><th>Agent</th><th>Games</th><th>Hands</th><th>Wins</th><th>Deal-ins</th><th>Riichi</th><th>Calls</th><th>Decisions / legal</th><th>Fallback</th><th>Errors</th><th>Hybrid escalations</th><th>Latency mean / p50 / p95</th><th>Input tokens</th><th>Output tokens</th><th>Retries</th></tr></thead><tbody>' + (debugMetricRows || '<tr><td colspan="15" class="muted">No agent metrics yet</td></tr>') + '</tbody></table>'
      : '<table><thead><tr><th>Agent</th><th>Games</th><th>Hands</th><th>Wins</th><th>Deal-ins</th><th>Riichi</th><th>Calls</th></tr></thead><tbody>' + (publicMetricRows || '<tr><td colspan="7" class="muted">No public outcome metrics yet</td></tr>') + '</tbody></table>';
    const actionCell = (id, action) => {
      const details = action ? JSON.stringify(action) : '';
      return '<div class="action-cell"><code>' + escapeHtml(id || '—') + '</code>' + (details ? '<br><small>' + escapeHtml(details) + '</small>' : '') + '</div>';
    };
    const debugRows = (snapshot.lastDecisions || []).map((decision) => '<tr><td>' + escapeHtml(decision.player == null ? '—' : seats[decision.player]) + '</td><td>' + escapeHtml(decision.agentId || '—') + '</td><td>' + actionCell(decision.requestedActionId, decision.requestedAction) + '</td><td>' + actionCell(decision.appliedActionId, decision.appliedAction || (decision.actionType ? { type: decision.actionType } : undefined)) + '</td><td>' + escapeHtml(decision.isLegal === false ? 'fallback' : 'legal') + '</td><td>' + escapeHtml(decision.latencyMs == null ? '—' : Number(decision.latencyMs).toFixed(1) + 'ms') + '</td><td>' + escapeHtml((decision.inputTokens == null && decision.outputTokens == null) ? '—' : (decision.inputTokens || 0) + ' / ' + (decision.outputTokens || 0)) + '</td><td>' + escapeHtml(decision.retryCount || 0) + '</td><td>' + escapeHtml(decision.error || decision.fallbackReason || '') + '</td></tr>').join("");
    const publicRows = (snapshot.lastDecisions || []).map((decision) => '<tr><td>' + escapeHtml(decision.player == null ? '—' : seats[decision.player]) + '</td><td>' + escapeHtml(decision.agentId || '—') + '</td><td>' + escapeHtml(decision.actionType || '—') + '</td></tr>').join("");
    $("decisions").innerHTML = mode === "debug"
      ? '<table><thead><tr><th>Seat</th><th>Agent</th><th>Requested</th><th>Applied</th><th>Validity</th><th>Latency</th><th>Input / output tokens</th><th>Retries</th><th>Note</th></tr></thead><tbody>' + (debugRows || '<tr><td colspan="9" class="muted">No decisions yet</td></tr>') + '</tbody></table>'
      : '<table><thead><tr><th>Seat</th><th>Agent</th><th>Action</th></tr></thead><tbody>' + (publicRows || '<tr><td colspan="3" class="muted">No public decisions yet</td></tr>') + '</tbody></table>';
    const debugSection = $("debug-section");
    debugSection.hidden = mode !== "debug";
    if (mode === "debug") $("debug").textContent = JSON.stringify(snapshot.debug || {}, null, 2);
  }
  const controlPanel = $("control-panel");
  const controlError = $("control-error");
  async function refreshControl() {
    const response = await fetch("/api/control", { cache: "no-store" });
    if (response.status === 404) {
      controlPanel.hidden = true;
      return;
    }
    if (!response.ok) throw new Error("control status request failed");
    const control = await response.json();
    controlPanel.hidden = false;
    setText("control-state", control.state);
    setText("control-next", control.nextStep || "—");
    setText("control-step", control.stepNumber || 0);
    setText("control-pause-requested", control.pauseRequested ? "pause requested" : "");
    $("control-pause").disabled = control.state !== "running" && control.state !== "stepping";
    $("control-resume").disabled = control.state !== "paused";
    $("control-step-button").disabled = control.state !== "paused";
    controlError.textContent = "";
  }
  async function sendControl(path) {
    try {
      const response = await fetch(path, { method: "POST", cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "control request failed");
      await refreshControl();
    } catch (error) {
      controlError.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  $("control-pause").addEventListener("click", () => { void sendControl("/api/control/pause"); });
  $("control-resume").addEventListener("click", () => { void sendControl("/api/control/resume"); });
  $("control-step-button").addEventListener("click", () => { void sendControl("/api/control/step"); });
  $("mode").textContent = mode === "debug" ? "DEBUG · local only" : "SPECTATOR";
  if (mode === "debug") $("mode").classList.add("debug");
  let source;
  let lastEventId = 0;
  async function refresh() {
    const response = await fetch("/api/snapshot?mode=" + mode, { cache: "no-store" });
    if (!response.ok) throw new Error("snapshot request failed");
    const snapshot = await response.json();
    lastEventId = snapshot.lastEventId || lastEventId;
    render(snapshot);
  }
  function connect() {
    if (source) source.close();
    source = new EventSource("/api/events?mode=" + mode + "&after=" + lastEventId);
    const onEvent = (event) => {
      try { const envelope = JSON.parse(event.data); lastEventId = envelope.id || lastEventId; } catch (_) { /* snapshot refresh is authoritative */ }
      refresh().catch((error) => { $("connection").textContent = error.message; $("connection").classList.add("error"); });
    };
    ["tournament:start", "tournament:progress", "game:start", "mjai", "decision:start", "decision:end", "game:end", "tournament:end", "tournament:error"].forEach((name) => source.addEventListener(name, onEvent));
    source.addEventListener("reset", () => { refresh().then(connect).catch(() => connect()); });
    source.onopen = () => { $("connection").textContent = "Live · stream connected"; $("connection").classList.remove("error"); };
    source.onerror = () => { $("connection").textContent = "Reconnecting…"; };
  }
  setInterval(() => { void refreshControl().catch((error) => { controlError.textContent = error.message; }); }, 1_000);
  void refreshControl().catch((error) => { controlError.textContent = error.message; });
  refresh().then(connect).catch((error) => { $("connection").textContent = error.message; $("connection").classList.add("error"); });
})();`;
