/**
 * End-to-end over real HTTP: boots serve.js on a spare port exactly as event
 * day would, then plays a whole round through the same URLs the browser uses,
 * on a real clock with a one-second tick — static assets, the SPA fallback for
 * /admin and /board, the CSV download, and every call from admin login to the
 * reveal.
 *
 * Run: npm run test:e2e  (in week5/, after npm run build)
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const PORT = 8135;
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

if (!fs.existsSync(path.join(root, "..", "public", "week5", "index.html"))) {
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
      const r = await fetch(`${BASE}/api/week5/health`);
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
  return { status: r.status, text: await r.text(), type: r.headers.get("content-type"), disp: r.headers.get("content-disposition") };
};
const api = async (method, route, body) => {
  const r = await fetch(`${BASE}/api/week5/${route}`, {
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
  const index = await get("/week5/");
  assert.strictEqual(index.status, 200);
  assert.match(index.text, /Horizon Market/);
  const js = index.text.match(/src="(\/week5\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(js, "no script tag");
  assert.strictEqual((await get(js)).status, 200);
  for (const p of ["/week5/admin", "/week5/board"]) assert.match((await get(p)).text, /Horizon Market/);
  assert.strictEqual((await get("/week5/fonts/press-start-2p.ttf")).status, 200);
});

await ok("a whole round plays through on a 1-second tick: create → research → open → trade → settle → reveal", async () => {
  await fails(api("POST", "admin/round", { token: "nope" }), 401);
  const { token } = await api("POST", "admin/auth", { password: "letmein" });
  const T = 6;
  const built = await api("POST", "admin/round", { token, preset: "meanrev", phi1: 0.9, T, H: 60, secondsPerTick: 1, researchMinutes: 1, naiveBot: true });
  assert.strictEqual(built.round.status, "lobby");
  assert.strictEqual(built.round.secondsPerTick, 1);

  const a = await api("POST", "join", { name: "Ada", deviceId: "e2e-device-ada" });
  const b = await api("POST", "join", { name: "Bo", deviceId: "e2e-device-bo" });
  const t = await api("POST", "team/create", { playerId: a.playerId, token: a.token, name: "E2E" });
  await api("POST", "team/join", { playerId: b.playerId, token: b.token, code: t.code });

  await api("POST", "admin/start", { token });
  let s = await api("GET", `state?${q(a)}`);
  assert.strictEqual(s.round.status, "research");
  assert.strictEqual(s.series.ys.length, 60);
  await fails(api("POST", "order", { playerId: a.playerId, token: a.token, side: "B", px: 50, qty: 1 }), 409);
  const csv0 = await get(`/api/week5/data.csv?${q(a)}`);
  assert.strictEqual(csv0.status, 200);
  assert.match(csv0.type, /text\/csv/);
  assert.match(csv0.disp, /attachment; filename="horizon-[0-9a-f]+-tick-0\.csv"/);
  assert.strictEqual(csv0.text.trim().split("\n").filter((l) => /^-?\d+,/.test(l)).length, 60);

  await api("POST", "admin/open", { token });
  const opened = Date.now();
  // The naive desk quotes as the book opens. Bo offers inside its quotes (an
  // offer below its bid would simply sell to the desk), and Ada lifts him.
  const book = (await api("GET", `state?${q(a)}`)).market;
  assert.ok(book.bestBid != null && book.bestAsk != null, "the naive desk quotes at the open");
  assert.ok(book.bestAsk - book.bestBid >= 2, `spread ${book.bestBid}/${book.bestAsk}`);
  const px = book.bestBid + 1;
  await api("POST", "order", { playerId: b.playerId, token: b.token, side: "A", px, qty: 5 });
  const fill = await api("POST", "order", { playerId: a.playerId, token: a.token, side: "B", px, qty: 5 });
  assert.strictEqual(fill.filled, 5);

  // Watch two ticks print on the real clock, and the data grow with them.
  await sleep(Math.max(0, opened + 2300 - Date.now()));
  s = await api("GET", `state?${q(a)}`);
  assert.strictEqual(s.round.status, "live");
  assert.ok(s.round.tickNow >= 2 && s.round.tickNow < T, `tick ${s.round.tickNow}`);
  assert.strictEqual(s.series.ys.length, 60 + s.round.tickNow);
  const d = await api("GET", `data?${q(a)}`);
  assert.ok(d.rows >= 60 + 2);
  assert.match(d.prompt, /P\(Y_T > K\)/);

  // Nobody does anything; the round settles itself at tick T.
  await sleep(Math.max(0, opened + T * 1000 + 300 - Date.now()));
  s = await api("GET", `state?${q(a)}`);
  assert.strictEqual(s.round.status, "settled");
  assert.strictEqual(s.round.tickNow, T);
  const rv = await api("GET", "reveal");
  assert.strictEqual(rv.value, rv.yT > rv.K ? 100 : 0);
  assert.strictEqual(rv.truth.phi1, 0.9);
  assert.strictEqual(rv.path.length, T + 1);
  assert.strictEqual(rv.mids.length, T + 1);
  assert.strictEqual(rv.fair[T], rv.value);
  assert.strictEqual(s.me.cashC, 1_000_000 - 5 * px * 100 + 5 * rv.value * 100);
  assert.deepStrictEqual((await api("GET", "health")).audit, []);
  const board = await api("GET", "board");
  assert.strictEqual(board.history[0].phi1, 0.9);
  assert.strictEqual(board.leaderboard[0].name, "E2E");
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
