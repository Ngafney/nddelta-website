/**
 * Render tests. Every screen is rendered to static markup against realistic
 * mock data — the shape the API actually sends — which catches the whole class
 * of bug a build cannot: a bad import, a prop read off undefined, a map over
 * something that is not an array. Ported from week 3's render test.
 *
 * Effects and canvas drawing do not run here — this checks that the trees
 * mount and say the right things, not pixels.
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

const entry = `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App, { Floor } from "./src/App.jsx";
import Gate from "./src/components/Gate.jsx";
import OrderBook from "./src/components/OrderBook.jsx";
import YouPanel from "./src/components/YouPanel.jsx";
import Leaderboard from "./src/components/Leaderboard.jsx";
import Toasts, { fillToasts } from "./src/components/Toasts.jsx";
import Reveal from "./src/components/Reveal.jsx";
import Rules from "./src/components/Rules.jsx";
import AdminPanel, { Console } from "./src/components/AdminPanel.jsx";
import BigBoard from "./src/components/BigBoard.jsx";
import DataPanel from "./src/components/DataPanel.jsx";
import HorizonChart, { ChartHeader, FairChart } from "./src/components/HorizonChart.jsx";
import StaleBuild from "./src/components/StaleBuild.jsx";
export const C = { App, Floor, Console, Gate, OrderBook, YouPanel, Leaderboard, Toasts, Reveal, Rules, AdminPanel, BigBoard, DataPanel, HorizonChart, ChartHeader, FairChart, StaleBuild };
export { React, renderToStaticMarkup, fillToasts };
`;

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

// The browser globals the components read at render time — nothing more.
globalThis.window = {
  location: { pathname: "/week5/", host: "nddelta.com" },
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
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "test", language: "en", hardwareConcurrency: 8, maxTouchPoints: 0, clipboard: { writeText: async () => {} } },
  configurable: true,
});
globalThis.screen = { width: 1920, height: 1080, colorDepth: 24 };
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const M = await import(pathToFileURL(outFile).href);
const { React, renderToStaticMarkup: render, C } = M;
const h = React.createElement;

/* ── mock data, shaped exactly like the API's ─────────────────────────── */

const NOW = Date.now();
const round = {
  roundId: "r5",
  status: "live",
  phase: "LIVE",
  K: 100,
  T: 60,
  H: 150,
  tickNow: 12,
  ticksLeft: 48,
  tickMs: 4000,
  secondsPerTick: 4,
  liveStartedAt: NOW - 48_000,
  nextTickAt: NOW + 2000,
  researchMinutes: 3,
  researchEndsAt: NOW - 48_000,
  endsAt: NOW + 192_000,
  msLeft: 192_000,
  serverNow: NOW,
  startCashC: 1_000_000,
  defaultSize: 10,
  lateJoin: true,
  players: 3,
  teams: 2,
  teamSize: 4,
  priceTick: 1,
  center: 50,
  orderMin: 1,
  orderMax: 99,
  naiveDesk: true,
  noiseDesks: 2,
  settleC: null,
  xStar: null,
  yT: null,
};
const ys = Array.from({ length: 162 }, (_, i) => 100 + 5 * Math.sin(i / 9));
const series = { t0: -149, ys, tick: 12 };
const me = {
  id: "p1",
  name: "Alice",
  teamId: "t1",
  cashC: 960_000,
  pos: 10,
  bidResC: 45_000,
  askResC: 0,
  buyC: 915_000,
  sellC: 1_955_000,
  spendableC: 915_000,
  valueC: 1_020_000,
  spentC: 0,
  startC: 1_000_000,
  orders: [{ id: 1, side: "B", px: 45, qty: 10, ts: 1, holdC: 45_000 }],
};
const market = {
  bids: [{ px: 70, qty: 5, mine: 0 }, { px: 45, qty: 10, mine: 10 }],
  asks: [{ px: 78, qty: 5, mine: 0 }],
  last: 74,
  bestBid: 70,
  bestAsk: 78,
  mark: 74,
  mid: 74,
  volume: 42,
  tape: [{ s: 3, px: 74, qty: 3, ts: 1, aggr: "B" }],
};
const team = { id: "t1", name: "Mean Team", code: "ABCD", size: 2, max: 4, valueC: 1_010_000, totalC: 2_020_000, members: [{ id: "p1", name: "Alice", valueC: 1_020_000, pos: 10, me: true }, { id: "p2", name: "Bob", valueC: 1_000_000, pos: -10, me: false }] };
const lb = [
  { rank: 1, id: "t1", name: "Mean Team", valueC: 1_010_000, startC: 1_000_000, totalC: 2_020_000, size: 2, pos: 0, spentC: 0, members: team.members },
  { rank: 2, id: "t2", name: "Walkers", valueC: 990_000, startC: 1_000_000, totalC: 990_000, size: 1, pos: 0, spentC: 0, members: [{ id: "p3", name: "Cy", valueC: 990_000, pos: 0 }] },
];
const T = 60;
const reveal = {
  roundId: "r5",
  K: 100,
  T,
  secondsPerTick: 4,
  t0: -149,
  history: ys.slice(0, 150),
  path: Array.from({ length: T + 1 }, (_, s) => 105 - s * 0.08),
  yT: 100.2,
  value: 100,
  settleC: 10_000,
  fair: Array.from({ length: T + 1 }, (_, s) => (s === T ? 100 : 50 + s * 0.3)),
  naive: Array.from({ length: T + 1 }, (_, s) => 74 - s * 0.2),
  mids: Array.from({ length: T + 1 }, (_, s) => ({ t: s, mid: 74 - s * 0.3, bid: 70, ask: 78, last: 74 })),
  truth: { preset: "switch", presetName: "Regime switch", phi1: 0.9, phi2: 1, switchTick: 30, mu: 100, sigma: 1, seed: "abc-123" },
  fitAtOpen: { phi: 0.887, sePhi: 0.038, mu: 100.4, sigma: 0.98, n: 149 },
  desks: [{ name: "NAIVE DESK", pnlC: -123_400 }, { name: "NOISE DESK A", pnlC: 5_000 }],
  leaderboard: lb,
};
const noop = () => {};

console.log("\nscreens");

ok("the chart header says the tick, the countdown, Y against K and what is left", () => {
  const out = render(h(C.ChartHeader, { round, series, msToNext: 2100 }));
  assert.match(out, /12<small> \/ 60/);
  assert.match(out, />3s</, "2.1 s rounds up to 3");
  assert.match(out, /K = 100/);
  assert.match(out, /48 <small>× 4s/);
});

ok("the chart mounts with its header, and says when there is nothing to draw yet", () => {
  const out = render(h(C.HorizonChart, { series, K: 100, T: 60, header: h(C.ChartHeader, { round, series, msToNext: 1000 }) }));
  assert.match(out, /<canvas/);
  assert.match(out, /K = 100 and T = 60/);
  assert.match(render(h(C.HorizonChart, { series: null, K: 100, T: 60 })), /APPEARS WHEN RESEARCH OPENS/);
  assert.match(render(h(C.FairChart, { fair: reveal.fair, mids: reveal.mids, naive: reveal.naive })), /TRUE FAIR VALUE/);
});

ok("the order book stops at 1 and 99", () => {
  const out = render(h(C.OrderBook, { book: market, last: 74, me, center: 50, tick: 1, lo: 1, hi: 99, mine: me.orders, size: 10, onSize: noop, onOrder: noop, onCancelLevel: noop, onCancelAll: noop, disabled: false }));
  const pxs = [...out.matchAll(/data-px="(-?\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(pxs.length > 10);
  assert.ok(pxs.every((p) => p >= 1 && p <= 99));
  assert.match(out, /Prices run 1 to 99/);
});

ok("you-panel, leaderboard, rules and the gate all mount", () => {
  assert.match(render(h(C.YouPanel, { me, team, mark: 74, settled: false, onCancel: noop, onCancelAll: noop })), /paid if Y finishes above K/);
  assert.match(render(h(C.Leaderboard, { rows: lb, myTeamId: "t1", settled: false })), /Mean Team/);
  render(h(C.Rules, { onClose: noop }));
  const gate = render(h(C.Gate, { round, player: null, me: null, team: null, limits: { teamSize: 4 }, onPlayer: noop, onHold: noop, onDone: noop }));
  assert.match(gate, /THE HORIZON MARKET/);
  assert.match(gate, /WEEK 5/);
});

ok("fills become toasts", () => {
  const t = M.fillToasts([{ s: 9, side: "B", px: 74, qty: 3, taker: true, cp: "NAIVE DESK" }]);
  assert.match(t[0].title, /YOU LIFTED NAIVE DESK/);
  assert.match(t[0].body, /Bought 3 shares at 74/);
});

ok("the data panel waits for research in the lobby", () => {
  const out = render(h(C.DataPanel, { player: { playerId: "p1", token: "t" }, round: { ...round, status: "lobby" } }));
  assert.match(out, /history comes out the moment the host opens research/);
});

ok("the reveal counts down, and every one of its beats renders", () => {
  assert.match(render(h(C.Reveal, { reveal, me, leaderboard: lb, myTeamId: "t1", onClose: noop })), /TIME/);
  // Beats past the countdown are reached by clicking; render each directly.
  for (const [phase, want] of [
    [1, /THE PATH[\s\S]*Y AT TICK 60[\s\S]*100\.20[\s\S]*\$100\.00/],
    [2, /WHAT IT WAS WORTH[\s\S]*TRUE FAIR VALUE[\s\S]*naive desk/i],
    [3, /THE PROCESS[\s\S]*φ = 0\.9[\s\S]*UNTIL TICK 30\. THEN φ = 1\.0[\s\S]*mean-reverting, then a random walk[\s\S]*fitted φ = 0\.887/],
    [4, /THE PODIUM[\s\S]*Mean Team/],
    [5, /FINAL STANDINGS[\s\S]*TOP INDIVIDUALS[\s\S]*Alice/],
  ]) {
    assert.match(render(h(C.Reveal, { reveal, me, leaderboard: lb, myTeamId: "t1", onClose: noop, startPhase: phase })), want, `beat ${phase}`);
  }
});

ok("the admin panel, the big screen and the app all mount before any data arrives", () => {
  assert.match(render(h(C.AdminPanel)), /CONTROL ROOM/);
  render(h(C.BigBoard));
  assert.match(render(h(C.App)), /.+/);
  render(h(C.StaleBuild));
});

ok("the admin console renders the preset dropdown and every field", () => {
  sessionStorage.setItem("w5admin", "tok");
  const out = render(h(C.AdminPanel));
  sessionStorage.removeItem("w5admin");
  // With a token it is the console's spinner until inspect returns.
  assert.match(out, /CONNECTING/);
  const src = fs.readFileSync(path.join(root, "src", "components", "AdminPanel.jsx"), "utf8");
  for (const f of ["phi1", "phi2", "switchTick", "sigma", "mu", "K", "yOpen", "H", "T", "secondsPerTick", "researchMinutes", "naiveBot", "seed"]) {
    assert.match(src, new RegExp(`set\\("${f}"\\)`), `no input for ${f}`);
  }
  for (const b of ["CREATE ROUND", "START RESEARCH", "OPEN TRADING", "\\+1 MIN RESEARCH", "END NOW", "RESET", "REMOVE", "PEEK"]) {
    assert.match(src, new RegExp(b), `no ${b} control`);
  }
});

ok("the player floor renders live: chart, book, you-panel, desks — and research and settled states", () => {
  const st = { round, series, me, team, market, leaderboard: lb, fills: [], seq: 9 };
  const out = render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: st } }));
  assert.match(out, /THE HORIZON MARKET/);
  assert.match(out, /<canvas/);
  assert.match(out, /tick 12\/60/);
  assert.match(out, /naive desk quoting · 2 noise desks/);
  assert.match(out, /data-px="74"/);
  assert.match(out, /paid if Y finishes above K/);
  const research = render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: { ...st, round: { ...round, status: "research", phase: "RESEARCH", tickNow: 0, nextTickAt: null } } } }));
  assert.match(research, /RESEARCH — the book opens in/);
  const settled = render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: { ...st, round: { ...round, status: "settled", phase: "SETTLED", tickNow: 60, xStar: 100, yT: 101.37, settleC: 10000 } } } }));
  assert.match(settled, /SETTLED — Y_T = 101\.37 &gt; K = 100, so a share paid \$100/);
  assert.match(render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: st, tab: "board" } })), /Walkers/);
  assert.match(render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: st, tab: "data" } })), /FETCHING THE SERIES/);
});

ok("the projector renders a live round, a research round, and a settled one", () => {
  const history = [{ roundId: "r4", phi1: 0.9, phi2: 1, switchTick: 30, settles: 0, podium: [{ name: "Mean Team" }] }];
  const live = render(h(C.BigBoard, { initial: { round, series, market, leaderboard: lb, history } }));
  assert.match(live, /THE HORIZON MARKET/);
  assert.match(live, /DOES Y FINISH ABOVE 100 AT TICK 60/);
  assert.match(live, /LAST <b[^>]*>74/);
  assert.match(live, /φ = 0\.9 → 1 at 30/);
  assert.match(live, /Mean Team/);
  const research = render(h(C.BigBoard, { initial: { round: { ...round, status: "research" }, series, market, leaderboard: lb, history: [] } }));
  assert.match(research, /nddelta\.com\/week5\//);
  const settled = render(h(C.BigBoard, { initial: { round: { ...round, status: "settled", xStar: 0, yT: 99.1 }, series, market, leaderboard: lb, history: [] } }));
  assert.match(settled, /99\.10 ≤ 100 · PAID \$0/);
});

ok("the admin console renders a round with the peek open, the desks and the players", () => {
  const info = {
    persistent: true,
    kv: "memory",
    round,
    market,
    showPeek: true,
    peek: { preset: "meanrev", presetName: "Mean-reverting", phi1: 0.9, phi2: 0.9, switchTick: null, mu: 100, sigma: 1, K: 100, yOpen: 105, H: 150, T: 60, secondsPerTick: 4, seed: "s-1", pinned: false, tick: 12, yNow: 101.2, fairNow: 51.3, naiveNow: 72.8, fitAtOpen: { phi: 0.88, sePhi: 0.04 } },
    audit: [],
    desks: { naive: { on: true, bid: 69, ask: 77, sent: 5 }, noise: [{ key: "noise-1", sent: 2, fills: 6 }] },
    players: [{ id: "p1", name: "Alice", team: "Mean Team", cashC: 960_000, pos: 10, valueC: 1_020_000, orders: 1 }],
    teams: [],
  };
  const out = render(h(C.Console, { token: "t", onOut: noop, initial: info }));
  for (const want of [/CONTROL ROOM · WEEK 5/, /Mean-reverting/, /TRUE FAIR VALUE[\s\S]*51\.3/, /NAIVE \(RANDOM WALK\)[\s\S]*72\.8/, /69 \/ 77 · 5 quotes/, /Alice/, /<select/, /Regime switch/]) {
    assert.match(out, want);
  }
  assert.match(render(h(C.Console, { token: "t", onOut: noop, initial: { ...info, persistent: false, showPeek: false } })), /STORAGE IS NOT PERSISTENT[\s\S]*Click SHOW/);
});

console.log("\nregressions carried from weeks 2–4");

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
  assert.match(fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8"), /gateHolding/);
  assert.match(fs.readFileSync(path.join(root, "src", "components", "Gate.jsx"), "utf8"), /onHold\?\.\(true\)/);
});

try {
  fs.unlinkSync(outFile);
} catch {}
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
