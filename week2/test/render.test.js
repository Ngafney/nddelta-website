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
import ProbePanel from "./src/components/ProbePanel.jsx";
import YouPanel from "./src/components/YouPanel.jsx";
import Leaderboard from "./src/components/Leaderboard.jsx";
import Toasts, { fillToast } from "./src/components/Toasts.jsx";
import Reveal from "./src/components/Reveal.jsx";
import Rules from "./src/components/Rules.jsx";
import AdminPanel from "./src/components/AdminPanel.jsx";
import BigBoard from "./src/components/BigBoard.jsx";
import { money, moneyShort, num, clock } from "./src/components/PixelBits.jsx";
export const C = { App, Gate, Scope, OrderBook, ProbePanel, YouPanel, Leaderboard, Toasts, Reveal, Rules, AdminPanel, BigBoard };
export { React, renderToStaticMarkup, fillToast, money, moneyShort, num, clock };
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

const M = await import(pathToFileURL(outFile).href);
const { React, renderToStaticMarkup: render, C } = M;
const h = React.createElement;

/* ── mock data, shaped exactly like the API's ─────────────────────────── */

const points = [
  { x: 312.5, y: -220.418, d: -14.8123 },
  { x: 437.25, y: -388.902, d: 2.0071 },
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
  probes: 2,
  descents: 3,
  tickets: 1,
  sawAll: false,
  probeCostC: 421_250,
  descentCostC: 100_000,
  ticketCostC: 421_250,
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
  { rank: 1, id: "t1", name: "Convex Hull", valueC: 30_100_000, startC: 30_000_000, pos: 2, spentC: 1_400_000, sawAll: false, size: 3, members: team.members },
  { rank: 2, id: "t2", name: "Second Derivative", valueC: 24_000_000, startC: 20_000_000, pos: -3, spentC: 500_000, sawAll: true, size: 2, members: [{ id: "p4", name: "Dave", valueC: 14_000_000, pos: -3, points: 5 }, { id: "p5", name: "Erin", valueC: 10_000_000, pos: 0, points: 1 }] },
  { rank: 3, id: "t3", name: "Tail Risk", valueC: 9_000_000, startC: 10_000_000, pos: 1, spentC: 2_000_000, sawAll: false, size: 1, members: [{ id: "p6", name: "Pat", valueC: 9_000_000, pos: 1, points: 3 }] },
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
  difficulty: "rugged",
  difficultyName: "Rugged",
  difficultyBlurb: "Decoy valleys.",
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

const curve = Array.from({ length: 200 }, (_, i) => [i * (1000 / 199), Math.pow(i / 20 - 5, 2) * 7 - 300]);

/* ── the tests ────────────────────────────────────────────────────────── */

console.log("\nrender");

ok("the scope draws your points and reads out the active gradient", () => {
  // f'(437.25) is positive, so the function rises with x and downhill is left.
  const up = render(h(C.Scope, { points, activeX: 437.25 }));
  assert.ok(up.includes("437.25"), "the active x must be on screen");
  assert.ok(up.includes("GRADIENT"), "the gradient must be labeled");
  assert.ok(up.includes("to the left"), "a POSITIVE gradient means downhill is to the left");
  // f'(312.5) is negative, so downhill is the other way.
  const down = render(h(C.Scope, { points, activeX: 312.5 }));
  assert.ok(down.includes("to the right"), "a NEGATIVE gradient means downhill is to the right");
  assert.ok(down.includes("-14.8123"), "the gradient number itself is printed");
});

ok("the scope never names the ends of the domain", () => {
  // The axes are fitted to the player's own points, so nothing on the chart
  // can hint at where the domain — and therefore the minimum — has to be.
  const out = render(h(C.Scope, { points, activeX: 437.25 }));
  assert.ok(!/toward 0|toward 100|\b1000\b/.test(out), `the scope leaked a bound: ${out.slice(0, 400)}`);
});

ok("the scope survives having no points yet", () => {
  const out = render(h(C.Scope, { points: [], activeX: null }));
  assert.ok(out.includes("waiting for your opening point"));
});

ok("the book renders a window of ticks with depth, my lots and the market's", () => {
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
  const out = render(h(C.OrderBook, props));
  assert.ok(out.includes("SPREAD"), "the spread strip must render");
  assert.ok(out.includes("JUMP TO MIDDLE"), "there must be a way back to the middle");
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
  assert.ok(out.includes("+4 lots"), "position");
  assert.ok(out.includes("+$250.00"), "P&L against the starting stack");
  assert.ok(out.includes("Convex Hull"));
  assert.ok(out.includes("2 @ 300") && out.includes("1 @ 850"), "working orders");
  assert.ok(out.includes("$600.00 held") && out.includes("$150.00 held"), "each order says what it is holding");
});

ok("the buy panel offers a descent, a point and a ticket, priced 2/5/5", () => {
  const props = {
    me,
    anchorX: 437.25,
    onAnchor() {},
    onProbe() {},
    onDescend() {},
    onTicket() {},
    busy: null,
    disabled: false,
    limits: { maxProbeStep: 250, learningRate: [0.01, 10000] },
  };
  const out = render(h(C.ProbePanel, props));
  assert.ok(out.includes("DESCEND") && out.includes("POINT") && out.includes("TICKET"), "all three offers");
  assert.ok(out.includes("5%"), "the share-priced ones show a share");
  // The descent tab opens first, and shows the step the current rate implies.
  assert.ok(out.includes("f′(x)"), "the update rule is on screen");
  assert.ok(out.includes("$1,000.00"), "the descent is a flat $1,000");
  assert.ok(out.includes("LEARNING RATE"));
  assert.ok(out.includes("-14.8123") || out.includes("2.0071"), "the slope you stand on is shown");
});

ok("the buy panel never names a bound", () => {
  const out = render(
    h(C.ProbePanel, {
      me,
      anchorX: 437.25,
      onAnchor() {},
      onProbe() {},
      onDescend() {},
      onTicket() {},
      busy: null,
      disabled: false,
      limits: { maxProbeStep: 250, learningRate: [0.01, 10000] },
    })
  );
  assert.ok(!/\b1000\b/.test(out.replace(/10000/g, "")), "the buy panel leaked a settlement bound");
});

ok("the leaderboard ranks teams and opens up my own", () => {
  const out = render(h(C.Leaderboard, { rows: leaderboard, myTeamId: "t1", settled: false }));
  assert.ok(out.includes("Convex Hull") && out.includes("Second Derivative"));
  assert.ok(out.includes("$301,000.00"), "a team total is its members added up");
  assert.ok(out.includes("Bob") && out.includes("Carol"), "my own team opens out");
  assert.ok(!out.includes("Dave"), "other teams stay closed until the bell");
  assert.ok(out.includes("+$1,000.00") && out.includes("−$10,000.00"), "team P&L, up and down");
});

ok("toasts render fills from both sides", () => {
  const t1 = M.fillToast({ s: 1, side: "B", px: 40, qty: 2, ts: 1, taker: true, cp: "Bob" });
  const t2 = M.fillToast({ s: 2, side: "A", px: 41, qty: 1, ts: 1, taker: false, cp: "Carol" });
  const out = render(h(C.Toasts, { items: [t1, t2], onExpire() {} }));
  assert.ok(out.includes("BOUGHT") && out.includes("SOLD"));
  assert.ok(out.includes("you crossed") && out.includes("Carol hit you"));
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
