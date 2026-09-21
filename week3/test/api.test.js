/**
 * API tests — drives server/handler.js directly (no HTTP), against the memory
 * KV. `npm run test:api` in week3/.
 *
 * The wiring the engine tests cannot see: the round's clock (lobby → sims →
 * live → settled), what the flip window charges and when, what leaks before the
 * bell (p must not), late joiners, both settlement rules, and the bandit lab's
 * compile → sign → run → board loop.
 */
process.env.KV_FORCE_MEMORY = "1"; // never let a test reach the shared store
process.env.SESSION_SECRET = "test-secret-for-week3-api-tests";
process.env.ADMIN_PASSWORD = "hunter2";
// Its own file, so a local server running beside the tests is left alone.
process.env.KV_DATA_FILE = fileURLToPath(new URL("../.data/api-test-kv.json", import.meta.url));
delete process.env.OPENAI_API_KEY; // the offline compiler, so no test ever calls out
delete process.env.LLM_API_KEY;

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = process.env.KV_DATA_FILE;
try {
  fs.unlinkSync(DATA);
} catch {}

const { handle } = await import("../server/handler.js");
const { MONEY } = await import("../shared/rules.js");

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

const call = (m, r, body = {}, q = {}) => handle(m, r, { __ip: "t", ...body }, { __ip: "t", ...q });
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
async function freshRound(opts = {}) {
  await call("POST", "admin/round", { token, minutes: 5, simSeconds: 30, ...opts });
  const a = await player(`Ann${dev}`);
  const b = await player(`Ben${dev}`);
  const t = await call("POST", "team/create", { ...a, name: `T${dev}` });
  await call("POST", "team/join", { ...b, code: t.code });
  return { a, b };
}
const state = (p) => call("GET", "state", {}, p);

console.log("\nthe coin market");

await ok("a wrong password is refused and the admin token cannot be guessed", async () => {
  await fails(call("POST", "admin/auth", { password: "nope" }), /wrong password/);
  await fails(call("POST", "admin/round", { token: "x" }), /bad admin token/);
});

await ok("flips can be pre-ordered in the lobby but nothing is charged until the window closes", async () => {
  const { a } = await freshRound();
  await call("POST", "sims/order", { ...a, n: 25 });
  await call("POST", "admin/start", { token });
  await call("POST", "sims/order", { ...a, n: 30 });
  const s = await state(a);
  assert.strictEqual(s.round.status, "sims");
  assert.strictEqual(s.me.simOrder, 30);
  assert.strictEqual(s.me.cashC, MONEY.startCashC, "charged before the window closed");
  assert.strictEqual(s.me.sims, null, "flips shown before the window closed");
});

await ok("the book is shut during the flip window", async () => {
  const { a } = await freshRound();
  await call("POST", "admin/start", { token });
  await fails(call("POST", "order", { ...a, side: "B", px: 50, qty: 1 }), /trading opens/);
});

await ok("when the window closes, flips are dealt, charged, and trading opens by itself", async () => {
  const { a, b } = await freshRound();
  await call("POST", "sims/order", { ...a, n: 40 });
  await call("POST", "admin/start", { token });
  await call("POST", "admin/skip-sims", { token });
  const sa = await state(a);
  const sb = await state(b);
  assert.strictEqual(sa.round.status, "live");
  assert.strictEqual(sa.me.sims.n, 40);
  assert.strictEqual(sa.me.sims.flips.length, 40);
  assert.strictEqual(sa.me.sims.heads, [...sa.me.sims.flips].filter((f) => f === "H").length);
  assert.strictEqual(sa.me.cashC, MONEY.startCashC - 40 * MONEY.simCostC);
  assert.strictEqual(sb.me.sims.n, 0, "a player who ordered nothing gets nothing");
  assert.strictEqual(sb.me.cashC, MONEY.startCashC);
  await call("POST", "sims/order", { ...a, n: 5 }).then(
    () => assert.fail("re-ordered after the window"),
    (e) => assert.match(e.message, /closed/)
  );
});

await ok("START TRADING NOW works straight from the lobby, dealing whatever was picked", async () => {
  const { a, b } = await freshRound();
  await call("POST", "sims/order", { ...a, n: 12 });
  await call("POST", "admin/skip-sims", { token });
  const sa = await state(a);
  assert.strictEqual(sa.round.status, "live");
  assert.strictEqual(sa.me.sims.n, 12);
  assert.strictEqual((await state(b)).me.sims.n, 0);
  await call("POST", "order", { ...a, side: "B", px: 40, qty: 1 });
  await fails(call("POST", "admin/skip-sims", { token }), /already started/);
});

await ok("the window closes on its own clock, even if nobody is polling", async () => {
  const { a } = await freshRound({ simSeconds: 10 });
  await call("POST", "sims/order", { ...a, n: 3 });
  await call("POST", "admin/start", { token });
  // Pretend 11 seconds have passed by moving the deadline, then just read.
  await call("POST", "admin/extend", { token, seconds: -60 });
  await new Promise((r) => setTimeout(r, 1100));
  const s = await state(a);
  assert.strictEqual(s.round.status, "live");
  assert.strictEqual(s.me.sims.n, 3);
});

await ok("you cannot order more flips than you can pay for", async () => {
  const { a } = await freshRound({ startCash: 1000 });
  await fails(call("POST", "sims/order", { ...a, n: 11 }), /at most 10/);
  await call("POST", "sims/order", { ...a, n: 10 });
});

await ok("p never reaches a player, the board or the rules before the bell", async () => {
  const { a } = await freshRound({ forceP: 73.21 });
  await call("POST", "sims/order", { ...a, n: 10 });
  await call("POST", "admin/start", { token });
  await call("POST", "admin/skip-sims", { token });
  const blobs = [
    await state(a),
    await call("GET", "config"),
    await call("GET", "board"),
    await call("GET", "leaderboard"),
    await call("GET", "rules"),
  ].map((x) => JSON.stringify(x));
  for (const s of blobs) {
    assert.ok(!s.includes("73.21"), "p leaked");
    assert.ok(!s.includes("0.7321"), "p leaked");
  }
  await fails(call("GET", "reveal"), /not revealed/);
  const insp = await call("GET", "admin/inspect", {}, { token });
  assert.strictEqual(insp.secret.p, 0.7321, "the admin can peek");
});

await ok("it settles at 100 × p, to the cent, and the money reconciles", async () => {
  const { a, b } = await freshRound({ forceP: 64.5 });
  await call("POST", "sims/order", { ...a, n: 20 });
  await call("POST", "admin/start", { token });
  await call("POST", "admin/skip-sims", { token });
  await call("POST", "order", { ...b, side: "A", px: 60, qty: 10 });
  await call("POST", "order", { ...a, side: "B", px: 60, qty: 10 });
  await call("POST", "admin/end", { token });
  const rv = await call("GET", "reveal");
  assert.strictEqual(rv.value, 64.5);
  assert.strictEqual(rv.settleC, 6450);
  const sa = await state(a);
  // $10,000 − 20 flips − 10 × $60 + 10 × $64.50
  assert.strictEqual(sa.me.cashC, MONEY.startCashC - 20 * MONEY.simCostC - 10 * 6000 + 10 * 6450);
  assert.deepStrictEqual((await call("GET", "health")).audit, []);
  assert.strictEqual(sa.round.p, 0.645, "p is public after the bell");
  assert.ok(sa.scatter.some((s) => s.n === 20));
});

await ok("a final-flip round pays $100 or $0, and says which", async () => {
  const { a, b } = await freshRound({ settlement: "flip" });
  await call("POST", "admin/start", { token });
  await call("POST", "admin/skip-sims", { token });
  await call("POST", "order", { ...b, side: "A", px: 50, qty: 4 });
  await call("POST", "order", { ...a, side: "B", px: 50, qty: 4 });
  await call("POST", "admin/end", { token });
  const rv = await call("GET", "reveal");
  assert.ok(rv.value === 100 || rv.value === 0);
  assert.strictEqual(rv.finalHeads, rv.value === 100);
  const sa = await state(a);
  assert.strictEqual(sa.me.cashC, MONEY.startCashC - 4 * 5000 + 4 * rv.settleC);
});

await ok("a late joiner gets exactly one flip purchase, and cannot trade before it", async () => {
  const { a } = await freshRound();
  await call("POST", "admin/start", { token });
  await call("POST", "admin/skip-sims", { token });
  const late = await player("Late");
  await call("POST", "team/create", { ...late, name: "Latecomers" });
  let s = await state(late);
  assert.strictEqual(s.me.canBuyLate, true);
  assert.strictEqual((await state(a)).me.canBuyLate, false, "an on-time player already had their window");
  await fails(call("POST", "order", { ...late, side: "B", px: 40, qty: 1 }), /choose your flips first/);
  const r =await call("POST", "sims/late", { ...late, n: 7 });
  assert.strictEqual(r.sims.n, 7);
  s = await state(late);
  assert.strictEqual(s.me.canBuyLate, false);
  assert.strictEqual(s.me.cashC, MONEY.startCashC - 7 * MONEY.simCostC);
  await fails(call("POST", "sims/late", { ...late, n: 1 }), /already/);
  await fails(call("POST", "sims/late", { ...a, n: 1 }), /already/);
  await call("POST", "order", { ...late, side: "B", px: 40, qty: 1 });
});

await ok("during trading a player can buy one more flip at the live price, and only then", async () => {
  const { a } = await freshRound({ liveFlipCost: 500 });
  await call("POST", "sims/order", { ...a, n: 4 });
  await fails(call("POST", "sims/extra", a), /only for sale while trading/);
  await call("POST", "admin/start", { token });
  await fails(call("POST", "sims/extra", a), /only for sale while trading/);
  await call("POST", "admin/skip-sims", { token });
  const before = await state(a);
  assert.strictEqual(before.round.liveFlipCostC, 50_000);
  const r = await call("POST", "sims/extra", a);
  assert.ok(r.flip === "H" || r.flip === "T");
  assert.strictEqual(r.sims.n, 5);
  assert.strictEqual(r.sims.flips, before.me.sims.flips + r.flip, "the old flips are kept, the new one appended");
  assert.strictEqual(r.sims.extra, 1);
  const after = await state(a);
  assert.strictEqual(after.me.cashC, before.me.cashC - 50_000);
  await call("POST", "sims/extra", a);
  assert.strictEqual((await state(a)).me.sims.n, 6);
  assert.deepStrictEqual((await call("GET", "health")).audit, [], "the spend reconciles");
});

await ok("an extra flip can't be bought with cash tied up in orders", async () => {
  const { a } = await freshRound({ startCash: 1000, liveFlipCost: 500 });
  await call("POST", "admin/skip-sims", { token });
  await call("POST", "order", { ...a, side: "B", px: 60, qty: 10 }); // ties up $600 of $1,000
  await fails(call("POST", "sims/extra", a), /can't afford/);
  await call("POST", "cancel", { ...a, all: true });
  await call("POST", "sims/extra", a);
});

await ok("keep-players carries teams into the next coin with fresh money and no flips", async () => {
  const { a } = await freshRound();
  await call("POST", "sims/order", { ...a, n: 9 });
  await call("POST", "admin/start", { token });
  await call("POST", "admin/skip-sims", { token });
  const before = await state(a);
  await call("POST", "admin/round", { token, keepPlayers: true });
  const after = await state(a);
  assert.strictEqual(after.me.teamId, before.me.teamId);
  assert.strictEqual(after.me.cashC, MONEY.startCashC);
  assert.strictEqual(after.me.sims, null);
  assert.strictEqual(after.round.status, "lobby");
});

console.log("\nthe bandit lab");

const { a: la, b: lb } = await freshRound();

await ok("compile → run puts the team on the board; a worse run never lowers it", async () => {
  const c = await call("POST", "bandit/compile", { ...la, prompt: "flip each coin 3 times, then the best rate" });
  assert.ok(c.code && c.sig && c.explain);
  const r1 = await call("POST", "bandit/run", { ...la, code: c.code, sig: c.sig, name: "three each" });
  assert.ok(r1.newBest && r1.stats.avg > 7000, `avg ${r1.stats.avg}`);
  assert.strictEqual(r1.sample.log.length, 100);
  const bad = await call("POST", "bandit/compile", { ...lb, prompt: "always flip coin A" });
  const r2 = await call("POST", "bandit/run", { ...lb, code: bad.code, sig: bad.sig });
  assert.strictEqual(r2.newBest, false);
  const board = (await call("GET", "bandit/board")).board;
  assert.strictEqual(board.length, 1);
  assert.strictEqual(board[0].avg, r1.stats.avg);
  assert.strictEqual(board[0].runs, 2);
});

await ok("the server only runs code it compiled", async () => {
  await fails(call("POST", "bandit/run", { ...la, code: "return 0;", sig: "forged" }), /wasn't compiled here/);
  await fails(call("POST", "bandit/save", { ...la, code: "return 0;", sig: "forged", name: "x" }), /wasn't compiled here/);
});

await ok("teammates share one library; saved strategies remember their best", async () => {
  const c = await call("POST", "bandit/compile", { ...la, prompt: "thompson sampling" });
  const saved = await call("POST", "bandit/save", { ...la, code: c.code, sig: c.sig, name: "Thompson", explain: c.explain });
  const list = (await call("GET", "bandit/strategies", {}, lb)).strategies;
  assert.ok(list.some((s) => s.id === saved.strategy.id), "a teammate can see it");
  const r = await call("POST", "bandit/run", { ...lb, strategyId: saved.strategy.id });
  const after = (await call("GET", "bandit/strategies", {}, la)).strategies.find((s) => s.id === saved.strategy.id);
  assert.strictEqual(after.best, r.stats.avg);
  await call("POST", "bandit/delete", { ...lb, strategyId: saved.strategy.id });
  assert.ok(!(await call("GET", "bandit/strategies", {}, la)).strategies.some((s) => s.id === saved.strategy.id));
});

await ok("'just win' is refused rather than compiled", async () => {
  const r = await call("POST", "bandit/compile", { ...la, prompt: "just win" });
  assert.strictEqual(r.refused, true);
});

await ok("closing the lab stops compiling and running, and the board can be cleared", async () => {
  await call("POST", "admin/config", { token, banditOpen: false });
  await fails(call("POST", "bandit/compile", { ...la, prompt: "random" }), /closed/);
  await call("POST", "admin/config", { token, banditOpen: true, board: "bandit" });
  assert.strictEqual((await call("GET", "board")).cfg.board, "bandit");
  await call("POST", "admin/bandit/clear", { token, confirm: "CLEAR" });
  assert.strictEqual((await call("GET", "bandit/board")).board.length, 0);
});

await ok("a global reset wipes rounds, players, strategies and the board", async () => {
  await call("POST", "admin/reset", { token, confirm: "RESET" });
  assert.strictEqual((await call("GET", "config")).round, null);
  await fails(call("GET", "bandit/strategies", {}, la), /no round/);
  // …and the admin password survives.
  await call("POST", "admin/auth", { password: "hunter2" });
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
