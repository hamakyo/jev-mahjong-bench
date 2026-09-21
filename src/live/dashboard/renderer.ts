/**
 * Browser-side renderers shared by the live and offline replay dashboards.
 * Both dashboards are served as standalone JavaScript assembled by Node.
 */
import { tileCatalogRuntimeJs } from "./tiles.js";
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
${tileCatalogRuntimeJs}
  const tablePositions = ["top", "left", "right", "bottom"];
  const tableRotations = { bottom: "0deg", right: "90deg", top: "180deg", left: "-90deg" };
  const tableSeatForPlayer = (snapshot, player) => Number.isInteger(player)
    ? Object.values(snapshot.table?.seats || {}).find((seat) => seat && seat.playerIndex === player)
    : undefined;
  const tableWindForPlayer = (snapshot, player) => {
    const tableSeat = tableSeatForPlayer(snapshot, player);
    if (tableSeat?.currentWind) return tableSeat.currentWind;
    if (!Number.isInteger(player)) return undefined;
    const oya = Number.isInteger(snapshot.oya) ? snapshot.oya : 0;
    return ["E", "S", "W", "N"][(player - oya + 4) % 4];
  };
  const tileSortValue = (value) => {
    const text = String(value || "");
    const match = /^(0|[1-9])([mps])(?:r)?$/.exec(text);
    if (match) return ({ m: 0, p: 10, s: 20 }[match[2]] || 0) + (Number(match[1]) === 0 ? 5.1 : Number(match[1]) + (/r$/.test(text) ? 0.1 : 0));
    const normalized = text.toUpperCase();
    if (mjaiHonorSortValues[normalized] !== undefined) return mjaiHonorSortValues[normalized];
    return /^[1-7]z$/.test(normalized) ? 30 + Number(normalized[0]) : 99;
  };
  const sortedHand = (values) => (Array.isArray(values) ? values : []).map((value, index) => ({ value, index })).sort((left, right) => tileSortValue(left.value) - tileSortValue(right.value) || left.index - right.index).map((entry) => entry.value);
  const assetTile = (value, className, ariaLabel) => {
    const text = String(value || "?");
    const asset = text === "Back.svg" ? "Back.svg" : tileAssetFilename(text);
    return '<span class="tile-image ' + (className || '') + '"' + (ariaLabel ? ' aria-label="' + escapeHtml(ariaLabel) + '"' : '') + '><img src="/assets/tiles/' + encodeURIComponent(asset) + '" alt="' + escapeHtml(ariaLabel || text) + '" decoding="async"></span>';
  };
  const hiddenHand = (count, drawnTilePending) => {
    const total = Math.max(0, Number(count) || 0);
    const drawn = drawnTilePending === true && total > 0;
    const concealedCount = drawn ? total - 1 : total;
    const backs = Array.from({ length: concealedCount }, () => assetTile("Back.svg", "concealed", localeRuntime.t("table.concealed"))).join("");
    const drawnBack = drawn ? '<span class="draw-gap">' + assetTile("Back.svg", "concealed drawn", localeRuntime.t("table.concealed")) + '</span>' : '';
    return backs + drawnBack || '<span class="muted">—</span>';
  };
  const visibleHand = (seat, mode) => {
    if (mode !== "debug" || !Array.isArray(seat.debugHand)) return hiddenHand(seat.concealedTileCount, seat.drawnTilePending);
    const drawn = seat.debugDrawnTile;
    const hand = sortedHand(seat.debugHand);
    const drawnIndex = drawn ? hand.lastIndexOf(drawn) : -1;
    if (drawnIndex >= 0) hand.splice(drawnIndex, 1);
    return hand.map((tile) => assetTile(tile, "face", tile)).join("") + (drawn ? '<span class="draw-gap">' + assetTile(drawn, "face drawn", drawn) + '</span>' : '') || hiddenHand(seat.concealedTileCount, seat.drawnTilePending);
  };
  const calledTileIndexForSource = (meld, playerIndex) => {
    if (typeof meld.fromPlayer !== "number" || !Number.isInteger(playerIndex)) return meld.calledTileIndex;
    const tileCount = Array.isArray(meld.tiles) ? meld.tiles.length : 0;
    if (!tileCount) return undefined;
    const relative = (meld.fromPlayer - playerIndex + 4) % 4;
    if (relative === 3) return 0;
    if (relative === 2) return Math.floor((tileCount - 1) / 2);
    return tileCount - 1;
  };
  const renderMeld = (meld, playerIndex) => {
    const calledIndex = calledTileIndexForSource(meld, playerIndex);
    return (meld.tiles || []).map((tile, index) => assetTile((meld.concealedIndexes || []).includes(index) ? "Back.svg" : tile, (calledIndex === index ? "called" : "face"), meld.concealedIndexes?.includes(index) ? "concealed meld tile" : tile)).join("");
  };
  const renderRiver = (seat, snapshot, mode) => (seat.river || []).map((riverTile, index) => {
    const latest = snapshot.table?.latestDiscard?.playerIndex === seat.playerIndex && snapshot.table?.latestDiscard?.riverIndex === index;
    const classes = [riverTile.riichi ? "riichi-discard" : "", latest ? "latest-discard" : ""].filter(Boolean).join(" ");
    const translated = localeRuntime.t("table.latestDiscard");
    return assetTile(riverTile.tile, classes, latest ? translated + ": " + riverTile.tile : riverTile.tile);
  }).join("") || '<span class="muted">—</span>';
  const seatFallback = (snapshot, player) => {
    const position = tablePositions.find((candidate) => candidate === ["bottom", "right", "top", "left"][player]);
    const wind = tableWindForPlayer(snapshot, player);
    return { playerIndex: player, position, agentId: snapshot.seatAgents?.[wind] || "—", currentWind: wind, isDealer: snapshot.oya === player, score: snapshot.scores?.[player] || 0, rank: snapshot.ranks?.[player], concealedTileCount: 0, drawnTilePending: false, river: [], melds: [], riichi: false };
  };
  function renderMahjongTable(snapshot, mode) {
    const root = $("mahjong-table");
    if (!root) return;
    const label = (key, params) => localeRuntime.t(key, params);
    const seatMap = snapshot.table?.seats || {};
    const seatsForPosition = Object.fromEntries(tablePositions.map((position) => [position, seatMap[position] || seatFallback(snapshot, ["top", "left", "right", "bottom"].indexOf(position))]));
    const central = '<div class="table-center"><div class="center-round">' + escapeHtml(localeRuntime.formatRound(snapshot.round)) + '</div><div class="center-meta"><span>' + label("table.honba") + ' ' + escapeHtml(snapshot.honba ?? 0) + '</span><span>' + label("table.kyotaku") + ' ' + escapeHtml(snapshot.kyotaku ?? 0) + '</span></div><div class="center-dora"><span>' + label("table.dora") + '</span><div class="center-dora-tiles">' + (snapshot.doraIndicators || []).map((tile) => assetTile(tile, "face", tile)).join("") + '</div></div><div class="center-turn">' + label("table.dealer") + ': ' + escapeHtml(localeRuntime.formatSeat(tableWindForPlayer(snapshot, snapshot.oya))) + ' · ' + label("table.currentTurn") + ': ' + escapeHtml(localeRuntime.formatSeat(tableWindForPlayer(snapshot, snapshot.currentSeat))) + '</div></div>';
    const zones = tablePositions.map((position) => {
      const seat = seatsForPosition[position];
      const current = seat.playerIndex === snapshot.currentSeat;
      const dealer = seat.isDealer;
      const labels = '<div class="seat-labels"><strong>' + escapeHtml(seat.agentId) + '</strong><span>' + escapeHtml(localeRuntime.formatSeat(seat.currentWind)) + (dealer ? ' · ' + label("table.dealer") : '') + '</span><span>' + escapeHtml(String(seat.score)) + (seat.rank == null ? '' : ' · ' + label("table.rank") + ' ' + escapeHtml(String(seat.rank))) + '</span></div>';
      const tiles = '<div class="oriented-frame" style="--seat-rotation:' + tableRotations[position] + '"><div class="oriented-tiles"><div class="table-hand" aria-label="' + escapeHtml(label("table.hand")) + '">' + visibleHand(seat, mode) + '</div><div class="table-melds" aria-label="' + escapeHtml(label("table.melds")) + '">' + (seat.melds || []).map((meld) => renderMeld(meld, seat.playerIndex)).join('<span class="meld-gap"></span>') + '</div><div class="river" aria-label="' + escapeHtml(label("table.discards")) + '">' + renderRiver(seat, snapshot, mode) + '</div></div></div>';
      return '<div class="seat-zone position-' + position + (current ? ' current-actor' : '') + (dealer ? ' dealer' : '') + '" data-player-index="' + seat.playerIndex + '">' + labels + tiles + '</div>';
    }).join("");
    root.innerHTML = zones + central;
    root.setAttribute("aria-label", label("table.mahjongTable"));
  }
  function renderTableState(snapshot, mode) { renderMahjongTable(snapshot, mode); }
`;
