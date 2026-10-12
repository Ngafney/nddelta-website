/**
 * The pot's arithmetic — pure, no server. `npm run test:game`.
 *
 * What has to be true for the round to be honest: the payoffs are what the
 * rules say, the parity identity holds at every S, the uniform-prior fair
 * value is the probability a Monte Carlo of the same pot would give, the
 * seeded shuffle is a permutation, and the admin form rejects nonsense.
 */
import assert from "node:assert";
import { payoff, payRange, sumBounds, sumPmf, fairUniform, fairAll, shuffle, drawNumber, validNumber, normalizeParams, resolveStrike } from "../shared/game.js";
import { DEFAULTS, BOOK_ORDER } from "../shared/rules.js";
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

console.log("\npayoffs");

ok("the three payoffs are what the rules say, and CALL − PUT = SUM − K at every S", () => {
  for (const K of [1, 7, 25, 60, 149]) {
    for (let S = 0; S <= 150; S++) {
      assert.strictEqual(payoff("fut", S, K), S);
      assert.strictEqual(payoff("call", S, K), Math.max(S - K, 0));
      assert.strictEqual(payoff("put", S, K), Math.max(K - S, 0));
      assert.strictEqual(payoff("call", S, K) - payoff("put", S, K), S - K, `parity at S=${S} K=${K}`);
      assert.ok(payoff("call", S, K) >= 0 && payoff("put", S, K) >= 0, "an option never pays less than zero");
    }
  }
  assert.throws(() => payoff("straddle", 1, 1), /no such book/);
});

ok("payRange brackets every payoff over an interval of sums", () => {
  for (const K of [5, 50]) {
    for (const [lo, hi] of [[0, 100], [12, 12], [40, 61], [0, 4], [90, 100]]) {
      for (const k of BOOK_ORDER) {
        const [a, b] = payRange(k, lo, hi, K);
        assert.ok(a <= b);
        for (let S = lo; S <= hi; S++) {
          const p = payoff(k, S, K);
          assert.ok(p >= a && p <= b, `${k} at ${S} in [${lo},${hi}]: ${p} not in [${a},${b}]`);
        }
        assert.ok([lo, hi].some((S) => payoff(k, S, K) === a) && [lo, hi].some((S) => payoff(k, S, K) === b), "extremes at the ends");
      }
    }
  }
});

ok("the bounds on S tighten by exactly what has come out", () => {
  assert.deepStrictEqual(sumBounds(5, []), { sum: 0, left: 5, lo: 0, hi: 50 });
  assert.deepStrictEqual(sumBounds(5, [7, 0]), { sum: 7, left: 3, lo: 7, hi: 37 });
  assert.deepStrictEqual(sumBounds(5, [7, 0, 10, 3, 4]), { sum: 24, left: 0, lo: 24, hi: 24 });
  assert.deepStrictEqual(sumBounds(0, []), { sum: 0, left: 0, lo: 0, hi: 0 });
});

console.log("\nthe uniform prior");

ok("the pmf of a sum of uniforms sums to one, has mean 5m and variance 10m", () => {
  for (const m of [0, 1, 2, 5, 12, 40]) {
    const p = sumPmf(m);
    assert.strictEqual(p.length, 10 * m + 1);
    const total = p.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(total - 1) < 1e-12, `m=${m} total ${total}`);
    const mean = p.reduce((s, v, i) => s + v * i, 0);
    const vr = p.reduce((s, v, i) => s + v * (i - mean) ** 2, 0);
    assert.ok(Math.abs(mean - 5 * m) < 1e-9, `m=${m} mean ${mean}`);
    assert.ok(Math.abs(vr - 10 * m) < 1e-9, `m=${m} var ${vr}`);
  }
  assert.deepStrictEqual(sumPmf(0), [1]);
  assert.ok(sumPmf(1).every((v) => Math.abs(v - 1 / 11) < 1e-12));
});

/** E[payoff] by brute force: m uniforms on 0..10 on top of what is known. */
function monteCarlo(key, N, revealed, K, n, seed) {
  const rand = rngFrom(seed);
  const { sum, left } = sumBounds(N, revealed);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    let S = sum;
    for (let j = 0; j < left; j++) S += Math.floor(rand() * 11);
    acc += payoff(key, S, K);
  }
  return acc / n;
}

ok("fairUniform matches a 40,000-draw Monte Carlo within 0.3 for every book, at the open and mid-reveal", () => {
  const cases = [
    ["8 teams, nothing out, K at the mean", 8, [], 40],
    ["8 teams, 3 out", 8, [7, 2, 9], 40],
    ["8 teams, K far above", 8, [5, 5], 70],
    ["8 teams, K far below", 8, [5, 5], 12],
    ["3 teams, 2 out", 3, [10, 0], 15],
    ["20 teams, 11 out", 20, [7, 7, 7, 3, 8, 6, 5, 9, 2, 7, 4], 100],
    ["1 team, nothing out", 1, [], 5],
  ];
  for (const [label, N, revealed, K] of cases) {
    for (const k of BOOK_ORDER) {
      const fv = fairUniform(k, N, revealed, K);
      const mc = monteCarlo(k, N, revealed, K, 40_000, `mc-${label}-${k}`);
      assert.ok(Math.abs(fv - mc) < 0.3, `${label} ${k}: exact ${fv.toFixed(3)} vs MC ${mc.toFixed(3)}`);
    }
  }
});

ok("fair values obey parity exactly and collapse to the payoff when the pot is empty", () => {
  for (const [N, revealed, K] of [[6, [], 30], [6, [1, 2, 3], 30], [6, [9, 9, 9, 9, 9, 9], 30], [10, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 50]]) {
    const f = fairAll(N, revealed, K);
    assert.ok(Math.abs(f.call - f.put - (f.fut - K)) < 1e-9, `parity at N=${N}`);
    assert.ok(Math.abs(f.fut - (sumBounds(N, revealed).sum + 5 * sumBounds(N, revealed).left)) < 1e-9, "E[S] = revealed + 5 × left");
    if (revealed.length === N) {
      const S = revealed.reduce((a, b) => a + b, 0);
      for (const k of BOOK_ORDER) assert.strictEqual(f[k], payoff(k, S, K));
    }
  }
});

console.log("\nthe draw");

ok("the reveal order is a seeded permutation: same seed same order, different seed different order", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `team-${i}`);
  const a = shuffle(ids, "s1");
  const b = shuffle(ids, "s1");
  const c = shuffle(ids, "s2");
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
  assert.deepStrictEqual([...a].sort(), [...ids].sort(), "every team exactly once");
  assert.deepStrictEqual(ids, Array.from({ length: 12 }, (_, i) => `team-${i}`), "the input is not touched");
  assert.deepStrictEqual(shuffle([], "x"), []);
  assert.deepStrictEqual(shuffle(["only"], "x"), ["only"]);
  // Over many seeds every position is reachable for a given team.
  const seen = new Set();
  for (let s = 0; s < 400; s++) seen.add(shuffle(ids, `many-${s}`).indexOf("team-0"));
  assert.strictEqual(seen.size, 12);
});

ok("a drawn number is a legal number, and uniform-ish over many seeds", () => {
  const counts = new Array(11).fill(0);
  for (let s = 0; s < 11_000; s++) {
    const n = drawNumber(`draw-${s}`);
    assert.ok(validNumber(n), `${n}`);
    counts[n]++;
  }
  for (const c of counts) assert.ok(c > 700 && c < 1300, `counts ${counts}`);
  assert.strictEqual(drawNumber("fixed"), drawNumber("fixed"));
  for (const bad of [-1, 11, 2.5, NaN, "7", null]) assert.ok(!validNumber(bad), `${bad}`);
  for (let n = 0; n <= 10; n++) assert.ok(validNumber(n));
});

console.log("\nthe admin form");

ok("blanks read as defaults, and the strike falls back to 5N when it cannot fit", () => {
  const d = normalizeParams({}, DEFAULTS);
  assert.strictEqual(d.K, null);
  assert.strictEqual(d.pickSeconds, 30);
  assert.strictEqual(d.autoOn, false);
  assert.deepStrictEqual(d.books, { fut: true, call: false, put: false });
  assert.deepStrictEqual(d.noise, { on: true, desks: 2, everySec: 12, size: 10, sweep: 4 });
  const p = normalizeParams({ K: "48", pickSeconds: "45", autoOn: "true", autoEverySec: 5, books: { fut: "true", call: "true", put: "" }, noise: { on: "false", desks: "4", everySec: "6", size: "25", sweep: "0" } }, DEFAULTS);
  assert.strictEqual(p.K, 48);
  assert.strictEqual(p.autoOn, true);
  assert.deepStrictEqual(p.books, { fut: true, call: true, put: false });
  assert.deepStrictEqual(p.noise, { on: false, desks: 4, everySec: 6, size: 25, sweep: 0 });
  assert.throws(() => normalizeParams({ K: "4.5" }, DEFAULTS), /whole number/);
  assert.throws(() => normalizeParams({ K: "0" }, DEFAULTS), /K must be between/);
  assert.throws(() => normalizeParams({ pickSeconds: 2 }, DEFAULTS), /pick seconds/);
  assert.throws(() => normalizeParams({ noise: { desks: 9 } }, DEFAULTS), /noise desks/);
  assert.throws(() => normalizeParams({ noise: { size: 0 } }, DEFAULTS), /noise size/);
  assert.throws(() => normalizeParams({ autoEverySec: "abc" }, DEFAULTS), /number/);

  assert.deepStrictEqual(resolveStrike(null, 8), { K: 40, auto: true });
  assert.deepStrictEqual(resolveStrike(33, 8), { K: 33, auto: false });
  assert.deepStrictEqual(resolveStrike(80, 8), { K: 40, auto: true }, "K = Smax cannot be a strike");
  assert.deepStrictEqual(resolveStrike(79, 8), { K: 79, auto: false });
  assert.deepStrictEqual(resolveStrike(null, 1), { K: 5, auto: true });
  assert.deepStrictEqual(resolveStrike(12, 1), { K: 5, auto: true });
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
