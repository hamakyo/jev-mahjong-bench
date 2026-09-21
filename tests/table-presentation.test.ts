import { describe, expect, it } from "vitest";
import { LiveEventHub } from "../src/live/hub.js";
import { projectTournamentEvent } from "../src/live/projector.js";
import { createLiveServer } from "../src/live/server.js";
import { dashboardCss } from "../src/live/dashboard/index.js";
import {
  POSITION_BY_PLAYER,
  ROTATION_BY_POSITION,
  SnapshotStore,
  type SnapshotCheckpoint,
} from "../src/live/snapshot.js";
import { tableStateRendererJs } from "../src/live/dashboard/renderer.js";
import { tileAssetFilename } from "../src/live/dashboard/tiles.js";

const base = { schemaVersion: 1 as const, gameId: "game", pairId: "pair", rotationIndex: 0 };

function mjai(event: Record<string, unknown>) {
  return { ...base, type: "mjai" as const, source: "bridge" as const, event };
}

function startingHands(): string[][] {
  return Array.from({ length: 4 }, (_, player) => Array.from({ length: 13 }, (_, index) => `${(index % 9) + 1}${["m", "p", "s", "z"][player]}`));
}

describe("table presentation", () => {
  it("keeps player indexes at physical positions while winds follow oya", () => {
    const hub = new LiveEventHub({ streamId: "table-stream" });
    const store = new SnapshotStore(hub.streamId);
    const apply = (event: Parameters<LiveEventHub["emit"]>[0]) => store.apply(hub.emit(event));
    apply({ type: "game:start", ...base, seed: 1, baseSeed: 1, seats: ["duplicate", "duplicate", "random", "random"], gameIndex: 0, totalGames: 1 });
    apply(mjai({ type: "start_kyoku", bakaze: "E", kyoku: 1, oya: 0, scores: [25_000, 25_000, 25_000, 25_000], tehais: startingHands() }));

    let snapshot = store.getSnapshot("spectator");
    expect(POSITION_BY_PLAYER).toEqual(["bottom", "right", "top", "left"]);
    expect(ROTATION_BY_POSITION).toEqual({ bottom: 0, right: 90, top: 180, left: -90 });
    expect(snapshot.table.seats.bottom).toMatchObject({ playerIndex: 0, agentId: "duplicate", currentWind: "E", isDealer: true });
    expect(snapshot.table.seats.right).toMatchObject({ playerIndex: 1, agentId: "duplicate", currentWind: "S", isDealer: false });
    expect(snapshot.table.seats.top).toMatchObject({ playerIndex: 2, agentId: "random", currentWind: "W" });
    expect(snapshot.table.seats.left).toMatchObject({ playerIndex: 3, agentId: "random", currentWind: "N" });
    apply({ type: "decision:start", ...base, player: 2, agentId: "random", observation: { state: {}, legalActions: [], newEvents: [] } });
    expect(store.getSnapshot("spectator").currentSeat).toBe(2);
    expect(store.getSnapshot("spectator").table.seats.top.playerIndex).toBe(2);

    apply(mjai({ type: "start_kyoku", bakaze: "E", kyoku: 2, oya: 1, scores: [25_000, 25_000, 25_000, 25_000], tehais: startingHands() }));
    snapshot = store.getSnapshot("spectator");
    expect(snapshot.table.seats.bottom).toMatchObject({ playerIndex: 0, agentId: "duplicate", currentWind: "N", isDealer: false });
    expect(snapshot.table.seats.right).toMatchObject({ playerIndex: 1, agentId: "duplicate", currentWind: "E", isDealer: true });
    expect(snapshot.table.seats.top).toMatchObject({ playerIndex: 2, currentWind: "S" });
    expect(snapshot.table.seats.left).toMatchObject({ playerIndex: 3, currentWind: "W" });
  });

  it("keeps spectator hand data to counts while debug reconstructs raw tiles", () => {
    const hub = new LiveEventHub({ streamId: "privacy-stream" });
    const store = new SnapshotStore(hub.streamId);
    const apply = (event: Parameters<LiveEventHub["emit"]>[0]) => store.apply(hub.emit(event));
    const hands = startingHands();
    const projection = projectTournamentEvent(mjai({ type: "start_kyoku", oya: 0, tehais: hands }));
    const publicEvent = projection.publicEvent as Extract<typeof projection.publicEvent, { type: "mjai" }>;
    expect(publicEvent.event).not.toHaveProperty("tehais");
    expect(publicEvent.presentation?.concealedTileCountByPlayer).toEqual([13, 13, 13, 13]);
    apply({ type: "game:start", ...base, seed: 1, baseSeed: 1, seats: ["a", "b", "c", "d"], gameIndex: 0, totalGames: 1 });
    apply(mjai({ type: "start_kyoku", oya: 0, tehais: hands }));
    apply(mjai({ type: "tsumo", actor: 0, pai: "5mr" }));

    const spectator = store.getSnapshot("spectator");
    const debug = store.getSnapshot("debug");
    expect(spectator.table.seats.bottom).toMatchObject({ concealedTileCount: 14, drawnTilePending: true });
    expect(spectator.table.seats.bottom).not.toHaveProperty("debugHand");
    expect(spectator.table.seats.bottom).not.toHaveProperty("debugDrawnTile");
    expect(debug.table.seats.bottom.debugHand).toContain("5mr");
    expect(debug.table.seats.bottom.debugDrawnTile).toBe("5mr");
    expect((projection.debugEvent as Extract<typeof projection.debugEvent, { type: "mjai" }>).event).toHaveProperty("tehais");
  });

  it("preserves river order, marks riichi, and structures ankan/kakan", () => {
    const hub = new LiveEventHub({ streamId: "meld-stream" });
    const store = new SnapshotStore(hub.streamId);
    const apply = (event: Parameters<LiveEventHub["emit"]>[0]) => store.apply(hub.emit(event));
    apply({ type: "game:start", ...base, seed: 1, baseSeed: 1, seats: ["a", "b", "c", "d"], gameIndex: 0, totalGames: 1 });
    apply(mjai({ type: "start_kyoku", oya: 0, tehais: startingHands() }));
    for (let index = 0; index < 7; index += 1) apply(mjai({ type: "dahai", actor: 0, pai: `${(index % 9) + 1}m`, tsumogiri: index % 2 === 0 }));
    apply(mjai({ type: "reach", actor: 0 }));
    apply(mjai({ type: "dahai", actor: 0, pai: "8m", tsumogiri: true }));
    apply(mjai({ type: "ankan", actor: 1, consumed: ["1p", "1p", "1p", "1p"] }));
    apply(mjai({ type: "pon", actor: 2, target: 0, pai: "3s", consumed: ["3s", "3s"] }));
    apply(mjai({ type: "pon", actor: 2, target: 1, pai: "4s", consumed: ["4s", "4s"] }));
    apply(mjai({ type: "kakan", actor: 2, pai: "3s", consumed: ["3s", "3s", "3s"] }));

    const table = store.getSnapshot("spectator").table;
    expect(table.seats.bottom.river).toHaveLength(8);
    expect(table.seats.bottom.river.slice(0, 6).map((tile) => tile.tile)).toEqual(["1m", "2m", "3m", "4m", "5m", "6m"]);
    expect(table.seats.bottom.river[7]).toMatchObject({ tile: "8m", riichi: true, tsumogiri: true });
    expect(table.latestDiscard).toEqual({ playerIndex: 0, riverIndex: 7 });
    expect(table.seats.right.melds[0]).toMatchObject({ type: "ankan", tiles: ["1p", "1p", "1p", "1p"], concealedIndexes: [0, 3] });
    expect(table.seats.top.melds).toHaveLength(2);
    expect(table.seats.top.melds[0]).toMatchObject({ type: "kakan", fromPlayer: 0, calledTileIndex: 1 });
    expect(table.seats.top.melds[1]).toMatchObject({ type: "pon", fromPlayer: 1, calledTileIndex: 0 });
    expect(tableStateRendererJs).toContain("meld.fromPlayer");
    expect(tableStateRendererJs).toContain("renderMeld(meld, seat.playerIndex)");
  });

  it("does not restore legacy checkpoints without a presentation version", () => {
    const store = new SnapshotStore("checkpoint-stream");
    const checkpoint = store.checkpoint();
    expect(store.restore({ ...checkpoint, presentationVersion: undefined } as unknown as SnapshotCheckpoint)).toBe(false);
  });

  it("shares oriented table rendering and serves vendored SVG assets", async () => {
    expect(tableStateRendererJs).toContain("function renderMahjongTable");
    expect(dashboardCss).toContain("grid-template-columns: repeat(6");
    expect(tableStateRendererJs).toContain("right: \"90deg\"");
    expect(tileAssetFilename("0m")).toBe("Man5-Dora.svg");
    expect(tileAssetFilename("5pr")).toBe("Pin5-Dora.svg");
    expect(["E", "S", "W", "N", "P", "F", "C"].map(tileAssetFilename)).toEqual([
      "Ton.svg", "Nan.svg", "Shaa.svg", "Pei.svg", "Haku.svg", "Hatsu.svg", "Chun.svg",
    ]);
    expect(["1z", "2z", "3z", "4z", "5z", "6z", "7z"].map(tileAssetFilename)).toEqual([
      "Ton.svg", "Nan.svg", "Shaa.svg", "Pei.svg", "Haku.svg", "Hatsu.svg", "Chun.svg",
    ]);
    expect(tableStateRendererJs).toContain("mjaiHonorSortValues");
    expect(tableStateRendererJs).toContain("tableWindForPlayer(snapshot, snapshot.oya)");
    expect(tableStateRendererJs).toContain("tableWindForPlayer(snapshot, snapshot.currentSeat)");
    expect(tableStateRendererJs).toContain("hiddenHand = (count, drawnTilePending)");
    expect(tableStateRendererJs).toContain("drawnBack");
    const hub = new LiveEventHub({ streamId: "asset-stream" });
    const server = createLiveServer({ hub, snapshots: new SnapshotStore(hub.streamId), port: 0 });
    const port = await server.listen();
    try {
      const asset = await fetch(`http://127.0.0.1:${port}/assets/tiles/Man5-Dora.svg`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("image/svg+xml");
      expect(await asset.text()).toContain("<svg");
      expect((await fetch(`http://127.0.0.1:${port}/assets/tiles/nope.svg`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
