/**
 * Engine tests — the week 3 matching engine on week 5's single 1–99 book.
 * Ported from week3/test/engine.test.js (the market section; the coin and the
 * bandit do not exist here), plus the things this week leans on harder:
 * price-time priority, self-trade prevention between desks, settlement at
 * exactly 100 or 0, and a random storm that must never break solvency.
 * `npm run test:engine` in week5/.
 */
import assert from "node:assert";
import {
  newMarket, newPlayer, placeOrder, cancelAll, settle, auditState, spendableC, createTeam, joinTeam, grid,
  leaderboard, bookLevels,
} from "../shared/engine.js";
import { MONEY } from "../shared/rules.js";
import { rngFrom } from "../shared/rng.js";

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
}

function room() {
  const s = newMarket({ roundId: "r", mode: "horizon", startCashC: MONEY.startCashC });
  s.status = "live";
  for (const id of ["a", "b", "c"]) s.players[id] = newPlayer(id, id.toUpperCase(), `dev-${id}`, MONEY.startCashC, 0);
  createTeam(s, "a", "Team A", "ta", "AAAA");
  joinTeam(s, "b", "AAAA");
  createTeam(s, "c", "Team C", "tc", "CCCC");
  return s;
}

console.log("\nthe market (ported from week 3)");

ok("the ladder runs exactly 1 to 99 and settles on 0 to 100", () => {
  const s = room();
  const g = grid(s);
  assert.deepStrictEqual([g.orderMin, g.orderMax, g.settleMin, g.settleMax, g.tick], [1, 99, 0, 100, 1]);
  assert.throws(() => placeOrder(s, "a", "B", 100, 1, 0), /off the ladder/);
  assert.throws(() => placeOrder(s, "a", "A", 0, 1, 0), /off the ladder/);
  assert.throws(() => placeOrder(s, "a", "B", 50.5, 1, 0), /off the ladder|grid/);
  placeOrder(s, "a", "B", 99, 1, 0);
  placeOrder(s, "c", "A", 1, 1, 0);
});

ok("a player with no free cash cannot quote at all", () => {
  const s = room();
  const p = s.players.a;
  p.cash -= MONEY.startCashC;
  p.spentC += MONEY.startCashC;
  assert.strictEqual(p.cash, 0);
  assert.throws(() => placeOrder(s, "a", "B", 50, 1, 0), /out of balance/);
  assert.throws(() => placeOrder(s, "a", "A", 50, 1, 0), /out of balance/);
  assert.deepStrictEqual(auditState(s), []);
});

ok("money reconciles, and nobody can end below zero at either settlement", () => {
  for (const value of [0, 100]) {
    const s = room();
    for (const [id, c] of [["a", 200_000], ["b", 550_000], ["c", 30_000]]) {
      s.players[id].cash -= c;
      s.players[id].spentC += c;
    }
    placeOrder(s, "a", "A", 30, 50, 0);
    placeOrder(s, "c", "B", 30, 50, 0);
    placeOrder(s, "b", "B", 80, 50, 0);
    placeOrder(s, "c", "A", 80, 50, 0);
    assert.deepStrictEqual(auditState(s), []);
    settle(s, value, 0);
    assert.deepStrictEqual(auditState(s), []);
    for (const p of Object.values(s.players)) assert.ok(p.cash >= 0, `${p.name} ended at ${p.cash} when S=${value}`);
    assert.ok(spendableC(s, s.players.a) >= 0);
  }
});

console.log("\nweek 5");

ok("price-time priority: best price first, then whoever was there first", () => {
  const s = room();
  placeOrder(s, "a", "A", 55, 5, 1);
  placeOrder(s, "b", "A", 54, 5, 2);
  placeOrder(s, "a", "A", 54, 5, 3); // same price as b, later
  const r = placeOrder(s, "c", "B", 55, 12, 4);
  assert.deepStrictEqual(r.trades.map((t) => [t.px, t.qty, t.seller]), [[54, 5, "b"], [54, 5, "a"], [55, 2, "a"]]);
  assert.strictEqual(s.players.c.pos, 12);
  assert.strictEqual(s.players.c.cash, MONEY.startCashC - (54 * 10 + 55 * 2) * 100, "the taker pays the resting price");
});

ok("self-trade prevention: crossing your own order cancels it and prints nothing", () => {
  const s = room();
  placeOrder(s, "a", "A", 60, 5, 1);
  const r = placeOrder(s, "a", "B", 61, 5, 2);
  assert.strictEqual(r.trades.length, 0);
  assert.strictEqual(s.last, null, "no trade, no last price");
  assert.deepStrictEqual(bookLevels(s, "a").asks, []);
  assert.strictEqual(bookLevels(s, "a").bids[0].px, 61);
});

ok("the book is shut outside the live phase", () => {
  const s = room();
  for (const status of ["lobby", "research", "settled"]) {
    s.status = status;
    assert.throws(() => placeOrder(s, "a", "B", 50, 1, 0), /closed/);
  }
});

ok("settlement pays exactly $100 or $0 a share and pulls every resting order", () => {
  for (const value of [100, 0]) {
    const s = room();
    placeOrder(s, "c", "A", 40, 10, 1);
    placeOrder(s, "a", "B", 40, 10, 2);
    placeOrder(s, "b", "B", 10, 5, 3); // left resting
    settle(s, value, 9);
    assert.strictEqual(s.orders.length, 0);
    assert.strictEqual(s.players.a.cash, MONEY.startCashC - 10 * 4000 + 10 * value * 100);
    assert.strictEqual(s.players.c.cash, MONEY.startCashC + 10 * 4000 - 10 * value * 100);
    assert.strictEqual(s.players.b.cash, MONEY.startCashC, "a resting order never fills at the bell");
    assert.strictEqual(settle(s, 100 - value, 10).settleC, value * 100, "settling twice changes nothing");
  }
});

ok("hidden tables trade but never appear on the leaderboard", () => {
  const s = room();
  s.players.bot = newPlayer("bot", "DESK", "dev-bot", MONEY.startCashC * 400, 0);
  s.players.bot.teamId = "house";
  s.teams.house = { id: "house", name: "HOUSE", code: "----", members: ["bot"], hidden: true };
  placeOrder(s, "bot", "A", 50, 5, 1);
  placeOrder(s, "a", "B", 50, 5, 2);
  assert.ok(!leaderboard(s).some((r) => r.id === "house"));
  assert.strictEqual(leaderboard(s).length, 2);
  assert.deepStrictEqual(auditState(s), []);
});

ok("a random storm of orders never breaks solvency, at either settlement", () => {
  for (const value of [0, 100]) {
    const s = room();
    const rand = rngFrom(`storm-${value}`);
    const ids = ["a", "b", "c"];
    for (let i = 0; i < 3000; i++) {
      const id = ids[Math.floor(rand() * 3)];
      if (rand() < 0.05) {
        cancelAll(s, id);
        continue;
      }
      try {
        placeOrder(s, id, rand() < 0.5 ? "B" : "A", 1 + Math.floor(rand() * 99), 1 + Math.floor(rand() * 50), i);
      } catch (e) {
        if (!/balance|too many|full/.test(e.message)) throw e;
      }
      if (i % 250 === 0) assert.deepStrictEqual(auditState(s), [], `step ${i}`);
    }
    assert.deepStrictEqual(auditState(s), []);
    settle(s, value, 1);
    assert.deepStrictEqual(auditState(s), []);
    for (const p of Object.values(s.players)) assert.ok(p.cash >= 0, `${p.name} at ${p.cash}`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
