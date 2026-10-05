/**
 * The process and its fair value — pure, no server. `npm run test:process`.
 *
 * What has to be true for the round to be honest: the history really ends at
 * Y_open, a seed really pins a path, OLS on the simulator recovers the φ it was
 * given, a switch really waits for its tick, and the fair value the reveal
 * plots is the probability a Monte Carlo of the same process would give.
 */
import assert from "node:assert";
import { Phi, makePath, phiAt, fairValue, fitAR1, naivePrice, normalizeParams } from "../shared/process.js";
import { rngFrom, gaussian } from "../shared/rng.js";
import { DEFAULTS, csvText, aiPrompt, publicRows } from "../shared/rules.js";

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

const base = { phi1: 0.9, phi2: 0.9, switchTick: null, sigma: 1, mu: 100, K: 100, yOpen: 105, H: 150, T: 60, seed: "s" };

console.log("\nΦ");

ok("Φ matches the standard normal CDF to 1e-6 (reference: Python math.erfc)", () => {
  const ref = [
    [0, 0.5],
    [0.5, 0.6914624612740131],
    [1, 0.8413447460685429],
    [-1, 0.15865525393145707],
    [1.96, 0.9750021048517795],
    [-1.96, 0.024997895148220435],
    [2.5, 0.9937903346742238],
    [-3, 0.0013498980316300957],
    [3, 0.9986501019683699],
    [-5, 2.8665157187919455e-7],
    [5, 0.9999997133484281],
    [-7.5, 3.1908916729109203e-14],
    [0.1234, 0.5491048214630145],
    [-0.8, 0.2118553985833967],
  ];
  for (const [x, want] of ref) assert.ok(Math.abs(Phi(x) - want) < 1e-6, `Φ(${x}) = ${Phi(x)}, want ${want}`);
  // Symmetry and the tails, over a dense grid.
  for (let x = -8; x <= 8; x += 0.01) assert.ok(Math.abs(Phi(x) + Phi(-x) - 1) < 1e-12, `Φ(x)+Φ(-x) at ${x}`);
  assert.strictEqual(Phi(Infinity), 1);
  assert.strictEqual(Phi(-Infinity), 0);
});

console.log("\nthe process");

ok("the history ends exactly at Y_open, for every φ and any opening value", () => {
  for (const phi1 of [0.5, 0.9, 1, -0.3]) {
    for (const yOpen of [105, 99.5, -12.25, 100000.0001]) {
      const { history, path } = makePath({ ...base, phi1, phi2: phi1, yOpen, seed: `h-${phi1}-${yOpen}` });
      assert.strictEqual(history.length, base.H);
      assert.strictEqual(history[history.length - 1], yOpen, `φ=${phi1}`);
      assert.strictEqual(path[0], yOpen, "the live path starts where the history stops");
      assert.strictEqual(path.length, base.T + 1);
    }
  }
  // The admin form rounds Y_open onto the 4-dp grid, so even 105.123456 is exact.
  const p = normalizeParams({ yOpen: "105.123456" }, DEFAULTS);
  assert.strictEqual(makePath({ ...base, ...p, seed: "x" }).history.at(-1), 105.1235);
});

ok("the same seed gives the same path; a different seed a different one", () => {
  const a = makePath(base);
  const b = makePath(base);
  assert.deepStrictEqual(a, b);
  const c = makePath({ ...base, seed: "t" });
  assert.notDeepStrictEqual(a.history, c.history);
  assert.notDeepStrictEqual(a.path, c.path);
  // Separate streams: changing T leaves the history alone, changing H the live ticks.
  assert.deepStrictEqual(makePath({ ...base, T: 90 }).history, a.history);
  assert.deepStrictEqual(makePath({ ...base, H: 40 }).path, a.path);
});

ok("OLS φ̂ on a long simulated path is within ±0.02 of the true φ, for φ = 0.5, 0.9 and 1.0", () => {
  for (const phi of [0.5, 0.9, 1.0]) {
    // Forward and backward generators both, since the room fits a history.
    const fwd = makePath({ ...base, phi1: phi, phi2: phi, H: 20, T: 20_000, yOpen: 100, seed: `ols-f-${phi}` }).path;
    const bwd = makePath({ ...base, phi1: phi, phi2: phi, H: 20_000, T: 5, yOpen: 100, seed: `ols-b-${phi}` }).history;
    for (const [label, ys] of [["forward", fwd], ["backward", bwd]]) {
      const f = fitAR1(ys);
      assert.ok(Math.abs(f.phi - phi) < 0.02, `${label} φ=${phi}: φ̂=${f.phi.toFixed(4)}`);
      assert.ok(Math.abs(f.sigma - 1) < 0.03, `${label} φ=${phi}: σ̂=${f.sigma.toFixed(4)}`);
    }
  }
});

ok("a regime switch applies only AFTER the switch tick", () => {
  const spec = { ...base, phi1: 0.5, phi2: 1, switchTick: 10, mu: 0, sigma: 0, yOpen: 1024, T: 20 };
  for (let s = 1; s <= 20; s++) assert.strictEqual(phiAt(spec, s), s <= 10 ? 0.5 : 1, `tick ${s}`);
  // With no noise the path is the recursion itself: halving up to tick 10, then flat.
  const { path, history } = makePath(spec);
  assert.strictEqual(path[9], 2);
  assert.strictEqual(path[10], 1);
  assert.strictEqual(path[11], 1, "tick 11 must already use φ2 = 1");
  assert.strictEqual(path[20], 1);
  // And the history never sees φ2: the backward step is the same map with φ1,
  // so it halves going back (φ2 = 1 would have left it at 1024).
  assert.strictEqual(history.at(-2), 512);
  assert.strictEqual(history.at(-3), 256);
  // The reverse switch: a walk that starts mean-reverting at tick 4.
  const rev = makePath({ ...spec, phi1: 1, phi2: 0.5, switchTick: 4, yOpen: 64 }).path;
  assert.deepStrictEqual(rev.slice(0, 8), [64, 64, 64, 64, 64, 32, 16, 8]);
  // No switch: φ2 is ignored entirely.
  assert.strictEqual(phiAt({ ...spec, switchTick: null, phi2: 7 }, 15), 0.5);
});

console.log("\nfair value");

/** P(Y_T > K) by brute force from Y at `tick`, under the true spec. */
function monteCarlo(spec, y0, tick, n, seed) {
  const rand = rngFrom(seed);
  let above = 0;
  for (let i = 0; i < n; i++) {
    let y = y0;
    for (let s = tick + 1; s <= spec.T; s++) {
      const phi = phiAt(spec, s);
      y = spec.mu + phi * (y - spec.mu) + spec.sigma * gaussian(rand);
    }
    if (y > spec.K) above++;
  }
  return above / n;
}

ok("matches a 20,000-path Monte Carlo within 1.5 pp: AR(1), random walk, and a regime switch", () => {
  const cases = [
    ["AR(1) φ=0.9 from the open", { ...base, phi1: 0.9, phi2: 0.9, K: 100 }, 0],
    ["AR(1) φ=0.9 near the bell", { ...base, phi1: 0.9, phi2: 0.9, K: 100.8, yOpen: 101.5 }, 52],
    ["AR(1) φ=0.5, K below μ", { ...base, phi1: 0.5, phi2: 0.5, K: 99.3 }, 0],
    ["random walk", { ...base, phi1: 1, phi2: 1, K: 103 }, 0],
    ["random walk, mid-round", { ...base, phi1: 1, phi2: 1, K: 107 }, 25],
    ["regime switch 0.9 → 1 at 30, before it", { ...base, phi1: 0.9, phi2: 1, switchTick: 30, K: 101 }, 10],
    ["regime switch 0.9 → 1 at 30, after it", { ...base, phi1: 0.9, phi2: 1, switchTick: 30, K: 101 }, 40],
    ["regime switch 1 → 0.6 at 20", { ...base, phi1: 1, phi2: 0.6, switchTick: 20, K: 100.5 }, 5],
  ];
  for (const [label, spec, tick] of cases) {
    const { path } = makePath({ ...spec, seed: `fv-${label}` });
    const fv = fairValue(spec, path, tick);
    const mc = monteCarlo(spec, path[tick], tick, 20_000, `mc-${label}`);
    assert.ok(Math.abs(fv - mc) < 0.015, `${label}: closed form ${(fv * 100).toFixed(2)} vs MC ${(mc * 100).toFixed(2)}`);
  }
});

ok("at the bell the fair value is the settlement: 1 above K, 0 at or below", () => {
  const spec = { ...base };
  const { path } = makePath(spec);
  assert.strictEqual(fairValue({ ...spec, K: path[spec.T] - 0.0001 }, path, spec.T), 1);
  assert.strictEqual(fairValue({ ...spec, K: path[spec.T] }, path, spec.T), 0);
});

ok("the same chart is worth very different prices depending on φ (the lesson, as a number)", () => {
  // Y_open = 105, K = μ = 100, 60 ticks to go.
  const path = [105];
  const mr = fairValue({ ...base, phi1: 0.9, phi2: 0.9 }, path, 0);
  const rw = fairValue({ ...base, phi1: 1, phi2: 1 }, path, 0);
  assert.ok(Math.abs(mr - 0.5) < 0.01, `mean-reverting ${mr}`);
  assert.ok(rw > 0.7, `random walk ${rw}`);
  // The naive desk prices the random walk whatever the truth.
  const ys = makePath({ ...base, phi1: 1, phi2: 1, seed: "naive" }).history;
  assert.ok(Math.abs(naivePrice(ys, 100, 60) - rw) < 0.1, "naive ≈ the random-walk price when σ̂ ≈ σ");
  assert.strictEqual(naivePrice([1, 2, 3], 2, 0), 1);
});

console.log("\nthe data a player gets");

ok("the CSV and the AI prompt carry the contract and the data, and never the process", () => {
  const spec = { ...base, phi1: 0.913, phi2: 0.977, switchTick: 23, mu: 97.31, sigma: 1.37, seed: "zebra-seed" };
  const { history, path } = makePath(spec);
  const d = { roundId: "r9", K: 101, T: 60, secondsPerTick: 4, tick: 7, history, live: path.slice(1, 8) };
  const csv = csvText(d);
  const lines = csv.trim().split("\n");
  assert.strictEqual(lines.filter((l) => !l.startsWith("#")).length, 1 + history.length + 7, "header + every public row");
  assert.match(csv, /^t,y$/m);
  assert.match(csv, /K=101/);
  assert.match(csv, /seconds per tick: 4/);
  assert.match(csv, /current tick: 7 of 60/);
  assert.match(lines.at(-1), new RegExp(`^7,${path[7].toFixed(4)}$`));
  const prompt = aiPrompt(d);
  for (const text of [csv, prompt]) {
    assert.ok(!/0\.913|0\.977|97\.31|1\.37\b|zebra|switch|regime/i.test(text), "the process leaked");
    assert.ok(!text.includes(path[8].toFixed(4)), "an unrevealed tick leaked");
  }
  assert.strictEqual(publicRows(d).length, history.length + 7);
  for (const must of [/ACF/, /regress/i, /distinguishable from\s+1/i, /phi\^h/, /h sigma\^2/, /may not stay the same/]) {
    assert.match(prompt, must);
  }
});

ok("the admin form rejects nonsense and reads blanks as defaults", () => {
  const d = normalizeParams({}, DEFAULTS);
  assert.strictEqual(d.phi1, 0.9);
  assert.strictEqual(d.switchTick, null);
  assert.strictEqual(d.phi2, 0.9, "with no switch, φ2 is φ1");
  assert.strictEqual(d.secondsPerTick, 4);
  assert.throws(() => normalizeParams({ secondsPerTick: 31 }, DEFAULTS), /between 1 and 30/);
  assert.throws(() => normalizeParams({ secondsPerTick: 0.5 }, DEFAULTS), /between 1 and 30/);
  assert.throws(() => normalizeParams({ phi1: 1.2 }, DEFAULTS), /φ1/);
  assert.throws(() => normalizeParams({ switchTick: 60, T: 60 }, DEFAULTS), /switch tick/);
  assert.throws(() => normalizeParams({ sigma: "abc" }, DEFAULTS), /number/);
  const sw = normalizeParams({ phi1: 0.9, phi2: 1, switchTick: "30" }, DEFAULTS);
  assert.deepStrictEqual([sw.phi1, sw.phi2, sw.switchTick], [0.9, 1, 30]);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
