import assert from "node:assert/strict";
import { chromium } from "playwright";
import { dashboardCss } from "../../src/live/dashboard/index.js";
import { localeRuntimeJs } from "../../src/live/dashboard/i18n.js";
import { tableStateRendererJs } from "../../src/live/dashboard/renderer.js";
import { LiveEventHub } from "../../src/live/hub.js";
import { SnapshotStore } from "../../src/live/snapshot.js";
import { createLiveServer } from "../../src/live/server.js";

const positions = ["bottom", "right", "top", "left"];
function fixture(meldCount: number) {
  return {
    round: "E1", honba: 1, kyotaku: 0, oya: 0, currentSeat: 1, doraIndicators: ["E"],
    table: { seats: Object.fromEntries(positions.map((position, playerIndex) => [position, {
      position, playerIndex, agentId: "hybrid@0.30", currentWind: ["E", "S", "W", "N"][playerIndex],
      score: 25000, concealedTileCount: 14, drawnTilePending: true,
      debugHand: [...Array(13).fill("E"), "8m"], debugDrawnTile: "8m",
      river: Array.from({ length: 24 }, (_, index) => ({ tile: `${index % 9 + 1}m`, riichi: false })),
      melds: [
        { type: "kakan", tiles: ["8m", "8m", "8m", "8m"], calledTileIndex: playerIndex % 3 },
        { type: "pon", tiles: ["E", "E", "E"], calledTileIndex: 1 },
        { type: "chi", tiles: ["3p", "4p", "5p"], calledTileIndex: 0 },
        { type: "ankan", tiles: ["1s", "1s", "1s", "1s"], concealedIndexes: [0, 3] },
      ].slice(0, meldCount),
    }])) },
  };
}

const hub = new LiveEventHub({ streamId: "layout-test" });
const server = createLiveServer({ hub, snapshots: new SnapshotStore(hub.streamId), port: 0 });
const port = await server.listen();
const browser = await chromium.launch({ headless: true });
let checked = 0;
try {
  const page = await browser.newPage();
  // Serve only the shared renderer for deterministic geometry; SVGs use the real asset route.
  await page.route(`http://127.0.0.1:${port}/`, (route) => route.fulfill({ contentType: "text/html", body:
    `<style>${dashboardCss}</style><main><section class="table-section"><div id="mahjong-table" class="mahjong-table"></div></section></main>`,
  }));
  await page.goto(`http://127.0.0.1:${port}/`);
  // tsx preserves local function names through this helper in serialized callbacks.
  await page.addScriptTag({ content: `window.__name = (fn) => fn; (function () {
    ${localeRuntimeJs}
    const $ = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => '&#' + char.charCodeAt(0) + ';');
    ${tableStateRendererJs}
    window.renderTableFixture = renderMahjongTable;
  })();` });
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    let expectedSide: number | undefined;
    for (const mode of ["spectator", "debug"]) for (const meldCount of [0, 1, 4]) {
      await page.evaluate(({ snapshot, mode }) => (window as any).renderTableFixture(snapshot, mode), { snapshot: fixture(meldCount), mode });
      await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
      const geometry = await page.evaluate(() => {
        const table = document.querySelector("#mahjong-table")!;
        const board = table.getBoundingClientRect();
        const seats = [...table.querySelectorAll(".seat-zone")].map((seat) => {
          const frame = seat.querySelector(".oriented-frame")!;
          const inverse = new DOMMatrix(getComputedStyle(frame).transform).inverse();
          const cx = board.x + board.width / 2, cy = board.y + board.height / 2;
          const local = (node: Element) => {
            const r = node.getBoundingClientRect();
            const points = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]
              .map(([x, y]) => inverse.transformPoint(new DOMPoint(x! - cx, y! - cy)));
            return { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)),
              right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y)), width: r.width, height: r.height };
          };
          const hand = [...seat.querySelectorAll(".table-hand .tile-image")].map(local);
          const river = [...seat.querySelectorAll(".river .tile-image")].map(local);
          const melds = [...seat.querySelectorAll(".meld-set")].map(local);
          const stack = [...seat.querySelectorAll(".kakan-stack .tile-image")].map(local);
          const rect = seat.querySelector(".meld-slot")?.getBoundingClientRect();
          return { hand, river, melds, stack, rotation: getComputedStyle(frame).transform,
            meldCenter: rect ? { x: (rect.x + rect.width / 2 - board.x) / board.width, y: (rect.y + rect.height / 2 - board.y) / board.height } : null,
          };
        });
        const escaped = [...table.querySelectorAll(".tile-image")].filter(node => {
          const r = node.getBoundingClientRect();
          return r.left < board.left || r.right > board.right || r.top < board.top || r.bottom > board.bottom;
        }).length;
        return { width: board.width, height: board.height, seats, escaped, pageOverflow: document.documentElement.scrollWidth > innerWidth };
      });
      const context = `${width}px ${mode} ${meldCount} melds`;
      const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1, `${context}: ${actual} != ${expected}`);
      near(geometry.width, geometry.height);
      expectedSide ??= geometry.width;
      near(geometry.width, expectedSide);
      assert.equal(geometry.escaped, 0, `${context}: tiles outside table`);
      assert.equal(geometry.pageOverflow, false, `${context}: page overflow`);
      // DOM order is top, left, right, bottom; these matrices orient faces toward their owner.
      const rotations = ["matrix(-1, 0, 0, -1, 0, 0)", "matrix(0, 1, -1, 0, 0, 0)", "matrix(0, -1, 1, 0, 0, 0)", "matrix(1, 0, 0, 1, 0, 0)"];
      geometry.seats.forEach((seat, index) => {
        assert.equal(seat.rotation, rotations[index], context);
        assert.equal(seat.hand.length, 14);
        seat.hand.forEach(tile => near(tile.y, seat.hand[0]!.y));
        for (let i = 1; i < 14; i++) assert.ok(seat.hand[i]!.x >= seat.hand[i - 1]!.right - .1, context);
        assert.ok(seat.hand[13]!.x - seat.hand[12]!.right > seat.hand[1]!.x - seat.hand[0]!.right, `${context}: drawn tile gap`);
        seat.river.forEach((tile, i) => {
          near(tile.x, seat.river[i % 6]!.x);
          near(tile.y, seat.river[Math.floor(i / 6) * 6]!.y);
        });
        if (!meldCount) return;
        // In every seat's own coordinates, melds sit at the right edge, above the hand.
        const rightmost = seat.melds[0]!;
        assert.ok(rightmost.right > geometry.width * .44, context);
        seat.melds.forEach(meld => assert.ok(meld.bottom < seat.hand[0]!.y, `${context}: meld touches hand`));
        assert.equal(seat.stack.length, 2);
        near(seat.stack[0]!.x, seat.stack[1]!.x);
        near(seat.stack[0]!.right, seat.stack[1]!.right);
        assert.ok(seat.stack[1]!.bottom < seat.stack[0]!.y, `${context}: added kan is not stacked`);
        for (let i = 1; i < seat.melds.length; i++) assert.ok(seat.melds[i]!.right < seat.melds[i - 1]!.x, `${context}: melds overlap`);
        if (meldCount === 1) {
          const corner = seat.meldCenter!;
          const expectedRight = index === 2 || index === 3;
          const expectedBottom = index === 1 || index === 3;
          assert.equal(corner.x > .5, expectedRight, `${context}: wrong meld corner x`);
          assert.equal(corner.y > .5, expectedBottom, `${context}: wrong meld corner y`);
        }
      });
      checked++;
    }
  }
  console.log(`Table layout: ${checked} browser cases passed (four seats, 14 tiles, rivers, meld corners, kan stacks, square and mobile layout).`);
} finally {
  await browser.close();
  await server.close();
}
