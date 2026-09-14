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
  assert.deepStrictEqual(r.diagnostics.domain, MODES.gradient.xDomain);
  assert.ok(r.diagnostics.yStar >= 0 && r.diagnostics.yStar <= SETTLE_MAX);
  assert.ok(r.diagnostics.valueError <= 0.01, "the minimum value must be exactly y*");
});

await ok("the round tells a client the tick and the center, and nothing else", async () => {
  const { round } = await GET("config");
  assert.strictEqual(round.tick, TICK);
  assert.strictEqual(round.center, MODES.gradient.center);
  for (const leak of ["settleMin", "settleMax", "orderMin", "orderMax", "domain", "yStarMean", "yStarSd", "difficulty"]) {
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
  // The learning-rate range legitimately contains 1000; nothing else may.
  const withoutRates = JSON.stringify({ ...r, limits: { ...r.limits, learningRate: null } });
  assert.ok(!/\b1000\b/.test(withoutRates), "GET rules leaks a bound");
  // But it still has to say enough to draw the screens.
  assert.strictEqual(r.modes.gradient.name, "Gradient Trading");
  // The difficulty catalogue is gone from the public payload entirely: the
  // names and blurbs describe the shape of the function.
  assert.ok(!("difficulties" in r), "GET rules still ships the difficulty catalogue");
  assert.ok(!/parabola|diabolical|decoy|sine/i.test(blob), "GET rules describes the function");
  assert.strictEqual(r.limits.maxStep, LIMITS.maxStep);
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
  const [dlo, dhi] = MODES.gradient.xDomain;
  assert.ok(pt.x >= dlo && pt.x <= dhi, `opening point at ${pt.x}`);
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
  // 50 shares at 1000 ties up $50,000, so two of those orders is every cent.
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

await ok("a step of gradient descent costs a flat $1,000 and lands where it says", async () => {
  const before = await GET("state", cred(carol));
  const from = before.me.points.find((p) => Math.abs(p.d) > 1e-9) ?? before.me.points[0];
  assert.strictEqual(before.me.descentCostC, 100_000, "a flat $1,000, whatever the stack");

  // A SMALL step is what descent actually guarantees will go downhill, and
  // small has to mean small relative to the domain: a fifth of a unit on a
  // hundred-wide axis. A big step may legitimately overshoot the bottom and
  // come up the far side, which is the whole hazard the game is about.
  const lr = 0.2 / Math.abs(from.d);
  const expected = from.x - lr * from.d;
  const r = await POST("descend", { ...cred(carol), anchorX: from.x, lr });
  assert.strictEqual(r.costC, 100_000);
  assert.strictEqual(r.me.cashC, before.me.cashC - r.costC);
  assert.ok(Math.abs(r.point.x - expected) < 0.02, `landed at ${r.point.x}, expected ${expected}`);
  assert.strictEqual(r.me.descents, 1);
  assert.ok(Math.abs(Math.abs(r.step) - 0.2) < 0.01, `the step should be 0.2 units, was ${r.step}`);
  assert.ok(Number.isFinite(r.point.y) && Number.isFinite(r.point.d), "the new point is a real point");
  // NOT asserted here: that f went down. Descent only guarantees that for a
  // step small relative to the LOCAL curvature, and on a random round curve
  // this test cannot know what that is - a sharp well turns any fixed step
  // into an overshoot, which is exactly the hazard the game is built on. The
  // guarantee is asserted on a parabola in engine.test.js, where it holds.
});

await ok("descent is refused for a bad rate, a foreign anchor, or a step that does not move", async () => {
  const st = await GET("state", cred(carol));
  const from = st.me.points[0];
  await rejects(() => POST("descend", { ...cred(carol), anchorX: 99999, lr: 1 }), /point you already own/);
  await rejects(() => POST("descend", { ...cred(carol), anchorX: from.x, lr: 0 }), /learning rate/);
  await rejects(() => POST("descend", { ...cred(carol), anchorX: from.x, lr: -5 }), /learning rate/);
  await rejects(() => POST("descend", { ...cred(carol), anchorX: from.x, lr: 1e9 }), /learning rate/);
  // A rate whose step would leave the neighborhood is refused, not clamped —
  // clamping would quietly hand over where the domain ends. On a very shallow
  // slope no legal rate can produce an oversized step at all, so the cap is
  // only asserted where it is actually reachable.
  const overshoot = (LIMITS.maxStep * 2) / Math.abs(from.d);
  if (overshoot <= LIMITS.learningRate[1]) {
    const huge = await rejects(() => POST("descend", { ...cred(carol), anchorX: from.x, lr: overshoot }), /at most/);
    assert.ok(!bound(huge.message), `the step-cap message leaked a bound: ${huge.message}`);
  }
  assert.strictEqual((await GET("state", cred(carol))).me.cashC, st.me.cashC, "none of that was charged for");
});

await ok("a step onto a point you own is refused free, and names no coordinate", async () => {
  const st = await GET("state", cred(carol));
  const from = st.me.points[0];
  // A rate chosen from the slope actually under foot, so the step is certainly
  // below the one-hundredth resolution points are stored at. A fixed tiny rate
  // is not enough: on a steep curve even 0.0001 moves you.
  const lr = Math.max(LIMITS.learningRate[0], 0.001 / Math.abs(from.d));
  const e = await rejects(() => POST("descend", { ...cred(carol), anchorX: from.x, lr }), /already walked/);
  // A step aimed past the end of the domain is clamped to the edge, so naming
  // the landing point in this message would announce where the domain stops.
  assert.ok(!/\d/.test(e.message), `the refusal names a coordinate: ${e.message}`);
  assert.strictEqual((await GET("state", cred(carol))).me.cashC, st.me.cashC, "and nothing was charged");
});

await ok("points record which is newest, and repeated steps walk downhill from it", async () => {
  // THE BUG THIS EXISTS FOR: points are kept sorted by x so they can be drawn,
  // so the last element is the RIGHTMOST, not the newest. The app used that as
  // "where you are standing", so a step to the left snapped the selection back
  // to some old point and it looked like the descent had done nothing.
  const walker = await POST("join", { name: "Walker", deviceId: "device-walker-000000" });
  await POST("team/create", { ...cred(walker), name: "On Foot" });
  let st = await GET("state", cred(walker));
  assert.strictEqual(st.me.points[0].n, 0, "the opening point is step zero");

  const newestOf = (points) => points.reduce((a, b) => ((b.n ?? 0) >= (a.n ?? 0) ? b : a));

  let movedEveryTime = true;
  let leftward = 0;
  let steps = 0;
  for (let i = 0; i < 6; i++) {
    const points = st.me.points;
    const active = newestOf(points);
    const round2 = (v) => Math.round(v * 100) / 100;
    const owned = (t) => points.some((q) => Math.abs(q.x - t) < 0.005);
    // The panel's escape hatch: hunt outward for a rate that lands somewhere
    // new. Searched over a wide range and in both directions, because a narrow
    // search genuinely does come up empty sometimes.
    const base = 0.6 / Math.abs(active.d || 1);
    let lr = null;
    for (let k = 1; k <= 40 && lr === null; k *= 1.05) {
      for (const cand of [base * k, base / k]) {
        const t = round2(active.x - cand * active.d);
        if (Math.abs(cand * active.d) >= 0.01 && !owned(t)) {
          lr = cand;
          break;
        }
      }
    }
    if (lr === null) break; // nowhere new to stand from here; the walk is done
    const r = await POST("descend", { ...cred(walker), anchorX: active.x, lr });
    steps++;
    assert.strictEqual(r.point.n, steps, "each step is numbered in order");
    st = await GET("state", cred(walker));
    const now = newestOf(st.me.points);
    if (now.x === active.x) movedEveryTime = false;
    if (now.x < active.x) leftward++;
    assert.strictEqual(now.x, r.point.x, "the newest point is the one just bought");
  }
  assert.ok(steps >= 3, `expected to be able to walk, took ${steps} steps`);
  assert.ok(movedEveryTime, "a step must move where you are standing");

  // And prove the trap was real: on a leftward walk the rightmost point is an
  // old one, so the previous logic would have snapped back to it.
  if (leftward > 0) {
    const rightmost = st.me.points[st.me.points.length - 1];
    const newest = newestOf(st.me.points);
    assert.ok(rightmost.n < newest.n, "the rightmost point should be an older one after walking left");
    assert.notStrictEqual(rightmost.x, newest.x, "which is exactly what the old code mistook for 'where you are'");
  }
});

await ok("there is nothing else to buy", async () => {
  await rejects(() => POST("probe", { ...cred(carol), anchorX: 1, offset: 1 }), /no route/);
  await rejects(() => POST("ticket", cred(carol)), /no route/);
  const st = await GET("state", cred(carol));
  for (const gone of ["probeCostC", "ticketCostC", "sawAll", "probes", "tickets"]) {
    assert.ok(!(gone in st.me), `the player payload still carries ${gone}`);
  }
});

/* ── the bell ─────────────────────────────────────────────────────────── */

console.log("\nsettlement");

await ok("a gradient round settles itself at the MINIMUM VALUE, and only then reveals", async () => {
  const inspect = await GET("admin/inspect", { token: admin });
  const low = inspect.yStar; // how low f gets — the contract
  const where = inspect.xStar; // where it gets there — not the contract
  assert.ok(low >= 0 && low <= SETTLE_MAX);
  await POST("admin/end", { token: admin });
  const cfg = await GET("config");
  assert.strictEqual(cfg.round.status, "settled");
  assert.strictEqual(cfg.round.xStar, low, "the market settles on the value, not the location");
  assert.strictEqual(cfg.round.settleC, Math.round(low * 100));
  const rev = await GET("reveal");
  assert.strictEqual(rev.yStar, low);
  assert.strictEqual(rev.xStar, where);
  // And the revealed curve really does bottom out at that value.
  let lowest = Infinity;
  for (const [, y] of rev.curve) lowest = Math.min(lowest, y);
  assert.ok(Math.abs(lowest - low) < 1, `the drawn curve bottoms at ${lowest}, settlement was ${low}`);
  assert.deepStrictEqual((await GET("health")).audit, []);
});

await ok("the leaderboard is by team and every member's number is inside it", async () => {
  const lb = (await GET("leaderboard")).leaderboard;
  assert.ok(lb.length >= 2);
  assert.ok(lb[0].valueC >= lb[1].valueC);
  assert.strictEqual(
    lb[0].valueC,
    Math.round(lb[0].members.reduce((t, m) => t + m.valueC, 0) / lb[0].size),
    "a team is scored on the average of its members"
  );
  for (const row of lb) for (const m of row.members) assert.ok(m.valueC >= 0, "nobody finishes below zero");
});

await ok("a settled round is closed to trading, stepping and new players", async () => {
  await rejects(() => POST("order", { ...cred(alice), side: "B", px: 100, qty: 1 }), /closed/);
  await rejects(() => POST("descend", { ...cred(alice), anchorX: 0, lr: 1 }), /not running/);
  await rejects(() => POST("join", { name: "Latecomer", deviceId: "device-late-aaaaaaaa" }), /over/);
});

await ok("the admin cannot hand-pick a gradient settlement, or preload one", async () => {
  await rejects(() => POST("admin/resolve", { token: admin, value: 500 }), /already resolved|not the admin's/);
  await rejects(() => POST("admin/preload", { token: admin, value: 500 }), /already resolved|nothing to preload/);
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

await ok("players get no points and there is nothing to step on", async () => {
  pat = await POST("join", { name: "Pat", deviceId: "device-pat-11111111" });
  await POST("team/create", { ...cred(pat), name: "Basis Points" });
  const st = await GET("state", cred(pat));
  assert.strictEqual(st.me.points.length, 0);
  await POST("admin/start", { token: admin, minutes: 5 });
  await rejects(() => POST("descend", { ...cred(pat), anchorX: 10, lr: 1 }), /no curve/);
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

await ok("an answer can be loaded in advance and changes nothing until the bell", async () => {
  await POST("admin/round", { token: admin, mode: "prediction", question: "Loaded?", minutes: 5, keepPlayers: true });
  await POST("admin/start", { token: admin, minutes: 5 });

  const before = await GET("state", cred(pat));
  await POST("admin/preload", { token: admin, value: 73 });

  // Nothing a player can see has moved, and nothing they can do has changed.
  const after = await GET("state", cred(pat));
  assert.strictEqual(after.round.status, "live", "the market is still trading");
  assert.strictEqual(after.me.cashC, before.me.cashC);
  // Structural, not a substring hunt: a millisecond timestamp will happily
  // contain "73" by chance, which is how this assertion first passed by luck.
  assert.ok(!("preset" in after.round), "the loaded answer must not appear on the round");
  assert.ok(!JSON.stringify(after.me).includes("preset"), "nor anywhere on the player");
  assert.strictEqual(after.round.xStar, null, "and nothing is settled yet");
  assert.strictEqual(after.round.settleC, null);
  const ok1 = await POST("order", { ...cred(pat), side: "B", px: 20, qty: 1 });
  assert.ok(ok1.resting, "and trading still works exactly as before");

  // The admin can see it, change it, and clear it.
  assert.strictEqual((await GET("admin/inspect", { token: admin })).preset, 73);
  await POST("admin/preload", { token: admin, value: 88 });
  assert.strictEqual((await GET("admin/inspect", { token: admin })).preset, 88);
  await POST("admin/preload", { token: admin, value: null });
  assert.strictEqual((await GET("admin/inspect", { token: admin })).preset, null);
  await POST("admin/preload", { token: admin, value: 88 });

  // At the bell it settles there by itself, with nobody to press anything.
  await POST("admin/end", { token: admin });
  const done = await GET("config");
  assert.strictEqual(done.round.status, "settled", "a loaded answer settles the market at the bell");
  assert.strictEqual(done.round.xStar, 88);
  assert.deepStrictEqual((await GET("health")).audit, []);
});

await ok("without a loaded answer the bell still waits for a human", async () => {
  await POST("admin/round", { token: admin, mode: "prediction", question: "Unloaded?", minutes: 5, keepPlayers: true });
  await POST("admin/start", { token: admin, minutes: 5 });
  await POST("admin/end", { token: admin });
  assert.strictEqual((await GET("config")).round.status, "ended");
  await POST("admin/resolve", { token: admin, value: 12 });
  assert.strictEqual((await GET("config")).round.xStar, 12);
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

await ok("the admin can set the price of a step, and the round carries it", async () => {
  await POST("admin/round", { token: admin, mode: "gradient", difficulty: "wavy", minutes: 10, descentCost: 2500 });
  const cfg = await GET("config");
  assert.strictEqual(cfg.round.descentCostC, 250_000, "$2,500 a step");

  const p = await POST("join", { name: "Pricey", deviceId: "device-pricey-99999999" });
  await POST("team/create", { ...cred(p), name: "Expensive Tastes" });
  await POST("admin/start", { token: admin, minutes: 10 });
  const st = await GET("state", cred(p));
  assert.strictEqual(st.me.descentCostC, 250_000, "and the player is quoted it");

  const from = st.me.points[0];
  const r = await POST("descend", { ...cred(p), anchorX: from.x, lr: 0.2 / Math.abs(from.d) });
  assert.strictEqual(r.costC, 250_000);
  assert.strictEqual(r.me.cashC, st.me.cashC - 250_000, "and actually charged it");

  // Free steps are a legitimate setting too.
  await POST("admin/round", { token: admin, mode: "gradient", difficulty: "wavy", minutes: 10, descentCost: 0, keepPlayers: true });
  assert.strictEqual((await GET("config")).round.descentCostC, 0);
});

await ok("a cross that cannot rest its remainder comes back as an IOC", async () => {
  await POST("admin/round", { token: admin, mode: "gradient", difficulty: "wavy", minutes: 10, startCash: 100000 });
  const shorty = await POST("join", { name: "Shorty", deviceId: "device-shorty-0000001" });
  const buyer = await POST("join", { name: "Buyer", deviceId: "device-buyer-00000001" });
  const third = await POST("join", { name: "Third", deviceId: "device-third-00000001" });
  await POST("team/create", { ...cred(shorty), name: "Downside" });
  await POST("team/create", { ...cred(buyer), name: "Upside" });
  await POST("team/create", { ...cred(third), name: "Sideways" });
  await POST("admin/start", { token: admin, minutes: 10 });

  // Sell 200 at 500 on $100,000: exactly the short cap.
  for (let i = 0; i < 4; i++) {
    await POST("order", { ...cred(buyer), side: "B", px: 500, qty: 50 });
    await POST("order", { ...cred(shorty), side: "A", px: 500, qty: 50 });
  }
  const maxed = await GET("state", cred(shorty));
  assert.strictEqual(maxed.me.pos, -200, "the setup should be exactly at the cap");
  assert.strictEqual(maxed.me.sellC, 0, "and have no room left to sell");

  // Only 20 on offer, and a bid above the ceiling cannot rest. So: fill 20,
  // drop 30, and leave nothing behind.
  await POST("order", { ...cred(third), side: "A", px: 505, qty: 20 });
  const r = await POST("order", { ...cred(shorty), side: "B", px: 1500, qty: 50 });
  assert.strictEqual(r.ioc, true, "this had to become immediate-or-cancel");
  assert.strictEqual(r.filled, 20);
  assert.strictEqual(r.canceled, 30, "the client needs to know what was dropped");
  assert.strictEqual(r.resting, null);
  assert.strictEqual(r.me.pos, -180, "the short really came in");

  const after = await GET("state", cred(shorty));
  assert.strictEqual(after.me.orders.length, 0, "nothing of mine may be left on the book");

  // An ordinary order is untouched by any of this.
  const plain = await POST("order", { ...cred(shorty), side: "B", px: 300, qty: 5 });
  assert.strictEqual(plain.ioc, false);
  assert.strictEqual(plain.canceled, 0);
  assert.ok(plain.resting, "it should rest normally");

  // And the refusal, when it comes, says what to do about it.
  const e = await rejects(
    () => POST("order", { ...cred(shorty), side: "A", px: 600, qty: 50 }),
    /out of balance/
  );
  assert.match(e.message, /cancel some resting orders/);
  for (const bound of [1000, 9000, -8000]) {
    assert.ok(!e.message.includes(String(bound)), `the refusal leaked ${bound}`);
  }
});

await ok("a box the admin cleared falls back to the default, not to zero", async () => {
  // Number("") is 0. A form full of money fields that coerce on every keystroke
  // will happily read a half-deleted entry as "steps are free" or "everyone
  // gets a dollar", and nobody notices until the round is live.
  const cleared = await POST("admin/round", {
    token: admin,
    mode: "gradient",
    difficulty: "wavy",
    minutes: "",
    startCash: "",
    descentCost: "",
    defaultSize: "",
  });
  assert.ok(cleared.ok !== false);
  const r = (await GET("config")).round;
  assert.strictEqual(r.descentCostC, MONEY.descentCostC, "a cleared price must not mean free");
  assert.strictEqual(r.startCashC, MONEY.startCashC, "a cleared stack must not mean a dollar");
  assert.strictEqual(r.defaultSize, LIMITS.defaultOrderSize, "a cleared click size must not mean one");

  // Garbage is treated the same way rather than becoming NaN.
  await POST("admin/round", { token: admin, mode: "gradient", minutes: 10, descentCost: "abc", startCash: "abc" });
  const g = (await GET("config")).round;
  assert.strictEqual(g.descentCostC, MONEY.descentCostC);
  assert.strictEqual(g.startCashC, MONEY.startCashC);

  // But a deliberate zero still means zero: free steps are a real setting.
  await POST("admin/round", { token: admin, mode: "gradient", minutes: 10, descentCost: 0 });
  assert.strictEqual((await GET("config")).round.descentCostC, 0, "an explicit zero must survive");
  await POST("admin/round", { token: admin, mode: "gradient", minutes: 10, descentCost: "0" });
  assert.strictEqual((await GET("config")).round.descentCostC, 0, '"0" from a text field is still zero');
});

await ok("the admin can pin the true minimum, and the curve really bottoms out there", async () => {
  const built = await POST("admin/round", {
    token: admin,
    mode: "gradient",
    difficulty: "diabolical",
    minutes: 10,
    minValue: 317.5,
  });
  assert.strictEqual(built.diagnostics.yStar, 317.5, "the draw was overridden");
  assert.ok(built.diagnostics.ok, "and the curve still passes its self-check");
  assert.ok(built.diagnostics.valueError <= 0.01, "the minimum really is 317.5");
  assert.strictEqual((await GET("admin/inspect", { token: admin })).yStar, 317.5);

  // It settles there, to the cent, like any other round.
  await POST("admin/start", { token: admin, minutes: 10 });
  await POST("admin/end", { token: admin });
  const done = await GET("config");
  assert.strictEqual(done.round.xStar, 317.5);
  assert.strictEqual(done.round.settleC, 31_750);
  const rev = await GET("reveal");
  let low = Infinity;
  for (const [, y] of rev.curve) low = Math.min(low, y);
  assert.ok(Math.abs(low - 317.5) < 1, `the drawn curve bottoms at ${low}`);

  // Out of the settleable range is refused rather than silently clamped.
  await rejects(() => POST("admin/round", { token: admin, mode: "gradient", minutes: 10, minValue: 5000 }), /between/);
  await rejects(() => POST("admin/round", { token: admin, mode: "gradient", minutes: 10, minValue: -20 }), /between/);
});

await ok("neither setting leaks to a player", async () => {
  await POST("admin/round", { token: admin, mode: "gradient", difficulty: "wavy", minutes: 10, minValue: 642.25, keepPlayers: true });
  await POST("admin/start", { token: admin, minutes: 10 });
  // The pinned minimum lives on the spec, and the spec never leaves the server.
  const blob = JSON.stringify(await GET("config")) + JSON.stringify(await GET("board"));
  assert.ok(!blob.includes("642.25"), "the pinned minimum reached a public payload");
  assert.strictEqual((await GET("config")).round.xStar, null);
  // The step price, by contrast, is meant to be visible — you must know what
  // you are being charged.
  assert.strictEqual((await GET("config")).round.descentCostC, 100_000);
});

await ok("a click is ten shares by default, and the admin can set it", async () => {
  assert.strictEqual(LIMITS.defaultOrderSize, 10);
  assert.strictEqual((await GET("config")).round.defaultSize, 10, "rounds carry the default");

  await POST("admin/round", { token: admin, mode: "gradient", difficulty: "wavy", minutes: 10, defaultSize: 3 });
  assert.strictEqual((await GET("config")).round.defaultSize, 3, "and whatever the admin chose");

  // Nonsense is clamped into the tradable range rather than accepted.
  await POST("admin/round", { token: admin, mode: "gradient", minutes: 10, defaultSize: 9999 });
  assert.strictEqual((await GET("config")).round.defaultSize, LIMITS.maxSharesPerOrder);
  await POST("admin/round", { token: admin, mode: "gradient", minutes: 10, defaultSize: 0 });
  assert.strictEqual((await GET("config")).round.defaultSize, 1);

  // It is a default for the click, not a limit on the order.
  await POST("admin/round", { token: admin, mode: "gradient", minutes: 10, defaultSize: 10 });
  const q = await POST("join", { name: "Clicker", deviceId: "device-clicker-00000" });
  await POST("team/create", { ...cred(q), name: "Ten At A Time" });
  await POST("admin/start", { token: admin, minutes: 10 });
  const r = await POST("order", { ...cred(q), side: "B", px: 300, qty: 25 });
  assert.strictEqual(r.resting.qty, 25, "a bigger order is still allowed");
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
        calls.push(POST("descend", { ...cred(p), anchorX: 0, lr: 1 }).catch((e) => e));
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
  const total = lb.reduce((t, r) => t + r.totalC, 0);
  const spent = lb.reduce((t, r) => t + r.spentC, 0);
  assert.strictEqual(total, 60 * START - spent, "the room's money must add up to what it started with, less what it burned");
  for (const row of lb) for (const m of row.members) assert.ok(m.valueC >= 0);
});

await ok("the global reset wipes the game and leaves the admin logged in", async () => {
  const before = await GET("admin/inspect", { token: admin });
  assert.ok(before.players.length > 0, "there is something to wipe");
  await rejects(() => POST("admin/reset", { token: admin }), /confirm/);
  const out = await POST("admin/reset", { token: admin, confirm: "RESET" });
  assert.ok(out.cleared.players > 0);

  // Everything is gone.
  assert.strictEqual((await GET("config")).round, null);
  assert.deepStrictEqual((await GET("leaderboard")).leaderboard, []);
  assert.deepStrictEqual((await GET("history")).history, []);
  await rejects(() => GET("state", cred(pat)), /no round/);

  // But the password still works, and a new round starts clean.
  const still = await POST("admin/auth", { password: "hunter2" });
  assert.strictEqual(still.token, admin, "the admin is not locked out of their own control room");
  await POST("admin/round", { token: admin, mode: "gradient", difficulty: "wavy", minutes: 5 });
  const fresh = await GET("admin/inspect", { token: admin });
  assert.strictEqual(fresh.players.length, 0, "nobody carried over");
  assert.strictEqual(fresh.round.teams, 0);

  // The bit that matters on game day: every phone in the room re-joins on the
  // device it already used. The one-account-per-device binding lives in the
  // document the reset deleted, so the same device must come back clean.
  const again = await POST("join", { name: "Pat", deviceId: "device-pat-11111111" });
  assert.ok(again.playerId, "the same device must be able to join again");
  assert.notStrictEqual(again.playerId, pat.playerId, "and as a brand new account");
  assert.strictEqual((await GET("state", cred(again))).me.teamId, null, "with no team carried over");
  assert.strictEqual((await GET("state", cred(again))).me.cashC, (await GET("config")).round.startCashC);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
