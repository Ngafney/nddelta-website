/**
 * Render tests. Every screen is rendered to static markup against realistic
 * mock data — the shape the API actually sends — which catches the whole class
 * of bug a build cannot: a bad import, a prop read off undefined, a map over
 * something that is not an array.
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
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 6).join("\n      ")}`);
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
import Pot from "./src/components/Pot.jsx";
import SumChart, { FairChart } from "./src/components/SumChart.jsx";
import Books, { parityCheck } from "./src/components/Books.jsx";
import NumberPick from "./src/components/NumberPick.jsx";
import StaleBuild from "./src/components/StaleBuild.jsx";
export const C = { App, Floor, Console, Gate, OrderBook, YouPanel, Leaderboard, Toasts, Reveal, Rules, AdminPanel, BigBoard, Pot, SumChart, FairChart, Books, NumberPick, StaleBuild };
export { React, renderToStaticMarkup, fillToasts, parityCheck };
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

globalThis.window = {
  location: { pathname: "/week6/", host: "nddelta.com" },
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
globalThis.performance = globalThis.performance ?? { now: () => 0 };

const M = await import(pathToFileURL(outFile).href);
const { React, renderToStaticMarkup: render, C } = M;
const h = React.createElement;

/* ── mock data, shaped exactly like the API's ─────────────────────────── */

const NOW = Date.now();
const bookOf = (lo, hi, center) => ({ key: "x", name: "", short: "", pays: "", open: true, enabled: true, orderMin: lo, orderMax: hi, settleMin: lo, settleMax: hi, center, tick: 1 });
const round = {
  roundId: "r6",
  status: "live",
  phase: "LIVE",
  locked: true,
  N: 8,
  K: 40,
  Kauto: true,
  Smax: 80,
  numberMax: 10,
  revealed: [7, 3, 10],
  revealedAt: [NOW - 30000, NOW - 20000, NOW - 10000],
  revealedCount: 3,
  sum: 20,
  left: 5,
  lo: 20,
  hi: 70,
  fair: { fut: 45, call: 7.2, put: 2.2 },
  auto: { on: true, everySec: 8, nextAt: NOW + 4000 },
  pickEndsAt: null,
  msLeft: null,
  liveStartedAt: NOW - 40000,
  serverNow: NOW,
  startCashC: 1_000_000,
  defaultSize: 10,
  lateJoin: true,
  players: 9,
  teams: 8,
  teamSize: 4,
  books: {
    fut: { ...bookOf(0, 80, 45), key: "fut", name: "THE SUM", short: "SUM", pays: "$S a share" },
    call: { ...bookOf(0, 40, 7), key: "call", name: "THE CALL", short: "CALL", pays: "max(S − K, 0)" },
    put: { ...bookOf(0, 40, 2), key: "put", name: "THE PUT", short: "PUT", pays: "max(K − S, 0)", open: false, enabled: false },
  },
  noise: { on: true, desks: 2, everySec: 12, size: 10, sweep: 4 },
  settleS: null,
  payouts: null,
  settledAt: null,
};
const me = {
  id: "p1",
  name: "Alice",
  teamId: "t1",
  cashC: 960_000,
  pos: { fut: 10, call: -3, put: 0 },
  bidResC: 45_000,
  askResC: 12_000,
  freeC: 880_000,
  spendableC: 880_000,
  valueC: 1_020_000,
  spentC: 0,
  startC: 1_000_000,
  orders: [
    { id: 1, mkt: "fut", side: "B", px: 44, qty: 10, ts: 1, holdC: 44_000 },
    { id: 2, mkt: "call", side: "A", px: 9, qty: 4, ts: 2, holdC: 12_000 },
  ],
};
const mk = (bids, asks, last) => ({ bids, asks, last, bestBid: bids[0]?.px ?? null, bestAsk: asks[0]?.px ?? null, mark: last ?? 45, mid: last ?? 45, volume: 42, open: true, tape: [] });
const market = {
  fut: mk([{ px: 44, qty: 10, mine: 10 }, { px: 43, qty: 5, mine: 0 }], [{ px: 47, qty: 5, mine: 0 }], 46),
  call: mk([{ px: 6, qty: 5, mine: 0 }], [{ px: 9, qty: 4, mine: 4 }], 7),
  put: { ...mk([], [], null), open: false },
};
const team = {
  id: "t1",
  name: "Mean Team",
  code: "ABCD",
  size: 2,
  max: 4,
  valueC: 1_010_000,
  totalC: 2_020_000,
  number: 7,
  pickedBy: "Alice",
  drawn: false,
  canPick: false,
  members: [
    { id: "p1", name: "Alice", valueC: 1_020_000, pos: { fut: 10, call: -3, put: 0 }, me: true },
    { id: "p2", name: "Bob", valueC: 1_000_000, pos: { fut: -10, call: 0, put: 0 }, me: false },
  ],
};
const lb = [
  { rank: 1, id: "t1", name: "Mean Team", valueC: 1_010_000, startC: 1_000_000, totalC: 2_020_000, size: 2, members: team.members },
  { rank: 2, id: "t2", name: "Walkers", valueC: 990_000, startC: 1_000_000, totalC: 990_000, size: 1, members: [{ id: "p3", name: "Cy", valueC: 990_000, pos: { fut: 0, call: 0, put: 0 } }] },
];
const reveal = {
  roundId: "r6",
  N: 8,
  K: 40,
  S: 46,
  payouts: { fut: 46, call: 6, put: 0 },
  numbers: [7, 3, 10, 5, 8, 2, 7, 4],
  revealedAt: [],
  teams: [7, 3, 10, 5, 8, 2, 7, 4].map((n, i) => ({ i, id: `t${i}`, name: i === 1 ? "Mean Team" : `Team ${i}`, number: n, drawn: i === 5 })),
  fair: Array.from({ length: 9 }, (_, i) => ({ fut: 40 + i * 0.75, call: 6 + i * 0.1, put: 6 - i * 0.7 })),
  mids: Array.from({ length: 9 }, (_, i) => ({ i, at: NOW, fut: { mid: 42 + i * 0.5, last: 42, bid: 41, ask: 43 }, call: { mid: 7, last: 7, bid: 6, ask: 8 }, put: { mid: null, last: null, bid: null, ask: null } })),
  desks: [{ name: "NOISE DESK A", pnlC: -12_300, sent: 10, fills: 40 }],
  sharp: { name: "THE INSIDER", pnlC: 31_200, strikes: 2, fills: 60 },
  leaderboard: lb,
};
const noop = () => {};

console.log("\nscreens");

ok("the pot shows every cell, the ones that have landed, the sum, the range and K", () => {
  const out = render(h(C.Pot, { round }));
  assert.strictEqual((out.match(/class="cell /g) ?? []).length, 8, "one cell per team");
  assert.strictEqual((out.match(/class="cell in/g) ?? []).length, 3, "three have landed");
  assert.match(out, /cell in v10/);
  assert.match(out, /class="odo[^"]*">20</);
  assert.match(out, /20 – 70/);
  assert.match(out, /STRIKE K[\s\S]*40/);
  assert.match(out, /3 of 8 out · 5 still in/);
  assert.match(out, /AUTO · next number in 4s/);
  const lobby = render(h(C.Pot, { round: { ...round, status: "lobby", locked: false, revealed: [], revealedCount: 0, sum: 0, N: 3, Smax: 30, lo: 0, hi: 30, left: 3, auto: { on: false } } }));
  assert.match(lobby, /IN THE POT/);
  assert.match(lobby, /class="odo[^"]*">3</);
  assert.match(lobby, /0 – 30/);
  const done = render(h(C.Pot, { round: { ...round, status: "settled", revealed: reveal.numbers, revealedCount: 8, sum: 46, left: 0, lo: 46, hi: 46, settleS: 46, auto: { on: false } } }));
  assert.match(done, /S · THE SUM/);
  assert.match(done, /every number is out/);
  assert.strictEqual((done.match(/class="cell in/g) ?? []).length, 8);
});

ok("the sum chart and the fair charts mount to a canvas", () => {
  assert.match(render(h(C.SumChart, { round })), /<canvas[^>]*K = 40/);
  assert.match(render(h(C.FairChart, { book: "call", label: "THE CALL", fair: reveal.fair, mids: reveal.mids, payout: 6, settleMin: 0, settleMax: 40 })), /THE CALL[\s\S]*<canvas/);
});

ok("the books strip shows all three, which is shut, your position, and the parity check", () => {
  const out = render(h(C.Books, { round, market, me, selected: "fut", onSelect: noop }));
  assert.match(out, /bookcard fut on/);
  assert.match(out, /bookcard put[^"]*shut/);
  assert.match(out, /NOT OPEN YET/);
  assert.match(out, /long 10/);
  assert.match(out, /short 3/);
  assert.match(out, /fair 45\.0/);
  assert.match(out, /max\(S − 40, 0\)/);
  assert.match(out, /parity needs a two-sided market in all three/);
  // With all three two-sided and off by 2: CALL − PUT = 7.5 − 2 = 5.5 vs SUM − K = 45.5 − 40 = 5.5 → holds; nudge the put.
  const m2 = { ...market, put: mk([{ px: 1, qty: 1, mine: 0 }], [{ px: 3, qty: 1, mine: 0 }], 2) };
  const p = M.parityCheck(round, m2);
  assert.strictEqual(p.gap, 7.5 - 2 - (45.5 - 40));
  const m3 = { ...m2, put: mk([{ px: 3, qty: 1, mine: 0 }], [{ px: 5, qty: 1, mine: 0 }], 4) };
  assert.match(render(h(C.Books, { round, market: m3, me, selected: "fut", onSelect: noop })), /parity off[\s\S]*off by 2\.0/);
});

ok("the number picker renders eleven buttons and marks the chosen one", () => {
  const out = render(h(C.NumberPick, { value: 7, onPick: noop }));
  assert.strictEqual((out.match(/class="numbtn/g) ?? []).length, 11);
  assert.match(out, /numbtn on"[^>]*>7</);
});

ok("the order book runs the book's own ladder in dollars", () => {
  const out = render(h(C.OrderBook, { book: market.fut, last: 46, me: { ...me, pos: 10, buyC: me.freeC }, center: 45, tick: 1, lo: 0, hi: 80, mine: me.orders.filter((o) => o.mkt === "fut"), size: 10, onSize: noop, onOrder: noop, onCancelLevel: noop, onCancelAll: noop, disabled: false }));
  const pxs = [...out.matchAll(/data-px="(-?\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(pxs.length > 10);
  assert.ok(pxs.every((p) => p >= 0 && p <= 80));
  assert.match(out, /Prices run 0 to 80 — whole dollars a share/);
  assert.match(out, /FREE \(WORST CASE\)/);
});

ok("you-panel, leaderboard, rules and the gate all mount", () => {
  const you = render(h(C.YouPanel, { me, team, settled: false, onCancel: noop, onCancelAll: noop }));
  assert.match(you, /your number 7/);
  assert.match(you, /SUM BID[\s\S]*10 @ 44/);
  assert.match(you, /CALL OFFER[\s\S]*4 @ 9/);
  assert.match(you, /S\+10 C−3/);
  assert.match(render(h(C.Leaderboard, { rows: lb, myTeamId: "t1", settled: false })), /Mean Team[\s\S]*S−10/);
  render(h(C.Rules, { onClose: noop }));
  const gate = render(h(C.Gate, { round, player: null, me: null, team: null, limits: { teamSize: 4 }, onPlayer: noop, onHold: noop, onDone: noop }));
  assert.match(gate, /THE POT/);
  assert.match(gate, /WEEK 6/);
  const sealed = render(h(C.Gate, { round, player: { playerId: "p", token: "t", name: "Zed" }, me: null, team: null, limits: { teamSize: 4 }, onPlayer: noop, onHold: noop, onDone: noop }));
  assert.match(sealed, /choice off[\s\S]*pot is sealed/);
});

ok("fills become toasts that say which book", () => {
  const t = M.fillToasts([{ s: 9, market: "call", side: "B", px: 7, qty: 3, taker: true, cp: "NOISE DESK A" }]);
  assert.match(t[0].title, /YOU LIFTED NOISE DESK A · CALL/);
  assert.match(t[0].body, /Bought 3 shares at 7/);
});

ok("the reveal counts down, and every one of its beats renders", () => {
  assert.match(render(h(C.Reveal, { reveal, me, leaderboard: lb, myTeamId: "t1", onClose: noop })), /TIME/);
  for (const [phase, want] of [
    [1, /THE POT[\s\S]*S = 46[\s\S]*Mean Team[\s\S]*\(drawn\)/],
    [2, /WHAT IT PAID[\s\S]*THE SUM PAID[\s\S]*\$46\.00[\s\S]*THE CALL PAID[\s\S]*\$6\.00[\s\S]*CALL − PUT = 6 − 0[\s\S]*SUM − K = 46 − 40/],
    [3, /WHAT IT WAS WORTH[\s\S]*THE SUM[\s\S]*THE CALL[\s\S]*THE PUT[\s\S]*insider struck 2 times[\s\S]*\+\$312\.00[\s\S]*noise desks finished/],
    [4, /THE PODIUM[\s\S]*Mean Team/],
    [5, /FINAL STANDINGS[\s\S]*TOP INDIVIDUALS[\s\S]*Alice/],
  ]) {
    assert.match(render(h(C.Reveal, { reveal, me, leaderboard: lb, myTeamId: "t1", onClose: noop, startPhase: phase })), want, `beat ${phase}`);
  }
  const mine = render(h(C.Reveal, { reveal, me, leaderboard: lb, myTeamId: "t1", onClose: noop, startPhase: 1 }));
  assert.strictEqual((mine.match(/cell in v\d+ named mine/g) ?? []).length, 1, "my team's cell is outlined");
});

ok("the admin panel, the big screen and the app all mount before any data arrives", () => {
  assert.match(render(h(C.AdminPanel)), /CONTROL ROOM/);
  render(h(C.BigBoard));
  assert.match(render(h(C.App)), /.+/);
  render(h(C.StaleBuild));
});

ok("the admin console renders every field and control", () => {
  const src = fs.readFileSync(path.join(root, "src", "components", "AdminPanel.jsx"), "utf8");
  for (const f of ["K", "pickSeconds", "autoOn", "autoEverySec", "noiseOn", "desks", "everySec", "size", "sweep", "edge", "sharpSize", "sharpEvery", "seed", "startCash", "defaultSize", "keepPlayers"]) {
    assert.match(src, new RegExp(`set\\("${f}"\\)`), `no input for ${f}`);
  }
  assert.match(src, /BOOK_ORDER\.map\(\(k\) => \([\s\S]*?onChange=\{set\(k\)\}/, "no checkbox per book at the start");
  for (const b of ["CREATE ROUND", "PICK CLOCK", "OPEN TRADING NOW", "REVEAL NEXT", "AUTO", "END NOW", "APPLY DESKS", "RESET", "REMOVE", "PEEK", "HOLD", "\\+30s"]) {
    assert.match(src, new RegExp(b), `no ${b} control`);
  }
});

ok("the admin console renders a live round with the pot, the books, the peek and the players", () => {
  const info = {
    persistent: true,
    kv: "memory",
    round,
    market,
    showPeek: true,
    peek: {
      N: 8,
      K: 40,
      Kauto: true,
      Kreq: null,
      S: 46,
      unpicked: 0,
      seed: "s-1",
      payouts: { fut: 46, call: 6, put: 0 },
      fair: { fut: 45, call: 7.2, put: 2.2 },
      marks: { fut: 46, call: 7, put: 2 },
      revealed: [7, 3, 10],
      next: { name: "Team 3", number: 5 },
      teams: [
        { id: "t1", name: "Mean Team", number: 7, drawn: false, members: 2, revealed: true },
        { id: "t3", name: "Team 3", number: 5, drawn: false, members: 1, revealed: false },
      ],
      pickSeconds: 30,
      auto: { on: true, everySec: 8, nextAt: NOW + 4000 },
      books: { fut: true, call: true, put: false },
      noise: { on: true, desks: 2, everySec: 12, size: 10, sweep: 4 },
    },
    audit: [],
    desks: { cfg: { on: true, desks: 2, everySec: 12, size: 10, sweep: 4 }, desks: [{ key: "noise-1", name: "NOISE DESK A", sent: 5, fills: 12 }, { key: "noise-2", name: "NOISE DESK B", sent: 4, fills: 3 }] },
    sharp: { cfg: { edgeC: 10, size: 100, everySec: 15 }, loop: false, nextAt: null, strikes: 2, fills: 60, lastAt: NOW, lastReport: { fut: 40, call: -20, put: 0, shares: 60 }, lastError: null, pos: { fut: 40, call: -20, put: 0 }, pnlC: 31_200 },
    players: [{ id: "p1", name: "Alice", team: "Mean Team", cashC: 960_000, pos: { fut: 10, call: -3, put: 0 }, valueC: 1_020_000, orders: 2 }],
    teams: [],
  };
  const out = render(h(C.Console, { token: "t", onOut: noop, initial: info }));
  for (const want of [/CONTROL ROOM · WEEK 6/, /REVEAL NEXT \(4 of 8\)/, /PAUSE AUTO/, /S · THE SUM[\s\S]*46/, /NEXT OUT[\s\S]*Team 3 → 5/, /SUM 46 · CALL 6 · PUT 0/, /● THE SUM · 0–80/, /○ THE PUT/, /Alice[\s\S]*S\+10 C-3/, /A: 5 sent \/ 12 filled/, /THE INSIDER[\s\S]*STRIKE ONCE[\s\S]*LOOP EVERY 15s[\s\S]*2 strikes · 60 shares taken · last: SUM \+40 CALL -20 PUT 0[\s\S]*\+\$312\.00/]) {
    assert.match(out, want);
  }
  const lobbyInfo = { ...info, round: { ...round, status: "lobby", phase: "LOBBY", locked: false, pickEndsAt: null, teams: 3 }, peek: { ...info.peek, unpicked: 1 } };
  const lob = render(h(C.Console, { token: "t", onOut: noop, initial: lobbyInfo }));
  assert.match(lob, /START THE 30s PICK CLOCK/);
  assert.match(lob, /1 without a number/);
  assert.match(render(h(C.Console, { token: "t", onOut: noop, initial: { ...info, persistent: false, showPeek: false } })), /STORAGE IS NOT PERSISTENT[\s\S]*Click SHOW/);
});

ok("the player floor renders live: pot, chart, books, ladder, you — and lobby, pick prompt and settled states", () => {
  const st = { round, me, team, market, leaderboard: lb, fills: [], seq: 9 };
  const out = render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: st } }));
  assert.match(out, /THE POT/);
  assert.match(out, /<canvas/);
  assert.match(out, /3\/8 out/);
  assert.match(out, /bookcard fut on/);
  assert.match(out, /data-px="46"/);
  assert.match(out, /2 noise desks/);
  assert.match(out, /your number 7/);
  // Selecting the call puts its ladder up (0 … 40).
  const call = render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: st, mkt: "call" } }));
  assert.match(call, /Prices run 0 to 40/);
  assert.match(call, /THE CALL/);
  // A new round in the lobby with no number picked yet prompts for one.
  const lobbyRound = { ...round, status: "lobby", phase: "LOBBY", locked: false, revealed: [], revealedCount: 0, sum: 0, left: 8, lo: 0, hi: 80, auto: { on: false }, pickEndsAt: NOW + 25_000, msLeft: 25_000 };
  const pick = render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: { ...st, round: lobbyRound, team: { ...team, number: null, canPick: true } } } }));
  assert.match(pick, /NEW ROUND — PICK YOUR NUMBER/);
  assert.match(pick, /Mean Team[\s\S]*needs a fresh number/);
  assert.strictEqual((pick.match(/class="numbtn/g) ?? []).length, 11);
  assert.match(pick, /YOUR TEAM HAS NOT PICKED A NUMBER/);
  const picked = render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: { ...st, round: lobbyRound, team: { ...team, canPick: true } } } }));
  assert.match(picked, /YOUR NUMBER IS <b class="gold">7<\/b> \(picked by Alice\)\. THE BOOKS OPEN IN 0:25/);
  assert.ok(!/NEW ROUND — PICK/.test(picked));
  const settled = render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: { ...st, round: { ...round, status: "settled", phase: "SETTLED", revealed: reveal.numbers, revealedCount: 8, left: 0, sum: 46, lo: 46, hi: 46, settleS: 46, payouts: { fut: 46, call: 6, put: 0 }, auto: { on: false } } } } }));
  assert.match(settled, /SETTLED — S = 46\. SUM PAID \$46 · CALL PAID \$6 · PUT PAID \$0/);
  assert.match(render(h(C.Floor, { initial: { player: { playerId: "p1", token: "t" }, state: st, tab: "board" } })), /Walkers/);
});

ok("the projector renders a live round, a lobby, and a settled one", () => {
  const history = [{ roundId: "r4", N: 6, K: 30, S: 33, payouts: { fut: 33, call: 3, put: 0 }, podium: [{ name: "Mean Team" }] }];
  const live = render(h(C.BigBoard, { initial: { round, market, leaderboard: lb, history } }));
  assert.match(live, /THE POT/);
  assert.match(live, /8 NUMBERS · TRADE THE SUM · K = 40/);
  assert.match(live, /NEXT NUMBER[\s\S]*4s/);
  assert.match(live, /6 numbers · S = 33 · K = 30/);
  assert.match(live, /Mean Team/);
  assert.match(live, /bookcards/);
  const lobby = render(h(C.BigBoard, { initial: { round: { ...round, status: "lobby", locked: false, pickEndsAt: NOW + 12_000, revealed: [], revealedCount: 0, auto: { on: false } }, market, leaderboard: lb, history: [] } }));
  assert.match(lobby, /nddelta\.com\/week6\//);
  assert.match(lobby, /BOOKS OPEN IN[\s\S]*0:12/);
  const settled = render(h(C.BigBoard, { initial: { round: { ...round, status: "settled", settleS: 46, payouts: { fut: 46, call: 6, put: 0 }, revealed: reveal.numbers, revealedCount: 8, auto: { on: false } }, market, leaderboard: lb, history: [] } }));
  assert.match(settled, /S = 46/);
});

console.log("\nregressions carried from weeks 2–5");

ok("the stylesheet cannot override the row height the virtualizer places rows by", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8") + fs.readFileSync(path.join(root, "src", "pot.css"), "utf8");
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
