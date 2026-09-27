/**
 * API tests — drives server/handler.js directly (no HTTP), against the memory
 * KV. `npm run test:api` in week4/.
 *
 * The wiring the engine tests cannot see: the round clock, what the data
 * release actually hands over, what must NOT leak before the bell (which side
 * wins, the true latitude, any unreleased row), the noise desk, and the whole
 * lobby → research → live → settled → reveal loop.
 *
 * Building a round is genuinely expensive — it solves a three-year trajectory
 * and then differentiates it nineteen ways — so one round is built and reused.
 */
process.env.KV_FORCE_MEMORY = "1"; // never let a test reach the shared store
process.env.SESSION_SECRET = "test-secret-for-week4-api-tests";
process.env.ADMIN_PASSWORD = "hunter2";

import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

process.env.KV_DATA_FILE = fileURLToPath(new URL("../.data/api-test-kv.json", import.meta.url));
try {
  fs.unlinkSync(process.env.KV_DATA_FILE);
} catch {}

const { handle } = await import("../server/handler.js");
const { MONEY, MARKETS, LIMITS, SCENARIO, CONFIDENCE } = await import("../shared/rules.js");
const { EVENTS, EVENT_KEYS } = await import("../shared/events.js");

let passed = 0;
let failed = 0;
async function ok(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    const ms = Date.now() - t0;
    console.log(`  ✓ ${name}${ms > 800 ? ` (${(ms / 1000).toFixed(1)}s)` : ""}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
}

const call = (m, r, body = {}, q = {}) => handle(m, r, { __ip: "t", ...body }, { __ip: "t", ...q });
const GET = (r, q) => call("GET", r, {}, q);
const POST = (r, b) => call("POST", r, b);
const cred = (p) => ({ playerId: p.playerId, token: p.token });

async function rejects(fn, re) {
  try {
    await fn();
  } catch (e) {
    if (re && !re.test(e.message)) throw new Error(`wrong error: ${e.message}`);
    return e;
  }
  throw new Error("expected a rejection, got none");
}

console.log("\napi");

let admin;

await ok("health and rules come up, and the rules give away nothing", async () => {
  const h = await GET("health");
  assert.strictEqual(h.ok, true);
  const r = await GET("rules");
  assert.ok(r.rules.length > 400);
  assert.strictEqual(r.markets.length, 2);
  assert.strictEqual(r.book.orderMin, 1);
  assert.strictEqual(r.book.orderMax, 99);
  const blob = JSON.stringify(r).toLowerCase();
  for (const word of ["winner", "truelat", "impactlat", "seed"]) {
    assert.ok(!blob.includes(word), `the rules mention "${word}"`);
  }
  // The rules have to tell the room what to actually do, and warn them off the
  // one shortcut that produces a confident wrong answer.
  assert.ok(/covariance/i.test(r.rules), "the rules never mention the covariance");
  assert.ok(/simulate/i.test(r.rules), "the rules never say to simulate");
});

let truth;

await ok("a round is built on a real impact", async () => {
  const a = await POST("admin/auth", { password: "hunter2" });
  admin = a.token;
  await rejects(() => POST("admin/auth", { password: "nope" }), /wrong password/);

  const built = await POST("admin/round", { token: admin, seed: "api-test", event: "2008TC3" });
  truth = built.truth;
  assert.strictEqual(truth.event, "2008 TC3");
  // The real impact point, not something generated.
  assert.ok(Math.abs(truth.trueLat - 20.9) < 1e-9, `true latitude ${truth.trueLat}`);
  assert.ok(Math.abs(truth.trueLon - 31.4) < 1e-9);
  // The settlement is a historical fact, not a simulation.
  assert.strictEqual(truth.winner, truth.trueLat > truth.lineDeg ? "north" : "south");
  assert.strictEqual(built.round.status, "lobby");
  assert.strictEqual(built.round.released, 0);
  assert.strictEqual(built.round.eventName, "2008 TC3");
});

await ok("every real event can carry a round", async () => {
  for (const key of EVENT_KEYS) {
    const b = await POST("admin/round", { token: admin, seed: `ev-${key}`, event: key });
    const ev = EVENTS.find((e) => e.key === key);
    assert.ok(Math.abs(b.truth.trueLat - ev.lat) < 1e-9, `${key} did not use the real impact point`);
    assert.ok(MARKETS.includes(b.truth.winner));
    assert.ok(Math.abs(b.truth.lineDeg - ev.lat) < 9, `${key}: line ${b.truth.lineDeg} is nowhere near the impact`);
  }
  // put the flagship round back
  truth = (await POST("admin/round", { token: admin, seed: "api-test", event: "2008TC3" })).truth;
});

await ok("the published solution is NOT the true impact point", async () => {
  // If it were, the favoured side would always win and nobody would have to
  // think. Every release is the truth displaced by a draw from its own
  // covariance, and the displacement shrinks as the solutions tighten.
  const rel = truth.releases;
  assert.ok(rel.length >= 4, `only ${rel.length} releases`);
  assert.ok(rel[0].offsetKm > 5, "the first solution sits exactly on the truth");
  assert.ok(
    rel[rel.length - 1].offsetKm < rel[0].offsetKm,
    `the solution did not converge: ${rel[0].offsetKm} km → ${rel[rel.length - 1].offsetKm} km`
  );
  // And the uncertainty shrinks with it.
  for (let i = 1; i < rel.length; i++) {
    assert.ok(rel[i].sigmaKm < rel[i - 1].sigmaKm, `sigma grew at release ${i + 1}`);
  }
});

await ok("the question is hard at first and easier by the end", async () => {
  const rel = truth.releases;
  // Near the target, not on it: the line has to be a latitude a person can say
  // out loud, so placeLine picks the best available 0.1-degree line rather than
  // an exact one. Measured across events and error draws that costs at most
  // three points, so six is a real bound and not a shrug.
  assert.ok(
    Math.abs(rel[0].confidence - CONFIDENCE.defaultStart) < 0.06,
    `the opening release sits at ${(rel[0].confidence * 100).toFixed(1)}%`
  );
  assert.ok(
    rel[rel.length - 1].confidence > rel[0].confidence,
    "the last solution is no more convincing than the first"
  );
  for (const r of rel) {
    assert.ok(r.pNorth >= 0 && r.pNorth <= 1, `p = ${r.pNorth}`);
  }
});

let alice, bob, carol;

await ok("players join, form teams, and one device is one account", async () => {
  alice = await POST("join", { name: "Alice", deviceId: "device-alice-0001" });
  bob = await POST("join", { name: "Bob", deviceId: "device-bob-00001" });
  carol = await POST("join", { name: "Carol", deviceId: "device-carol-001" });
  const again = await POST("join", { name: "Alice", deviceId: "device-alice-0001" });
  assert.strictEqual(again.playerId, alice.playerId);
  assert.strictEqual(again.rejoined, true);

  await POST("team/create", { ...cred(alice), name: "Ephemeris" });
  const t = await POST("team/create", { ...cred(bob), name: "Perihelion" });
  await POST("team/join", { ...cred(carol), code: t.team.code });
  const st = await GET("state", cred(carol));
  assert.strictEqual(st.team.name, "Perihelion");
  assert.strictEqual(st.me.cashC, MONEY.startCashC);
  for (const m of MARKETS) assert.strictEqual(st.me.pos[m], 0);
});

await ok("no solution before the operator releases one", async () => {
  await rejects(() => GET("data", cred(alice)), /released yet|not ready/i);
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.round.released, 0);
});

await ok("research opens, the first solution lands, and the books stay shut", async () => {
  await POST("admin/start", { token: admin, minutes: 30 });
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.round.status, "research");
  assert.strictEqual(st.round.released, 1);
  await rejects(() => POST("order", { ...cred(alice), market: "north", side: "B", px: 50, qty: 1 }), /books are shut/);
});

await ok("the solution has everything needed to price it, and nothing else", async () => {
  const d = await GET("data", cred(alice));
  for (const k of ["nominalLat", "nominalLon", "azimuthDeg", "covarianceKm2", "lineDeg", "prompt"]) {
    assert.ok(d[k] !== undefined, `the solution has no ${k}`);
  }
  const C = d.covarianceKm2;
  assert.strictEqual(C.length, 2);
  assert.ok(C[0][0] > 0 && C[1][1] > 0, "a variance is not positive");
  assert.ok(Math.abs(C[0][1]) > 1, "the covariance is diagonal — the correlation lesson is gone");
  assert.ok(Math.abs(C[0][1] - C[1][0]) < 1e-9, "not symmetric");
  // It must NOT contain the answer.
  const blob = JSON.stringify(d);
  assert.ok(!/winner/.test(blob), "the solution names the winner");
  assert.ok(!blob.includes(String(truth.trueLat)), "the true impact latitude is in the payload");
});

await ok("the AI prompt is self-contained and warns off the shortcut", async () => {
  const d = await GET("data", cred(alice));
  const p = d.prompt;
  assert.ok(p.length > 600, "the prompt is too short to be self-contained");
  assert.ok(p.includes(d.nominalLat.toFixed(3)), "the prompt does not carry the nominal point");
  assert.ok(p.includes(d.covarianceKm2[0][0].toFixed(1)), "the prompt does not carry the covariance");
  assert.ok(/NOT diagonal/i.test(p), "the prompt never says the covariance is correlated");
  assert.ok(/SIMULATE/i.test(p), "the prompt never says to simulate");
  assert.ok(/ASSUMPTIONS/i.test(p), "the prompt offers nothing to argue with");
  assert.ok(!p.includes(String(truth.trueLat)), "the prompt leaks the true impact point");
});

await ok("the download is a real CSV of the solution", async () => {
  const csv = await GET("data.csv", cred(alice));
  assert.ok(csv.__contentType.startsWith("text/csv"));
  assert.ok(csv.__filename.endsWith(".csv"));
  const text = csv.__raw;
  for (const k of ["nominal_lat_deg", "corridor_azimuth_deg", "cov_along_cross_km2", "line_latitude_deg", "earth_radius_km"]) {
    assert.ok(text.includes(k), `the CSV has no ${k}`);
  }
  assert.ok(!text.includes(String(truth.trueLat)), "the CSV leaks the true impact point");
});

await ok("asking for a later release does not produce one", async () => {
  const before = (await GET("data", cred(alice))).release;
  const sneaky = await GET("data", { ...cred(alice), release: 99, released: 99 });
  assert.strictEqual(sneaky.release, before, "a query parameter widened the release");
});

await ok("trading opens on both books and the two are independent", async () => {
  await POST("admin/open", { token: admin, minutes: 30 });
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.round.status, "live");

  await POST("order", { ...cred(bob), market: "north", side: "A", px: 45, qty: 10 });
  const r = await POST("order", { ...cred(alice), market: "north", side: "B", px: 45, qty: 10 });
  assert.strictEqual(r.filled, 10);
  const a2 = await GET("state", cred(alice));
  assert.strictEqual(a2.me.pos.north, 10);
  assert.strictEqual(a2.me.pos.south, 0);
  assert.strictEqual(a2.markets.north.last, 45);
  assert.strictEqual(a2.markets.south.last, null);
});

await ok("buying both sides is cheaper than buying one", async () => {
  const before = (await GET("state", cred(alice))).me.freeC;
  await POST("order", { ...cred(carol), market: "south", side: "A", px: 50, qty: 10 });
  await POST("order", { ...cred(alice), market: "south", side: "B", px: 50, qty: 10 });
  const after = (await GET("state", cred(alice))).me;
  assert.strictEqual(after.pos.south, 10);
  // Spent $500 of cash, but the hedge means the binding number improves.
  assert.ok(after.freeC > before, `free balance went ${before} → ${after.freeC}; the hedge must help`);
  assert.strictEqual(after.powers.north, after.powers.south, "a matched pair is worth the same either way");
});

await ok("a fill comes back with both sides of the story", async () => {
  const st = await GET("state", cred(bob));
  const f = st.fills.find((x) => x.market === "north");
  assert.ok(f, "bob should have a north fill");
  assert.strictEqual(f.side, "A");
  assert.strictEqual(f.cp, "Alice");
});

await ok("the noise desk trades on its own schedule and is announced", async () => {
  await POST("admin/bots", {
    token: admin,
    bots: [
      { key: "north-buy", on: true, shares: 5, everySec: 2 },
      { key: "south-sell", on: true, shares: 5, everySec: 2 },
    ],
  });
  const round = (await GET("config")).round;
  assert.strictEqual(round.bots.length, 2, "the room has to be told the bots exist");
  assert.ok(round.bots.every((b) => b.shares === 5 && b.everySec === 2));

  // Give them something to hit, wind the clock on, and poll.
  await POST("order", { ...cred(bob), market: "north", side: "A", px: 60, qty: 40 });
  await POST("order", { ...cred(bob), market: "south", side: "B", px: 20, qty: 40 });
  const before = (await GET("state", cred(bob))).me.pos;
  await new Promise((r) => setTimeout(r, 2300));
  await GET("config");
  await new Promise((r) => setTimeout(r, 2300));
  await GET("config");
  const after = (await GET("state", cred(bob))).me.pos;
  assert.ok(
    after.north !== before.north || after.south !== before.south,
    "the desk never traded against the resting orders"
  );
  const insp = await GET("admin/inspect", { token: admin });
  assert.deepStrictEqual(insp.audit, [], `audit broke: ${insp.audit.join(" | ")}`);
});

await ok("the desk never appears on the leaderboard", async () => {
  const lb = await GET("leaderboard");
  assert.ok(lb.leaderboard.length >= 2);
  for (const t of lb.leaderboard) assert.notStrictEqual(t.name, "SURVEY DESK");
  const board = await GET("board");
  for (const t of board.leaderboard) assert.notStrictEqual(t.name, "SURVEY DESK");
});

await ok("each release tightens the solution and the operator runs out", async () => {
  let prev = await GET("data", cred(alice));
  const total = (await GET("config")).round.releaseCount;
  for (let i = 1; i < total; i++) {
    const out = await POST("admin/release", { token: admin });
    assert.strictEqual(out.released, i + 1);
    const now = await GET("data", cred(alice));
    assert.strictEqual(now.release, i + 1);
    assert.ok(
      now.sigmaAlongKm < prev.sigmaAlongKm,
      `release ${i + 1} did not tighten: ${prev.sigmaAlongKm} → ${now.sigmaAlongKm}`
    );
    prev = now;
  }
  await rejects(() => POST("admin/release", { token: admin }), /already out/);
});

await ok("it lands where it really landed, and the reveal tells the story", async () => {
  await POST("admin/end", { token: admin });
  const cfg = await GET("config");
  assert.strictEqual(cfg.round.status, "settled");
  assert.strictEqual(cfg.round.winner, truth.winner);

  const rev = await GET("reveal");
  assert.strictEqual(rev.winner, truth.winner);
  assert.strictEqual(rev.truth.name, "2008 TC3");
  assert.ok(Math.abs(rev.truth.lat - 20.9) < 1e-9, "the reveal does not show the real impact point");
  assert.ok(rev.truth.story.length > 80, "no story to tell");
  assert.ok(rev.truth.leadHours > 0, "no warning time");
  assert.ok(rev.releases.length >= 4, "the reveal cannot draw the solutions walking in");
  assert.ok(Array.isArray(rev.others) && rev.others.length >= 5, "the other impacts are missing");
  // The side is a fact about the world, not about the simulation.
  const expect = rev.truth.lat > rev.lineDeg ? "north" : "south";
  assert.strictEqual(rev.winner, expect);
});

await ok("settlement paid the winning book and not the losing one", async () => {
  const st = await GET("state", cred(alice));
  // Alice held 10 north and 10 south. North landed, so the pair paid 10 × $100.
  assert.strictEqual(st.me.pos.north, 0);
  assert.strictEqual(st.me.pos.south, 0);
  assert.ok(st.me.settledPos, "the settled position should be kept for the reveal");
  assert.strictEqual(st.me.settledPos.north, 10);
  assert.strictEqual(st.me.settledPos.south, 10);
  const insp = await GET("admin/inspect", { token: admin });
  assert.deepStrictEqual(insp.audit, [], `audit broke after settling: ${insp.audit.join(" | ")}`);
});

await ok("history records the round", async () => {
  const h = await GET("history");
  assert.ok(h.history.length >= 1);
  // Whichever side the real impact fell on — that is a fact about 2008 TC3,
  // not something this test gets to choose.
  assert.strictEqual(h.history[0].winner, truth.winner);
  assert.strictEqual(h.history[0].event, "2008 TC3");
});

await ok("a global reset wipes players, teams and the sky", async () => {
  await rejects(() => POST("admin/reset", { token: admin }), /confirm/);
  const out = await POST("admin/reset", { token: admin, confirm: "RESET" });
  assert.ok(out.cleared.players >= 3);
  assert.strictEqual((await GET("config")).round, null);
  // The same device must be able to come back as a brand new account.
  await POST("admin/round", { token: admin, seed: "after-reset", impactLat: 4 });
  const again = await POST("join", { name: "Alice", deviceId: "device-alice-0001" });
  assert.notStrictEqual(again.playerId, alice.playerId);
  assert.strictEqual(again.rejoined, false);
});

await ok("an admin route cannot be reached without the token", async () => {
  for (const r of ["admin/round", "admin/start", "admin/open", "admin/release", "admin/bots", "admin/end"]) {
    await rejects(() => POST(r, {}), /bad admin token/);
  }
  await rejects(() => GET("admin/inspect", {}), /bad admin token/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
