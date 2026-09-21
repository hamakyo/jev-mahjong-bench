/**
 * Browser-side renderer shared by the live and offline replay dashboards.
 * Both dashboards are served as standalone JavaScript assembled by Node.
 */
export const decisionTableRendererJs = String.raw`
  function renderDecisionTable(snapshot, mode) {
    const node = $("decisions");
    if (!node) return;
    const actionCell = (id, action) => {
      const details = action ? JSON.stringify(action) : "";
      return '<div class="action-cell"><code>' + escapeHtml(id || '—') + '</code>' + (details ? '<br><small>' + escapeHtml(details) + '</small>' : '') + '</div>';
    };
    const debugRows = (snapshot.lastDecisions || []).map((decision) => '<tr><td>' + escapeHtml(decision.player == null ? '—' : seats[decision.player]) + '</td><td>' + escapeHtml(decision.agentId || '—') + '</td><td>' + actionCell(decision.requestedActionId, decision.requestedAction) + '</td><td>' + actionCell(decision.appliedActionId, decision.appliedAction || (decision.actionType ? { type: decision.actionType } : undefined)) + '</td><td>' + escapeHtml(decision.isLegal === false ? 'fallback' : 'legal') + '</td><td>' + escapeHtml(decision.latencyMs == null ? '—' : Number(decision.latencyMs).toFixed(1) + 'ms') + '</td><td>' + escapeHtml((decision.inputTokens == null && decision.outputTokens == null) ? '—' : (decision.inputTokens || 0) + ' / ' + (decision.outputTokens || 0)) + '</td><td>' + escapeHtml(decision.retryCount || 0) + '</td><td>' + escapeHtml(decision.error || decision.fallbackReason || '') + '</td></tr>').join("");
    const publicRows = (snapshot.lastDecisions || []).map((decision) => '<tr><td>' + escapeHtml(decision.player == null ? '—' : seats[decision.player]) + '</td><td>' + escapeHtml(decision.agentId || '—') + '</td><td>' + escapeHtml(decision.actionType || '—') + '</td></tr>').join("");
    node.innerHTML = mode === "debug"
      ? '<table><thead><tr><th>Seat</th><th>Agent</th><th>Requested</th><th>Applied</th><th>Validity</th><th>Latency</th><th>Input / output tokens</th><th>Retries</th><th>Note</th></tr></thead><tbody>' + (debugRows || '<tr><td colspan="9" class="muted">No decisions yet</td></tr>') + '</tbody></table>'
      : '<table><thead><tr><th>Seat</th><th>Agent</th><th>Action</th></tr></thead><tbody>' + (publicRows || '<tr><td colspan="3" class="muted">No public decisions yet</td></tr>') + '</tbody></table>';
  }
`;

export const tableStateRendererJs = String.raw`
  function renderTableState(snapshot) {
    const tile = (value) => {
      const text = String(value ?? "?");
      const known = /^[0-9][mps]$/.test(text) || /^[1-7]z$/.test(text);
      return '<span class="tile ' + (known ? '' : 'unknown') + '">' + escapeHtml(text) + '</span>';
    };
    const tileList = (values) => (Array.isArray(values) ? values : []).map(tile).join("") || '<span class="muted">—</span>';
    const scoreNode = $("scores");
    if (scoreNode) scoreNode.innerHTML = seats.map((seat, index) => '<div class="score ' + (snapshot.currentSeat === index ? 'current' : '') + '"><span><b class="seat">' + seat + '</b> ' + escapeHtml(snapshot.seatAgents?.[seat] || '—') + '<br><small>rank ' + escapeHtml(snapshot.ranks?.[index] ?? '—') + '</small></span><strong>' + escapeHtml(snapshot.scores?.[index] ?? '—') + '</strong></div>').join("");
    const renderBySeat = (id, values, formatter) => {
      const node = $(id);
      if (!node) return;
      node.innerHTML = seats.map((seat) => '<div><div class="seat">' + seat + (snapshot.riichi?.[seat] ? ' · riichi' : '') + '</div>' + formatter(values?.[seat] || []) + '</div>').join("");
    };
    renderBySeat("discards", snapshot.discards, (values) => '<div class="tiles">' + tileList(values) + '</div>');
    renderBySeat("melds", snapshot.melds, (values) => values.length ? values.map((value) => '<span class="meld">' + escapeHtml(value) + '</span>').join("") : '<span class="muted">—</span>');
    const dora = $("dora");
    if (dora) dora.innerHTML = tileList(snapshot.doraIndicators);
    const events = $("events");
    if (events) events.innerHTML = (snapshot.recentEvents || []).slice(-8).reverse().map((event) => '<div>' + escapeHtml(event.type || 'unknown') + (event.actor == null ? '' : ' · ' + escapeHtml(seats[event.actor] || event.actor)) + '</div>').join('') || 'No events yet';
  }
`;
