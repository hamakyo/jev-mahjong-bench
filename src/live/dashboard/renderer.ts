/**
 * Browser-side renderers shared by the live and offline replay dashboards.
 * Both dashboards are served as standalone JavaScript assembled by Node.
 */
import { tileCatalogRuntimeJs } from "./tiles.js";
export const decisionTableRendererJs = String.raw`
  function renderDebugInspector(snapshot, selected) {
    const node = $("debug-inspector-content");
    if (!node) return;
    const label = (key, params) => localeRuntime.t(key, params);
    const debug = snapshot.debug || {};
    const selectedDebug = selected && typeof selected === "object" ? selected : {};
    const selectedPlayer = Number.isInteger(selected?.player) ? selected.player : snapshot.currentSeat;
    const seat = selectedPlayer == null ? undefined : seats[selectedPlayer];
    const legalActions = Array.isArray(selectedDebug.legalActions)
      ? selectedDebug.legalActions
      : seat && Array.isArray(debug.legalActionsBySeat?.[seat]) ? debug.legalActionsBySeat[seat] : [];
    const diagnostics = selectedDebug.diagnostics && typeof selectedDebug.diagnostics === "object" ? selectedDebug.diagnostics
      : seat && debug.diagnosticsBySeat?.[seat] && typeof debug.diagnosticsBySeat[seat] === "object" ? debug.diagnosticsBySeat[seat] : {};
    const providerMetadata = selectedDebug.metadata && typeof selectedDebug.metadata === "object" ? selectedDebug.metadata
      : seat && debug.providerMetadataBySeat?.[seat] && typeof debug.providerMetadataBySeat[seat] === "object" ? debug.providerMetadataBySeat[seat] : {};
    const diagnosticProviderMetadata = diagnostics.providerMetadata && typeof diagnostics.providerMetadata === "object" && !Array.isArray(diagnostics.providerMetadata) ? diagnostics.providerMetadata : {};
    const finalSource = typeof diagnostics.hybridTrace?.finalSource === "string" ? diagnostics.hybridTrace.finalSource : undefined;
    const providerSource = finalSource === "jev-fallback" ? "jev" : finalSource === "jev" || finalSource === "gpt" ? finalSource : undefined;
    const sourceRecord = providerSource && diagnosticProviderMetadata[providerSource] && typeof diagnosticProviderMetadata[providerSource] === "object" ? diagnosticProviderMetadata[providerSource] : undefined;
    const sourceMetadata = sourceRecord?.metadata && typeof sourceRecord.metadata === "object" && !Array.isArray(sourceRecord.metadata) ? sourceRecord.metadata : sourceRecord;
    const hasProviderIdentity = (value) => value && typeof value === "object" && (value.provider != null || value.providerId != null || value.modelId != null || value.model != null || value.requestedModel != null);
    const selectedProviderMetadata = hasProviderIdentity(sourceMetadata)
      ? sourceMetadata
      : hasProviderIdentity(providerMetadata)
        ? providerMetadata
        : hasProviderIdentity(diagnosticProviderMetadata)
          ? diagnosticProviderMetadata
          : {};
    const decision = selectedDebug.appliedAction || selectedDebug.requestedAction || (seat && snapshot.decisionsBySeat?.[seat] ? snapshot.decisionsBySeat[seat] : (snapshot.lastDecisions || []).find((item) => item.player === selectedPlayer));
    const actionText = legalActions.map((action) => {
      const rawType = String(action?.type || "unknown");
      const translated = localeRuntime.formatActionType(rawType);
      const typeText = translated === rawType ? rawType : translated + " (" + rawType + ")";
      return String(action?.id || rawType) + " · " + typeText;
    }).join(", ") || "—";
    const probabilityText = diagnostics.probabilities && typeof diagnostics.probabilities === "object" ? JSON.stringify(diagnostics.probabilities) : "—";
    const inputTokens = typeof selectedDebug.inputTokens === "number" ? selectedDebug.inputTokens : typeof decision?.inputTokens === "number" ? decision.inputTokens : undefined;
    const outputTokens = typeof selectedDebug.outputTokens === "number" ? selectedDebug.outputTokens : typeof decision?.outputTokens === "number" ? decision.outputTokens : undefined;
    const totalTokens = inputTokens === undefined && outputTokens === undefined ? "—" : String((inputTokens || 0) + (outputTokens || 0));
    const provider = selectedProviderMetadata.provider ?? selectedProviderMetadata.providerId ?? "—";
    const model = selectedProviderMetadata.modelId ?? selectedProviderMetadata.model ?? selectedProviderMetadata.requestedModel ?? "—";
    const appliedText = selectedDebug.appliedAction ? JSON.stringify(selectedDebug.appliedAction) : decision?.actionType || "—";
    const requestedText = selectedDebug.requestedAction ? JSON.stringify(selectedDebug.requestedAction) : "—";
    const rawEvents = Array.isArray(selectedDebug.rawEvents) ? selectedDebug.rawEvents.length : 0;
    const hybridText = diagnostics.hybridTrace && typeof diagnostics.hybridTrace === "object" ? JSON.stringify(diagnostics.hybridTrace) : "—";
    const validity = selectedDebug.isLegal === undefined ? (decision?.isLegal === undefined ? "—" : String(decision.isLegal)) : String(selectedDebug.isLegal);
    const seatFormatter = typeof localeRuntime.formatSeat === "function" ? localeRuntime.formatSeat : (value) => String(value ?? "—");
    const selectedSeatLabel = selectedPlayer == null ? "—" : seatFormatter(typeof tableWindForPlayer === "function" ? tableWindForPlayer(snapshot, selectedPlayer) : selectedPlayer);
    node.innerHTML = '<dl class="debug-inspector-grid">' +
      '<div><dt>' + label("decision.agent") + '</dt><dd>' + escapeHtml(selected?.agentId || decision?.agentId || "—") + '</dd></div>' +
      '<div><dt>' + label("decision.seat") + '</dt><dd>' + escapeHtml(selectedSeatLabel) + '</dd></div>' +
      '<div><dt>' + label("decision.requested") + '</dt><dd>' + escapeHtml(requestedText) + '</dd></div>' +
      '<div><dt>' + label("decision.applied") + '</dt><dd>' + escapeHtml(appliedText) + '</dd></div>' +
      '<div><dt>' + label("debug.legalActions") + '</dt><dd>' + escapeHtml(actionText) + '</dd></div>' +
      '<div><dt>' + label("debug.confidence") + '</dt><dd>' + escapeHtml(diagnostics.confidence == null ? "—" : String(diagnostics.confidence)) + '</dd></div>' +
      '<div><dt>' + label("debug.probabilities") + '</dt><dd>' + escapeHtml(probabilityText) + '</dd></div>' +
      '<div><dt>' + label("debug.hybridTrace") + '</dt><dd>' + escapeHtml(hybridText) + '</dd></div>' +
      '<div><dt>' + label("decision.validity") + '</dt><dd>' + escapeHtml(validity) + '</dd></div>' +
      '<div><dt>' + label("debug.totalTokens") + '</dt><dd>' + escapeHtml(totalTokens) + '</dd></div>' +
      '<div><dt>' + label("debug.provider") + '</dt><dd>' + escapeHtml(String(provider)) + '</dd></div>' +
      '<div><dt>' + label("debug.model") + '</dt><dd>' + escapeHtml(String(model)) + '</dd></div>' +
      '<div><dt>' + label("decision.latency") + '</dt><dd>' + escapeHtml(selectedDebug.latencyMs == null ? "—" : String(selectedDebug.latencyMs) + "ms") + '</dd></div>' +
      '<div><dt>' + label("decision.retries") + '</dt><dd>' + escapeHtml(selectedDebug.retryCount == null ? "—" : String(selectedDebug.retryCount)) + '</dd></div>' +
      '<div><dt>' + label("decision.note") + '</dt><dd>' + escapeHtml(selectedDebug.error || selectedDebug.fallbackReason || "—") + '</dd></div>' +
      '<div><dt>' + label("debug.rawEvents") + '</dt><dd>' + escapeHtml(String(rawEvents)) + '</dd></div>' +
      '</dl>';
  }

  function renderDecisionTable(snapshot, mode) {
    const node = $("decisions");
    if (!node) return;
    node.innerHTML = "";
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
    return '<span class="tile-image ' + (className || '') + '"' + (ariaLabel ? ' aria-label="' + escapeHtml(ariaLabel) + '"' : '') + '><span class="tile-body"><img class="tile-face" src="/assets/tiles/' + encodeURIComponent(asset) + '" alt="' + escapeHtml(ariaLabel || text) + '" decoding="async"></span></span>';
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
    if (typeof meld.calledTileIndex === "number") return meld.calledTileIndex;
    if (typeof meld.fromPlayer !== "number" || !Number.isInteger(playerIndex)) return undefined;
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
