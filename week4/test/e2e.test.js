/**
 * End-to-end over real HTTP: boots serve.js on a spare port exactly as event
 * day would, then plays a whole round through the same URLs the browser uses —
 * static assets, the SPA fallback for /admin and /board, and every API call
 * from admin login to the reveal.
 *
 * Run: npm run test:e2e  (in week4/)
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const PORT = 8133;
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

if (!fs.existsSync(path.join(root, "..", "public", "week4", "index.html"))) {
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
    KV_DATA_FILE: dataFile,
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
      const r = await fetch(`${BASE}/api/week4/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server never came up:\n${serverLog}`);
}
await waitForBoot();

const get = async (p) => {
  const r = await fetch(`${BASE}${p}`);
  return { status: r.status, text: await r.text(), type: r.headers.get("content-type") };
};
const api = async (method, route, body) => {
  const r = await fetch(`${BASE}/api/week4/${route}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error), { status: r.status });
  return data;
};

console.log("\ne2e over http");

await ok("the app, its assets and the SPA fallback are served", async () => {
  const index = await get("/week4/");
  assert.strictEqual(index.status, 200);
  const js = index.text.match(/src="(\/week4\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(js, "no script tag in the served page");
  assert.strictEqual((await get(js)).status, 200);
  // /admin and /board are client routes, so the SPA page has to come back.
  for (const p of ["/week4/admin", "/week4/board"]) {
    const r = await get(p);
    assert.strictEqual(r.status, 200, `${p} did not serve the app`);
    assert.ok(r.text.includes("/week4/assets/"), `${p} did not serve the SPA`);
  }
});

await ok("a whole round plays through over HTTP, from build to reveal", async () => {
  const { token } = await api("POST", "admin/auth", { password: "letmein" });
  const built = await api("POST", "admin/round", { token, seed: "e2e", impactLat: 4.25, stepDays: 60 });
  assert.strictEqual(built.truth.winner, "north");

  const a = await api("POST", "join", { name: "Ada", deviceId: "e2e-device-ada" });
  const b = await api("POST", "join", { name: "Bo", deviceId: "e2e-device-bo0" });
  const t = await api("POST", "team/create", { playerId: a.playerId, token: a.token, name: "E2E" });
  await api("POST", "team/join", { playerId: b.playerId, token: b.token, code: t.team.code });

  // Research first: data out, books shut.
  await api("POST", "admin/start", { token, minutes: 30 });
  const cred = `playerId=${a.playerId}&token=${a.token}`;
  const s1 = await api("GET", `state?${cred}`);
  assert.strictEqual(s1.round.status, "research");
  assert.strictEqual(s1.round.released, 1);

  // The download is a real file, over real HTTP, with real headers.
  const csv = await get(`/api/week4/data.csv?${cred}`);
  assert.strictEqual(csv.status, 200);
  assert.match(csv.type ?? "", /text\/csv/);
  assert.ok(csv.text.split("\n").filter((l) => l && !l.startsWith("#")).length > 100, "the CSV is too short");
  assert.ok(csv.text.includes("mass_sun_kg"), "the masses are missing from the download");

  // Then the books.
  await api("POST", "admin/open", { token, minutes: 30 });
  await api("POST", "order", { playerId: b.playerId, token: b.token, market: "north", side: "A", px: 60, qty: 5 });
  await api("POST", "order", { playerId: a.playerId, token: a.token, market: "north", side: "B", px: 60, qty: 5 });
  await api("POST", "order", { playerId: b.playerId, token: b.token, market: "south", side: "A", px: 35, qty: 5 });
  await api("POST", "order", { playerId: a.playerId, token: a.token, market: "south", side: "B", px: 35, qty: 5 });

  const mid = await api("GET", `state?${cred}`);
  assert.strictEqual(mid.me.pos.north, 5);
  assert.strictEqual(mid.me.pos.south, 5);

  await api("POST", "admin/release", { token });
  const after = await api("GET", `state?${cred}`);
  assert.strictEqual(after.round.released, 2);

  await api("POST", "admin/end", { token });
  const rv = await api("GET", "reveal");
  assert.strictEqual(rv.winner, "north");
  assert.ok(rv.track.length > 100);

  // Ada bought the pair for 95 and it paid 100, whichever way it went.
  const done = await api("GET", `state?${cred}`);
  assert.strictEqual(done.me.cashC, 1_000_000 - 5 * 6000 - 5 * 3500 + 5 * 10_000);

  const insp = await api("GET", `admin/inspect?token=${token}`);
  assert.deepStrictEqual(insp.audit, [], `audit broke: ${insp.audit.join(" | ")}`);
});

const exited = new Promise((r) => server.once("exit", r));
server.kill();
await exited;
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
