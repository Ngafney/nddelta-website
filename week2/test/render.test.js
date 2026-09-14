/**
 * Render tests. Every screen is rendered to static markup against realistic
 * mock data, which catches the whole class of bug a build cannot: a bad import,
 * a prop that is read off undefined, a map over something that is not an array.
 *
 * Effects and canvas drawing do not run here — this is a check that the trees
 * mount and produce the right text, not a pixel test.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
}

/* ── build the components into something node can import ──────────────── */

const entry = `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./src/App.jsx";
import Gate from "./src/components/Gate.jsx";
import Scope from "./src/components/Scope.jsx";
import OrderBook from "./src/components/OrderBook.jsx";
import YouPanel from "./src/components/YouPanel.jsx";
import Leaderboard from "./src/components/Leaderboard.jsx";
import Toasts, { fillToasts } from "./src/components/Toasts.jsx";
import Reveal from "./src/components/Reveal.jsx";
import Rules from "./src/components/Rules.jsx";
import AdminPanel from "./src/components/AdminPanel.jsx";
import BigBoard from "./src/components/BigBoard.jsx";
import { money, moneyShort, num, clock } from "./src/components/PixelBits.jsx";
export const C = { App, Gate, Scope, OrderBook, YouPanel, Leaderboard, Toasts, Reveal, Rules, AdminPanel, BigBoard };
export { React, renderToStaticMarkup, fillToasts, money, moneyShort, num, clock };
`;

// Inside the project, so node can resolve react from week2/node_modules.
fs.mkdirSync(path.join(root, ".data"), { recursive: true });
const outFile = path.join(root, ".data", `render-${process.pid}.mjs`);
await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: "jsx" },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react-dom/server"],
  jsx: "automatic",
  logLevel: "silent",
});

// The components read a few browser globals at render time. Nothing more than
// this is needed, which is itself a useful fact about the code.
globalThis.window = {
  location: { pathname: "/week2/", host: "nddelta.com" },
  devicePixelRatio: 1,
  crypto: { getRandomValues: (a) => a.fill(7) },
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = {
  cookie: "",
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {},
  getElementById: () => null,
};
globalThis.localStorage = {
  store: new Map(),
  getItem(k) {
    return this.store.get(k) ?? null;
  },
  setItem(k, v) {
    this.store.set(k, v);
  },
  removeItem(k) {
    this.store.delete(k);
  },
};
globalThis.sessionStorage = globalThis.localStorage;
// node 21+ defines navigator as a getter-only global, so patch rather than assign
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "test", language: "en", hardwareConcurrency: 8, maxTouchPoints: 0 },
  configurable: true,
});
globalThis.screen = { width: 1920, height: 1080, colorDepth: 24 };
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
// matchMedia drives the responsive decisions the components make in JS.
let NARROW_SCREEN = false;
globalThis.window.matchMedia = (q) => ({
  matches: /max-width:\s*760px/.test(q) ? NARROW_SCREEN : false,
  addEventListener() {},
  removeEventListener() {},
});
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
if (!globalThis.performance) globalThis.performance = { now: () => 0 };

const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const gateSource = fs.readFileSync(path.join(root, "src", "components", "Gate.jsx"), "utf8");

const M = await import(pathToFileURL(outFile).href);
const { React, renderToStaticMarkup: render, C } = M;
const h = React.createElement;

/* ── mock data, shaped exactly like the API's ─────────────────────────── */

const points = [
  { x: 31.25, y: 720.418, d: -14.8123 },
  { x: 43.72, y: 588.902, d: 2.0071 },
];

const me = {
  id: "p1",
  name: "Alice",
  teamId: "t1",
  cashC: 8_425_000,
  pos: 4,
  bidResC: 60_000,
  askResC: 15_000,
  buyC: 7_825_000,
  sellC: 8_675_000,
  spendableC: 7_825_000,
  valueC: 10_025_000,
  spentC: 975_000,
  startC: 10_000_000,
  descents: 3,
  descentCostC: 100_000,
  points,
  orders: [
    { id: 3, side: "B", px: 300, qty: 2, ts: 1, holdC: 60_000 },
    { id: 7, side: "A", px: 850, qty: 1, ts: 2, holdC: 15_000 },
  ],
};

const team = {
  id: "t1",
  name: "Convex Hull",
  code: "K7QP",
  size: 3,
  max: 4,
  valueC: 30_100_000,
  members: [
    { id: "p1", name: "Alice", valueC: 10_025_000, pos: 4, points: 2, me: true },
    { id: "p2", name: "Bob", valueC: 10_075_000, pos: -2, points: 1, me: false },
    { id: "p3", name: "Carol", valueC: 10_000_000, pos: 0, points: 1, me: false },
  ],
};

const market = {
  bids: [
    { px: 340, qty: 7, mine: 0 },
    { px: 300, qty: 12, mine: 2 },
  ],
  asks: [
    { px: 380, qty: 5, mine: 0 },
    { px: 850, qty: 1, mine: 1 },
  ],
  last: 360,
  bestBid: 340,
  bestAsk: 380,
  mark: 360,
  mid: 360,
  volume: 148,
  tape: [
    { s: 90, px: 360, qty: 2, ts: Date.now(), aggr: "B" },
    { s: 88, px: 355, qty: 1, ts: Date.now(), aggr: "A" },
  ],
};

const leaderboard = [
  { rank: 1, id: "t1", name: "Convex Hull", valueC: 10_033_333, startC: 10_000_000, totalC: 30_100_000, pos: 2, spentC: 1_400_000, size: 3, members: team.members },
  { rank: 2, id: "t2", name: "Second Derivative", valueC: 12_000_000, startC: 10_000_000, totalC: 24_000_000, pos: -3, spentC: 500_000, size: 2, members: [{ id: "p4", name: "Dave", valueC: 14_000_000, pos: -3, points: 5 }, { id: "p5", name: "Erin", valueC: 10_000_000, pos: 0, points: 1 }] },
  { rank: 3, id: "t3", name: "Tail Risk", valueC: 9_000_000, startC: 10_000_000, totalC: 9_000_000, pos: 1, spentC: 2_000_000, size: 1, members: [{ id: "p6", name: "Pat", valueC: 9_000_000, pos: 1, points: 3 }] },
];

const round = {
  roundId: "abc12",
  mode: "gradient",
  modeName: "Gradient Trading",
  hasCurve: true,
  question: null,
  status: "live",
  startedAt: Date.now() - 60_000,
  endsAt: Date.now() + 300_000,
  msLeft: 300_000,
  startCashC: 10_000_000,
  lateJoin: true,
  players: 42,
  teams: 12,
  teamSize: 4,
  serverNow: Date.now(),
  tick: 5,
  center: 500,
  settleC: null,
  xStar: null,
};

const curve = Array.from({ length: 200 }, (_, i) => [i * (100 / 199), Math.pow(i / 20 - 5, 2) * 7 + 500]);

/* ── the tests ────────────────────────────────────────────────────────── */

console.log("\nrender");

ok("the scope reads out where you are, how high, and the lowest you have seen", () => {
  const out = render(h(C.Scope, { points, activeX: 43.72 }));
  assert.ok(out.includes("43.72"), "the active x must be on screen");
  assert.ok(out.includes("GRADIENT"), "the gradient must be labeled");
  assert.ok(out.includes("HEIGHT"), "the height is the thing being traded");
  assert.ok(out.includes("LOWEST SEEN"), "and the bound it gives you");
  assert.ok(out.includes("588.90"), "the lowest height owned is shown");
  assert.ok(out.includes("at or below"), "explained as a bound on the answer");
  assert.ok(out.includes("-14.8123") || out.includes("2.007"), "the gradient number is printed");
});

ok("the scope never names the ends of the domain", () => {
  // The axes are fitted to the player's own points, so nothing on the chart
  // can hint at where the domain — and therefore the answer — has to be.
  const out = render(h(C.Scope, { points, activeX: 43.72 }));
  assert.ok(!/toward 0|toward 100|\b1000\b/.test(out), `the scope leaked a bound: ${out.slice(0, 400)}`);
});

ok("the step control lives in the chart, with the top of the slider as the max step", () => {
  const out = render(
    h(C.Scope, {
      points,
      activeX: 43.72,
      me,
      onDescend() {},
      busy: null,
      disabled: false,
      limits: { maxStep: 25, learningRate: [0.0001, 1000] },
    })
  );
  assert.ok(out.includes("TAKE A STEP DOWNHILL"), "the one purchase is on the chart itself");
  assert.ok(out.includes("$1,000.00"), "at a flat fee");
  assert.ok(out.includes("LEARNING RATE") && out.includes("THE STEP"), "rate in, step out");
  assert.ok(out.includes("max step · 25"), "the slider tops out at the largest legal step");
  assert.ok(!/TOO BIG/.test(out), "so there is never a too-big state to hit");
});

ok("the scope survives having no points yet", () => {
  const out = render(h(C.Scope, { points: [], activeX: null }));
  assert.ok(out.includes("waiting for your opening point"));
});

ok("the book renders a window of ticks with depth, my shares and the market's", () => {
  const props = {
    book: market,
    last: 360,
    me,
    center: 500,
    tick: 5,
    mine: me.orders,
    size: 1,
    onSize() {},
    onOrder() {},
    onCancelLevel() {},
    onCancelAll() {},
    disabled: false,
  };
  const out = render(h(C.OrderBook, props));
  assert.ok(out.includes("SPREAD"), "the spread strip must render");
  assert.ok(out.includes("MIDDLE"), "there must be a way back to the middle");
  assert.ok(out.includes("ZOOM"), "and a zoom control");
  assert.ok(out.includes("FLAT") || out.includes("LONG") || out.includes("SHORT"), "the net position sits above the book");
  assert.ok(out.includes("CANCEL ALL"), "and a cancel-all");
  assert.ok(/data-px="\d+"/.test(out), "rows must render");
  // Virtualised: a window, not thousands of rows.
  const rows = (out.match(/data-px=/g) ?? []).length;
  assert.ok(rows > 5 && rows < 200, `expected a virtualized window, got ${rows} rows`);
  // Ticks of five only.
  for (const m of out.matchAll(/data-px="(-?\d+)"/g)) {
    assert.strictEqual(Number(m[1]) % 5, 0, `row ${m[1]} is off the 5-tick grid`);
  }
  const closed = render(h(C.OrderBook, { ...props, disabled: true }));
  assert.ok(closed.includes("disabled"), "a closed market must disable the ladder");
});

ok("the you panel shows cash, reserved, position and P&L", () => {
  const out = render(h(C.YouPanel, { me, team, mark: 360, settled: false, onCancel() {}, onCancelAll() {} }));
  assert.ok(out.includes("$84,250.00"), "cash");
  assert.ok(out.includes("$750.00"), "reserved = $600 bids + $150 offers");
  assert.ok(out.includes("+4 shares"), "position");
  assert.ok(out.includes("+$250.00"), "P&L against the starting stack");
  assert.ok(out.includes("Convex Hull"));
  assert.ok(out.includes("2 @ 300") && out.includes("1 @ 850"), "working orders");
  assert.ok(out.includes("$600.00 held") && out.includes("$150.00 held"), "each order says what it is holding");
});

ok("the leaderboard ranks teams and opens up my own", () => {
  const out = render(h(C.Leaderboard, { rows: leaderboard, myTeamId: "t1", settled: false }));
  assert.ok(out.includes("Convex Hull") && out.includes("Second Derivative"));
  assert.ok(out.includes("$100,333.33"), "a team is scored on the average of its members");
  assert.ok(out.includes("Bob") && out.includes("Carol"), "my own team opens out");
  assert.ok(!out.includes("Dave"), "other teams stay closed until the bell");
  assert.ok(out.includes("+$333.33") && out.includes("−$10,000.00"), "team P&L, up and down");
});

ok("one trade makes one notification, and says whether you lifted or hit", () => {
  // You crossed and bought: you LIFTED them. Three resting orders eaten by one
  // click is still one thing that happened, so it is one notification.
  const lifted = M.fillToasts([
    { s: 1, side: "B", px: 40, qty: 2, ts: 1, taker: true, cp: "Bob" },
    { s: 2, side: "B", px: 45, qty: 1, ts: 1, taker: true, cp: "Bob" },
  ]);
  assert.strictEqual(lifted.length, 1, "one trade, one notification");
  assert.ok(lifted[0].title.includes("YOU LIFTED BOB"), lifted[0].title);
  assert.ok(lifted[0].body.includes("Bought 3 shares at 40–45"), lifted[0].body);

  // You crossed and sold: you HIT them.
  const hit = M.fillToasts([{ s: 3, side: "A", px: 41, qty: 1, ts: 1, taker: true, cp: "Carol" }]);
  assert.ok(hit[0].title.includes("YOU HIT CAROL"), hit[0].title);

  // Somebody traded into your resting orders: they did it to you.
  const passive = M.fillToasts([{ s: 4, side: "A", px: 41, qty: 1, ts: 1, taker: false, cp: "Dave" }]);
  assert.ok(passive[0].title.includes("DAVE LIFTED YOU"), passive[0].title);

  const out = render(h(C.Toasts, { items: [...lifted, ...hit], onExpire() {} }));
  assert.ok(out.includes("LIFTED") && out.includes("HIT"));
});

ok("the reveal mounts for a curve and for a resolution", () => {
  const gradient = render(
    h(C.Reveal, { reveal: { mode: "gradient", curve, xStar: 441.9, yStar: -300, settleC: 44190 }, points, leaderboard, myTeamId: "t1", onClose() {} })
  );
  assert.ok(gradient.includes("TIME"), "it opens on the countdown");

  const prediction = render(
    h(C.Reveal, { reveal: { mode: "prediction", value: 100, question: "Will it snow?", settleC: 10000 }, points: [], leaderboard, onClose() {}, projector: true })
  );
  assert.ok(prediction.includes("TIME"));
});

ok("the gate walks name → create or join", () => {
  const nameStep = render(h(C.Gate, { player: null, round, onPlayer() {}, onTeam() {} }));
  assert.ok(nameStep.includes("YOUR NAME"));
  assert.ok(nameStep.includes("PRESS START"));
  const choose = render(h(C.Gate, { player: { playerId: "p", token: "t", name: "Alice" }, round, onPlayer() {}, onTeam() {} }));
  assert.ok(choose.includes("CREATE TEAM") && choose.includes("JOIN TEAM"));
  assert.ok(choose.includes("Alice"));
});

ok("the gate reads as a prediction market in prediction mode", () => {
  const out = render(h(C.Gate, { player: null, round: { ...round, mode: "prediction" }, onPlayer() {}, onTeam() {} }));
  assert.ok(out.includes("PREDICTION MARKET"));
  assert.ok(!out.includes("HIDDEN MINIMUM"));
});

ok("the admin panel renders its login", () => {
  const out = render(h(C.AdminPanel, {}));
  assert.ok(out.includes("CONTROL ROOM") && out.includes("WHO GOES THERE"));
});

ok("the big board renders the waiting state", () => {
  const out = render(h(C.BigBoard, {}));
  assert.ok(out.includes("NO ROUND IS OPEN"));
});

ok("the app routes to the floor and survives having no round", () => {
  const out = render(h(C.App, {}));
  assert.ok(out.includes("NO ROUND IS OPEN"), "with no config loaded yet it should say so, not crash");
});

ok("the book switches to touch-sized rows on a phone", () => {
  const props = {
    book: market,
    last: 360,
    center: 500,
    tick: 5,
    mine: me.orders,
    size: 1,
    onSize() {},
    onOrder() {},
    onCancelLevel() {},
    onCancelAll() {},
    disabled: false,
  };
  const rowHeight = (out) => Number(out.match(/height:\s*(\d+)px/)?.[1]);
  NARROW_SCREEN = false;
  const desktop = render(h(C.OrderBook, props));
  NARROW_SCREEN = true;
  const phone = render(h(C.OrderBook, props));
  NARROW_SCREEN = false;
  // The ladder is absolutely positioned, so row height is arithmetic the
  // virtualizer depends on - it has to change with the screen, not just in CSS.
  assert.ok(rowHeight(phone) > rowHeight(desktop), `phone rows ${rowHeight(phone)} vs desktop ${rowHeight(desktop)}`);
  assert.ok(rowHeight(phone) >= 40, "touch targets must be at least 40px tall");
});

ok("the stylesheet cannot override the row height the virtualizer places rows by", () => {
  // THE BUG THIS EXISTS FOR: .bookrow carried `min-height: 30px`, which beat
  // the inline height the virtualizer sets from the zoom level. Rows rendered
  // 30px tall but were positioned 11px apart, so every row overlapped the one
  // above and the opaque price cells painted the prices out entirely.
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  const blocks = [...css.matchAll(/\.bookrow[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(blocks.length, "expected some .bookrow rules");
  for (const b of blocks) {
    const mh = b.match(/min-height:\s*([\d.]+)px/);
    if (mh) {
      assert.ok(
        Number(mh[1]) <= 14,
        `.bookrow sets min-height ${mh[1]}px, which would override the tightest zoom and overlap the rows`
      );
    }
    // strip min-height AND line-height before looking for a fixed height
    const stripped = b.replace(/(?:min|line)-height:[^;]*;/g, "");
    assert.ok(!/\bheight:\s*\d/.test(stripped), ".bookrow must not set a fixed height in CSS");
  }
});

ok("every price renders, at a size that fits its row, at every zoom", () => {
  const props = {
    book: market,
    last: 360,
    me,
    center: 500,
    tick: 5,
    mine: me.orders,
    size: 1,
    onSize() {},
    onOrder() {},
    onCancelLevel() {},
    onCancelAll() {},
    disabled: true, // the lobby: prices must still be legible before the open
  };
  for (const narrow of [false, true]) {
    NARROW_SCREEN = narrow;
    const out = render(h(C.OrderBook, props));
    const rows = [...out.matchAll(/data-px="(-?\d+)"[^>]*style="([^"]*)"/g)];
    assert.ok(rows.length > 10, `expected a window of rows, got ${rows.length}`);
    for (const [, px, style] of rows.slice(0, 20)) {
      // the number itself is on screen, not just the attribute
      assert.ok(out.includes(`>${px}</div>`), `price ${px} is not rendered as text`);
      const height = Number(style.match(/height:\s*(\d+)px/)?.[1]);
      const font = Number(style.match(/font-size:\s*(\d+)px/)?.[1]);
      assert.ok(height > 0, `row ${px} has no height`);
      assert.ok(font > 0, `row ${px} has no font size`);
      assert.ok(font <= height, `row ${px}: ${font}px type in a ${height}px row will overflow onto its neighbour`);
    }
  }
  NARROW_SCREEN = false;
});

ok("the gate keeps the team code up until the player dismisses it", () => {
  // THE BUG THIS EXISTS FOR: the app decided whether to show the gate from
  // me.teamId, which the poll sets about a second after the team is created —
  // so the code screen was unmounted mid-read. The gate now holds the app.
  let held = null;
  const gate = render(
    h(C.Gate, {
      player: { playerId: "p", token: "t", name: "Alice" },
      round,
      limits: { codeHoldSeconds: 6 },
      team: null,
      onHold: (v) => {
        held = v;
      },
      onPlayer() {},
      onTeam() {},
    })
  );
  assert.ok(gate.includes("CREATE TEAM"), "the choice screen still renders");
  // The app must offer the hold hook at all — without it there is nothing the
  // gate can do to stop the poll pulling it out from under the player.
  assert.ok(appSource.includes("gateHolding"), "App does not track a gate hold");
  assert.ok(
    /\|\|\s*gateHolding\)/.test(appSource),
    "App's gate condition does not consider the hold, so a poll can still unmount it"
  );
  assert.ok(!gateSource.includes("TO THE FLOOR IN"), "the code screen still auto-counts down instead of waiting");
  assert.ok(gateSource.includes("onHold?.(true)"), "the code screen does not ask the app to hold");
});

ok("money formatting is exact and signed where it should be", () => {
  assert.strictEqual(M.money(10_000_000), "$100,000.00");
  assert.strictEqual(M.money(1_000_000), "$10,000.00");
  assert.strictEqual(M.money(-2550), "−$25.50");
  assert.strictEqual(M.money(2550, { sign: true }), "+$25.50");
  assert.strictEqual(M.money(0), "$0.00");
  assert.strictEqual(M.moneyShort(1_000_000), "$10.0k");
  assert.strictEqual(M.clock(90_000), "1:30");
  assert.strictEqual(M.clock(-5), "0:00");
  assert.strictEqual(M.num(3.14159, 2), "3.14");
});

try {
  fs.unlinkSync(outFile);
} catch {}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
