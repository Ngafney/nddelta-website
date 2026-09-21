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
import SimPanel from "./src/components/SimPanel.jsx";
import BanditLab, { BanditBoard } from "./src/components/BanditLab.jsx";
import OrderBook from "./src/components/OrderBook.jsx";
import YouPanel from "./src/components/YouPanel.jsx";
import Leaderboard from "./src/components/Leaderboard.jsx";
import Toasts, { fillToasts } from "./src/components/Toasts.jsx";
import Reveal from "./src/components/Reveal.jsx";
import Rules from "./src/components/Rules.jsx";
import AdminPanel from "./src/components/AdminPanel.jsx";
import BigBoard from "./src/components/BigBoard.jsx";
import StaleBuild from "./src/components/StaleBuild.jsx";
import { money, moneyShort, num, clock } from "./src/components/PixelBits.jsx";
export const C = { App, Gate, SimPanel, BanditLab, BanditBoard, OrderBook, YouPanel, Leaderboard, Toasts, Reveal, Rules, AdminPanel, BigBoard, StaleBuild };
export { React, renderToStaticMarkup, fillToasts, money, moneyShort, num, clock };
`;

// Inside the project, so node can resolve react from week3/node_modules.
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
  location: { pathname: "/week3/", host: "nddelta.com" },
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

const baseRound = {
  roundId: "r1",
  mode: "coin",
  modeName: "Coin Market",
  status: "live",
  startedAt: 1,
  simsEndsAt: 2,
  endsAt: Date.now() + 300_000,
  msLeft: 300_000,
  minutes: 10,
  simSeconds: 120,
  prior: "beta05",
  priorName: "Beta(½, ½)",
  priorBlurb: "U-shaped",
  settlement: "prob",
  settlementName: "The true probability",
  settlementBlurb: "Each share pays 100 × p.",
  startCashC: 1_000_000,
  simCostC: 10_000,
  maxSims: 100,
  defaultSize: 10,
  lateJoin: true,
  players: 3,
  teams: 2,
  teamSize: 4,
  serverNow: Date.now(),
  tick: 1,
  center: 50,
  orderMin: 1,
  orderMax: 99,
  settleC: null,
  xStar: null,
  p: null,
  finalHeads: null,
};
const round = baseRound;
const prior = { key: "beta05", name: "Beta(½, ½)", blurb: "U-shaped", a: 0.5, b: 0.5 };
const me = {
  id: "p1",
  name: "Alice",
  teamId: "t1",
  cashC: 800_000,
  pos: 12,
  bidResC: 45_000,
  askResC: 0,
  buyC: 755_000,
  sellC: 1_955_000,
  spendableC: 755_000,
  valueC: 1_560_000,
  spentC: 200_000,
  startC: 1_000_000,
  simOrder: 20,
  sims: { n: 20, heads: 14, flips: "HHHHTHHTTHHHHHHHTTTH", at: 1 },
  canBuyLate: false,
  orders: [{ id: 1, side: "B", px: 45, qty: 10, ts: 1, holdC: 45_000 }],
};
const market = {
  bids: [{ px: 45, qty: 10, mine: 10 }, { px: 44, qty: 30, mine: 0 }],
  asks: [{ px: 66, qty: 20, mine: 0 }],
  last: 60,
  bestBid: 45,
  bestAsk: 66,
  mark: 60,
  mid: 55.5,
  volume: 42,
  tape: [{ s: 3, px: 60, qty: 10, ts: 1, aggr: "B" }],
};
const lb = [
  { rank: 1, id: "t1", name: "Heads Up", valueC: 1_200_000, startC: 1_000_000, totalC: 2_400_000, size: 2, pos: 12, spentC: 200_000, members: [{ id: "p1", name: "Alice", valueC: 1_560_000, pos: 12, sims: 20 }, { id: "p2", name: "Bob", valueC: 840_000, pos: -12, sims: 3 }] },
];
const rules = {
  marketRules: "**The coin.** hidden.\n\nMore flips, sharper estimate.",
  banditRules: "**Five coins.** 100 flips.",
  limits: { maxSharesPerOrder: 50, maxOrdersPerPlayer: 40, teamSize: 4 },
  sims: { max: 100, seconds: 120 },
  priors: { beta05: prior },
  priorOrder: ["beta05"],
  settlements: { prob: { key: "prob", name: "The true probability", blurb: "100 × p" } },
  settlementOrder: ["prob"],
};
const noop = () => {};

/* ── tests ────────────────────────────────────────────────────────────── */

console.log("\nscreens");

ok("the flip chooser shows the cost and what is left to trade with", () => {
  const out = render(h(C.SimPanel, { round: { ...round, status: "sims" }, me: { ...me, sims: null, cashC: 1_000_000 }, prior, onOrder: noop, onLate: noop }));
  assert.match(out, /HOW MANY FLIPS/);
  assert.match(out, /\$2,000\.00/, "20 flips at $100");
  assert.match(out, /\$8,000\.00/, "what is left");
});

ok("dealt flips show both the frequentist and the Bayesian estimate", () => {
  const out = render(h(C.SimPanel, { round, me, prior, onOrder: noop, onLate: noop }));
  assert.match(out, /14 \/ 20/);
  assert.match(out, />70\.0</, "heads ÷ flips");
  // Beta(0.5 + 14, 0.5 + 6) has mean 14.5 / 21 = 69.0
  assert.match(out, />69\.0</, "posterior mean under the round's prior");
  assert.strictEqual((out.match(/class="coin h"/g) ?? []).length, 14);
  assert.strictEqual((out.match(/class="coin t"/g) ?? []).length, 6);
});

ok("while trading, the flips panel offers one more flip at the live price", () => {
  const out = render(h(C.SimPanel, { round: { ...round, liveFlipCostC: 50_000 }, me, prior, onOrder: noop, onLate: noop, onExtra: noop }));
  assert.match(out, /ONE MORE FLIP · \$500\.00/);
  const settled = render(h(C.SimPanel, { round: { ...round, status: "settled", liveFlipCostC: 50_000, p: 0.5 }, me, prior, onOrder: noop, onLate: noop, onExtra: noop }));
  assert.ok(!/ONE MORE FLIP/.test(settled), "no extra flips after the bell");
});

ok("after the bell the panel shows the truth against the interval", () => {
  const out = render(h(C.SimPanel, { round: { ...round, status: "settled", p: 0.7, settleC: 7000, xStar: 70 }, me, prior, onOrder: noop, onLate: noop }));
  assert.match(out, /p = 70\.00/);
  assert.match(out, /the truth/);
});

ok("a late joiner is offered their one purchase", () => {
  const out = render(h(C.SimPanel, { round, me: { ...me, sims: null, canBuyLate: true }, prior, onOrder: noop, onLate: noop }));
  assert.match(out, /MISSED THE FLIP WINDOW/);
});

ok("the order book stops at 1 and 99", () => {
  const out = render(
    h(C.OrderBook, { book: market, last: 60, me, center: 50, tick: 1, lo: 1, hi: 99, mine: me.orders, size: 10, onSize: noop, onOrder: noop, onCancelLevel: noop, onCancelAll: noop, disabled: false })
  );
  const pxs = [...out.matchAll(/data-px="(-?\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(pxs.length > 10);
  assert.ok(pxs.every((p) => p >= 1 && p <= 99), `rows outside 1–99: ${pxs.filter((p) => p < 1 || p > 99)}`);
  assert.match(out, /Prices run 1 to 99/);
});

ok("rules, leaderboard, you-panel and reveal all mount", () => {
  assert.match(render(h(C.Rules, { rules, round })), /THE BANDIT LAB/);
  assert.match(render(h(C.Leaderboard, { rows: lb, myTeamId: "t1", settled: false })), /Heads Up/);
  assert.match(render(h(C.YouPanel, { me, team: null, mark: 60, settled: false, onCancel: noop, onCancelAll: noop })), /long the coin/);
  const reveal = { roundId: "r1", p: 0.6478, priorName: "Uniform", settlement: "flip", finalHeads: true, value: 100, settleC: 10000, scatter: [{ name: "Alice", n: 20, heads: 14, valueC: 1_100_000, startC: 1_000_000 }] };
  assert.match(render(h(C.Reveal, { reveal, me, leaderboard: lb, myTeamId: "t1", onClose: noop })), /TIME/);
});

ok("the bandit lab and its leaderboard mount", () => {
  assert.match(render(h(C.BanditLab, { player: { playerId: "p1", token: "t" }, team: { id: "t1" }, open: true, llm: false })), /DESCRIBE YOUR STRATEGY/);
  const board = [{ rank: 1, teamId: "t1", teamName: "Heads Up", avg: 7570.56, oraclePct: 90.7, sd: 1500, stratName: "three each", by: "Alice", at: 1, runs: 2 }];
  const out = render(h(C.BanditBoard, { rows: board, myTeamId: "t1" }));
  assert.match(out, /\$7,570\.56/);
  assert.match(out, /three each/);
});

ok("the admin panel and the big screen mount before any data arrives", () => {
  assert.match(render(h(C.AdminPanel)), /CONTROL ROOM/);
  render(h(C.BigBoard));
  assert.match(render(h(C.App)), /.+/);
});

console.log("\nregressions carried from week 2");

ok("the stylesheet cannot override the row height the virtualizer places rows by", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  const blocks = [...css.matchAll(/\.bookrow[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(blocks.length, "expected some .bookrow rules");
  for (const b of blocks) {
    const mh = b.match(/min-height:\s*([\d.]+)px/);
    if (mh) assert.ok(Number(mh[1]) <= 14, `.bookrow sets min-height ${mh[1]}px`);
    const stripped = b.replace(/(?:min|line)-height:[^;]*;/g, "");
    assert.ok(!/\bheight:\s*\d/.test(stripped), ".bookrow must not set a fixed height in CSS");
  }
});

ok("the gate keeps the team code up until the player dismisses it", () => {
  assert.match(appSource, /gateHolding/);
  assert.match(gateSource, /onHold\?\.\(true\)/);
});

try {
  fs.unlinkSync(outFile);
} catch {}
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
