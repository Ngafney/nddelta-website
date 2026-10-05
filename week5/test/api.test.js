/**
 * API tests — drives server/handler.js directly (no HTTP) against the memory
 * KV, stepping the clock by handing `now` to every call. `npm run test:api`.
 *
 * The wiring the pure tests cannot see: the phase machine, a tick derived from
 * the clock and nothing else, the data growing by exactly one row per tick,
 * settlement at tick T, the settings lock, admin auth — and above all that
 * nothing about the process, and no tick that has not printed, ever reaches a
 * player.
 */
process.env.KV_FORCE_MEMORY = "1"; // never let a test reach a shared store
process.env.SESSION_SECRET = "test-secret-for-week5-api-tests";
process.env.ADMIN_PASSWORD = "hunter2";
process.env.KV_DATA_FILE = fileURLToPath(new URL("../.data/api-test-kv.json", import.meta.url));

import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

try {
  fs.unlinkSync(process.env.KV_DATA_FILE);
} catch {}

const { handle } = await import("../server/handler.js");
const { MONEY } = await import("../shared/rules.js");
const { makePath } = await import("../shared/process.js");

let passed = 0;
let failed = 0;
async function ok(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
}

/** The test clock. Every call reads it; nothing reads Date.now() for game time. */
let NOW = Date.UTC(2026, 9, 6, 18, 0, 0);
const at = (ms) => (NOW = ms);
const advance = (ms) => (NOW += ms);

const call = (m, r, body = {}, q = {}) => handle(m, r, { __ip: "t", ...body }, { __ip: "t", ...q }, NOW);
const fails = async (p, re) => {
  try {
    await p;
  } catch (e) {
    if (re) assert.match(e.message, re);
    return e;
  }
  throw new Error("expected a rejection");
};

const { token } = await call("POST", "admin/auth", { password: "hunter2" });

let dev = 0;
async function player(name) {
  const p = await call("POST", "join", { name, deviceId: `device-${name}-${dev++}-xyz` });
  return { playerId: p.playerId, token: p.token };
}

/**
 * A round with deliberately odd numbers, so a leak cannot hide behind a
 * coincidence: no default value appears anywhere in it.
 */
const ODD = {
  phi1: 0.913,
  phi2: 0.977,
  switchTick: 23,
  sigma: 1.37,
  mu: 97.31,
  K: 101,
  yOpen: 104.5,
  H: 80,
  T: 40,
  secondsPerTick: 2,
  researchMinutes: 1,
  seed: "zebra-seed-xyz",
  naiveBot: false,
};

async function freshRound(opts = {}) {
  const r = await call("POST", "admin/round", { token, ...ODD, ...opts });
  const a = await player(`Ann${dev}`);
  const b = await player(`Ben${dev}`);
  const t = await call("POST", "team/create", { ...a, name: `T${dev}` });
  await call("POST", "team/join", { ...b, code: t.code });
  return { a, b, round: r.round, peek: r.peek };
}
const state = (p) => call("GET", "state", {}, p);
const data = (p) => call("GET", "data", {}, p);
const csv = (p) => call("GET", "data.csv", {}, p);

/** Every number and key that would give the process away. */
function assertNoLeak(blob, label, { path, tick }) {
  const s = typeof blob === "string" ? blob : JSON.stringify(blob);
  for (const key of ["phi", "phi1", "phi2", "mu", "sigma", "switchTick", "seed", "preset", "fair", "path"]) {
    assert.ok(!s.includes(`"${key}"`), `${label}: key "${key}" leaked`);
  }
  for (const v of ["0.913", "0.977", "97.31", "1.37", "zebra"]) {
    assert.ok(!new RegExp(`(^|[^0-9.])${v.replace(".", "\\.")}($|[^0-9])`).test(s), `${label}: ${v} leaked`);
  }
  // No live tick that has not printed — skipping any value that also happens
  // to be on the public part of the series.
  const shown = new Set();
  for (const y of path.slice(0, tick + 1)) shown.add(y.toFixed(4));
  for (let k = tick + 1; k < path.length; k++) {
    const v = path[k];
    if (shown.has(v.toFixed(4))) continue;
    assert.ok(!s.includes(String(v)) && !s.includes(v.toFixed(4)), `${label}: unrevealed tick ${k} (${v}) leaked`);
  }
}

console.log("\nadmin");

await ok("admin auth is required for every admin route, and the password is checked", async () => {
  await fails(call("POST", "admin/auth", { password: "nope" }), /wrong password/);
  for (const r of ["admin/round", "admin/settings", "admin/start", "admin/open", "admin/extend", "admin/end", "admin/reset", "admin/kick"]) {
    await fails(call("POST", r, { token: "forged" }), /bad admin token/);
    await fails(call("POST", r, {}), /bad admin token/);
  }
  await fails(call("GET", "admin/inspect", {}, { token: "forged" }), /bad admin token/);
});

await ok("bad settings are refused with the reason", async () => {
  await fails(call("POST", "admin/round", { token, secondsPerTick: 45 }), /seconds per tick must be between 1 and 30/);
  await fails(call("POST", "admin/round", { token, switchTick: 70, T: 60 }), /switch tick/);
});

await ok("every round gets a fresh seed and a fresh path; a pinned seed reproduces one", async () => {
  const r1 = await call("POST", "admin/round", { token });
  const r2 = await call("POST", "admin/round", { token });
  assert.notStrictEqual(r1.peek.seed, r2.peek.seed);
  const a = await player("Seedy");
  await call("POST", "admin/start", { token });
  const h2 = (await data(a)).history;
  await call("POST", "admin/round", { token, keepPlayers: true });
  await call("POST", "admin/start", { token });
  const h3 = (await data(a)).history;
  assert.notDeepStrictEqual(h2, h3, "a new round must not reuse the last path");
  assert.strictEqual(h3.at(-1), 105, "…but it still ends at Y_open");
  const p1 = await call("POST", "admin/round", { token, seed: "pinned" });
  const p2 = await call("POST", "admin/round", { token, seed: "pinned" });
  assert.strictEqual(p1.peek.seed, "pinned");
  assert.strictEqual(p1.peek.yNow, p2.peek.yNow);
  assert.strictEqual(p1.peek.fairNow, p2.peek.fairNow);
});

console.log("\nphases and the clock");

await ok("research: data is out, the book is shut, the tick is 0", async () => {
  const { a } = await freshRound();
  await fails(data(a), /research opens/);
  await call("POST", "admin/start", { token });
  const s = await state(a);
  assert.strictEqual(s.round.status, "research");
  assert.strictEqual(s.round.tickNow, 0);
  assert.strictEqual(s.series.ys.length, ODD.H);
  assert.strictEqual(s.series.ys.at(-1), ODD.yOpen);
  await fails(call("POST", "order", { ...a, side: "B", px: 50, qty: 1 }), /book opens when research ends/);
  const d = await data(a);
  assert.strictEqual(d.history.length, ODD.H);
  assert.strictEqual(d.live.length, 0);
});

await ok("research ends on its own clock and the book opens, anchored to when it was due", async () => {
  const { a } = await freshRound({ researchMinutes: 0.5 });
  const t0 = NOW;
  await call("POST", "admin/start", { token });
  advance(30_000 + 2 * 2000 + 500); // research over, then two whole ticks and a bit
  const s = await state(a);
  assert.strictEqual(s.round.status, "live");
  assert.strictEqual(s.round.liveStartedAt, t0 + 30_000, "trading started when research was DUE to end");
  assert.strictEqual(s.round.tickNow, 2);
  await call("POST", "order", { ...a, side: "B", px: 40, qty: 1 });
});

await ok("the tick is derived from the clock: same answer however often (or rarely) anyone polls", async () => {
  const { a, b } = await freshRound();
  await call("POST", "admin/open", { token });
  const start = NOW;
  for (const [ms, want] of [[0, 0], [1999, 0], [2000, 1], [9_999, 4], [20_000, 10], [79_999, 39]]) {
    at(start + ms);
    assert.strictEqual((await state(ms % 2 ? a : b)).round.tickNow, want, `at +${ms}ms`);
  }
  // Nobody polls for a while; the next read is simply correct.
  at(start + 79_999);
  assert.strictEqual((await call("GET", "config")).round.tickNow, 39);
});

await ok("the CSV grows by exactly one row per tick, and is named for the round and the tick", async () => {
  const { a, round } = await freshRound();
  await call("POST", "admin/open", { token });
  const start = NOW;
  let prev = null;
  for (let k = 0; k <= 6; k++) {
    at(start + k * 2000 + 10);
    const c = await csv(a);
    const rows = c.__raw.trim().split("\n").filter((l) => !l.startsWith("#") && l !== "t,y");
    assert.strictEqual(rows.length, ODD.H + k, `tick ${k}`);
    assert.strictEqual(c.__filename, `horizon-${round.roundId}-tick-${k}.csv`);
    assert.match(c.__contentType, /text\/csv/);
    assert.match(c.__raw, new RegExp(`# current tick: ${k} of ${ODD.T}`));
    assert.match(c.__raw, /^t,y$/m);
    if (prev) assert.ok(c.__raw.includes(prev.trim().split("\n").at(-1)), "old rows never change");
    assert.strictEqual(rows.at(-1).split(",")[0], String(k));
    prev = c.__raw;
  }
  const d = await data(a);
  assert.strictEqual(d.rows, ODD.H + 6);
  assert.strictEqual(d.h, ODD.T - 6);
  assert.match(d.prompt, /h = 34/);
});

await ok("GET state, data and data.csv NEVER leak φ, μ, σ, the switch, the seed, or an unrevealed tick", async () => {
  const { a, round } = await freshRound({ naiveBot: true });
  // The real path, to know what must NOT appear.
  const { path } = makePath({ ...ODD, seed: ODD.seed });
  const check = async (tick, label) => {
    for (const [what, blob] of [
      ["state", await state(a)],
      ["data", await data(a).catch(() => ({}))],
      ["data.csv", (await csv(a).catch(() => ({ __raw: "" }))).__raw],
      ["config", await call("GET", "config")],
      ["board", await call("GET", "board")],
      ["leaderboard", await call("GET", "leaderboard")],
      ["rules", await call("GET", "rules")],
    ]) {
      assertNoLeak(blob, `${label} ${what}`, { path, tick });
    }
  };
  await check(0, "lobby");
  await call("POST", "admin/start", { token });
  await check(0, "research");
  await call("POST", "admin/open", { token });
  const start = NOW;
  for (const k of [0, 1, 7, 22, 23, 24, 39]) {
    at(start + k * 2000 + 1);
    await call("POST", "order", { ...a, side: "B", px: 30 + (k % 20), qty: 1 }).catch(() => {});
    await check(k, `tick ${k}`);
    assert.strictEqual((await state(a)).series.ys.length, ODD.H + k);
  }
  await fails(call("GET", "reveal"), /not revealed/);
  // The host can peek, and only the host.
  const insp = await call("GET", "admin/inspect", {}, { token });
  assert.strictEqual(insp.peek.phi1, 0.913);
  assert.strictEqual(insp.peek.switchTick, 23);
  assert.strictEqual(insp.peek.tick, 39);
  assert.ok(insp.peek.fairNow >= 0 && insp.peek.fairNow <= 100);
  assert.strictEqual(insp.round.roundId, round.roundId);
});

await ok("the book is shut in research and open while live", async () => {
  const { a, b } = await freshRound();
  await call("POST", "admin/start", { token });
  await fails(call("POST", "order", { ...a, side: "A", px: 60, qty: 2 }), /book opens/);
  await call("POST", "admin/open", { token });
  await call("POST", "order", { ...a, side: "A", px: 60, qty: 2 });
  const r = await call("POST", "order", { ...b, side: "B", px: 60, qty: 2 });
  assert.strictEqual(r.filled, 2);
});

for (const [label, K, want] of [
  ["above K → 100", 50, 100],
  ["at or below K → 0", 150, 0],
]) {
  await ok(`it auto-settles at tick T with no action from anyone: ${label}`, async () => {
    const { a, b } = await freshRound({ K, switchTick: "", phi2: "" });
    await call("POST", "admin/open", { token });
    const start = NOW;
    advance(2000);
    await call("POST", "order", { ...b, side: "A", px: 50, qty: 4 });
    await call("POST", "order", { ...a, side: "B", px: 50, qty: 4 });
    at(start + ODD.T * 2000 - 1);
    assert.strictEqual((await state(a)).round.status, "live", "one millisecond before the bell");
    at(start + ODD.T * 2000);
    const s = await state(a);
    assert.strictEqual(s.round.status, "settled");
    assert.strictEqual(s.round.tickNow, ODD.T);
    assert.strictEqual(s.round.xStar, want);
    assert.strictEqual(s.me.cashC, MONEY.startCashC - 4 * 5000 + 4 * want * 100);
    const rv = await call("GET", "reveal");
    assert.strictEqual(rv.value, want);
    assert.strictEqual(rv.yT > K, want === 100);
    assert.strictEqual(rv.yT, s.round.yT);
    assert.strictEqual(rv.path.length, ODD.T + 1);
    assert.strictEqual(rv.fair.length, ODD.T + 1);
    assert.strictEqual(rv.fair[ODD.T], want, "the fair value at the bell is the payout");
    assert.strictEqual(rv.mids.length, ODD.T + 1, "one mid per tick, 0 … T");
    assert.deepStrictEqual(rv.mids.map((m) => m.t), Array.from({ length: ODD.T + 1 }, (_, i) => i));
    assert.strictEqual(rv.truth.phi1, 0.913);
    assert.deepStrictEqual((await call("GET", "health")).audit, []);
    await fails(call("POST", "order", { ...a, side: "B", px: 50, qty: 1 }), /closed/);
  });
}

await ok("a sparse poll still settles at the bell, records every tick, and the series is the whole path", async () => {
  const { a } = await freshRound();
  await call("POST", "admin/open", { token });
  advance(10 * 60_000); // nobody looked for ten minutes
  const s = await state(a);
  assert.strictEqual(s.round.status, "settled");
  assert.strictEqual(s.series.ys.length, ODD.H + ODD.T);
  const rv = await call("GET", "reveal");
  assert.strictEqual(rv.mids.length, ODD.T + 1);
});

await ok("the settings lock once trading opens; before that they redraw the process", async () => {
  const { a } = await freshRound();
  await call("POST", "admin/start", { token });
  const before = (await data(a)).history;
  const r = await call("POST", "admin/settings", { token, ...ODD, seed: "", yOpen: 99, H: 30 });
  assert.strictEqual(r.peek.yOpen, 99);
  assert.strictEqual((await state(a)).round.status, "research", "still in research, players kept");
  const after = (await data(a)).history;
  assert.strictEqual(after.length, 30);
  assert.strictEqual(after.at(-1), 99);
  assert.notDeepStrictEqual(before.slice(-30), after);
  await call("POST", "admin/open", { token });
  await fails(call("POST", "admin/settings", { token, ...ODD }), /locked/);
  await fails(call("POST", "admin/extend", { token, seconds: 30 }), /cannot be extended/);
});

await ok("extend adds research time; end jumps to tick T and settles on the real Y_T", async () => {
  const { a } = await freshRound();
  await call("POST", "admin/start", { token });
  const was = (await state(a)).round.researchEndsAt;
  await call("POST", "admin/extend", { token, seconds: 45 });
  assert.strictEqual((await state(a)).round.researchEndsAt, was + 45_000);
  await call("POST", "admin/open", { token });
  advance(2000 * 3 + 5);
  await call("POST", "admin/end", { token });
  const s = await state(a);
  assert.strictEqual(s.round.status, "settled");
  assert.strictEqual(s.round.tickNow, ODD.T);
  const { path } = makePath({ ...ODD, seed: ODD.seed });
  assert.strictEqual(s.round.yT, path[ODD.T]);
  assert.strictEqual(s.round.xStar, path[ODD.T] > ODD.K ? 100 : 0);
});

console.log("\nthe desks");

await ok("the naive desk quotes ±4 around the random-walk price and the noise desks trade with it", async () => {
  const { a } = await freshRound({ naiveBot: true });
  await call("POST", "admin/open", { token });
  const start = NOW;
  advance(1);
  const s0 = await state(a);
  const bid = s0.market.bestBid;
  const ask = s0.market.bestAsk;
  assert.ok(bid != null && ask != null, "the desk quotes as the book opens");
  assert.strictEqual(ask - bid, 8);
  const insp = await call("GET", "admin/inspect", {}, { token });
  assert.ok(Math.abs((bid + ask) / 2 - insp.peek.naiveNow) <= 1, `mid ${(bid + ask) / 2} vs naive ${insp.peek.naiveNow}`);
  // A minute of ticks: the noise desks have fired and the book has printed.
  for (let ms = 2000; ms <= 60_000; ms += 2000) {
    at(start + ms);
    await call("GET", "config");
  }
  const s = await state(a);
  assert.ok(s.market.volume > 0, "the desks traded with each other");
  assert.ok(!s.leaderboard.some((r) => /DESK/.test(r.name)), "desks are not on the board");
  assert.strictEqual(s.round.players, 2);
  assert.strictEqual(s.round.naiveDesk, true);
  assert.deepStrictEqual((await call("GET", "health")).audit, []);
});

await ok("with the naive desk off, nothing quotes", async () => {
  const { a } = await freshRound({ naiveBot: false });
  await call("POST", "admin/open", { token });
  advance(1);
  const s = await state(a);
  assert.strictEqual(s.market.bestBid, null);
  assert.strictEqual(s.market.bestAsk, null);
  assert.strictEqual(s.round.naiveDesk, false);
});

await ok("a quiet minute does not turn into a burst: each desk fires once, then re-bases", async () => {
  const { a } = await freshRound({ naiveBot: true, T: 300, secondsPerTick: 1 });
  await call("POST", "admin/open", { token });
  advance(1);
  await call("GET", "config");
  advance(120_000);
  await call("GET", "config");
  const desks = (await call("GET", "admin/inspect", {}, { token })).desks;
  assert.strictEqual(desks.naive.sent, 2);
  assert.ok(desks.noise.every((n) => n.sent === 1), JSON.stringify(desks.noise.map((n) => n.sent)));
  void a;
});

console.log("\nplayers");

await ok("keep-players carries teams into the next round with fresh money", async () => {
  const { a } = await freshRound();
  const before = await state(a);
  await call("POST", "admin/round", { token, keepPlayers: true });
  const after = await state(a);
  assert.strictEqual(after.me.teamId, before.me.teamId);
  assert.strictEqual(after.me.cashC, MONEY.startCashC);
  assert.strictEqual(after.round.status, "lobby");
});

await ok("kick removes a flat player; reset wipes the game but keeps the password", async () => {
  const { a } = await freshRound();
  await call("POST", "admin/kick", { token, playerId: a.playerId });
  await fails(state(a), /not in this round/);
  await fails(call("POST", "admin/kick", { token, playerId: "bot-naive" }), /no such player/);
  await call("POST", "admin/reset", { token, confirm: "RESET" });
  assert.strictEqual((await call("GET", "config")).round, null);
  await call("POST", "admin/auth", { password: "hunter2" });
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
