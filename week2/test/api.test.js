/**
 * API tests — drives server/handler.js directly (no HTTP), against the memory
 * KV. `npm run test:api` in week2/.
 *
 * These cover the wiring the engine tests cannot see: authentication, the CAS
 * transaction under concurrent writes, WHAT LEAKS (the domain, the range and
 * the settlement bounds must never reach a player), the two modes, the three
 * things you can buy, and the admin's powers and limits.
 */
process.env.KV_FORCE_MEMORY = "1"; // never let a test reach the shared store
process.env.SESSION_SECRET = "test-secret-for-week2-api-tests";
process.env.ADMIN_PASSWORD = "hunter2";

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data", "dev-kv.json");
try {
  fs.unlinkSync(DATA);
} catch {}

const { handle } = await import("../server/handler.js");
const { MODES, MONEY, LIMITS } = await import("../shared/rules.js");

const START = MONEY.startCashC; // $100,000.00
const SETTLE_MAX = MODES.gradient.settleMax;
const TICK = MODES.gradient.tick;

let passed = 0;
let failed = 0;
async function ok(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.stack?.split("\n").slice(0, 3).join("\n      ")}`);
  }
}

const GET = (route, query = {}) => handle("GET", route, {}, { __ip: "1.2.3.4", ...query });
const POST = (route, body = {}) => handle("POST", route, { ...body }, { __ip: "1.2.3.4" });

async function rejects(fn, re) {
  try {
    await fn();
  } catch (e) {
    if (re && !re.test(e.message)) throw new Error(`wrong error: ${e.message}`);
    return e;
  }
  throw new Error("expected a rejection, got none");
}

let admin;
const cred = (p) => ({ playerId: p.playerId, token: p.token });
const join = (name, device) => POST("join", { name, deviceId: device ?? `device-${name}-xxxxxxxx`, fp: `fp-${name}` });

/** Does this text name a settlement bound as its own whole number? */
const bound = (msg) => new RegExp(`\b${MODES.gradient.settleMax}\b|\b${MODES.gradient.settleMin}\b(?! free)`).test(msg);

/* ── setup ────────────────────────────────────────────────────────────── */

console.log("\nadmin + rounds");

await ok("the admin password gates the admin token", async () => {
  await rejects(() => POST("admin/auth", { password: "nope" }), /wrong password/);
  admin = (await POST("admin/auth", { password: "hunter2" })).token;
  assert.ok(admin && admin.length === 64);
  await rejects(() => POST("admin/round", { token: "forged" }), /bad admin token/);
});

await ok("a gradient round is created with a proved curve", async () => {
  const r = await POST("admin/round", { token: admin, mode: "gradient", difficulty: "rugged", minutes: 10 });
  assert.strictEqual(r.round.mode, "gradient");
  assert.strictEqual(r.round.status, "lobby");
  assert.ok(r.diagnostics.ok);
  assert.ok(r.diagnostics.argminError < 0.2);
  assert.deepStrictEqual(r.diagnostics.domain, [MODES.gradient.settleMin, SETTLE_MAX]);
});

await ok("the round tells a client the tick and the center, and nothing else", async () => {
  const { round } = await GET("config");
  assert.strictEqual(round.tick, TICK);
  assert.strictEqual(round.center, MODES.gradient.center);
  for (const leak of ["settleMin", "settleMax", "orderMin", "orderMax", "domain", "xStarMean", "xStarSd"]) {
    assert.ok(!(leak in round), `the round payload leaks ${leak}`);
  }
  assert.strictEqual(round.xStar, null);
});

await ok("nothing leaks the curve or the answer before the end", async () => {
  const blob = JSON.stringify(await GET("config")) + JSON.stringify(await GET("board"));
  for (const leak of ["terms", "xStar\":5", "yScale", "lambda", "settleMin", "settleMax"]) {
    assert.ok(!blob.includes(leak), `a public payload leaks ${leak}`);
  }
  await rejects(() => GET("reveal"), /not open yet/);
});

/* ── players and teams ────────────────────────────────────────────────── */

await ok("the public rules payload carries labels, never the shape of the game", async () => {
  const r = await GET("rules");
  const blob = JSON.stringify(r);
  // MODES and DIFFICULTIES hold the settlement bounds, the distribution x* is
  // drawn from, and the curve's shape parameters. None of it is public.
  for (const leak of ["settleMin", "settleMax", "xStarMean", "xStarSd", "ladderPad", "lambda", "maxOmega", "wellWidth", "decoys", "polyDeg"]) {
    assert.ok(!blob.includes(leak), `GET rules leaks ${leak}`);
  }
  assert.ok(!/\b1000\b/.test(blob.replace(/10000/g, "")), "GET rules leaks a bound");
  // But it still has to say enough to draw the screens.
  assert.strictEqual(r.modes.gradient.name, "Gradient Trading");
  assert.strictEqual(r.difficulties.rugged.name, "Rugged");
  assert.strictEqual(r.limits.maxProbeStep, LIMITS.maxProbeStep);
  assert.deepStrictEqual(r.limits.learningRate, LIMITS.learningRate);
  assert.strictEqual(r.money.descentCostC, 100_000, "the flat descent fee is public");
  assert.ok(!("descentCostPct" in r.money));
  assert.ok(!("startCashC" in r.money), "even the stack size stays out of the public rules");
});

console.log("\nplayers + teams");

let alice;
let bob;
let carol;

await ok("joining gives credentials, $100,000 and one free point", async () => {
  alice = await join("Alice");
  assert.ok(alice.playerId && alice.token);
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.me.cashC, START);
  assert.strictEqual(st.me.points.length, 1);
  const pt = st.me.points[0];
  assert.ok(pt.x >= 0 && pt.x <= SETTLE_MAX, `opening point at ${pt.x}`);
  assert.ok(Number.isFinite(pt.y) && Number.isFinite(pt.d));
});

await ok("one account per device — the same browser rejoins, it does not double up", async () => {
  const again = await POST("join", { name: "Alice2", deviceId: "device-Alice-xxxxxxxx", fp: "fp-Alice" });
  assert.strictEqual(again.rejoined, true);
  assert.strictEqual(again.playerId, alice.playerId);
  assert.strictEqual(again.name, "Alice");
});

await ok("names are unique and forged tokens are refused", async () => {
  await rejects(() => POST("join", { name: "alice", deviceId: "device-other-yyyyyyyy" }), /already took that name/);
  await rejects(() => GET("state", { playerId: alice.playerId, token: "deadbeef" }), /bad player credentials/);
  await rejects(() => POST("join", { name: "Bo", deviceId: "short" }), /could not be identified/);
  await rejects(() => POST("join", { name: "x", deviceId: "device-x-zzzzzzzz" }), /must be 2/);
});

await ok("create a team, then join it by code, capped at four", async () => {
  const t = await POST("team/create", { ...cred(alice), name: "Convex Hull" });
  assert.strictEqual(t.team.size, 1);
  assert.strictEqual(t.code.length, LIMITS.codeLength);
  bob = await join("Bob");
  carol = await join("Carol");
  await POST("team/join", { ...cred(bob), code: t.code });
  const after = await POST("team/join", { ...cred(carol), code: t.code.toLowerCase() });
  assert.strictEqual(after.team.size, 3);
  await rejects(() => POST("team/join", { ...cred(alice), code: t.code }), /already on a team/);
  const dave = await join("Dave");
  await rejects(() => POST("team/join", { ...cred(dave), code: "ZZZZ" }), /no team has that code/);
  await POST("team/join", { ...cred(dave), code: t.code });
  const erin = await join("Erin");
  await rejects(() => POST("team/join", { ...cred(erin), code: t.code }), /full/);
  await POST("team/create", { ...cred(erin), name: "Second Derivative" });
});

await ok("you cannot trade before the round is live", async () => {
  await rejects(() => POST("order", { ...cred(alice), side: "B", px: 400, qty: 1 }), /closed/);
});

/* ── trading ──────────────────────────────────────────────────────────── */

console.log("\ntrading");

await ok("the round starts and orders match across players", async () => {
  await POST("admin/start", { token: admin, minutes: 10 });
  const a = await POST("order", { ...cred(alice), side: "B", px: 450, qty: 2 });
  assert.strictEqual(a.filled, 0);
  const b = await POST("order", { ...cred(bob), side: "A", px: 450, qty: 2 });
  assert.strictEqual(b.filled, 2);
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.me.pos, 2);
  assert.strictEqual(st.market.last, 450);
  assert.strictEqual(st.me.cashC, START - 2 * 450 * 100);
});

await ok("both sides are notified of the fill, and `since` advances", async () => {
  const st = await GET("state", { ...cred(bob), since: 0 });
  assert.strictEqual(st.fills.length, 1);
  assert.strictEqual(st.fills[0].side, "A");
  const after = await GET("state", { ...cred(bob), since: st.fills[0].s });
  assert.strictEqual(after.fills.length, 0);
});

await ok("the ladder is ticks of 5 and off-grid prices are refused", async () => {
  await rejects(() => POST("order", { ...cred(carol), side: "B", px: 447, qty: 1 }), /5-tick grid/);
  await rejects(() => POST("order", { ...cred(carol), side: "B", px: 400.5, qty: 1 }), /grid|ladder/);
  const r = await POST("order", { ...cred(carol), side: "B", px: 445, qty: 1 });
  await POST("cancel", { ...cred(carol), orderId: r.resting.id });
});

await ok("you can quote far outside where settlement can land, and it is margined", async () => {
  const wild = await POST("order", { ...cred(carol), side: "B", px: 2500, qty: 1 });
  assert.ok(wild.resting, "the ladder must accept a price way above the range");
  const st = await GET("state", cred(carol));
  assert.ok(st.me.bidResC > 2500 * 100, "and reserve more than the price, for the guaranteed overpay");
  await POST("cancel", { ...cred(carol), all: true });
  assert.strictEqual((await GET("state", cred(carol))).me.bidResC, 0);
});

await ok("balance rules are enforced through the API", async () => {
  const st = await GET("state", cred(carol));
  assert.strictEqual(st.me.buyC, START);
  // 50 lots at 1000 ties up $50,000, so two of those orders is every cent.
  const a = await POST("order", { ...cred(carol), side: "B", px: 1000, qty: 50 });
  const b = await POST("order", { ...cred(carol), side: "B", px: 1000, qty: 50 });
  assert.strictEqual(a.filled + b.filled, 0, "there was nothing resting to trade against");
  assert.strictEqual(b.me.buyC, 0);
  await rejects(() => POST("order", { ...cred(carol), side: "B", px: 5, qty: 1 }), /out of balance/);
  await POST("cancel", { ...cred(carol), all: true });
  assert.strictEqual((await GET("state", cred(carol))).me.buyC, START);
});

await ok("a rejection never names a settlement bound", async () => {
  // Far below the floor, so the downside is more than anyone here can cover.
  const e = await rejects(() => POST("order", { ...cred(carol), side: "A", px: -4000, qty: 50 }), /out of balance/);
  assert.ok(!bound(e.message), `leaked a bound: ${e.message}`);
  assert.ok(!/settlement can reach/.test(e.message), e.message);
});

await ok("you cannot cancel another player's order", async () => {
  const r = await POST("order", { ...cred(carol), side: "B", px: 120, qty: 1 });
  await rejects(() => POST("cancel", { ...cred(bob), orderId: r.resting.id }), /not your order/);
  await POST("cancel", { ...cred(carol), orderId: r.resting.id });
});

await ok("cancel-all clears the whole book for one player and nobody else", async () => {
  await POST("order", { ...cred(carol), side: "B", px: 100, qty: 1 });
  await POST("order", { ...cred(carol), side: "B", px: 105, qty: 1 });
  await POST("order", { ...cred(bob), side: "B", px: 95, qty: 1 });
  const out = await POST("cancel", { ...cred(carol), all: true });
  assert.strictEqual(out.canceled, 2);
  assert.strictEqual((await GET("state", cred(carol))).me.orders.length, 0);
  assert.strictEqual((await GET("state", cred(bob))).me.orders.length, 1);
  await POST("cancel", { ...cred(bob), all: true });
});

await ok("concurrent orders all land — the CAS loses nothing", async () => {
  const n = 30;
  for (const p of [alice, bob, carol]) await POST("cancel", { ...cred(p), all: true });
  const before = (await GET("state", cred(alice))).market.volume;
  const seed = await POST("order", { ...cred(alice), side: "A", px: 555, qty: 50 });
  assert.strictEqual(seed.filled, 0);
  const results = await Promise.all(
    Array.from({ length: n }, () => POST("order", { ...cred(bob), side: "B", px: 555, qty: 1 }).catch((e) => e))
  );
  const good = results.filter((r) => !(r instanceof Error));
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.market.volume - before, good.reduce((t, r) => t + r.filled, 0));
  assert.ok(good.length >= n - 2, `${n - good.length} of ${n} concurrent orders were dropped`);
  assert.strictEqual(st.market.volume - before, good.length, "one lot filled per accepted order");
  assert.deepStrictEqual((await GET("health")).audit, []);
});

/* ── buying information ───────────────────────────────────────────────── */

console.log("\ninformation");

await ok("a point costs 5% and comes back with a real gradient", async () => {
  const before = await GET("state", cred(carol));
  const anchor = before.me.points[0].x;
  const offset = anchor < 500 ? 125 : -125;
  const cost = before.me.probeCostC;
  assert.strictEqual(cost, Math.ceil(before.me.cashC * 0.05));
  const r = await POST("probe", { ...cred(carol), anchorX: anchor, offset });
  assert.strictEqual(r.costC, cost);
  assert.strictEqual(r.me.cashC, before.me.cashC - cost);
  assert.strictEqual(r.me.points.length, 2);
  assert.ok(Math.abs(r.point.x - (anchor + offset)) < 0.01);
  assert.ok(Number.isFinite(r.point.d));
});

await ok("a probe must start from a point you own, and cannot jump the domain", async () => {
  const st = await GET("state", cred(carol));
  await rejects(() => POST("probe", { ...cred(carol), anchorX: 99999, offset: 1 }), /point you already own/);
  await rejects(() => POST("probe", { ...cred(carol), anchorX: st.me.points[0].x, offset: 0 }), /already own the point/);
  // The step cap is what stops anyone binary-searching for the edges of a
  // domain they are supposed to be blind to.
  const e = await rejects(() => POST("probe", { ...cred(carol), anchorX: st.me.points[0].x, offset: 50_000 }), /at most/);
  assert.ok(!bound(e.message), `the cap message leaked a bound: ${e.message}`);
});

await ok("one step of gradient descent costs a flat $1,000 and lands where it says", async () => {
  const before = await GET("state", cred(carol));
  const from = before.me.points.find((p) => Math.abs(p.d) > 1e-6) ?? before.me.points[0];
  assert.strictEqual(before.me.descentCostC, 100_000, "a flat $1,000, whatever the stack");
  assert.ok(before.me.probeCostC > before.me.descentCostC, "at a full stack, descending is the cheap option");

  // A small step is what descent actually guarantees will go downhill; a big
  // one may legitimately overshoot the bottom and come up the far side.
  const lr = 2 / Math.abs(from.d);
  const expected = from.x - lr * from.d;
  const r = await POST("descend", { ...cred(carol), anchorX: from.x, lr });
  assert.strictEqual(r.costC, before.me.descentCostC);
  assert.strictEqual(r.me.cashC, before.me.cashC - r.costC);
  assert.ok(Math.abs(r.point.x - expected) < 0.02, `landed at ${r.point.x}, expected ${expected}`);
  assert.strictEqual(r.me.descents, 1);
  // Descent goes downhill: that is the entire point of paying for it.
  assert.ok(r.point.y < from.y, `a small descent step must go downhill: ${from.y} → ${r.point.y}`);
  assert.ok(Math.abs(Math.abs(r.step) - 2) < 0.01, `the step should be 2 units, was ${r.step}`);
});

await ok("descent is refused for a bad rate, a foreign anchor, or a step that does not move", async () => {
  const st = await GET("state", cred(carol));
  const from = st.me.points[0];
  await rejects(() => POST("descend", { ...cred(carol), anchorX: 99999, lr: 1 }), /point you already own/);
  await rejects(() => POST("descend", { ...cred(carol), anchorX: from.x, lr: 0 }), /learning rate/);
  await rejects(() => POST("descend", { ...cred(carol), anchorX: from.x, lr: -5 }), /learning rate/);
  await rejects(() => POST("descend", { ...cred(carol), anchorX: from.x, lr: 1e9 }), /learning rate/);
  // A rate so large the step would leave the neighbourhood is refused, not clamped.
  const huge = await rejects(() => POST("descend", { ...cred(carol), anchorX: from.x, lr: 300 / Math.abs(from.d) }), /at most/);
  assert.ok(!bound(huge.message), `the step-cap message leaked a bound: ${huge.message}`);
  // And nothing was charged for any of those.
  assert.strictEqual((await GET("state", cred(carol))).me.cashC, st.me.cashC);
});

await ok("the lottery ticket charges 5% and only sometimes opens the curve", async () => {
  const frank = await join("Frank");
  const teams = (await GET("admin/inspect", { token: admin })).teams;
  await POST("team/join", { ...cred(frank), code: teams[1].code });
  // Stay under the per-player rate limit; one win is all the test needs.
  for (let i = 0; i < 20; i++) {
    const r = await POST("ticket", { ...cred(frank) });
    if (r.won) break;
  }
  const st = await GET("state", cred(frank));
  assert.ok(st.me.tickets > 0, "tickets must be charged for");
  assert.ok(st.me.cashC < START, "tickets are not free");
  if (st.me.sawAll) {
    const rev = await GET("reveal", cred(frank));
    assert.ok(rev.early, "a winner sees the curve early");
    assert.ok(rev.curve.length > 100);
  } else {
    await rejects(() => GET("reveal", cred(frank)), /not open yet/);
  }
});

/* ── the bell ─────────────────────────────────────────────────────────── */

console.log("\nsettlement");

await ok("a gradient round settles itself at x*, and only then reveals", async () => {
  const inspect = await GET("admin/inspect", { token: admin });
  const truth = inspect.xStar;
  assert.ok(truth >= 0 && truth <= SETTLE_MAX);
  await POST("admin/end", { token: admin });
  const cfg = await GET("config");
  assert.strictEqual(cfg.round.status, "settled");
  assert.strictEqual(cfg.round.xStar, truth);
  const rev = await GET("reveal");
  assert.strictEqual(rev.xStar, truth);
  assert.strictEqual(rev.settleC, Math.round(truth * 100));
  assert.deepStrictEqual((await GET("health")).audit, []);
});

await ok("the leaderboard is by team and every member's number is inside it", async () => {
  const lb = (await GET("leaderboard")).leaderboard;
  assert.ok(lb.length >= 2);
  assert.ok(lb[0].valueC >= lb[1].valueC);
  assert.strictEqual(lb[0].valueC, lb[0].members.reduce((t, m) => t + m.valueC, 0));
  for (const row of lb) for (const m of row.members) assert.ok(m.valueC >= 0, "nobody finishes below zero");
});

await ok("a settled round is closed to trading, buying and new players", async () => {
  await rejects(() => POST("order", { ...cred(alice), side: "B", px: 100, qty: 1 }), /closed/);
  await rejects(() => POST("probe", { ...cred(alice), anchorX: 0, offset: 1 }), /not running/);
  await rejects(() => POST("descend", { ...cred(alice), anchorX: 0, lr: 1 }), /not running/);
  await rejects(() => POST("join", { name: "Latecomer", deviceId: "device-late-aaaaaaaa" }), /over/);
});

await ok("the admin cannot hand-pick a gradient settlement", async () => {
  await rejects(() => POST("admin/resolve", { token: admin, value: 500 }), /already resolved|not the admin's/);
});

/* ── prediction mode ──────────────────────────────────────────────────── */

console.log("\nprediction market mode");

let pat;
let quinn;

await ok("a prediction round forces 0–100 in ticks of 1, and has no curve", async () => {
  await rejects(() => POST("admin/round", { token: admin, mode: "prediction", minutes: 5 }), /needs a question/);
  const r = await POST("admin/round", {
    token: admin,
    mode: "prediction",
    question: "Will the Fed cut in March?",
    minutes: 5,
    keepPlayers: false,
  });
  assert.strictEqual(r.round.mode, "prediction");
  assert.strictEqual(r.round.hasCurve, false);
  assert.strictEqual(r.round.tick, 1);
  assert.strictEqual(r.round.center, 50);
  assert.strictEqual(r.diagnostics, null);
  const g = (await GET("admin/inspect", { token: admin })).grid;
  assert.strictEqual(g.settleMin, 0);
  assert.strictEqual(g.settleMax, 100);
});

await ok("players get no points and cannot buy information", async () => {
  pat = await POST("join", { name: "Pat", deviceId: "device-pat-11111111" });
  await POST("team/create", { ...cred(pat), name: "Basis Points" });
  const st = await GET("state", cred(pat));
  assert.strictEqual(st.me.points.length, 0);
  await POST("admin/start", { token: admin, minutes: 5 });
  await rejects(() => POST("probe", { ...cred(pat), anchorX: 10, offset: 5 }), /no curve/);
  await rejects(() => POST("descend", { ...cred(pat), anchorX: 10, lr: 1 }), /no curve/);
  await rejects(() => POST("ticket", cred(pat)), /no curve/);
});

await ok("the book works exactly the same, at a tick of 1", async () => {
  quinn = await POST("join", { name: "Quinn", deviceId: "device-quinn-2222222" });
  await POST("team/create", { ...cred(quinn), name: "Tail Risk" });
  await POST("order", { ...cred(pat), side: "B", px: 63, qty: 3 });
  const r = await POST("order", { ...cred(quinn), side: "A", px: 63, qty: 3 });
  assert.strictEqual(r.filled, 3);
  assert.strictEqual((await GET("state", cred(pat))).me.pos, 3);
});

await ok("time running out stops trading but waits for the admin's answer", async () => {
  await POST("admin/end", { token: admin });
  assert.strictEqual((await GET("config")).round.status, "ended");
  await rejects(() => POST("order", { ...cred(pat), side: "B", px: 10, qty: 1 }), /closed/);
  await rejects(() => GET("reveal"), /not been resolved/);
});

await ok("the admin resolves it to whatever they say, and it settles there", async () => {
  await rejects(() => POST("admin/resolve", { token: admin, value: 140 }), /between 0 and 100/);
  await rejects(() => POST("admin/resolve", { token: "forged", value: 100 }), /bad admin token/);
  await POST("admin/resolve", { token: admin, value: 100 });
  const cfg = await GET("config");
  assert.strictEqual(cfg.round.status, "settled");
  assert.strictEqual(cfg.round.xStar, 100);
  const st = await GET("state", cred(pat));
  assert.strictEqual(st.me.cashC, START - 3 * 6_300 + 3 * 10_000, "yes-resolution pays the buyer 100 a lot");
  const rev = await GET("reveal");
  assert.strictEqual(rev.mode, "prediction");
  assert.strictEqual(rev.value, 100);
  assert.deepStrictEqual((await GET("health")).audit, []);
  await rejects(() => POST("admin/resolve", { token: admin, value: 0 }), /already resolved/);
});

await ok("a fractional resolution works too", async () => {
  await POST("admin/round", { token: admin, mode: "prediction", question: "What share?", minutes: 5, keepPlayers: true });
  await POST("admin/start", { token: admin, minutes: 5 });
  await POST("order", { ...cred(pat), side: "B", px: 30, qty: 1 });
  await POST("admin/resolve", { token: admin, value: 42.5 });
  const cfg = await GET("config");
  assert.strictEqual(cfg.round.xStar, 42.5);
  assert.strictEqual(cfg.round.settleC, 4250);
});

await ok("a re-roll keeps the room but deals fresh money, points and a new curve", async () => {
  await POST("admin/round", { token: admin, mode: "gradient", difficulty: "tilted", minutes: 8, keepPlayers: true });
  const after = await GET("state", cred(pat));
  assert.strictEqual(after.round.mode, "gradient");
  assert.strictEqual(after.round.status, "lobby");
  assert.strictEqual(after.round.tick, TICK, "the grid follows the mode back to ticks of 5");
  assert.strictEqual(after.me.cashC, START, "everyone starts over with a full stack");
  assert.strictEqual(after.me.pos, 0);
  assert.strictEqual(after.me.orders.length, 0);
  assert.ok(after.team, "the team survives the re-roll");
  assert.strictEqual(after.me.points.length, 1, "and is dealt exactly one fresh opening point");
  const everyone = (await GET("admin/inspect", { token: admin })).players;
  for (const p of everyone) assert.strictEqual(p.points, 1, `${p.name} should hold one opening point`);
});

/* ── the event-day rehearsal ──────────────────────────────────────────── */

console.log("\nload");

await ok("60 players, 15 teams, 900 simultaneous actions — nothing dropped or corrupted", async () => {
  await POST("admin/round", { token: admin, mode: "gradient", difficulty: "diabolical", minutes: 30 });
  const players = [];
  for (let i = 0; i < 60; i++) {
    players.push(await POST("join", { name: `Trader${i}`, deviceId: `device-load-${i}-aaaaaaaa`, fp: `fp${i}` }));
  }
  for (let i = 0; i < 60; i += 4) {
    const t = await POST("team/create", { ...cred(players[i]), name: `Desk ${i / 4}` });
    for (let j = 1; j < 4; j++) await POST("team/join", { ...cred(players[i + j]), code: t.code });
  }
  await POST("admin/start", { token: admin, minutes: 30 });

  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  let busy = 0;
  let refused = 0;
  let accepted = 0;
  for (let wave = 0; wave < 6; wave++) {
    const calls = [];
    for (let i = 0; i < 150; i++) {
      const p = players[Math.floor(rnd() * players.length)];
      const roll = rnd();
      if (roll < 0.75) {
        calls.push(
          POST("order", {
            ...cred(p),
            side: rnd() < 0.5 ? "B" : "A",
            px: (200 + Math.floor(rnd() * 120)) * TICK, // ticks of 5 across a wide band
            qty: 1 + Math.floor(rnd() * 3),
          })
        );
      } else if (roll < 0.9) {
        calls.push(POST("cancel", { ...cred(p), all: true }));
      } else {
        calls.push(POST("ticket", cred(p)));
      }
    }
    for (const r of await Promise.allSettled(calls)) {
      if (r.status === "fulfilled") accepted++;
      else if (r.reason?.code === "busy") busy++;
      else refused++;
    }
    assert.deepStrictEqual((await GET("health")).audit, [], `audit failed after wave ${wave}`);
  }
  assert.strictEqual(busy, 0, `${busy} actions were turned away as "market busy"`);
  assert.ok(accepted > 500, `only ${accepted} of 900 actions were accepted (${refused} refused on their merits)`);

  await POST("admin/end", { token: admin });
  assert.deepStrictEqual((await GET("health")).audit, []);
  const lb = (await GET("leaderboard")).leaderboard;
  assert.strictEqual(lb.length, 15);
  const total = lb.reduce((t, r) => t + r.valueC, 0);
  const spent = lb.reduce((t, r) => t + r.spentC, 0);
  assert.strictEqual(total, 60 * START - spent, "the room's money must add up to what it started with, less what it burned");
  for (const row of lb) for (const m of row.members) assert.ok(m.valueC >= 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
