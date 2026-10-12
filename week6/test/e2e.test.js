/**
 * End-to-end over real HTTP: boots serve.js on a spare port exactly as event
 * day would, then plays a whole round through the same URLs the browser uses,
 * on a real clock — static assets, the SPA fallback for /admin and /board, and
 * every call from admin login to the reveal, with AUTO pulling the numbers.
 *
 * Run: npm run test:e2e  (in week6/, after npm run build)
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const PORT = 8136;
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

if (!fs.existsSync(path.join(root, "..", "public", "week6", "index.html"))) {
  console.log("\n  ! build the app first (npm run build) — skipping e2e\n");
  process.exit(0);
}

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
      const r = await fetch(`${BASE}/api/week6/health`);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`server never came up:\n${serverLog}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await waitForBoot();

const get = async (p) => {
  const r = await fetch(`${BASE}${p}`);
  return { status: r.status, text: await r.text(), type: r.headers.get("content-type") };
};
const api = async (method, route, body) => {
  const r = await fetch(`${BASE}/api/week6/${route}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error), { status: r.status });
  return data;
};
const q = (p) => new URLSearchParams({ playerId: p.playerId, token: p.token });

console.log("\ne2e over http");

await ok("the app, its assets and the SPA fallback are served", async () => {
  const index = await get("/week6/");
  assert.strictEqual(index.status, 200);
  assert.match(index.text, /The Sum/);
  const js = index.text.match(/src="(\/week6\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(js, "no script tag");
  assert.strictEqual((await get(js)).status, 200);
  for (const p of ["/week6/admin", "/week6/board"]) assert.match((await get(p)).text, /The Sum/);
  assert.strictEqual((await get("/week6/fonts/press-start-2p.ttf")).status, 200);
});

await ok("a whole round plays through: build → teams pick → pick clock → open → trade all three → AUTO reveals → settle → reveal", async () => {
  await fails(api("POST", "admin/round", { token: "nope" }), 401);
  const { token } = await api("POST", "admin/auth", { password: "letmein" });
  const built = await api("POST", "admin/round", { token, pickSeconds: 5, autoOn: true, autoEverySec: 1, books: { fut: true, call: true, put: true }, noise: { on: true, desks: 2, everySec: 2, size: 5, sweep: 3 } });
  assert.strictEqual(built.round.status, "lobby");

  const a = await api("POST", "join", { name: "Ada", deviceId: "e2e-device-ada" });
  const b = await api("POST", "join", { name: "Bo", deviceId: "e2e-device-bo" });
  const c = await api("POST", "join", { name: "Cy", deviceId: "e2e-device-cy" });
  const ta = await api("POST", "team/create", { playerId: a.playerId, token: a.token, name: "Alphas", number: 7 });
  await api("POST", "team/join", { playerId: b.playerId, token: b.token, code: ta.code });
  await api("POST", "team/create", { playerId: c.playerId, token: c.token, name: "Cees", number: 2 });
  await fails(api("POST", "order", { playerId: a.playerId, token: a.token, mkt: "fut", side: "B", px: 5, qty: 1 }), 409);

  let s = await api("GET", `state?${q(a)}`);
  assert.strictEqual(s.team.number, 7);
  assert.strictEqual(s.round.N, 2);
  await api("POST", "team/number", { playerId: b.playerId, token: b.token, number: 9 });
  s = await api("GET", `state?${q(a)}`);
  assert.strictEqual(s.team.number, 9, "a teammate changed it");

  // The pick clock opens trading on its own.
  await api("POST", "admin/pick", { token, seconds: 5 });
  await sleep(5400);
  s = await api("GET", `state?${q(a)}`);
  assert.strictEqual(s.round.status, "live");
  assert.strictEqual(s.round.N, 2);
  assert.strictEqual(s.round.K, 10);
  await fails(api("POST", "team/create", { playerId: a.playerId, token: a.token, name: "Late", number: 1 }), 400);

  // Trade all three books: Cy quotes, Ada lifts. Then AUTO pulls both numbers at a second each.
  // (The first AUTO pull is due one second after the open, so be quick.)
  const stateNow = await api("GET", `state?${q(c)}`);
  if (stateNow.round.status === "live") {
    try {
      await api("POST", "order", { playerId: c.playerId, token: c.token, mkt: "fut", side: "A", px: 12, qty: 3 });
      await api("POST", "order", { playerId: a.playerId, token: a.token, mkt: "fut", side: "B", px: 12, qty: 3 });
      await api("POST", "order", { playerId: c.playerId, token: c.token, mkt: "call", side: "A", px: 2, qty: 3 });
      await api("POST", "order", { playerId: a.playerId, token: a.token, mkt: "call", side: "B", px: 2, qty: 3 });
      await api("POST", "order", { playerId: c.playerId, token: c.token, mkt: "put", side: "B", px: 1, qty: 3 });
      await api("POST", "order", { playerId: a.playerId, token: a.token, mkt: "put", side: "A", px: 1, qty: 3 });
    } catch (e) {
      if (!/closed|settling/.test(e.message)) throw e;
    }
  }
  await sleep(2600);
  s = await api("GET", `state?${q(a)}`);
  assert.strictEqual(s.round.status, "settled");
  assert.strictEqual(s.round.settleS, 11, "9 + 2");
  assert.deepStrictEqual(s.round.payouts, { fut: 11, call: 1, put: 0 });
  const rv = await api("GET", "reveal");
  assert.strictEqual(rv.S, 11);
  assert.deepStrictEqual([...rv.numbers].sort(), [2, 9]);
  assert.deepStrictEqual(rv.teams.map((t) => t.name).sort(), ["Alphas", "Cees"]);
  assert.strictEqual(rv.fair.length, 3);
  assert.strictEqual(rv.mids.length, 3);
  // If the trades went through before the first reveal, Ada's cash is exact.
  if (s.me.pos.fut === 3) {
    assert.strictEqual(s.me.cashC, 1_000_000 + (-3 * 12 - 3 * 2 + 3 * 1) * 100 + (3 * 11 + 3 * 1 - 3 * 0) * 100);
  }
  assert.deepStrictEqual((await api("GET", "health")).audit, []);
  const board = await api("GET", "board");
  assert.strictEqual(board.history[0].S, 11);
  assert.ok(["Alphas", "Cees"].includes(board.leaderboard[0].name));

  // A new round keeps the teams and asks for numbers again; an unpicked team gets one drawn.
  await api("POST", "admin/round", { token, keepPlayers: true, noise: { on: false } });
  s = await api("GET", `state?${q(a)}`);
  assert.strictEqual(s.round.status, "lobby");
  assert.strictEqual(s.team.number, null);
  assert.strictEqual(s.round.N, 2);
  await api("POST", "team/number", { playerId: a.playerId, token: a.token, number: 4 });
  const opened = await api("POST", "admin/open", { token });
  assert.strictEqual(opened.round.locked, true);
  const sc = await api("GET", `state?${q(c)}`);
  assert.strictEqual(sc.team.drawn, true);
  assert.ok(sc.team.number >= 0 && sc.team.number <= 10);
  await api("POST", "admin/reveal", { token });
  await api("POST", "admin/reveal", { token });
  s = await api("GET", `state?${q(a)}`);
  assert.strictEqual(s.round.status, "settled");
  assert.strictEqual(s.round.settleS, 4 + sc.team.number);
});

async function fails(p, status) {
  try {
    await p;
  } catch (e) {
    if (status) assert.strictEqual(e.status, status, e.message);
    return e;
  }
  throw new Error("expected a rejection");
}

const exited = new Promise((r) => server.once("exit", r));
server.kill();
await exited;
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
