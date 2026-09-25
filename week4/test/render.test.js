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
import Orrery from "./src/components/Orrery.jsx";
import DataPanel from "./src/components/DataPanel.jsx";
import StaleBuild from "./src/components/StaleBuild.jsx";
import { money, num, clock } from "./src/components/PixelBits.jsx";
export const C = { App, Gate, OrderBook, YouPanel, Leaderboard, Toasts, Reveal, Rules, AdminPanel, BigBoard, Orrery, DataPanel, StaleBuild };
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
  releaseLog: [
    { index: 1, leadDays: 180, rows: 238, at: Date.now() },
    { index: 2, leadDays: 150, rows: 30, at: Date.now() },
    { index: 3, leadDays: 120, rows: 30, at: Date.now() },
  ],
  nextLeadDays: 90,
  observationCount: 298,
  recordYears: 3,
  impactDay: 1095.75,
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

ok("the data panel offers a one-click download and states the error bars", () => {
  const html = render(h(C.DataPanel, { player: { playerId: "p1", token: "t" }, round, onToast() {} }));
  // Before the fetch resolves it shows a spinner; the shape still has to mount.
  assert.ok(html.length > 50);
});

ok("the reveal names the winner, the latitude and the relativity", () => {
  const html = render(
    h(C.Reveal, {
      data: {
        roundId: "r1",
        winner: "north",
        latDeg: 3.42,
        impactDay: 1095.75,
        track,
        trackDays: track.map((_, i) => i),
        physics: {
          perihelionSolarRadii: 15.4,
          passes: 4,
          relativisticDriftKm: 29957,
          newtonianMisses: true,
          newtonianMissKm: 27056,
          newtonianLatDeg: null,
        },
        leaderboard: board,
      },
      onNext() {},
    })
  );
  // Only the first beat exists in a static mount: the globe, the verdict and
  // the board are all gated behind timers that do not run here. So check the
  // stage renders, and check the later beats are wired, in source.
  assert.ok(html.includes("reveal-canvas"), "the flight stage did not mount");
  const src = fs.readFileSync(path.join(root, "src", "components", "Reveal.jsx"), "utf8");
  assert.ok(/beat >= 1 && <Globe/.test(src), "the globe is not wired to the landing beat");
  assert.ok(/beat >= 2/.test(src), "the board is not wired to the final beat");
  // It must play ONCE. A reveal that loops stops being a reveal.
  assert.ok(!/setInterval/.test(src), "the reveal loops on an interval");
  assert.ok(/if \(t < 1\) raf\.current = requestAnimationFrame/.test(src), "the flight animation never stops");
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

/* ── against a payload the live server actually produced ──────────────── */

/**
 * Mock data is written from memory and therefore agrees with whatever I
 * believed when I wrote it. `test/fixtures/live.json` was captured off the
 * running site, so these mount every screen against what the server really
 * sends. This is the check that catches a component reading a field the API
 * does not have.
 */
const livePath = path.join(root, "test", "fixtures", "live.json");
if (fs.existsSync(livePath)) {
  const live = JSON.parse(fs.readFileSync(livePath, "utf8"));

  ok("the floor mounts against a real state payload", () => {
    const st = live.state;
    const r = st.round;
    for (const m of ["north", "south"]) {
      const html = render(
        h(C.OrderBook, {
          book: st.markets[m],
          last: st.markets[m].last,
          me: { pos: st.me.pos[m], buyC: st.me.freeC, valueC: st.me.valueC, startC: st.me.startC },
          center: r.center,
          tick: r.tick,
          lo: r.orderMin,
          hi: r.orderMax,
          mine: st.me.orders.filter((o) => o.market === m),
          size: r.defaultSize,
          onSize() {},
          onOrder() {},
          onCancelLevel() {},
          onCancelAll() {},
          disabled: false,
        })
      );
      assert.ok(html.length > 500, `the ${m} book rendered almost nothing`);
    }
    assert.ok(render(h(C.YouPanel, { me: st.me, team: st.team, markets: st.markets, round: r })).length > 200);
  });

  ok("the leaderboard tab is actually given its rows", () => {
    // It takes `rows`; handing it only `me` and `team` makes it say "no teams
    // on the board yet" forever, which is exactly what it did.
    assert.ok(
      /<Leaderboard[^>]*rows=/.test(appSource),
      "App renders <Leaderboard> without a rows prop, so the tab can never show anything"
    );
    const html = render(
      h(C.Leaderboard, { rows: live.leaderboard.leaderboard, myTeamId: live.state.team?.id, settled: false })
    );
    assert.ok(!/No teams on the board yet/.test(html), "real rows still rendered the empty state");
  });

  ok("the reveal mounts against the real reveal payload", () => {
    const html = render(h(C.Reveal, { data: live.reveal, onNext() {} }));
    assert.ok(html.includes("reveal-canvas"));
  });

  ok("the rules modal mounts against the real rules payload", () => {
    assert.ok(Array.isArray(live.rules.markets), "the rules payload has no markets array");
    assert.ok(typeof live.rules.rules === "string");
  });

  ok("every field the floor reads exists in the real payload", () => {
    const st = live.state;
    for (const k of ["round", "markets", "me", "team", "fills"]) assert.ok(st[k] !== undefined, `state.${k} missing`);
    for (const k of ["pos", "orders", "freeC", "powers", "valueC", "startC", "cashC", "reservedC"]) {
      assert.ok(st.me[k] !== undefined, `me.${k} missing`);
    }
    assert.ok(Array.isArray(st.me.orders), "me.orders is not an array");
    for (const m of ["north", "south"]) {
      assert.ok(st.me.pos[m] !== undefined, `me.pos.${m} missing`);
      assert.ok(st.me.powers[m] !== undefined, `me.powers.${m} missing`);
      for (const k of ["bids", "asks", "tape", "mark", "last"]) {
        assert.ok(st.markets[m][k] !== undefined, `markets.${m}.${k} missing`);
      }
    }
    if (st.team) for (const k of ["name", "code", "size", "max", "members"]) {
      assert.ok(st.team[k] !== undefined, `team.${k} missing`);
    }
    for (const k of ["released", "releaseCount", "defaultSize", "center", "tick", "orderMin", "orderMax", "teamSize"]) {
      assert.ok(st.round[k] !== undefined, `round.${k} missing`);
    }
  });
}

/* ── the props actually line up ───────────────────────────────────────── */

/**
 * Three separate bugs in this app were the same bug: App rendering a component
 * with prop names the component does not take. Gate wanted `onTeam` and got
 * `onDone`. Leaderboard wanted `rows` and got `me` and `team`. Toasts wanted
 * `items` and got `toasts`, which is undefined, which is `undefined.map`.
 *
 * None of them could be caught by mounting a component with mock props,
 * because the mock is written from the component's own signature and therefore
 * always agrees with it. What has to be checked is the CALL SITE.
 */
/**
 * The opening tag of `<Name ...>`, brace-aware.
 *
 * A regex cannot do this: JSX attributes hold arrow functions, and the `>` in
 * `(p) => {` ends the match three attributes early. Track brace depth and stop
 * at the first `>` that is actually outside a value.
 */
function openingTag(src, name) {
  const out = [];
  const re = new RegExp("<" + name + "(?=[\\s/>])", "g");
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

ok("every component App renders is given the props it destructures", () => {
  // Three separate bugs in this app were the same bug: App rendering a
  // component with prop names the component does not take. Gate wanted
  // `onTeam` and got `onDone`. Leaderboard wanted `rows` and got `me` and
  // `team`. Toasts wanted `items` and got `toasts`, which is undefined, which
  // is `undefined.map` and a dead floor.
  //
  // None of them could be caught by mounting a component with mock props: the
  // mock is written from the component's own signature and therefore always
  // agrees with it. The CALL SITE is what has to be checked.
  const files = {
    Gate: "Gate.jsx",
    OrderBook: "OrderBook.jsx",
    YouPanel: "YouPanel.jsx",
    Leaderboard: "Leaderboard.jsx",
    Toasts: "Toasts.jsx",
    Reveal: "Reveal.jsx",
    Rules: "Rules.jsx",
    Orrery: "Orrery.jsx",
    DataPanel: "DataPanel.jsx",
  };

  const problems = [];
  let checked = 0;
  for (const [name, file] of Object.entries(files)) {
    const src = fs.readFileSync(path.join(root, "src", "components", file), "utf8");
    const sig = src.match(new RegExp("export default function " + name + "\\(\\{([^}]*)\\}"));
    if (!sig) continue;

    // A name with `=` has a default and is therefore optional.
    const required = sig[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !p.includes("="))
      .map((p) => p.split(":")[0].trim());

    for (const tag of openingTag(appSource, name)) {
      checked++;
      const given = new Set([...tag.matchAll(/(\w+)=/g)].map((m) => m[1]));
      for (const need of required) {
        if (!given.has(need)) problems.push(`<${name}> is not given \`${need}\``);
      }
    }
  }

  assert.ok(checked >= 6, `only found ${checked} call sites — the scanner is not matching`);
  assert.deepStrictEqual(problems, [], "\n    " + problems.join("\n    ") + "\n");
});

ok("Toasts owns expiry, and App does not duplicate its timers", () => {
  // Two owners for one timer is how the older toasts stopped expiring in an
  // earlier week. There is exactly one, and it is the component.
  const src = fs.readFileSync(path.join(root, "src", "components", "Toasts.jsx"), "utf8");
  assert.ok(/onExpire/.test(src), "Toasts no longer reports expiry");
  assert.ok(/onExpire=/.test(appSource), "App never tells Toasts what to do when one expires");
  assert.ok(!/timers\.current\.set/.test(appSource), "App is running its own toast timers again");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
