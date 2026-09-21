/**
 * Browser-side renderers shared by the live and offline replay dashboards.
 * Both dashboards are served as standalone JavaScript assembled by Node.
 */
export const decisionTableRendererJs = String.raw`
  function renderDecisionTable(snapshot, mode) {
    const node = $("decisions");
    if (!node) return;
    const label = (key, params) => localeRuntime.t(key, params);
    const actionCell = (id, action, debug) => {
      const details = action ? JSON.stringify(action) : "";
      const rawType = action && typeof action.type === 'string' ? action.type : '';
      const translatedType = rawType ? localeRuntime.formatActionType(rawType) : '';
      const typeDetails = debug && rawType && translatedType !== rawType ? '<br><small>' + escapeHtml(translatedType) + ' (' + escapeHtml(rawType) + ')</small>' : '';
      return '<div class="action-cell"><code>' + escapeHtml(id || '—') + '</code>' + (details ? '<br><small>' + escapeHtml(details) + '</small>' : '') + typeDetails + '</div>';
    };
    const actionLabel = (value, debug) => {
      if (!value) return '—';
      const translated = localeRuntime.formatActionType(value);
      return debug && translated !== value ? translated + ' (' + escapeHtml(value) + ')' : escapeHtml(translated);
    };
    const debugRows = (snapshot.lastDecisions || []).map((decision) => '<tr><td>' + escapeHtml(decision.player == null ? '—' : localeRuntime.formatSeat(seats[decision.player])) + '</td><td>' + escapeHtml(decision.agentId || '—') + '</td><td>' + actionCell(decision.requestedActionId, decision.requestedAction, true) + '</td><td>' + actionCell(decision.appliedActionId, decision.appliedAction || (decision.actionType ? { type: decision.actionType } : undefined), true) + '</td><td>' + escapeHtml(decision.isLegal === false ? label('decision.fallback') : label('decision.legal')) + '</td><td>' + escapeHtml(decision.latencyMs == null ? '—' : Number(decision.latencyMs).toFixed(1) + 'ms') + '</td><td>' + escapeHtml((decision.inputTokens == null && decision.outputTokens == null) ? '—' : (decision.inputTokens || 0) + ' / ' + (decision.outputTokens || 0)) + '</td><td>' + escapeHtml(decision.retryCount || 0) + '</td><td>' + escapeHtml(decision.error || decision.fallbackReason || '') + '</td></tr>').join("");
    const publicRows = (snapshot.lastDecisions || []).map((decision) => '<tr><td>' + escapeHtml(decision.player == null ? '—' : localeRuntime.formatSeat(seats[decision.player])) + '</td><td>' + escapeHtml(decision.agentId || '—') + '</td><td>' + actionLabel(decision.actionType, false) + '</td></tr>').join("");
    node.innerHTML = mode === "debug"
      ? '<table><thead><tr><th>' + label('decision.seat') + '</th><th>' + label('decision.agent') + '</th><th>' + label('decision.requested') + '</th><th>' + label('decision.applied') + '</th><th>' + label('decision.validity') + '</th><th>' + label('decision.latency') + '</th><th>' + label('decision.inputOutputTokens') + '</th><th>' + label('decision.retries') + '</th><th>' + label('decision.note') + '</th></tr></thead><tbody>' + (debugRows || '<tr><td colspan="9" class="muted">' + label('table.noDecisions') + '</td></tr>') + '</tbody></table>'
      : '<table><thead><tr><th>' + label('decision.seat') + '</th><th>' + label('decision.agent') + '</th><th>' + label('decision.action') + '</th></tr></thead><tbody>' + (publicRows || '<tr><td colspan="3" class="muted">' + label('table.noPublicDecisions') + '</td></tr>') + '</tbody></table>';
  }
`;

export const tableStateRendererJs = String.raw`
  function renderTableState(snapshot, mode) {
    const label = (key, params) => localeRuntime.t(key, params);
    const tile = (value) => {
      const text = String(value ?? "?");
      const known = /^[0-9][mps]$/.test(text) || /^[1-7]z$/.test(text);
      return '<span class="tile ' + (known ? '' : 'unknown') + '">' + escapeHtml(text) + '</span>';
    };
    const tileList = (values) => (Array.isArray(values) ? values : []).map(tile).join("") || '<span class="muted">—</span>';
    const scoreNode = $("scores");
    if (scoreNode) scoreNode.innerHTML = seats.map((seat, index) => '<div class="score ' + (snapshot.currentSeat === index ? 'current' : '') + '"><span><b class="seat">' + escapeHtml(localeRuntime.formatSeat(seat)) + '</b> ' + escapeHtml(snapshot.seatAgents?.[seat] || '—') + '<br><small>' + label('table.rank') + ' ' + escapeHtml(snapshot.ranks?.[index] ?? '—') + '</small></span><strong>' + escapeHtml(snapshot.scores?.[index] ?? '—') + '</strong></div>').join("");
    const renderBySeat = (id, values, formatter) => {
      const node = $(id);
      if (!node) return;
      node.innerHTML = seats.map((seat) => '<div><div class="seat">' + escapeHtml(localeRuntime.formatSeat(seat)) + (snapshot.riichi?.[seat] ? ' · ' + label('table.riichi') : '') + '</div>' + formatter(values?.[seat] || []) + '</div>').join("");
    };
    renderBySeat("discards", snapshot.discards, (values) => '<div class="tiles">' + tileList(values) + '</div>');
    renderBySeat("melds", snapshot.melds, (values) => values.length ? values.map((value) => '<span class="meld">' + escapeHtml(value) + '</span>').join("") : '<span class="muted">—</span>');
    const dora = $("dora");
    if (dora) dora.innerHTML = tileList(snapshot.doraIndicators);
    const events = $("events");
    if (events) events.innerHTML = (snapshot.recentEvents || []).slice(-8).reverse().map((event) => { const rawType = event.type || 'unknown'; const translated = localeRuntime.formatActionType(rawType); const display = mode === 'debug' && translated !== rawType ? translated + ' (' + rawType + ')' : translated; return '<div>' + escapeHtml(display) + (event.actor == null ? '' : ' · ' + escapeHtml(localeRuntime.formatSeat(seats[event.actor] || event.actor))) + '</div>'; }).join('') || '<span class="muted">' + label('table.noEvents') + '</span>';
  }
`;
