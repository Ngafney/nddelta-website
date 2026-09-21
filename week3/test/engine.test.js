/**
 * Engine tests — the pure parts, no server: the coin, the bandit and its
 * sandbox, and the Week 2 matching engine on Week 3's 1–99 ladder with money
 * burned on flips. `node test/engine.test.js` in week3/.
 */
import assert from "node:assert";
import { makeCoin, flipMany, betaDraw } from "../shared/coin.js";
import { rngFrom } from "../shared/rng.js";
import { prepareCode, runMany, simulate, validateCode, makeWorld } from "../shared/bandit.js";
import { newMarket, newPlayer, placeOrder, settle, auditState, spendableC, createTeam, joinTeam, grid } from "../shared/engine.js";
import { PRIORS, BANDIT, MONEY } from "../shared/rules.js";

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

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

console.log("\nthe coin");

ok("every prior draws p in [0, 1] with the mean and spread the admin panel promises", () => {
  // Beta(a, a) has mean 1/2 and sd sqrt(1 / (4(2a + 1))): 28.9, 35.4, 39.5 points.
  for (const [key, want] of [
    ["uniform", 28.9],
    ["beta05", 35.4],
    ["beta03", 39.5],
  ]) {
    const rand = rngFrom(`prior-${key}`);
    const ps = Array.from({ length: 40_000 }, () => betaDraw(PRIORS[key].a, PRIORS[key].b, rand));
    assert.ok(ps.every((p) => p >= 0 && p <= 1), `${key}: a draw left [0, 1]`);
    assert.ok(Math.abs(mean(ps) - 0.5) < 0.01, `${key}: mean ${mean(ps)}`);
    assert.ok(Math.abs(sd(ps) * 100 - want) < 0.8, `${key}: sd ${(sd(ps) * 100).toFixed(1)} vs ${want}`);
  }
});

ok("a round's coin is fixed by its seed, and settles where it says", () => {
  const a = makeCoin("seed-1", PRIORS.uniform, "prob");
  const b = makeCoin("seed-1", PRIORS.uniform, "prob");
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.settleValue, Math.round(a.p * 10000) / 100);
  const f = makeCoin("seed-1", PRIORS.uniform, "flip");
  assert.strictEqual(f.p, a.p, "the settlement rule must not change p");
  assert.strictEqual(f.settleValue, f.finalHeads ? 100 : 0);
});

ok("the final flip comes up heads with probability p", () => {
  let heads = 0;
  let pSum = 0;
  for (let i = 0; i < 20_000; i++) {
    const c = makeCoin(`flip-${i}`, PRIORS.uniform, "flip");
    heads += c.finalHeads ? 1 : 0;
    pSum += c.p;
  }
  assert.ok(Math.abs(heads - pSum) / 20_000 < 0.01, `${heads} heads vs expected ${pSum.toFixed(0)}`);
});

ok("simulated flips are a fair sample of the coin", () => {
  const flips = flipMany(0.3, 50_000, "sample");
  const rate = [...flips].filter((f) => f === "H").length / flips.length;
  assert.ok(Math.abs(rate - 0.3) < 0.01, `rate ${rate}`);
  assert.strictEqual(flipMany(0.3, 20, "x"), flipMany(0.3, 20, "x"), "same seed, same flips");
});

console.log("\nthe bandit");

const S = {
  random: "return lib.floor(state.rng() * 5);",
  explore15: "if (state.flip < 15) return state.flip % 5;\nreturn lib.argmax(state.coins.map(c => c.rate));",
  onlyA: "return 0;",
  byName: 'return "C";',
};

ok("random play averages about $5,000 and a psychic about $8,333", () => {
  const r = runMany(prepareCode(S.random).run, "t-random", 4000);
  assert.ok(Math.abs(r.avg - 5000) < 120, `random avg ${r.avg}`);
  assert.ok(Math.abs(r.avgOracle - 8333) < 120, `oracle avg ${r.avgOracle}`);
});

ok("the explore-then-exploit strategy from the lecture beats random by a mile", () => {
  const r = runMany(prepareCode(S.explore15).run, "t-e15", 4000);
  assert.ok(r.avg > 7200 && r.avg < 8000, `explore-15 avg ${r.avg}`);
});

ok("every team faces the same coins: a run is fully determined by its seed", () => {
  const a = runMany(prepareCode(S.explore15).run, "same", 500);
  const b = runMany(prepareCode(S.explore15).run, "same", 500);
  assert.strictEqual(a.avg, b.avg);
  assert.deepStrictEqual(makeWorld("w"), makeWorld("w"));
});

ok("coins can be named by index or by letter", () => {
  const g = simulate(prepareCode(S.byName).run, "names", { withHistory: true });
  assert.ok(g.log.every((f) => f.coin === 2));
  assert.strictEqual(g.faults, 0);
});

ok("a payout is exactly $100 per heads, and a run is 100 flips", () => {
  const g = simulate(prepareCode(S.onlyA).run, "count", { withHistory: true });
  assert.strictEqual(g.log.length, BANDIT.flips);
  assert.strictEqual(g.total, g.log.reduce((s, f) => s + f.heads, 0) * BANDIT.payout);
});

ok("the sandbox refuses loops, escapes and randomness it does not control", () => {
  for (const bad of [
    "for (;;) {}",
    "while (true) {}",
    "return Math.random() < 0.5 ? 0 : 1;",
    "return process.exit();",
    "return this;",
    "const f = function () { return 0; }; return f();",
    "return new Array(1e9).length;",
    "return globalThis;",
    "return (()=>0).constructor('return process')();",
    "return `x`;",
  ]) {
    assert.strictEqual(validateCode(bad).ok, false, `should refuse: ${bad}`);
  }
  // …and does not trip over ordinary words.
  assert.ok(prepareCode("const array = state.coins.map(c => c.rate); return lib.argmax(array);").ok);
  assert.ok(prepareCode("const format = 1; return format;").ok);
});

ok("code that never answers with a coin is caught at compile time", () => {
  assert.strictEqual(prepareCode("return 7;").ok, false);
  assert.strictEqual(prepareCode('return "Z";').ok, false);
  assert.strictEqual(prepareCode("return state.nope.x;").ok, false);
});

ok("a strategy scribbling on its own view cannot change its score", () => {
  const vandal = "state.coins.forEach(c => { c.results.push(1); c.heads = 99; }); return 0;";
  const clean = "return 0;";
  const a = simulate(prepareCode(vandal).run, "vandal");
  const b = simulate(prepareCode(clean).run, "vandal");
  assert.strictEqual(a.total, b.total);
});

console.log("\nthe market");

function room() {
  const s = newMarket({ roundId: "r", mode: "coin", startCashC: MONEY.startCashC });
  s.status = "live";
  for (const id of ["a", "b", "c"]) s.players[id] = newPlayer(id, id.toUpperCase(), `dev-${id}`, MONEY.startCashC, 0);
  createTeam(s, "a", "Team A", "ta", "AAAA");
  joinTeam(s, "b", "AAAA");
  createTeam(s, "c", "Team C", "tc", "CCCC");
  return s;
}

ok("the ladder runs exactly 1 to 99 and settles on 0 to 100", () => {
  const s = room();
  const g = grid(s);
  assert.deepStrictEqual([g.orderMin, g.orderMax, g.settleMin, g.settleMax, g.tick], [1, 99, 0, 100, 1]);
  assert.throws(() => placeOrder(s, "a", "B", 100, 1, 0), /off the ladder/);
  assert.throws(() => placeOrder(s, "a", "A", 0, 1, 0), /off the ladder/);
  placeOrder(s, "a", "B", 99, 1, 0);
  placeOrder(s, "c", "A", 1, 1, 0);
});

ok("a player who spent everything on flips cannot quote at all", () => {
  const s = room();
  const p = s.players.a;
  p.cash -= 100 * MONEY.simCostC; // all 100 flips
  p.spentC += 100 * MONEY.simCostC;
  assert.strictEqual(p.cash, 0);
  assert.throws(() => placeOrder(s, "a", "B", 50, 1, 0), /out of balance/);
  assert.throws(() => placeOrder(s, "a", "A", 50, 1, 0), /out of balance/);
  assert.deepStrictEqual(auditState(s), []);
});

ok("money burned on flips reconciles, and nobody can end below zero at either settlement", () => {
  for (const value of [0, 37.5, 100]) {
    const s = room();
    for (const [id, n] of [["a", 20], ["b", 55], ["c", 3]]) {
      s.players[id].cash -= n * MONEY.simCostC;
      s.players[id].spentC += n * MONEY.simCostC;
    }
    // Everyone trades as much as they can afford.
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

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
