/**
 * End-to-end over real HTTP: boots serve.js on a spare port exactly as event
 * day would, then plays a whole round through the same URLs the browser uses —
 * static assets, the SPA fallback for /admin and /board, and every API call
 * from admin login to the reveal.
 *
 * Run: npm run test:e2e  (in week3/)
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

if (!fs.existsSync(path.join(root, "..", "public", "week3", "index.html"))) {
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
      const r = await fetch(`${BASE}/api/week3/health`);
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
  const r = await fetch(`${BASE}/api/week3/${route}`, {
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
  const index = await get("/week3/");
  assert.strictEqual(index.status, 200);
  assert.match(index.text, /Coin Flips/);
  const js = index.text.match(/src="(\/week3\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(js, "no script tag");
  assert.strictEqual((await get(js)).status, 200);
  for (const p of ["/week3/admin", "/week3/board"]) assert.match((await get(p)).text, /Coin Flips/);
});

await ok("a whole coin round plays through, and the bandit lab runs, over HTTP", async () => {
  const { token } = await api("POST", "admin/auth", { password: "letmein" });
  await api("POST", "admin/round", { token, prior: "uniform", settlement: "prob", forceP: 42 });
  const a = await api("POST", "join", { name: "Ada", deviceId: "e2e-device-ada" });
  const b = await api("POST", "join", { name: "Bo", deviceId: "e2e-device-bo" });
  const t = await api("POST", "team/create", { playerId: a.playerId, token: a.token, name: "E2E" });
  await api("POST", "team/join", { playerId: b.playerId, token: b.token, code: t.code });
  await api("POST", "sims/order", { playerId: a.playerId, token: a.token, n: 15 });
  await api("POST", "admin/start", { token });
  await api("POST", "admin/skip-sims", { token });
  await api("POST", "order", { playerId: b.playerId, token: b.token, side: "A", px: 50, qty: 5 });
  await api("POST", "order", { playerId: a.playerId, token: a.token, side: "B", px: 50, qty: 5 });
  await api("POST", "admin/end", { token });
  const rv = await api("GET", "reveal");
  assert.strictEqual(rv.value, 42);
  const s = await api("GET", `state?playerId=${a.playerId}&token=${a.token}`);
  assert.strictEqual(s.me.cashC, 1_000_000 - 15 * 10_000 - 5 * 5000 + 5 * 4200);
  assert.deepStrictEqual((await api("GET", "health")).audit, []);

  const c = await api("POST", "bandit/compile", { playerId: a.playerId, token: a.token, prompt: "first 20 flips exploring, then the best rate" });
  const r = await api("POST", "bandit/run", { playerId: a.playerId, token: a.token, code: c.code, sig: c.sig });
  assert.ok(r.stats.avg > 6500, `avg ${r.stats.avg}`);
  assert.strictEqual((await api("GET", "bandit/board")).board[0].teamName, "E2E");
});

const exited = new Promise((r) => server.once("exit", r));
server.kill();
await exited;
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
