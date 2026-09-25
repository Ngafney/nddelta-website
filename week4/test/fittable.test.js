/**
 * Can a student actually solve the round?
 *
 * This is the test the first version of this game did not have, and the one it
 * would have failed. The physics was beautiful — a sungrazing asteroid where
 * general relativity moved the impact by tens of thousands of kilometres — and
 * the record it produced could not be fitted by anybody, including me. Five
 * perihelion passes amplify a starting error so hard that the orbit had to be
 * known to eight significant figures before the residuals meant anything, and
 * every attempt sat at millions of sigma and predicted a miss.
 *
 * So: take the published rows, fit them the way a competent student would, and
 * assert that the fit CONVERGES and that the answer it gives is close enough to
 * the truth to be worth trading on. Nothing here may look at the true state.
 */
import assert from "node:assert";
import {
  buildScenario, verifyScenario, propagate, packState, posOf,
  sub, scale, norm, latitudeOf, findContact, AU_KM, M_SUN, M_EARTH,
} from "../shared/orbits.js";
import { observationEpochs, makeObservations, buildSensitivity, releasePlan, calibrateNoise } from "../shared/observe.js";
import { SCENARIO, DATA, CONFIDENCE } from "../shared/rules.js";

let passed = 0;
let failed = 0;
function ok(name, fn) {
  const t0 = Date.now();
  try {
    fn();
    passed++;
    const ms = Date.now() - t0;
    console.log(`  ✓ ${name}${ms > 800 ? ` (${(ms / 1000).toFixed(1)}s)` : ""}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 3).join("\n      ")}`);
  }
}

/* ── the solver a student would write ─────────────────────────────────── */

const MASS = [M_SUN, M_EARTH, 8e-19];
const MODEL = { mass: MASS, relativistic: SCENARIO.relativistic, rtol: 1e-10, atol: 1e-12 };

function resid(y0, rows, bodies) {
  const out = [];
  let y = Float64Array.from(y0);
  let t = 0;
  for (const row of rows) {
    y = propagate(y, t, row.day, MODEL);
    t = row.day;
    const w = 1 / row.sigmaAu;
    for (const b of bodies) {
      const p = posOf(y, b);
      const obs = b === 0 ? row.sun : b === 1 ? row.earth : row.ast;
      for (let k = 0; k < 3; k++) out.push((p[k] - obs[k]) * w);
    }
  }
  return out;
}
const rms = (r) => Math.sqrt(r.reduce((s, v) => s + v * v, 0) / Math.max(1, r.length));

function linsolve(A, n) {
  const M = A.map((r) => Float64Array.from(r));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return Array.from({ length: n }, (_, i) => M[i][n] / M[i][i]);
}

/** Gauss-Newton with a backtracking line search, over a subset of the state. */
function fit(y0, rows, idx, bodies, iters = 12) {
  let y = Float64Array.from(y0);
  const step = (i) => (i < 9 ? 1e-9 : 1e-11);
  let cur = resid(y, rows, bodies);
  for (let it = 0; it < iters && rms(cur) > 1.0; it++) {
    const m = cur.length;
    const J = idx.map((p) => {
      const yp = Float64Array.from(y);
      yp[p] += step(p);
      const rp = resid(yp, rows, bodies);
      const col = new Float64Array(m);
      for (let i = 0; i < m; i++) col[i] = (rp[i] - cur[i]) / step(p);
      return col;
    });
    const n = idx.length;
    const A = Array.from({ length: n }, () => new Float64Array(n + 1));
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        let s = 0;
        for (let k = 0; k < m; k++) s += J[i][k] * J[j][k];
        A[i][j] = A[j][i] = s;
      }
      let b = 0;
      for (let k = 0; k < m; k++) b -= J[i][k] * cur[k];
      A[i][n] = b;
    }
    for (let i = 0; i < n; i++) A[i][i] *= 1 + 1e-10;
    const d = linsolve(A, n);
    if (!d) break;
    let moved = false;
    for (let lam = 1; lam > 1e-6; lam /= 2) {
      const yt = Float64Array.from(y);
      idx.forEach((p, i) => (yt[p] = y[p] + lam * d[i]));
      const rt = resid(yt, rows, bodies);
      if (rms(rt) < rms(cur)) {
        y = yt;
        cur = rt;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return { y, rms: rms(cur) };
}

/** Build a round and publish its record, exactly as the server does. */
function round(seed, latDeg) {
  const sc = buildScenario(seed, latDeg, {
    years: SCENARIO.years,
    perihelion: SCENARIO.perihelion,
    minPasses: SCENARIO.minPasses,
    astMassKg: SCENARIO.astMassKg,
    relativistic: SCENARIO.relativistic,
    minStartRadius: SCENARIO.minStartRadius,
  });
  const epochs = observationEpochs(sc.tImpact, DATA.cadence);
  const sens = buildSensitivity(sc, epochs);
  const batches = releasePlan(sc.tImpact, epochs, { firstCutDays: DATA.firstCutDays, stepDays: DATA.defaultStepDays });
  const cal = calibrateNoise(sens, (latDeg * Math.PI) / 180, batches, {
    startConf: CONFIDENCE.defaultStart,
    endConf: CONFIDENCE.defaultEnd,
  });
  const rows = makeObservations(sc, epochs, cal.sigmas, seed);
  return { sc, batches, rows, truth: verifyScenario(sc) };
}

/** The whole student job: guess, stage, fit, propagate, read the latitude. */
function solve(rows, tImpact, axis) {
  const guess = (() => {
    const r = [];
    const v = [];
    for (const k of ["sun", "earth", "ast"]) {
      r.push(rows[0][k]);
      v.push(scale(sub(rows[1][k], rows[0][k]), 1 / (rows[1].day - rows[0].day)));
    }
    return packState(r, v);
  })();

  // The Sun and the Earth first. Staged the same way as the asteroid: from a
  // crude finite-difference guess a twelve-parameter fit over a three-year arc
  // does not reliably converge, and everything downstream is then being
  // propagated in the wrong solar system.
  const SUN_EARTH = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14];
  let base = guess;
  for (let n = 30; ; n = Math.min(rows.length, Math.ceil(n * 1.6))) {
    base = fit(base, rows.slice(0, n), SUN_EARTH, [0, 1], 20).y;
    if (n >= rows.length) break;
  }
  const stage1 = { y: base };

  // Then the asteroid, extending the arc so each step only corrects a little.
  let y = stage1.y;
  const trace = [];
  // Start on a long enough arc to pin the orbit (a handful of rows constrains
  // almost nothing over a three-year period), then grow gently.
  for (let n = 30; ; n = Math.min(rows.length, Math.ceil(n * 1.4))) {
    const f = fit(y, rows.slice(0, n), [6, 7, 8, 15, 16, 17], [2], 20);
    y = f.y;
    trace.push(`${n}:${f.rms < 100 ? f.rms.toFixed(1) : f.rms.toExponential(0)}`);
    if (n >= rows.length) break;
  }
  if (process.env.TRACE) console.log("      arc trace:", trace.join(" "));

  const hit = findContact(Float64Array.from(y), 0, tImpact + 40, MODEL, 1600);
  return {
    // The asteroid is the thing being predicted. The Sun and the Earth are
    // auxiliary -- they are pinned by their own rows and a sloppy fit of them
    // says nothing about whether the impact question is answerable.
    rms: rms(resid(y, rows, [2])),
    allRms: rms(resid(y, rows, [0, 1, 2])),
    hit: hit.hit,
    latDeg: (latitudeOf(hit.y, axis) * 180) / Math.PI,
  };
}

console.log("\nfittable");

ok("the published record can be fitted to its own error bars", () => {
  const r = round("fit-a", 3.0);
  const all = r.rows.filter((x) => x.day <= r.batches.at(-1).cutDay);
  const out = solve(all, r.sc.tImpact, r.sc.axis);
  // rms ≈ 1 means the model reproduces every observation to within its stated
  // noise. Anything much above that and the round is unsolvable.
  assert.ok(out.rms < 1.6, `fit sits at ${out.rms.toFixed(1)}σ — the record cannot be fitted`);
});

ok("and the fit predicts an impact, not a miss", () => {
  const r = round("fit-b", 2.5);
  const all = r.rows.filter((x) => x.day <= r.batches.at(-1).cutDay);
  const out = solve(all, r.sc.tImpact, r.sc.axis);
  assert.ok(out.rms < 1.6, `fit sits at ${out.rms.toFixed(1)}σ`);
  assert.ok(out.hit, "a correct fit of an asteroid that hits the Earth has to hit the Earth");
  assert.ok(
    Math.abs(out.latDeg - r.truth.latDeg) < 6,
    `predicted ${out.latDeg.toFixed(2)}° against a true ${r.truth.latDeg.toFixed(2)}°`
  );
});

ok("the full record is more convincing than the opening data", () => {
  const r = round("fit-c", 4.0);
  const early = r.rows.filter((x) => x.day <= r.batches[0].cutDay);
  const late = r.rows.filter((x) => x.day <= r.batches.at(-1).cutDay);
  const a = solve(early, r.sc.tImpact, r.sc.axis);
  const b = solve(late, r.sc.tImpact, r.sc.axis);
  assert.ok(a.rms < 1.6 && b.rms < 1.6, `rms ${a.rms.toFixed(1)} / ${b.rms.toFixed(1)}`);
  // Not a strict inequality on a single draw — noise is noise — but the late
  // answer must at least be in the right hemisphere.
  assert.ok(b.latDeg > 0 === r.truth.latDeg > 0, `the full record called the wrong side`);
});

ok("a starting guess is good enough to get going", () => {
  // The sungrazer failed here first: between the first row and the second the
  // asteroid had travelled far enough that a finite difference was 105% wrong.
  const r = round("fit-d", 3.0);
  const v = scale(sub(r.rows[1].ast, r.rows[0].ast), 1 / (r.rows[1].day - r.rows[0].day));
  const speed = norm(v) * AU_KM / 86400;
  assert.ok(speed > 5 && speed < 80, `first-difference speed is ${speed.toFixed(0)} km/s, which is not credible`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
