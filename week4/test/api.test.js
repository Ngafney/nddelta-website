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
const { MONEY, MARKETS, LIMITS, DATA, SCENARIO } = await import("../shared/rules.js");

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
let truth;

await ok("health and rules come up, and the rules give away nothing", async () => {
  const h = await GET("health");
  assert.strictEqual(h.ok, true);
  const r = await GET("rules");
  assert.ok(r.rules.length > 400);
  assert.strictEqual(r.markets.length, 2);
  assert.strictEqual(r.book.orderMin, 1);
  assert.strictEqual(r.book.orderMax, 99);
  // Nothing about the answer, the noise, or the trajectory belongs here.
  const blob = JSON.stringify(r).toLowerCase();
  // The market NAMES are public — "impact north of the equator" is the whole
  // point. What must not appear is anything about THIS round's answer or the
  // machinery behind it.
  for (const word of ["impactlat", "relativ", "einstein", "perihelion", "truelat", "y0", "seed"]) {
    assert.ok(!blob.includes(word), `the rules mention "${word}"`);
  }
  assert.ok(!/"winner"/.test(JSON.stringify(r)), "the rules carry a winner field");
});

await ok("the admin logs in and builds a round", async () => {
  const a = await POST("admin/auth", { password: "hunter2" });
  admin = a.token;
  await rejects(() => POST("admin/auth", { password: "nope" }), /wrong password/);

  const built = await POST("admin/round", {
    token: admin,
    seed: "api-test",
    impactLat: 3.5,
    startConfidence: 0.65,
    endConfidence: 0.9,
    stepDays: 30,
  });
  truth = built.truth;
  assert.strictEqual(truth.winner, "north", "a positive latitude has to be a northern impact");
  assert.ok(Math.abs(truth.latDeg - 3.5) < 0.05, `aimed at 3.5°, got ${truth.latDeg}`);
  assert.ok(truth.physics.perihelionSolarRadii < 20, "the asteroid has to actually graze the Sun");
  assert.ok(truth.physics.passes >= 3, "it needs several solar passes for relativity to bite");
  assert.strictEqual(built.round.status, "lobby");
  assert.strictEqual(built.round.released, 0, "no data is out before the operator starts");
});

await ok("a southern aim wins the southern book", async () => {
  const built = await POST("admin/round", { token: admin, seed: "api-south", impactLat: -2.5 });
  assert.strictEqual(built.truth.winner, "south");
  assert.ok(built.truth.latDeg < 0);
  // put the real round back
  const again = await POST("admin/round", { token: admin, seed: "api-test", impactLat: 3.5, stepDays: 30 });
  truth = again.truth;
});

await ok("the noise level is chosen from a confidence, and the round says what it got", async () => {
  const c = truth.calibration;
  assert.ok(c.releases.length >= 5, `expected several releases, got ${c.releases.length}`);
  assert.ok(Math.abs(c.releases[0].confidence - 0.65) < 0.02, `first release sits at ${c.releases[0].confidence}`);
  // Confidence must never go DOWN as more of the record arrives.
  for (let i = 1; i < c.releases.length; i++) {
    assert.ok(
      c.releases[i].confidence >= c.releases[i - 1].confidence - 1e-9,
      `release ${i} is less convincing than release ${i - 1}`
    );
  }
  const last = c.releases[c.releases.length - 1].confidence;
  assert.ok(last > 0.8, `the final release only reaches ${(last * 100).toFixed(1)}%`);
  // The survey improving over the record is the second axis of the noise
  // model. It has to be a real improvement, and not an absurd one.
  assert.ok(c.surveyImprovement > 2, `the survey barely improved (${c.surveyImprovement.toFixed(1)}×)`);
  assert.ok(c.surveyImprovement < 5000, `the survey improved ${c.surveyImprovement.toFixed(0)}× — not believable`);
});

let alice, bob, carol;

await ok("players join, form teams, and one device is one account", async () => {
  alice = await POST("join", { name: "Alice", deviceId: "device-alice-0001" });
  bob = await POST("join", { name: "Bob", deviceId: "device-bob-00001" });
  carol = await POST("join", { name: "Carol", deviceId: "device-carol-001" });
  const again = await POST("join", { name: "Alice", deviceId: "device-alice-0001" });
  assert.strictEqual(again.playerId, alice.playerId, "the same device must be the same account");
  assert.strictEqual(again.rejoined, true);

  await POST("team/create", { ...cred(alice), name: "Ephemeris" });
  const t = await POST("team/create", { ...cred(bob), name: "Perihelion" });
  await POST("team/join", { ...cred(carol), code: t.team.code });
  const st = await GET("state", cred(carol));
  assert.strictEqual(st.team.name, "Perihelion");
  assert.strictEqual(st.me.cashC, MONEY.startCashC);
  for (const m of MARKETS) assert.strictEqual(st.me.pos[m], 0);
});

await ok("no data before the operator releases any", async () => {
  await rejects(() => GET("data", cred(alice)), /released yet|not ready/i);
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.round.released, 0);
  assert.strictEqual(st.round.observationCount, 0);
});

await ok("research opens, the first release lands, and the books stay shut", async () => {
  await POST("admin/start", { token: admin, minutes: 30 });
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.round.status, "research");
  assert.strictEqual(st.round.released, 1);
  assert.ok(st.round.observationCount > 100, "the opening record should be substantial");
  // Trading is not allowed yet.
  await rejects(() => POST("order", { ...cred(alice), market: "north", side: "B", px: 50, qty: 1 }), /books are shut/);
});

await ok("the release stops exactly where it should, and hides the rest", async () => {
  const d = await GET("data", cred(alice));
  const impact = d.impactDay;
  const cut = d.cutDay;
  assert.ok(Math.abs(impact - cut - DATA.firstCutDays) < 1e-6, `first cut should be ${DATA.firstCutDays} days out`);
  for (const row of d.rows) {
    assert.ok(row.day <= cut + 1e-9, `row at day ${row.day} is past the cut at ${cut}`);
  }
  assert.ok(d.rows.every((r) => r.sigmaAu > 0), "every row needs an error bar");
  assert.strictEqual(d.masses.length, 3);
});

await ok("the download is a real CSV with the masses in the header", async () => {
  const csv = await GET("data.csv", cred(alice));
  assert.ok(csv.__contentType.startsWith("text/csv"));
  assert.ok(csv.__filename.endsWith(".csv"));
  const lines = csv.__raw.split("\n");
  const header = lines.find((l) => l.startsWith("day,"));
  assert.ok(header, "no column header");
  assert.deepStrictEqual(header.split(",").slice(0, 4), ["day", "sun_x", "sun_y", "sun_z"]);
  assert.ok(lines.some((l) => l.includes("mass_sun_kg")), "the masses have to travel with the data");
  assert.ok(lines.some((l) => l.includes("mass_asteroid_kg")));
  const body = lines.filter((l) => !l.startsWith("#") && l.includes(",") && !l.startsWith("day,"));
  assert.ok(body.length > 100, `only ${body.length} data rows`);
  assert.strictEqual(body[0].split(",").length, 11);
});

await ok("nothing a player can reach names the answer", async () => {
  const blobs = [
    JSON.stringify(await GET("state", cred(alice))),
    JSON.stringify(await GET("config")),
    JSON.stringify(await GET("board")),
    JSON.stringify(await GET("leaderboard")),
    JSON.stringify(await GET("data", cred(alice))),
    (await GET("data.csv", cred(alice))).__raw,
  ].join("|");
  assert.ok(!/"winner":"(north|south)"/.test(blobs), "the winning side leaked");
  assert.ok(!blobs.includes("impactLatDeg"), "the true latitude leaked");
  assert.ok(!blobs.includes("relativisticDrift"), "the physics summary leaked");
  assert.ok(!blobs.includes(String(truth.latDeg)), "the exact latitude appears somewhere public");
  await rejects(() => GET("reveal"), /not yet/);
});

await ok("an unreleased row cannot be fetched by asking nicely", async () => {
  const before = (await GET("data", cred(alice))).rows.length;
  // There is no parameter for "give me more", and inventing one changes nothing.
  const sneaky = await GET("data", { ...cred(alice), released: 99, upto: 9999, cutDay: 9999 });
  assert.strictEqual(sneaky.rows.length, before, "a query parameter must not widen the release");
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

await ok("each release adds rows and the operator runs out eventually", async () => {
  let last = (await GET("data", cred(alice))).rows.length;
  const total = (await GET("config")).round.releaseCount;
  for (let i = 1; i < total; i++) {
    const out = await POST("admin/release", { token: admin });
    assert.strictEqual(out.released, i + 1);
    const n = (await GET("data", cred(alice))).rows.length;
    assert.ok(n > last, `release ${i + 1} added nothing`);
    last = n;
  }
  await rejects(() => POST("admin/release", { token: admin }), /already out/);
});

await ok("the last release still stops short of the impact", async () => {
  const d = await GET("data", cred(alice));
  const gap = d.impactDay - d.cutDay;
  assert.ok(gap >= DATA.defaultStepDays - 1e-6, `the final month must stay hidden, gap was ${gap} days`);
  assert.ok(d.rows.every((r) => r.day <= d.cutDay + 1e-9));
});

await ok("the asteroid lands, everything settles, and the reveal opens", async () => {
  await POST("admin/end", { token: admin });
  const cfg = await GET("config");
  assert.strictEqual(cfg.round.status, "settled");
  assert.strictEqual(cfg.round.winner, truth.winner, "the public winner has to match what was built");

  const rev = await GET("reveal");
  assert.strictEqual(rev.winner, "north");
  assert.ok(Math.abs(rev.latDeg - truth.latDeg) < 1e-9);
  assert.ok(rev.track.length > 100, "the reveal needs a path to draw");
  assert.strictEqual(rev.track[0].length, 9, "three bodies, three coordinates each");
  assert.strictEqual(rev.track.length, rev.trackDays.length);
  assert.ok(rev.physics.relativisticDriftKm > 1000, "relativity has to have mattered");
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
  assert.strictEqual(h.history[0].winner, "north");
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
