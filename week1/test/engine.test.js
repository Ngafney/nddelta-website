/**
 * Engine smoke tests — no framework, just assertions. `npm test` in week1/.
 */
import assert from "node:assert";
import { validateSpec } from "../shared/dsl.js";
import { makeWorld, simulate, runMany, payoffAt, oracle } from "../shared/bandit.js";
import { playMatch, roundRobin } from "../shared/matrix.js";
import { SEED_BOTS } from "../shared/seedBots.js";
import { mockCompile } from "../shared/mockLLM.js";
import { readback } from "../shared/readback.js";
import { PAYOFFS, BANDIT } from "../shared/rules.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* ── determinism ── */
ok("worlds are deterministic", () => {
  const a = makeWorld("seed|w0");
  const b = makeWorld("seed|w0");
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, makeWorld("seed|w1"));
});

ok("payoffs keyed by position, not draw order", () => {
  const w = makeWorld("s|w0");
  const p1 = payoffAt("s|w0", w, 7, 3);
  const p2 = payoffAt("s|w0", w, 7, 3);
  assert.strictEqual(p1, p2);
  assert.notStrictEqual(p1, payoffAt("s|w0", w, 8, 3));
});

/* ── world distribution sanity (law of large numbers, loose bounds) ── */
ok("world params match the spec'd distributions", () => {
  let muSum = 0, muSq = 0, sigSum = 0, n = 0;
  for (let j = 0; j < 2000; j++) {
    const w = makeWorld(`dist|w${j}`);
    for (let i = 0; i < 5; i++) {
      muSum += w.mu[i]; muSq += w.mu[i] ** 2; sigSum += w.sigma[i]; n++;
      assert.ok(w.sigma[i] >= 0);
    }
  }
  const muMean = muSum / n;
  const muSd = Math.sqrt(muSq / n - muMean ** 2);
  assert.ok(Math.abs(muMean) < 0.5, `mu mean ${muMean}`);
  assert.ok(Math.abs(muSd - 10) < 0.5, `mu sd ${muSd}`);
  assert.ok(Math.abs(sigSum / n - 10) < 0.3, `sigma mean ${sigSum / n}`);
});

/* ── DSL validation ── */
ok("valid specs pass, junk fails", () => {
  const good = validateSpec({
    game: "bandit",
    rules: [
      { if: { lt: ["spinsUsed", 5] }, then: { play: "leastPlayed" } },
      { if: true, then: { play: "highestMean" } },
    ],
  });
  assert.ok(good.ok, JSON.stringify(good.errors));
  assert.ok(!validateSpec({ game: "bandit", rules: [{ if: { lt: ["spinsUsed", 5] }, then: { play: "leastPlayed" } }] }).ok, "missing fallback must fail");
  assert.ok(!validateSpec({ game: "chicken", rules: [{ if: true, then: "SPLIT" }] }).ok, "wrong action set must fail");
  assert.ok(!validateSpec({ game: "bandit", rules: [{ if: { lt: ["nonsense", 5] }, then: { play: "random" } }, { if: true, then: { play: "random" } }] }).ok);
});

/* ── bandit strategy quality ordering ── */
ok("explore-then-exploit beats pure random over shared worlds", () => {
  const ete = validateSpec({
    game: "bandit",
    rules: [
      { if: { lt: ["spinsUsed", 5] }, then: { play: "leastPlayed" } },
      { if: true, then: { play: "highestMean" } },
    ],
  }).spec;
  const rnd = validateSpec({ game: "bandit", rules: [{ if: true, then: { play: "random" } }] }).spec;
  const a = runMany(ete, "test-base", 800);
  const b = runMany(rnd, "test-base", 800);
  assert.ok(a.avg > b.avg + 50, `ete ${a.avg} vs random ${b.avg}`);
  // Random plays all machines equally: its expected avg is ~0 (μ prior mean 0).
  assert.ok(Math.abs(b.avg) < 40, `random avg ${b.avg}`);
});

ok("simulate is deterministic and history sums to total", () => {
  const spec = validateSpec({ game: "bandit", rules: [{ if: true, then: { play: "thompson" } }] }).spec;
  const r1 = simulate(spec, "x|w3", { withHistory: true });
  const r2 = simulate(spec, "x|w3");
  assert.strictEqual(r1.total, r2.total);
  const sum = r1.history.reduce((s, h) => s + h.pay, 0);
  assert.ok(Math.abs(sum - r1.total) < 1, "history rounds to total");
  assert.strictEqual(r1.history.length, BANDIT.spins);
});

/* ── matrix games ── */
ok("chicken payoffs are the corrected hawk-dove", () => {
  assert.strictEqual(PAYOFFS.chicken.STAY.STAY, -50);
  assert.strictEqual(PAYOFFS.chicken.STAY.SWERVE, 20);
  assert.strictEqual(PAYOFFS.chicken.SWERVE.STAY, -20);
  assert.strictEqual(PAYOFFS.chicken.SWERVE.SWERVE, -10);
});

ok("matches are deterministic and order-independent", () => {
  const [steel, , flip] = SEED_BOTS.chicken;
  const m1 = playMatch("chicken", steel, flip, 2);
  const m2 = playMatch("chicken", steel, flip, 2);
  assert.deepStrictEqual(m1, m2);
  const m3 = playMatch("chicken", flip, steel, 2); // swapped order
  assert.strictEqual(m1.scoreA, m3.scoreB);
  assert.strictEqual(m1.scoreB, m3.scoreA);
});

ok("steel nerve always stays; yielder yields to it", () => {
  const [steel, yielder] = SEED_BOTS.chicken;
  const m = playMatch("chicken", steel, yielder, 0);
  assert.ok(m.rounds.every((r) => r.a === "STAY"));
  // Yielder: round 0 swerve (-20 vs steel's +20), then opposite of STAY = SWERVE forever.
  assert.ok(m.rounds.every((r) => r.b === "SWERVE"));
  assert.strictEqual(m.scoreA, 200);
  assert.strictEqual(m.scoreB, -200);
});

ok("grim trigger punishes forever after one steal", () => {
  const grim = SEED_BOTS.pd[2];
  const bully = {
    id: "t:bully",
    name: "Bully",
    spec: validateSpec({
      game: "pd",
      rules: [
        { if: { eq: ["round", 3] }, then: "STEAL" },
        { if: true, then: "SPLIT" },
      ],
    }).spec,
  };
  const m = playMatch("pd", grim, bully, 0);
  // Rounds 0-3 grim splits; from round 4 on grim steals.
  assert.ok(m.rounds.slice(0, 4).every((r) => r.a === "SPLIT"));
  assert.ok(m.rounds.slice(4).every((r) => r.a === "STEAL"));
});

ok("round robin: always-steal farms the cooperative seed field", () => {
  // With both-steal now −10, the thief still tops this all-cooperative field
  // (it exploits Saint outright and only bleeds slowly against the retaliators),
  // and Saint — which never punishes — ends up worst.
  const thief = {
    id: "t:thief",
    name: "Thief",
    spec: validateSpec({ game: "pd", rules: [{ if: true, then: "STEAL" }] }).spec,
  };
  const { standings, pairs } = roundRobin("pd", [...SEED_BOTS.pd, thief]);
  assert.strictEqual(standings[0].id, "t:thief"); // exploits an all-cooperative field
  assert.strictEqual(Object.keys(pairs).length, 6); // C(4,2)
  assert.strictEqual(standings[0].matches, 15); // 3 opponents × 5
});

/* ── mock compiler round-trips through validation ── */
ok("mock compiler output always validates", () => {
  const prompts = {
    bandit: [
      "try every machine once and then repeatedly play the machine with the highest average payoff forever",
      "epsilon greedy with epsilon 0.1",
      "use ucb with constant 2",
      "thompson sampling",
      "always play machine 3",
      "pure random",
      "complete gibberish qwerty",
    ],
    chicken: [
      "always stay",
      "tit for tat",
      "if they have swerved 3 times then stay",
      "flip a coin",
      "gibberish",
    ],
    pd: ["always steal", "grim trigger, never forgive", "copy their last move", "gibberish"],
  };
  for (const [game, list] of Object.entries(prompts)) {
    for (const p of list) {
      const { spec } = mockCompile(game, p);
      const v = validateSpec(spec);
      assert.ok(v.ok, `${game}: "${p}" → ${JSON.stringify(v.errors)}`);
      assert.ok(readback(v.spec).length > 0);
    }
  }
});

/* ── the canonical example compiles to the canonical spec ── */
ok("'try every machine once then best forever' compiles to explore-then-exploit", () => {
  const { spec } = mockCompile("bandit", "try every machine once and then repeatedly play the machine with the highest average payoff forever");
  assert.deepStrictEqual(spec.rules[0], { if: { lt: ["spinsUsed", 5] }, then: { play: "leastPlayed" } });
  assert.deepStrictEqual(spec.rules[1], { if: true, then: { play: "highestMean" } });
});

/* ── regression: every shipped preset must compile to what it says ── */
ok("shipped presets compile to the intended bot (no silent miscompile)", () => {
  // MIND GAMES: swerve first, then the OPPOSITE — must not become copy.
  const mg = mockCompile("chicken", "swerve first, then do the opposite of whatever they did last round").spec;
  assert.deepStrictEqual(mg.rules[0], { if: { eq: ["round", 0] }, then: "SWERVE" });
  assert.deepStrictEqual(mg.rules[mg.rules.length - 1], { if: true, then: { opposite: "oppLast" } });

  const pd = mockCompile("pd", "split first, then do the opposite of their last move").spec;
  assert.deepStrictEqual(pd.rules[pd.rules.length - 1], { if: true, then: { opposite: "oppLast" } });

  // Reactive Yielder-style with an aggressive opener stays aggressive first.
  const rev = mockCompile("chicken", "stay to start, then reverse of their last move").spec;
  assert.strictEqual(rev.rules[0].then, "STAY");
});

/* ── regression: the natural phrasings audit-6 caught the compiler inverting ── */
ok("natural reactive phrasings compile to the right bot", () => {
  const spec = (g, prompt) => {
    const { spec } = mockCompile(g, prompt);
    const v = validateSpec(spec);
    assert.ok(v.ok, `${g}: "${prompt}" → ${JSON.stringify(v.errors)}`);
    return spec;
  };
  const lastRule = (s) => s.rules[s.rules.length - 1];

  // "steal if they steal, split if they split" == mirror, NOT a threshold.
  assert.deepStrictEqual(lastRule(spec("pd", "steal if they steal, split if they split")), { if: true, then: { mirror: "oppLast" } });

  // streak: "swerve if they stay twice in a row, otherwise stay"
  const st = spec("chicken", "swerve if they stay twice in a row, otherwise stay");
  assert.deepStrictEqual(st.rules[0], { if: { gte: [{ oppStreak: "STAY" }, 2] }, then: "SWERVE" });

  // endgame survives "every round": "split every round but steal on the last round"
  const eg = spec("pd", "split every round but steal on the last round");
  assert.strictEqual(eg.rules[0].then, "STEAL");
  assert.deepStrictEqual(lastRule(eg), { if: true, then: "SPLIT" });

  // "until" is grim, not a fallback
  const grim = spec("pd", "split until they steal, then steal forever");
  assert.deepStrictEqual(grim.rules[0], { if: { gte: [{ oppCount: "STEAL" }, 1] }, then: "STEAL" });

  // word maps: cooperate/defect
  assert.deepStrictEqual(spec("pd", "always cooperate").rules[0], { if: true, then: "SPLIT" });
  assert.deepStrictEqual(spec("pd", "just defect every time").rules[0], { if: true, then: "STEAL" });
  assert.deepStrictEqual(spec("chicken", "never swerve").rules[0], { if: true, then: "STAY" });

  // bandit explicit explore budget in pulls, not just "times"
  const be = mockCompile("bandit", "spend 10 pulls exploring, then exploit the best").spec;
  assert.deepStrictEqual(be.rules[0], { if: { lt: ["spinsUsed", 10] }, then: { play: "leastPlayed" } });

  // chicken fallback is reactive-yielder-shaped (opposite), NOT mirror
  const fb = spec("chicken", "qwerty asdf zxcv");
  assert.deepStrictEqual(lastRule(fb), { if: true, then: { opposite: "oppLast" } });
});

ok("bandit JS code: safe, deterministic, sees full data", async () => {
  const { validateBanditCode, prepareBanditCode, runManyCode } = await import("../shared/banditCode.js");
  // Denylist blocks host escapes, loops, Math.random.
  for (const bad of ["return this;", "for (;;) return 0;", "while(true){}", "return [].constructor.constructor('return process')();", "return Math.random() < 0.5 ? 0 : 1;", "return require('fs');"]) {
    assert.ok(!validateBanditCode(bad).ok, `should reject: ${bad}`);
  }
  // A real strategy over the full data + seeded rng: prob p ramps, pick best/2nd-best.
  const src = `const p = lib.clamp(0.7 + 0.28*(state.pull/50), 0.7, 0.98);
    const tried = state.machines.filter(m => m.plays > 0).sort((a,b)=> b.mean - a.mean);
    if (tried.length < 2) { const u = state.machines.find(m => m.plays === 0); return u ? u.index : 0; }
    return (state.rng() < p ? tried[0] : tried[1]).index;`;
  const prep = prepareBanditCode(src);
  assert.ok(prep.ok, prep.error);
  const a = runManyCode(prep.run, "codetest", 300);
  const b = runManyCode(prep.run, "codetest", 300);
  assert.strictEqual(a.avg, b.avg, "seeded runs must be identical"); // determinism
  assert.ok(Number.isFinite(a.avg));
  // The history dict is available to code.
  const usesHistory = prepareBanditCode("return Object.keys(state.history).length - 8 === 0 ? 0 : 1;");
  assert.ok(usesHistory.ok, usesHistory.error);
});

ok("bandit rich data model: refs and best/worst selectors validate and run", () => {
  const spec = validateSpec({
    game: "bandit",
    rules: [
      { if: { lt: ["spinsUsed", 8] }, then: { play: "leastPlayed" } },
      { if: { gt: [{ countPos: 0 }, 3] }, then: { play: { fixed: 0 } } },
      { if: { gte: [{ countAbove: [1, 10] }, 2] }, then: { play: "stay" } },
      { if: true, then: { play: { best: "sum" } } },
    ],
  });
  assert.ok(spec.ok, JSON.stringify(spec.errors));
  const r = simulate(spec.spec, "rich|w2");
  assert.ok(Number.isFinite(r.total));
  // {best:"max"} plays the machine with the biggest single payoff (after trying each once).
  const bmax = validateSpec({ game: "bandit", rules: [{ if: true, then: { play: { best: "max" } } }] });
  assert.ok(bmax.ok);
  assert.ok(Number.isFinite(simulate(bmax.spec, "rich|w3").total));
  // bad metric rejected
  assert.ok(!validateSpec({ game: "bandit", rules: [{ if: true, then: { play: { best: "variance" } } }] }).ok);
});

ok('bandit "stay" selector keeps the last machine', () => {
  // "play random until a machine pays over 5, then stick with it"
  const spec = validateSpec({
    game: "bandit",
    rules: [
      { if: { gt: ["lastPayoff", 5] }, then: { play: "stay" } },
      { if: true, then: { play: "random" } },
    ],
  });
  assert.ok(spec.ok, JSON.stringify(spec.errors));
  const r = simulate(spec.spec, "stay|w1", { withHistory: true });
  // Whenever the previous pull paid > 5, the next pull is the same machine.
  for (let i = 1; i < r.history.length; i++) {
    if (r.history[i - 1].pay > 5) assert.strictEqual(r.history[i].machine, r.history[i - 1].machine, `pull ${i} should stay`);
  }
});

ok('"NONE" opening-round literal validates', () => {
  assert.ok(validateSpec({ game: "pd", rules: [{ if: { eq: ["oppLast", "NONE"] }, then: "SPLIT" }, { if: true, then: { mirror: "oppLast" } }] }).ok);
});

ok("non-finite numbers are rejected by validation", () => {
  assert.ok(!validateSpec({ game: "bandit", rules: [{ if: true, then: { play: { ucb: Infinity } } }] }).ok);
  assert.ok(!validateSpec({ game: "chicken", rules: [{ if: { gte: [{ oppCount: "STAY" }, Infinity] }, then: "STAY" }, { if: true, then: "SWERVE" }] }).ok);
});

console.log(`\n${passed} tests passed`);
