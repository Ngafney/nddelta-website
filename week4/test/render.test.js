/**
 * Render tests. Every screen is mounted to static markup against realistic
 * mock data, which catches the class of bug a build cannot: a bad import, a
 * prop read off undefined, a map over something that is not an array.
 *
 * Effects and canvas drawing do not run here — this checks that the trees
 * mount and say the right things, not that pixels landed.
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
import App from "./src/App.jsx";
import Gate from "./src/components/Gate.jsx";
import OrderBook from "./src/components/OrderBook.jsx";
import YouPanel from "./src/components/YouPanel.jsx";
import Leaderboard from "./src/components/Leaderboard.jsx";
import Toasts, { fillToasts } from "./src/components/Toasts.jsx";
import Reveal from "./src/components/Reveal.jsx";
import Rules from "./src/components/Rules.jsx";
import AdminPanel from "./src/components/AdminPanel.jsx";
import BigBoard from "./src/components/BigBoard.jsx";
import CorridorMap from "./src/components/CorridorMap.jsx";
import DataPanel from "./src/components/DataPanel.jsx";
import StaleBuild from "./src/components/StaleBuild.jsx";
import { money, num, clock } from "./src/components/PixelBits.jsx";
export const C = { App, Gate, OrderBook, YouPanel, Leaderboard, Toasts, Reveal, Rules, AdminPanel, BigBoard, CorridorMap, DataPanel, StaleBuild };
export { React, renderToStaticMarkup, fillToasts, money, num, clock };
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
  location: { pathname: "/week4/", host: "nddelta.com" },
  devicePixelRatio: 1,
  crypto: { getRandomValues: (a) => a.fill(7) },
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  confirm: () => false,
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
  value: { userAgent: "test", language: "en", hardwareConcurrency: 8, maxTouchPoints: 0 },
  configurable: true,
});
globalThis.screen = { width: 1920, height: 1080, colorDepth: 24 };
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
let NARROW = false;
globalThis.window.matchMedia = (q) => ({
  matches: /max-width:\s*760px/.test(q) ? NARROW : false,
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
const M = await import(pathToFileURL(outFile).href);
const { React, renderToStaticMarkup: render, C } = M;
const h = React.createElement;

/* ── mock data, shaped exactly like the API's ─────────────────────────── */

const me = {
  id: "p1",
  name: "Alice",
  teamId: "t1",
  cashC: 842_500,
  pos: { north: 12, south: -4 },
  reservedC: 60_000,
  freeC: 700_000,
  powers: { north: 1_240_000, south: 380_000 },
  valueC: 1_002_500,
  startC: 1_000_000,
  spentC: 0,
  downloads: 2,
  orders: [
    { id: 3, market: "north", side: "B", px: 44, qty: 5, ts: 1, holdC: 22_000 },
    { id: 7, market: "south", side: "A", px: 61, qty: 2, ts: 2, holdC: 7_800 },
  ],
  settledPos: null,
};

const mk = (last, bb, ba) => ({
  bids: [
    { px: bb, qty: 12, mine: 5 },
    { px: bb - 2, qty: 30, mine: 0 },
  ],
  asks: [
    { px: ba, qty: 9, mine: 0 },
    { px: ba + 3, qty: 14, mine: 2 },
  ],
  last,
  bestBid: bb,
  bestAsk: ba,
  mid: (bb + ba) / 2,
  mark: last,
  volume: 210,
  tape: [{ s: 9, px: last, qty: 4, ts: Date.now(), aggr: "B" }],
});

const markets = { north: mk(58, 56, 60), south: mk(41, 39, 43) };

const round = {
  roundId: "r1",
  status: "live",
  phase: "TRADING",
  question: "Does it land NORTH or SOUTH of the equator?",
  startedAt: Date.now() - 60_000,
  endsAt: Date.now() + 300_000,
  msLeft: 300_000,
  serverNow: Date.now(),
  startCashC: 1_000_000,
  defaultSize: 10,
  tick: 1,
  center: 50,
  orderMin: 1,
  orderMax: 99,
  lateJoin: true,
  players: 34,
  teams: 9,
  teamSize: 4,
  released: 3,
  releaseCount: 6,
  eventName: "2008 TC3",
  lineDeg: 20,
  releaseLog: [
    { index: 1, sigmaKm: 600, at: Date.now() },
    { index: 2, sigmaKm: 468, at: Date.now() },
    { index: 3, sigmaKm: 372, at: Date.now() },
  ],
  nextSigmaKm: 300,
  bots: [{ market: "north", side: "B", shares: 200, everySec: 20 }],
  winner: null,
};

const team = {
  id: "t1",
  name: "Ephemeris",
  code: "K7QP",
  size: 3,
  max: 4,
  valueC: 1_010_000,
  members: [
    { id: "p1", name: "Alice", valueC: 1_002_500, pos: { north: 12, south: -4 }, me: true },
    { id: "p2", name: "Bob", valueC: 1_017_500, pos: { north: 0, south: 8 }, me: false },
  ],
};

const board = [
  { rank: 1, id: "t1", name: "Ephemeris", valueC: 1_010_000, startC: 1_000_000, totalC: 3_030_000, size: 3, members: team.members },
  { rank: 2, id: "t2", name: "Perihelion", valueC: 980_000, startC: 1_000_000, totalC: 1_960_000, size: 2, members: [] },
];

const track = Array.from({ length: 120 }, (_, i) => {
  const a = (i / 119) * Math.PI * 2;
  return [0, 0, 0, Math.cos(a), Math.sin(a), 0, 1.4 * Math.cos(-a), 1.4 * Math.sin(-a), 0.01];
});

console.log("\nrender");

/* ── the tests ────────────────────────────────────────────────────────── */

ok("the two books mount side by side and name themselves", () => {
  const out = ["north", "south"].map((m) =>
    render(
      h(C.OrderBook, {
        book: markets[m],
        last: markets[m].last,
        me: { pos: me.pos[m], buyC: me.freeC, valueC: me.valueC, startC: me.startC },
        center: 50,
        tick: 1,
        lo: 1,
        hi: 99,
        mine: me.orders.filter((o) => o.market === m),
        size: 10,
        onSize() {},
        onOrder() {},
        onCancelLevel() {},
        onCancelAll() {},
        disabled: false,
      })
    )
  );
  for (const html of out) assert.ok(html.length > 500, "a book rendered almost nothing");
  assert.ok(out[0].includes("56"), "the north bid is missing");
  assert.ok(out[1].includes("43"), "the south ask is missing");
});

ok("the position panel shows both books and both outcomes", () => {
  const html = render(h(C.YouPanel, { me, team, markets, round }));
  assert.ok(html.includes("NORTH") && html.includes("SOUTH"), "a market is missing");
  assert.ok(html.includes("+12"), "the long position is not shown");
  assert.ok(html.includes("-4"), "the short position is not shown");
  assert.ok(html.includes("IF NORTH") && html.includes("IF SOUTH"), "the two solvency numbers must both be visible");
  assert.ok(html.includes("K7QP"), "the team code should stay visible on the floor");
});

ok("the data panel mounts and carries the AI hand-off", () => {
  const html = render(h(C.DataPanel, { player: { playerId: "p1", token: "t" }, round }));
  assert.ok(html.length > 50);
  const src = fs.readFileSync(path.join(root, "src", "components", "DataPanel.jsx"), "utf8");
  // The prompt is built on the server so it can never drift from the numbers
  // shown beside it; the panel must not be assembling its own.
  assert.ok(/d\.prompt/.test(src), "the panel does not use the server-built prompt");
  assert.ok(/clipboard\.writeText/.test(src), "there is no way to copy the prompt");
  assert.ok(/promptbox/.test(src), "the prompt is not shown, only copyable");
});

ok("the reveal mounts against a real settled round", () => {
  const html = render(
    h(C.Reveal, {
      data: {
        roundId: "r1",
        winner: "north",
        lineDeg: 20,
        shown: 3,
        truth: {
          name: "2008 TC3",
          nick: "Almahata Sitta",
          when: "2008-10-07T02:45:45Z",
          lat: 20.9,
          lon: 31.4,
          where: "the Nubian Desert, northern Sudan",
          story: "The first asteroid ever discovered before it hit, and pieces of it were later walked up off the desert floor.",
          leadHours: 20.1,
          diameterM: [3.8, 4.4],
          impactKt: 1,
          speedKms: 13.3,
        },
        corridor: { azimuthDeg: 101, groundSpeedKms: 12.38 },
        releases: [
          { index: 1, sigmaKm: 600, nominalLat: 20.7, nominalLon: 31.1, pNorth: 0.63 },
          { index: 2, sigmaKm: 468, nominalLat: 20.8, nominalLon: 31.2, pNorth: 0.71 },
          { index: 3, sigmaKm: 372, nominalLat: 20.86, nominalLon: 31.3, pNorth: 0.8 },
        ],
        others: [{ name: "2018 LA", where: "Botswana", leadHours: 8.5 }],
        leaderboard: board,
      },
      onNext() {},
    })
  );
  assert.ok(html.includes("2008 TC3"), "the reveal does not name the event");
  assert.ok(html.includes("cmap"), "the corridor map did not mount");
  const src = fs.readFileSync(path.join(root, "src", "components", "Reveal.jsx"), "utf8");
  assert.ok(/beat >= 1/.test(src), "the landing beat is not wired");
  assert.ok(/beat >= 2/.test(src), "the story beat is not wired");
  assert.ok(!/setInterval/.test(src), "the reveal loops");
});

ok("the corridor map draws the line, the corridor and the ellipse", () => {
  const solution = {
    nominalLat: 20.9,
    nominalLon: 31.4,
    azimuthDeg: 101,
    groundSpeedKms: 12.38,
    covarianceKm2: [[352800, 57000], [57000, 17000]],
    lineDeg: 20,
  };
  const html = render(h(C.CorridorMap, { solution }));
  assert.ok(html.includes("cmap-corridor"), "no corridor drawn");
  assert.ok(html.includes("cmap-e1") && html.includes("cmap-e2"), "no uncertainty ellipses");
  assert.ok(html.includes("cmap-nom"), "no nominal point");
  assert.ok(/NORTH|SOUTH/.test(html), "the line is not labelled");

  // With the true point supplied it has to be marked, and it must NOT be
  // there otherwise — that would put the answer on screen mid-round.
  const withTruth = render(h(C.CorridorMap, { solution, truth: { lat: 20.9, lon: 31.4 } }));
  assert.ok(withTruth.includes("cmap-hit"), "the impact point is not marked at the reveal");
  assert.ok(!html.includes("cmap-hit"), "the impact point is drawn before the reveal");
});

ok("the big board shows both markets large", () => {
  const html = render(h(C.BigBoard));
  assert.ok(html.length > 50);
});

ok("the admin panel renders its login", () => {
  const html = render(h(C.AdminPanel));
  assert.ok(html.toUpperCase().includes("CONTROL ROOM"));
  assert.ok(html.includes("password"));
});

ok("the gate walks name then team, and never mentions the old game", () => {
  const html = render(h(C.Gate, { round, player: null, me: null, onPlayer() {}, onHold() {}, onDone() {} }));
  assert.ok(html.includes("MONTE CARLO"), "the gate is still titled for another week");
  assert.ok(!/COIN|FLIP|BANDIT/i.test(html), "week 3 copy survived in the gate");
});

ok("one trade makes one notification, and it says which book", () => {
  const toasts = M.fillToasts([
    { s: 1, market: "north", side: "B", px: 58, qty: 4, ts: 1, taker: true, cp: "Bob" },
    { s: 2, market: "north", side: "B", px: 59, qty: 6, ts: 1, taker: true, cp: "Bob" },
  ]);
  assert.strictEqual(toasts.length, 1, "one cross must be one notification");
  assert.ok(toasts[0].title.startsWith("NORTH"), `the book is not named: ${toasts[0].title}`);

  // Two books filling at once must NOT collapse into one message.
  const both = M.fillToasts([
    { s: 1, market: "north", side: "B", px: 58, qty: 4, ts: 1, taker: true, cp: "Bob" },
    { s: 2, market: "south", side: "B", px: 41, qty: 4, ts: 1, taker: true, cp: "Carol" },
  ]);
  assert.strictEqual(both.length, 2, "two books filling is two separate things");
  assert.notStrictEqual(both[0].key, both[1].key, "the toast keys collide, so one would replace the other");
});

ok("the app routes to the floor and survives having no round", () => {
  const html = render(h(C.App));
  assert.ok(html.length > 30);
});

ok("the leaderboard ranks teams on the average", () => {
  const html = render(h(C.Leaderboard, { rows: board, myTeamId: "t1", settled: false }));
  assert.ok(html.includes("Ephemeris") && html.includes("Perihelion"));
});

ok("the app takes the click size from the round, not a hardcoded one", () => {
  assert.ok(/sizePick \?\? round\?\.defaultSize/.test(appSource), "App ignores the round's default click size");
});

ok("the release banner fires once per batch and not on first load", () => {
  // The guard that stops a freshly-opened tab shouting about data it never
  // missed, and stops every poll re-firing the same announcement.
  assert.ok(/announced\.current === 0/.test(appSource), "no first-load guard on the release banner");
  assert.ok(/released > announced\.current/.test(appSource), "the banner is not edge-triggered");
});

ok("the floor is never reached with a null state", () => {
  // THE BUG THIS EXISTS FOR: for the second between joining and the first
  // poll returning, `player` is set and `state` is still null. The gate
  // condition reads `(state && !state.me?.teamId)` so a returning player does
  // not see the gate flash -- but that clause is FALSY when state is null, so
  // the render fell through to the floor and read `state.me` off null. React
  // unmounted the tree and the player was left staring at a black page.
  //
  // This cannot be caught by mounting the app here: with no effects there is
  // no config either, so the render stops at the "no round" branch long
  // before it could crash. What CAN be checked is the ordering that makes it
  // impossible, so that is what is checked.
  const guard = appSource.indexOf("if (!state) {");
  const deref = appSource.indexOf("const me = state.me;");
  assert.ok(deref > 0, "the floor no longer reads state.me — retarget this test");
  assert.ok(guard > 0, "there is no null-state guard before the floor renders");
  assert.ok(guard < deref, "the null-state guard must come BEFORE the floor dereferences state");

  // And the gate clause it partners with really is the falsy-on-null shape,
  // which is the reason the guard is load-bearing rather than decorative.
  assert.ok(
    /\(state && !state\.me\?\.teamId\)/.test(appSource),
    "the gate condition changed shape — re-check whether the guard is still needed"
  );
});

ok("the app still mounts for a player the browser already knows", () => {
  localStorage.setItem("w4player", JSON.stringify({ playerId: "p1", token: "t", name: "Probe" }));
  try {
    const html = render(h(C.App));
    assert.ok(html.length > 30, "the app rendered nothing at all");
    assert.ok(!/SOMETHING BROKE/.test(html), "the error boundary fired on an ordinary state");
  } finally {
    localStorage.removeItem("w4player");
  }
});

ok("a crash shows something a person can act on, never a blank page", () => {
  const src = appSource;
  assert.ok(/class Boundary/.test(src), "there is no error boundary");
  assert.ok(/getDerivedStateFromError/.test(src), "the boundary cannot actually catch anything");
  assert.ok(/<Boundary>/.test(src), "the boundary is defined but never wraps the app");
  assert.ok(/window\.location\.reload/.test(src), "the crash screen offers no way out");
});

ok("leaving the team-code screen lowers the hold that keeps it up", () => {
  // THE BUG THIS EXISTS FOR: the code screen asks the app to hold the gate
  // mounted so a teammate can read the code out. The only thing that lowered
  // the hold again was TeamStep's effect cleanup -- which runs on unmount, and
  // it cannot unmount while the hold is up. Pressing GO refetched state and
  // changed nothing. Nobody could get onto the floor at all.
  const at = appSource.indexOf("onDone={");
  assert.ok(at > 0, "the gate has no done handler");
  const handler = appSource.slice(at, at + 600);
  const lower = handler.indexOf("setGateHolding(false)");
  const refetch = handler.indexOf("pull()");
  assert.ok(lower > 0, "the gate's done handler never lowers gateHolding, so the code screen is a dead end");
  assert.ok(refetch > lower, "the hold must be lowered BEFORE the refetch, or the next poll re-holds it");

  const gateSource = fs.readFileSync(path.join(root, "src", "components", "Gate.jsx"), "utf8");
  assert.ok(gateSource.includes("onHold?.(true)"), "the code screen no longer holds the gate");
  // The gate must also be given the team size, or the code screen cannot say
  // how many seats there are and draws no slots.
  assert.ok(appSource.includes("limits={{ teamSize:"), "the gate is not told how big a team may be");
});

ok("the stylesheet lays the two books out side by side", () => {
  const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  const m = css.match(/\.twobooks\s*\{([^}]*)\}/);
  assert.ok(m, "no .twobooks rule");
  assert.ok(/grid-template-columns:\s*1fr 1fr/.test(m[1]), "the two books are not side by side on desktop");
  // …and stack on a phone, because two ladders do not fit across 390px.
  const narrow = [...css.matchAll(/@media \(max-width: (\d+)px\)\s*\{([\s\S]*?)\n\}/g)].filter(
    (x) => Number(x[1]) <= 900 && x[2].includes(".twobooks")
  );
  assert.ok(narrow.length, "the books never stack on a narrow screen");
  assert.ok(/grid-template-columns:\s*1fr\s*[;}]/.test(narrow[0][2]), "the narrow rule does not stack them");
});

ok("no entry point is cacheable, so a reload always gets the current build", () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "..", "vercel.json"), "utf8"));
  const heads = vercel.headers ?? [];
  for (const src of ["/week4", "/week4/", "/week4/index.html", "/week4/admin", "/week4/board"]) {
    const rule = heads.find((x) => x.source === src);
    assert.ok(rule, `no cache rule for ${src}`);
    const cc = rule.headers.find((x) => x.key.toLowerCase() === "cache-control");
    assert.ok(/no-store/.test(cc?.value ?? ""), `${src} is cacheable`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
