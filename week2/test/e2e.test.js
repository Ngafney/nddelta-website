/**
 * End-to-end over real HTTP: boots serve.js on a spare port exactly as event
 * day would, then plays a whole round through the same URLs the browser uses —
 * static assets, the SPA fallback for /admin and /board, and every API call
 * from admin login to the reveal.
 *
 * Run: npm run test:e2e  (in week2/)
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
async function ok(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 3).join("\n      ")}`);
  }
}

if (!fs.existsSync(path.join(root, "..", "public", "week2", "index.html"))) {
  console.log("\n  ! build the app first (npm run build) — skipping e2e\n");
  process.exit(0);
}

/* ── boot ─────────────────────────────────────────────────────────────── */

const dataFile = path.join(root, ".data", "e2e-kv.json");
try {
  fs.unlinkSync(dataFile);
} catch {}

const server = spawn(process.execPath, ["serve.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    KV_FORCE_MEMORY: "1",
    SESSION_SECRET: "e2e-secret-not-for-production",
    ADMIN_PASSWORD: "letmein",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitForBoot() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/week2/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server never came up:\n${serverLog}`);
}
await waitForBoot();

const GET = async (p, q) => {
  const url = new URL(`${BASE}/api/week2/${p}`);
  for (const [k, v] of Object.entries(q ?? {})) url.searchParams.set(k, v);
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status, code: j.code });
  return j;
};
const POST = async (p, body) => {
  const r = await fetch(`${BASE}/api/week2/${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status, code: j.code });
  return j;
};
const cred = (p) => ({ playerId: p.playerId, token: p.token });

/* ── the pages ────────────────────────────────────────────────────────── */

console.log("\nserving");

await ok("the app, the admin page and the big board all serve", async () => {
  for (const p of ["/week2/", "/week2/admin", "/week2/board"]) {
    const r = await fetch(`${BASE}${p}`);
    assert.strictEqual(r.status, 200, p);
    const html = await r.text();
    assert.ok(html.includes('<div id="root">'), `${p} should serve the SPA shell`);
    assert.ok(/assets\/index-.*\.js/.test(html), `${p} should reference the built bundle`);
  }
  const bare = await fetch(`${BASE}/`, { redirect: "manual" });
  assert.strictEqual(bare.status, 302);
});

await ok("the bundle, the stylesheet and the font are all reachable", async () => {
  const html = await (await fetch(`${BASE}/week2/`)).text();
  const js = html.match(/\/week2\/(assets\/index-[^"]+\.js)/)[1];
  const css = html.match(/\/week2\/(assets\/index-[^"]+\.css)/)[1];
  for (const [asset, type] of [
    [js, "text/javascript"],
    [css, "text/css"],
    ["fonts/press-start-2p.ttf", "font/ttf"],
  ]) {
    const r = await fetch(`${BASE}/week2/${asset}`);
    assert.strictEqual(r.status, 200, asset);
    assert.ok(r.headers.get("content-type").startsWith(type), `${asset} → ${r.headers.get("content-type")}`);
  }
});

await ok("path traversal out of the static root is refused", async () => {
  // fetch() normalizes "../" away before it leaves, so the interesting case is
  // the percent-encoded one, which arrives at the server intact.
  for (const attack of ["/week2/../../package.json", "/week2/%2e%2e%2f%2e%2e%2fpackage.json", "/week2/..%2f..%2f.env"]) {
    const r = await fetch(`${BASE}${attack}`, { redirect: "manual" });
    const body = r.status === 200 ? await r.text() : "";
    assert.ok(
      r.status === 403 || r.status === 404 || body.includes('<div id="root">'),
      `${attack} returned ${r.status} with ${body.slice(0, 60)}`
    );
    assert.ok(!body.includes("SESSION_SECRET"), `${attack} leaked the environment`);
    assert.ok(!body.includes('"nddelta-week2"'), `${attack} leaked package.json`);
  }
});

/* ── a whole round ────────────────────────────────────────────────────── */

console.log("\na complete round");

let admin;
let alice;
let bob;
let code;

await ok("the admin logs in and builds a round", async () => {
  admin = (await POST("admin/auth", { password: "letmein" })).token;
  const r = await POST("admin/round", { token: admin, mode: "gradient", difficulty: "wavy", minutes: 20 });
  assert.ok(r.diagnostics.ok);
  assert.strictEqual((await GET("config")).round.status, "lobby");
});

await ok("two players join, make a team and get their opening points", async () => {
  alice = await POST("join", { name: "Alice", deviceId: "e2e-alice-device", fp: "fpa" });
  bob = await POST("join", { name: "Bob", deviceId: "e2e-bob-device", fp: "fpb" });
  code = (await POST("team/create", { ...cred(alice), name: "Gradient Descent" })).code;
  await POST("team/join", { ...cred(bob), code });
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.team.size, 2);
  assert.strictEqual(st.me.points.length, 1);
  assert.strictEqual(st.me.cashC, 10_000_000);
});

await ok("the market opens and a trade prints", async () => {
  await POST("admin/start", { token: admin, minutes: 20 });
  await POST("order", { ...cred(alice), side: "B", px: 450, qty: 3 });
  const hit = await POST("order", { ...cred(bob), side: "A", px: 450, qty: 3 });
  assert.strictEqual(hit.filled, 3);
  const st = await GET("state", { ...cred(alice), since: 0 });
  assert.strictEqual(st.market.last, 450);
  assert.strictEqual(st.me.pos, 3);
  assert.strictEqual(st.fills.length, 1);
  assert.strictEqual(st.market.bids.length + st.market.asks.length, 0, "both sides consumed");
});

await ok("buying a point costs 5% and shows up on the chart", async () => {
  const before = await GET("state", cred(alice));
  const anchor = before.me.points[0].x;
  const r = await POST("probe", { ...cred(alice), anchorX: anchor, offset: anchor > 500 ? -200 : 200 });
  assert.strictEqual(r.costC, before.me.probeCostC);
  const after = await GET("state", cred(alice));
  assert.strictEqual(after.me.points.length, 2);
  assert.strictEqual(after.me.cashC, before.me.cashC - r.costC);
  assert.ok(Number.isFinite(r.point.d), "the new point carries a real gradient");
});

await ok("one step of gradient descent costs a flat $1,000 and goes downhill", async () => {
  const before = await GET("state", cred(alice));
  const from = before.me.points.find((p) => Math.abs(p.d) > 1e-9) ?? before.me.points[0];
  assert.strictEqual(before.me.descentCostC, 100_000);
  const lr = 2 / Math.abs(from.d); // small enough that downhill is guaranteed
  const r = await POST("descend", { ...cred(alice), anchorX: from.x, lr });
  assert.strictEqual(r.costC, before.me.descentCostC);
  assert.ok(Math.abs(r.point.x - (from.x - lr * from.d)) < 0.02, "it lands exactly where it said it would");
  assert.ok(r.point.y < from.y, "and it goes down");
});

await ok("the leaderboard is by team and reachable without credentials", async () => {
  const lb = (await GET("leaderboard")).leaderboard;
  assert.strictEqual(lb.length, 1);
  assert.strictEqual(lb[0].name, "Gradient Descent");
  assert.strictEqual(lb[0].size, 2);
  const board = await GET("board");
  assert.ok(board.market);
  assert.strictEqual(board.round.xStar, null, "the big board must not leak the answer either");
  const blob = JSON.stringify(board) + JSON.stringify(await GET("config"));
  for (const leak of ["settleMin", "settleMax", "orderMin", "orderMax", "terms", "yScale"]) {
    assert.ok(!blob.includes(leak), `a public payload leaks ${leak}`);
  }
});

await ok("the bell settles it and the reveal opens", async () => {
  const truth = (await GET("admin/inspect", { token: admin })).xStar;
  await POST("admin/end", { token: admin });
  const cfg = await GET("config");
  assert.strictEqual(cfg.round.status, "settled");
  const rev = await GET("reveal");
  assert.strictEqual(rev.xStar, truth);
  assert.ok(rev.curve.length > 600, "the reveal ships a drawable curve");
  // the curve really does bottom out at x*
  let bx = 0;
  let by = Infinity;
  for (const [x, y] of rev.curve) {
    if (y < by) {
      by = y;
      bx = x;
    }
  }
  assert.ok(Math.abs(bx - truth) < 3, `the drawn curve bottoms at ${bx}, x* is ${truth}`);
  const health = await GET("health");
  assert.deepStrictEqual(health.audit, []);
});

/* ── the other mode, over HTTP ────────────────────────────────────────── */

console.log("\nprediction mode");

await ok("a prediction round runs and resolves where the admin says", async () => {
  await POST("admin/round", { token: admin, mode: "prediction", question: "Snow by Friday?", minutes: 5, keepPlayers: true });
  await POST("admin/start", { token: admin, minutes: 5 });
  const st = await GET("state", cred(alice));
  assert.strictEqual(st.me.points.length, 0, "no curve, no points");
  assert.strictEqual(st.round.question, "Snow by Friday?");
  await POST("order", { ...cred(alice), side: "B", px: 60, qty: 2 });
  await POST("order", { ...cred(bob), side: "A", px: 60, qty: 2 });
  await POST("admin/end", { token: admin });
  assert.strictEqual((await GET("config")).round.status, "ended");
  await POST("admin/resolve", { token: admin, value: 100 });
  const after = await GET("state", cred(alice));
  assert.strictEqual(after.round.xStar, 100);
  assert.strictEqual(after.me.cashC, st.me.cashC - 2 * 6_000 + 2 * 10_000);
  assert.deepStrictEqual((await GET("health")).audit, []);
});

/* ── teardown ─────────────────────────────────────────────────────────── */

server.kill();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
