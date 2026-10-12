/**
 * API tests — drives server/handler.js directly (no HTTP) against the memory
 * KV, stepping the clock by handing `now` to every call. `npm run test:api`.
 *
 * The wiring the pure tests cannot see: the lobby → live → settled machine,
 * the pick clock, numbers that must be picked and may be drawn, the lock on
 * teams, manual and AUTO reveals (with catch-up anchored to when each was
 * due), the three books and their toggles, the desks, settlement with the
 * right payouts — and above all that no team's number, and not the reveal
 * order, ever reaches anyone it should not.
 */
process.env.KV_FORCE_MEMORY = "1";
process.env.SESSION_SECRET = "test-secret-for-week6-api-tests";
process.env.ADMIN_PASSWORD = "hunter2";
process.env.KV_DATA_FILE = fileURLToPath(new URL("../.data/api-test-kv.json", import.meta.url));

import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

try {
  fs.unlinkSync(process.env.KV_DATA_FILE);
} catch {}

const { handle } = await import("../server/handler.js");
const { MONEY, BOOK_ORDER } = await import("../shared/rules.js");
const { payoff } = await import("../shared/game.js");

let passed = 0;
let failed = 0;
async function ok(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 16).join("\n      ")}`);
  }
}

/** The test clock. Every call reads it; nothing reads Date.now() for game time. */
let NOW = Date.UTC(2026, 9, 12, 18, 0, 0);
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

/** A round with three teams and the numbers 7, 3 and 10 (S = 20, N = 3). */
async function freshRound(opts = {}, numbers = [7, 3, 10]) {
  const r = await call("POST", "admin/round", { token, noise: { on: false }, ...opts });
  const ps = [];
  for (const n of numbers) {
    const p = await player(`P${dev}`);
    const t = await call("POST", "team/create", { ...p, name: `Team ${dev}`, number: n });
    ps.push({ ...p, code: t.code, number: n });
  }
  return { ps, a: ps[0], b: ps[1], c: ps[2], round: r.round };
}
const state = (p) => call("GET", "state", {}, p);
const order = (p, mkt, side, px, qty) => call("POST", "order", { ...p, mkt, side, px, qty });

console.log("\nadmin");

await ok("admin auth is required for every admin route, and the password is checked", async () => {
  await fails(call("POST", "admin/auth", { password: "nope" }), /wrong password/);
  for (const r of ["admin/round", "admin/settings", "admin/pick", "admin/open", "admin/extend", "admin/hold", "admin/reveal", "admin/auto", "admin/books", "admin/bots", "admin/sharp", "admin/end", "admin/reset", "admin/kick"]) {
    await fails(call("POST", r, { token: "forged" }), /bad admin token/);
    await fails(call("POST", r, {}), /bad admin token/);
  }
  await fails(call("GET", "admin/inspect", {}, { token: "forged" }), /bad admin token/);
});

await ok("bad settings are refused with the reason", async () => {
  await fails(call("POST", "admin/round", { token, pickSeconds: 2 }), /pick seconds must be between 5 and 600/);
  await fails(call("POST", "admin/round", { token, K: "4.5" }), /K must be a whole number/);
  await fails(call("POST", "admin/round", { token, noise: { desks: 9 } }), /noise desks/);
});

console.log("\nthe lobby");

await ok("a team must bring a number; zero counts; the team sees its number and nobody else does", async () => {
  await call("POST", "admin/round", { token });
  const a = await player("Ann");
  await fails(call("POST", "team/create", { ...a, name: "No Number" }), /pick a whole number from 0 to 10/);
  await fails(call("POST", "team/create", { ...a, name: "Eleven", number: 11 }), /0 to 10/);
  await fails(call("POST", "team/create", { ...a, name: "Half", number: "2.5" }), /0 to 10/);
  const t = await call("POST", "team/create", { ...a, name: "Zeroes", number: "0" });
  assert.strictEqual(t.team.number, 0);
  assert.strictEqual(t.team.canPick, true);
  const b = await player("Ben");
  await call("POST", "team/join", { ...b, code: t.code });
  const sb = await state(b);
  assert.strictEqual(sb.team.number, 0, "a joiner sees the team's number");
  assert.strictEqual(sb.round.N, 1);
  assert.strictEqual(sb.round.locked, false);
  // Another team cannot see it anywhere in its poll.
  const c = await player("Cy");
  await call("POST", "team/create", { ...c, name: "Sevens", number: 7 });
  const sc = await state(c);
  assert.strictEqual(sc.team.number, 7);
  assert.strictEqual(sc.round.N, 2);
  assert.strictEqual(sc.round.Smax, 20);
  const everythingButMyTeam = JSON.stringify({ ...sc, team: null });
  assert.ok(!/"number"/.test(everythingButMyTeam), "no number key outside the player's own team view");
  assert.ok(!/"revealOrder"|"pickedBy"/.test(everythingButMyTeam));
  for (const blob of [await call("GET", "config"), await call("GET", "board"), await call("GET", "leaderboard")]) {
    assert.ok(!/"number"|"revealOrder"/.test(JSON.stringify(blob)));
  }
});

await ok("any member may change the number while the pot is open; the books are shut in the lobby", async () => {
  const { a, b } = await freshRound();
  const bj = await player("Joiner");
  await call("POST", "team/join", { ...bj, code: a.code });
  const r = await call("POST", "team/number", { ...bj, number: 4 });
  assert.strictEqual(r.team.number, 4);
  assert.strictEqual((await state(a)).team.number, 4);
  assert.strictEqual((await state(a)).team.pickedBy, "Joiner");
  await fails(call("POST", "team/number", { ...bj, number: 12 }), /0 to 10/);
  await fails(call("POST", "team/number", { ...bj, number: "x" }), /0 to 10/);
  await fails(order(a, "fut", "B", 10, 1), /books open when the host opens trading/);
  await fails(order(b, "fut", "B", 10, 1), /books open when the host opens trading/);
});

await ok("the pick clock needs a team, opens trading by itself when it runs out, anchored to when it was due, and can be extended or held", async () => {
  await call("POST", "admin/round", { token, noise: { on: false } });
  await fails(call("POST", "admin/pick", { token }), /no teams yet/);
  const { a } = await freshRound({ pickSeconds: 20 });
  await call("POST", "admin/pick", { token });
  let s = await state(a);
  assert.strictEqual(s.round.pickEndsAt, NOW + 20_000);
  assert.strictEqual(s.round.msLeft, 20_000);
  await call("POST", "admin/extend", { token, seconds: 10 });
  assert.strictEqual((await state(a)).round.pickEndsAt, NOW + 30_000);
  await call("POST", "admin/hold", { token });
  assert.strictEqual((await state(a)).round.pickEndsAt, null);
  await fails(call("POST", "admin/extend", { token }), /no pick clock/);
  await call("POST", "admin/pick", { token, seconds: 15 });
  const t0 = NOW;
  advance(15_000 + 4_321);
  s = await state(a);
  assert.strictEqual(s.round.status, "live");
  assert.strictEqual(s.round.locked, true);
  assert.strictEqual(s.round.liveStartedAt, t0 + 15_000, "opened when the clock was DUE to run out");
  await fails(call("POST", "admin/pick", { token }), /already opened/);
  await fails(call("POST", "admin/extend", { token }), /trading has opened/);
});

console.log("\nthe lock");

await ok("opening seals the pot: N, K = 5N, the ladders, no new teams, no new numbers, no leaving", async () => {
  const { a, b, c } = await freshRound();
  const o = await call("POST", "admin/open", { token });
  assert.strictEqual(o.round.N, 3);
  assert.strictEqual(o.round.K, 15);
  assert.strictEqual(o.round.Kauto, true);
  assert.strictEqual(o.round.Smax, 30);
  assert.deepStrictEqual([o.round.lo, o.round.hi, o.round.left], [0, 30, 3]);
  assert.deepStrictEqual([o.round.books.fut.orderMin, o.round.books.fut.orderMax], [0, 30]);
  assert.deepStrictEqual([o.round.books.call.orderMin, o.round.books.call.orderMax], [0, 15]);
  assert.deepStrictEqual([o.round.books.put.orderMin, o.round.books.put.orderMax], [0, 15]);
  assert.strictEqual(o.round.books.fut.open, true);
  assert.strictEqual(o.round.books.call.open, false);
  assert.strictEqual(o.round.fair.fut, 15);
  assert.strictEqual(o.peek.S, 20);
  assert.deepStrictEqual(o.peek.payouts, { fut: 20, call: 5, put: 0 });
  const late = await player("Late");
  await fails(call("POST", "team/create", { ...late, name: "Too Late", number: 5 }), /locked/);
  await call("POST", "team/join", { ...late, code: c.code });
  assert.strictEqual((await state(late)).team.number, 10, "a late joiner sees the team's number");
  await fails(call("POST", "team/number", { ...a, number: 9 }), /locked/);
  await fails(call("POST", "team/leave", { ...b }), /locked/);
  await fails(call("POST", "admin/settings", { token }), /opened/);
  assert.strictEqual((await state(a)).round.N, 3, "N did not move");
  assert.strictEqual((await state(a)).team.canPick, false);
});

await ok("a typed K is used when it fits, and falls back to 5N when it cannot", async () => {
  await freshRound({ K: 22 });
  let o = await call("POST", "admin/open", { token });
  assert.deepStrictEqual([o.round.K, o.round.Kauto], [22, false]);
  assert.deepStrictEqual([o.round.books.call.orderMax, o.round.books.put.orderMax], [8, 22]);
  await freshRound({ K: 30 });
  o = await call("POST", "admin/open", { token });
  assert.deepStrictEqual([o.round.K, o.round.Kauto], [15, true], "K = Smax is not a strike");
});

await ok("opening an empty lobby is refused", async () => {
  await call("POST", "admin/round", { token });
  await fails(call("POST", "admin/open", { token }), /no team has picked a number/);
});

console.log("\nthe reveal");

await ok("a manual reveal pulls one number, the public view grows by exactly one, and the last one settles with the right payouts", async () => {
  const { a, b, c } = await freshRound();
  await call("POST", "admin/books", { token, call: true, put: true });
  await call("POST", "admin/open", { token });
  // a: long 10 SUM at 14, long 7 CALL at 3, short 5 PUT at 4 — all against b.
  await order(b, "fut", "A", 14, 10);
  await order(a, "fut", "B", 14, 10);
  await order(b, "call", "A", 3, 7);
  await order(a, "call", "B", 3, 7);
  await order(b, "put", "B", 4, 5);
  await order(a, "put", "A", 4, 5);
  await order(c, "fut", "B", 1, 5); // resting, never fills
  const seen = [];
  for (let i = 1; i <= 3; i++) {
    advance(5000);
    const r = await call("POST", "admin/reveal", { token });
    assert.strictEqual(r.round.revealedCount, i);
    assert.strictEqual(r.round.revealed.length, i);
    assert.strictEqual(r.round.left, 3 - i);
    seen.push(r.round.revealed[i - 1]);
    const sum = seen.reduce((x, y) => x + y, 0);
    assert.strictEqual(r.round.sum, sum);
    assert.deepStrictEqual([r.round.lo, r.round.hi], [sum, sum + 10 * (3 - i)]);
    assert.strictEqual(r.round.revealedAt[i - 1], NOW);
  }
  assert.deepStrictEqual([...seen].sort((x, y) => x - y), [3, 7, 10], "every number came out exactly once");
  const s = await state(a);
  assert.strictEqual(s.round.status, "settled");
  assert.strictEqual(s.round.settleS, 20);
  assert.deepStrictEqual(s.round.payouts, { fut: 20, call: 5, put: 0 });
  const paid = 10 * 14 + 7 * 3 - 5 * 4;
  const got = 10 * 20 + 7 * 5 - 5 * 0;
  assert.strictEqual(s.me.cashC, MONEY.startCashC - paid * 100 + got * 100);
  assert.strictEqual((await state(b)).me.cashC, MONEY.startCashC + paid * 100 - got * 100);
  assert.strictEqual((await state(c)).me.cashC, MONEY.startCashC, "a resting order never fills at the bell");
  assert.deepStrictEqual(s.me.pos, { fut: 10, call: 7, put: -5 }, "settled positions are shown as they were");
  await fails(call("POST", "admin/reveal", { token }), /every number has been drawn/);
  await fails(order(a, "fut", "B", 10, 1), /closed/);
  const rv = await call("GET", "reveal");
  assert.strictEqual(rv.S, 20);
  assert.deepStrictEqual(rv.numbers, seen);
  assert.deepStrictEqual(rv.teams.map((t) => t.number), seen, "the reveal pairs each number with its team, in reveal order");
  assert.strictEqual(new Set(rv.teams.map((t) => t.name)).size, 3);
  assert.strictEqual(rv.fair.length, 4, "fair value with 0, 1, 2 and 3 numbers known");
  assert.strictEqual(rv.fair[3].fut, 20);
  assert.strictEqual(rv.fair[3].call, 5);
  assert.deepStrictEqual(rv.mids.map((m) => m.i), [0, 1, 2, 3], "a price snapshot with each count of numbers known");
  assert.strictEqual(rv.mids[0].fut.last, null, "the snapshot at the open, before anything traded");
  assert.strictEqual(rv.mids[1].fut.last, 14, "the snapshot just before the first number came out");
  assert.deepStrictEqual((await call("GET", "health")).audit, []);
  const board = await call("GET", "board");
  assert.strictEqual(board.history[0].S, 20);
  assert.strictEqual(board.history[0].N, 3);
});

await ok("nothing a player can read before settlement says whose number is whose, or what is still in the pot", async () => {
  // Distinct numbers, so a leak cannot hide behind a coincidence.
  const { a, b, c } = await freshRound({}, [2, 9, 6]);
  await call("POST", "admin/open", { token });
  const check = async (label) => {
    const sa = await state(a);
    const sb = await state(b);
    assert.strictEqual(sa.team.number, 2);
    assert.strictEqual(sb.team.number, 9);
    for (const [who, s] of [["a", sa], ["b", sb], ["c", await state(c)]]) {
      const blob = JSON.stringify({ ...s, team: null });
      assert.ok(!/"number"|"revealOrder"|"pickedBy"|"teams":\s*\[/.test(blob), `${label} ${who}: a secret key leaked`);
      assert.strictEqual(s.round.revealed.length, s.round.revealedCount);
    }
    for (const [what, blob] of [["config", await call("GET", "config")], ["board", await call("GET", "board")], ["leaderboard", await call("GET", "leaderboard")], ["rules", await call("GET", "rules")]]) {
      assert.ok(!/"number"|"revealOrder"|"pickedBy"/.test(JSON.stringify(blob)), `${label} ${what}`);
    }
    await fails(call("GET", "reveal"), /not been drawn yet/);
  };
  await check("open");
  await call("POST", "admin/reveal", { token });
  await check("one out");
  await call("POST", "admin/reveal", { token });
  await check("two out");
  const insp = await call("GET", "admin/inspect", {}, { token });
  assert.deepStrictEqual(insp.peek.teams.map((t) => t.number).sort(), [2, 6, 9], "the host sees everything");
  assert.strictEqual(insp.peek.next.number, insp.peek.teams.find((t) => !t.revealed).number);
});

await ok("AUTO pulls one number per interval, catches up a quiet stretch one at a time at the moments each was due, and settles", async () => {
  const { a } = await freshRound({ autoOn: true, autoEverySec: 10 }, [1, 2, 3, 4, 5]);
  await call("POST", "admin/open", { token });
  const t0 = NOW;
  advance(9_999);
  assert.strictEqual((await state(a)).round.revealedCount, 0);
  advance(1);
  let s = await state(a);
  assert.strictEqual(s.round.revealedCount, 1);
  assert.strictEqual(s.round.auto.nextAt, t0 + 20_000);
  // Nobody looks for half a minute: three more are due, each at its own time.
  advance(31_000);
  s = await state(a);
  assert.strictEqual(s.round.revealedCount, 4);
  assert.deepStrictEqual(s.round.revealedAt, [t0 + 10_000, t0 + 20_000, t0 + 30_000, t0 + 40_000]);
  assert.strictEqual(s.round.status, "live");
  advance(10_000);
  s = await state(a);
  assert.strictEqual(s.round.status, "settled");
  assert.strictEqual(s.round.settleS, 15);
  assert.strictEqual(s.round.revealedAt[4], t0 + 50_000);
  const rv = await call("GET", "reveal");
  assert.strictEqual(rv.mids.length, 6);
});

await ok("AUTO can be switched on mid-round, paused, re-timed; a manual pull re-bases it", async () => {
  const { a } = await freshRound({}, [1, 2, 3, 4]);
  await call("POST", "admin/open", { token });
  assert.strictEqual((await state(a)).round.auto.on, false);
  await call("POST", "admin/auto", { token, on: true, everySec: 6 });
  let s = await state(a);
  assert.deepStrictEqual([s.round.auto.on, s.round.auto.everySec, s.round.auto.nextAt], [true, 6, NOW + 6000]);
  advance(3000);
  await call("POST", "admin/reveal", { token });
  s = await state(a);
  assert.strictEqual(s.round.revealedCount, 1);
  assert.strictEqual(s.round.auto.nextAt, NOW + 6000, "re-based from the manual pull");
  await call("POST", "admin/auto", { token, on: false });
  advance(60_000);
  s = await state(a);
  assert.strictEqual(s.round.revealedCount, 1, "paused means paused");
  assert.strictEqual(s.round.auto.nextAt, null);
  await call("POST", "admin/auto", { token, on: true, everySec: 2 });
  advance(2000);
  assert.strictEqual((await state(a)).round.revealedCount, 2);
});

await ok("END NOW empties the pot at once and settles on the true sum", async () => {
  const { a } = await freshRound({}, [8, 8, 1]);
  await call("POST", "admin/open", { token });
  await call("POST", "admin/reveal", { token });
  await call("POST", "admin/end", { token });
  const s = await state(a);
  assert.strictEqual(s.round.status, "settled");
  assert.strictEqual(s.round.settleS, 17);
  assert.strictEqual(s.round.revealedCount, 3);
  assert.strictEqual((await call("POST", "admin/end", { token })).already, true);
  // From the lobby it opens, empties and settles in one go.
  const { a: a2 } = await freshRound({}, [5, 5]);
  await call("POST", "admin/end", { token });
  assert.strictEqual((await state(a2)).round.settleS, 10);
});

console.log("\nthe books and the desks");

await ok("the host opens and shuts books live; shutting one pulls its resting orders and nothing else", async () => {
  const { a, b } = await freshRound();
  await call("POST", "admin/open", { token });
  await fails(order(a, "call", "B", 3, 1), /not open for trading yet/);
  const r = await call("POST", "admin/books", { token, call: true });
  assert.strictEqual(r.round.books.call.open, true);
  await order(a, "call", "B", 3, 5);
  await order(a, "fut", "B", 10, 5);
  let s = await state(a);
  assert.strictEqual(s.me.orders.length, 2);
  assert.strictEqual(s.market.call.bestBid, 3);
  await call("POST", "admin/books", { token, call: false });
  s = await state(a);
  assert.deepStrictEqual(s.me.orders.map((o) => o.mkt), ["fut"]);
  assert.strictEqual(s.market.call.bestBid, null);
  assert.strictEqual(s.market.call.open, false);
  await fails(order(b, "call", "A", 5, 1), /not open/);
  assert.deepStrictEqual((await call("GET", "health")).audit, []);
});

await ok("the noise desks only take: an empty book stays empty, a quoted one gets hit, and they never reach the board", async () => {
  const { a, b } = await freshRound({ noise: { on: true, desks: 3, everySec: 5, size: 5, sweep: 10 } });
  await call("POST", "admin/open", { token });
  let s = (await state(a)).round;
  assert.deepStrictEqual([s.noise.on, s.noise.desks], [true, 3]);
  for (let i = 0; i < 12; i++) {
    advance(2500);
    await call("GET", "config");
  }
  s = await state(a);
  assert.strictEqual(s.market.fut.volume, 0, "nobody quoted, so nothing traded");
  assert.strictEqual(s.market.fut.bestBid, null);
  const insp = await call("GET", "admin/inspect", {}, { token });
  assert.ok(insp.desks.desks.every((d) => d.sent > 0), "every desk fired");
  // Now a quotes both sides, wide; the desks sweep into them.
  await order(a, "fut", "B", 12, 50);
  await order(a, "fut", "A", 18, 50);
  for (let i = 0; i < 12; i++) {
    advance(2500);
    await call("GET", "config");
  }
  s = await state(a);
  assert.ok(s.market.fut.volume > 0, "the desks traded with the quotes");
  assert.ok(!s.leaderboard.some((r) => /DESK/.test(r.name)));
  assert.strictEqual(s.round.players, 3);
  assert.deepStrictEqual((await call("GET", "health")).audit, []);
  // Switch them off: nothing more happens.
  const v = s.market.fut.volume;
  await call("POST", "admin/bots", { token, on: false });
  await order(b, "fut", "B", 13, 50);
  for (let i = 0; i < 8; i++) {
    advance(2500);
    await call("GET", "config");
  }
  assert.strictEqual((await state(a)).market.fut.volume, v);
  assert.strictEqual((await state(a)).round.noise.desks, 0);
});

await ok("a quiet minute does not turn into a burst: each desk fires once, then re-bases", async () => {
  const { a } = await freshRound({ noise: { on: true, desks: 2, everySec: 5, size: 5, sweep: 2 } });
  await call("POST", "admin/open", { token });
  advance(10_000);
  await call("GET", "config");
  advance(120_000);
  await call("GET", "config");
  const desks = (await call("GET", "admin/inspect", {}, { token })).desks.desks;
  assert.ok(desks.every((d) => d.sent === 2), JSON.stringify(desks.map((d) => d.sent)));
  void a;
});

console.log("\nrounds and people");

await ok("a new round keeps teams but clears every number; unpicked teams get one drawn for them at the open and are told", async () => {
  const { a, b, c } = await freshRound();
  await call("POST", "admin/open", { token });
  await call("POST", "admin/end", { token });
  await call("POST", "admin/round", { token, keepPlayers: true, noise: { on: false } });
  let sa = await state(a);
  assert.strictEqual(sa.round.status, "lobby");
  assert.strictEqual(sa.me.cashC, MONEY.startCashC);
  assert.strictEqual(sa.team.number, null, "the number is cleared");
  assert.strictEqual(sa.team.canPick, true);
  assert.strictEqual(sa.round.N, 3, "the teams carried over");
  assert.strictEqual(sa.round.locked, false);
  await call("POST", "team/number", { ...a, number: 6 });
  await call("POST", "team/number", { ...b, number: 1 });
  // c never picks. The host opens anyway.
  const o = await call("POST", "admin/open", { token });
  assert.strictEqual(o.peek.unpicked, 0);
  const sc = await state(c);
  assert.ok(Number.isInteger(sc.team.number) && sc.team.number >= 0 && sc.team.number <= 10);
  assert.strictEqual(sc.team.drawn, true, "the team is told the house drew for it");
  assert.strictEqual((await state(a)).team.drawn, false);
  assert.strictEqual(o.peek.S, 6 + 1 + sc.team.number);
  assert.deepStrictEqual((await call("GET", "health")).audit, []);
  // The same seed draws the same number; a different round draws afresh.
  const insp = await call("GET", "admin/inspect", {}, { token });
  assert.ok(insp.peek.teams.find((t) => t.drawn));
});

await ok("a team emptied before the lock vanishes; a kick after the lock leaves the number in the pot and N alone", async () => {
  const { a, b, c } = await freshRound();
  await call("POST", "team/leave", { ...c });
  assert.strictEqual((await state(a)).round.N, 2);
  await fails(call("POST", "team/join", { ...c, code: c.code }), /no team has that code/);
  await call("POST", "admin/open", { token });
  assert.strictEqual((await state(a)).round.N, 2);
  await call("POST", "admin/kick", { token, playerId: b.playerId });
  await fails(state(b), /not in this round/);
  const s = await state(a);
  assert.strictEqual(s.round.N, 2, "the kicked player's team still counts");
  assert.strictEqual(s.round.teams, 2);
  await call("POST", "admin/end", { token });
  const rv = await call("GET", "reveal");
  assert.strictEqual(rv.numbers.length, 2);
  assert.deepStrictEqual([...rv.numbers].sort(), [3, 7]);
  assert.deepStrictEqual((await call("GET", "health")).audit, []);
  await fails(call("POST", "admin/kick", { token, playerId: "bot-noise-1" }), /no such player/);
});

await ok("a player holding a position cannot be kicked; a flat one can", async () => {
  const { a, b } = await freshRound();
  await call("POST", "admin/open", { token });
  await order(a, "fut", "A", 15, 2);
  await order(b, "fut", "B", 15, 2);
  await fails(call("POST", "admin/kick", { token, playerId: a.playerId }), /holding a position/);
  await order(a, "fut", "B", 16, 2);
  await order(b, "fut", "A", 16, 2);
  await call("POST", "admin/kick", { token, playerId: a.playerId });
  await fails(state(a), /not in this round/);
});

await ok("rejoining from the same device signs you back in; a settled round takes no new players", async () => {
  const { a } = await freshRound();
  const again = await call("POST", "join", { name: "Whoever", deviceId: `device-P${dev - 3}-${dev - 3}-xyz` });
  assert.strictEqual(again.rejoined, true);
  assert.strictEqual(again.playerId, a.playerId);
  await call("POST", "admin/end", { token });
  await fails(call("POST", "join", { name: "New Kid", deviceId: "device-new-kid-xyz" }), /round is over/);
});

await ok("the IOC rule: a cross that fits trades, a remainder that would not fit is dropped and reported", async () => {
  const { a, b } = await freshRound();
  await call("POST", "admin/open", { token });
  // b has $100 and offers 5 SUM at 20 (worst loss (30 − 20) × 5 = $50).
  const insp = await call("GET", "admin/inspect", {}, { token });
  void insp;
  await order(b, "fut", "A", 20, 5);
  // a bids 50 at 29: 5 fill at 20 (cost $100), 45 would rest at 29 with worst loss 29 × 45 = $1,305 — fits in $10,000. Fine.
  const r = await order(a, "fut", "B", 29, 50);
  assert.strictEqual(r.filled, 5);
  assert.strictEqual(r.resting.qty, 45);
  // Now a is long 5 and has 45 bid at 29: free cash = 10,000 − 100 − 1,305 = 8,595 (the long's worst is S=0, worth 0).
  const s = await state(a);
  assert.strictEqual(s.me.freeC, MONEY.startCashC - 100 * 100 - 29 * 45 * 100);
  assert.strictEqual(s.me.orders[0].holdC, 29 * 45 * 100);
});

console.log("\nthe insider");

await ok("a strike buys only offers below the true payoff by the edge, sells only bids above it, caps at its size, and never rests", async () => {
  // Numbers 7, 3, 10 → S = 20, K = 15: SUM pays 20, CALL pays 5, PUT pays 0.
  const { a, b, c } = await freshRound();
  await call("POST", "admin/books", { token, call: true, put: true });
  await call("POST", "admin/open", { token });
  await fails(call("POST", "admin/sharp", { token, edge: "abc" }), /edge must be a number/);
  await fails(call("POST", "admin/sharp", { token, size: 0 }), /shares per strike/);
  // Offers first: cheap ones (take), fair ones (leave).
  await order(b, "fut", "A", 18, 10); // $2 cheap
  await order(b, "fut", "A", 19, 10); // $1 cheap
  await order(b, "fut", "A", 20, 10); // fair — leave
  await order(c, "call", "A", 3, 10); // $2 cheap
  await order(c, "call", "A", 5, 10); // fair — leave
  await order(c, "put", "A", 0, 10); // fair — leave
  const r = await call("POST", "admin/sharp", { token, strike: true, edge: "0.10", size: 100 });
  assert.deepStrictEqual(r.report, { fut: 20, call: 10, put: 0, shares: 30 });
  assert.strictEqual(r.sharp.strikes, 1);
  assert.strictEqual(r.sharp.fills, 30);
  assert.deepStrictEqual(r.sharp.pos, { fut: 20, call: 10, put: 0 });
  assert.strictEqual(r.sharp.cfg.edgeC, 10);
  let s = await state(a);
  assert.deepStrictEqual(s.market.fut.asks.map((l) => l.px), [20], "the fair offer is left alone");
  assert.deepStrictEqual(s.market.call.asks.map((l) => l.px), [5]);
  assert.deepStrictEqual(s.market.put.asks.map((l) => l.px), [0]);
  assert.ok(!s.leaderboard.some((row) => /INSIDER/.test(row.name)));
  assert.strictEqual(s.me.orders.length, 0, "nothing of the insider's rests (a is a player; the insider has no view)");
  // Now bids: rich ones (take), a fair one (leave). Clear the offers first so nothing crosses.
  await call("POST", "cancel", { ...b, all: true });
  await call("POST", "cancel", { ...c, all: true });
  await order(c, "fut", "B", 22, 10); // $2 rich
  await order(c, "fut", "B", 20, 10); // fair — leave
  await order(b, "call", "B", 7, 10); // $2 rich
  await order(b, "put", "B", 2, 10); // put pays 0: $2 rich
  const r1 = await call("POST", "admin/sharp", { token, strike: true });
  assert.deepStrictEqual(r1.report, { fut: -10, call: -10, put: -10, shares: 30 });
  s = await state(a);
  assert.deepStrictEqual(s.market.fut.bids.map((l) => l.px), [20], "the fair bid is left alone");
  assert.deepStrictEqual(s.market.call.bids, []);
  assert.deepStrictEqual(s.market.put.bids, []);
  // The size cap: 25 shares against 40 cheap.
  await call("POST", "cancel", { ...c, all: true });
  await order(b, "fut", "A", 17, 40);
  const r2 = await call("POST", "admin/sharp", { token, strike: true, size: 25 });
  assert.strictEqual(r2.report.shares, 25);
  assert.strictEqual((await state(a)).market.fut.asks.find((l) => l.px === 17).qty, 15);
  // A big edge takes nothing at $3 off.
  const r3 = await call("POST", "admin/sharp", { token, strike: true, edge: 5, size: 100 });
  assert.strictEqual(r3.report.shares, 0);
  assert.strictEqual(r3.sharp.cfg.edgeC, 500, "an edge of 5 is dollars");
  // Settle: its money is exactly its edge.
  await call("POST", "admin/end", { token });
  const insp = await call("GET", "admin/inspect", {}, { token });
  // bought 10@18 + 10@19 + 25@17 (SUM pays 20) = 20+10+75; bought 10 call @3 (pays 5) = 20;
  // sold 10 SUM @22 = 20; sold 10 call @7 = 20; sold 10 put @2 (pays 0) = 20.
  assert.strictEqual(insp.sharp.pnlC, (20 + 10 + 75 + 20 + 20 + 20 + 20) * 100);
  assert.deepStrictEqual((await call("GET", "health")).audit, []);
  const rv = await call("GET", "reveal");
  assert.strictEqual(rv.sharp.name, "THE INSIDER");
  assert.strictEqual(rv.sharp.strikes, 4);
});

await ok("the insider's loop fires on its clock, can be switched off, and does nothing before the pot is locked", async () => {
  const { a, b } = await freshRound();
  await fails(call("POST", "admin/sharp", { token, strike: true }), /open trading first/);
  await call("POST", "admin/sharp", { token, loop: true, everySec: 10 });
  assert.strictEqual((await call("GET", "admin/inspect", {}, { token })).sharp.loop, true);
  await call("POST", "admin/open", { token });
  await order(b, "fut", "A", 15, 5); // $5 cheap, S = 20
  advance(9_999);
  await call("GET", "config");
  assert.strictEqual((await state(a)).market.fut.asks.length, 1, "not yet");
  advance(1);
  await call("GET", "config");
  let insp = await call("GET", "admin/inspect", {}, { token });
  assert.strictEqual(insp.sharp.strikes, 1);
  assert.strictEqual((await state(a)).market.fut.asks.length, 0);
  await order(b, "fut", "A", 15, 5);
  await call("POST", "admin/sharp", { token, loop: false });
  advance(60_000);
  await call("GET", "config");
  insp = await call("GET", "admin/inspect", {}, { token });
  assert.strictEqual(insp.sharp.strikes, 1, "off means off");
  assert.strictEqual((await state(a)).market.fut.asks.length, 1);
  await fails(call("POST", "admin/sharp", { token: "forged", strike: true }), /bad admin token/);
});

console.log("\nfrom the playtests");

await ok("crossing your own resting order reports the self-cancel; a one-sided book has no mid; a silly print does not move the mark", async () => {
  const { a, b } = await freshRound();
  await call("POST", "admin/open", { token });
  await order(a, "fut", "A", 12, 5); // a's own offer
  const r = await order(a, "fut", "B", 14, 5); // a crosses it: pulled, not traded
  assert.strictEqual(r.filled, 0);
  assert.deepStrictEqual(r.selfCanceled.map((o) => [o.px, o.qty, o.side]), [[12, 5, "A"]]);
  let s = await state(a);
  assert.strictEqual(s.market.fut.mid, null, "one side only: no mid");
  assert.strictEqual(s.market.fut.mark, 14, "…so the mark is the best price there is");
  // b sells 1 at a's silly 14 bid while a two-sided book exists elsewhere: the mark is the mid, not the print.
  await order(b, "fut", "A", 16, 5);
  s = await state(a);
  assert.strictEqual(s.market.fut.mid, 15);
  await order(b, "fut", "A", 14, 1);
  s = await state(a);
  assert.strictEqual(s.market.fut.last, 14);
  assert.strictEqual(s.market.fut.mid, 15, "the bid at 14 still has 4 left, the offer at 16 stands");
  assert.strictEqual(s.market.fut.mark, 15, "marked at the mid, not the print");
  assert.ok(Number.isInteger(s.me.worstS) && s.me.worstS >= s.round.lo && s.me.worstS <= s.round.hi);
  assert.strictEqual(s.me.spendableC, undefined);
  assert.strictEqual(s.me.spentC, undefined);
  assert.strictEqual(s.fills[0]?.mkt, s.fills[0]?.market, "fills carry mkt like orders do");
  const e1 = await fails(order(a, "xyz", "B", 1, 1), /mkt must be/);
  assert.strictEqual(e1.code, "bad-book");
  const e2 = await fails(call("POST", "order", { ...a, mkt: "fut", side: "X", px: 1, qty: 1 }), /side must be/);
  assert.strictEqual(e2.code, "bad-side");
  const e3 = await fails(call("GET", "reveal"), /not been drawn/);
  assert.strictEqual(e3.code, "not-settled");
});

await ok("a partial admin/bots payload changes only what it names", async () => {
  const { a } = await freshRound({ noise: { on: true, desks: 3, everySec: 7, size: 9, sweep: 2 } });
  await call("POST", "admin/open", { token });
  let r = await call("POST", "admin/bots", { token, on: false });
  assert.deepStrictEqual(r.desks.cfg, { on: false, desks: 3, everySec: 7, size: 9, sweep: 2 });
  assert.strictEqual((await state(a)).round.noise.desks, 0, "off reads as no desks to players");
  r = await call("POST", "admin/bots", { token, on: true, size: "20", everySec: "" });
  assert.deepStrictEqual(r.desks.cfg, { on: true, desks: 3, everySec: 7, size: 20, sweep: 2 });
  assert.strictEqual(r.desks.desks.length, 3, "only the desks in play are listed");
  await fails(call("POST", "admin/bots", { token, desks: 9 }), /noise desks/);
});

await ok("reset wipes the game but keeps the password", async () => {
  await freshRound();
  await call("POST", "admin/reset", { token, confirm: "RESET" });
  assert.strictEqual((await call("GET", "config")).round, null);
  await call("POST", "admin/auth", { password: "hunter2" });
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
