/**
 * Week 4 — what the students actually get to see, and how wrong it is.
 *
 * The operator does not choose a noise level in kilometres. Nobody knows what
 * 40,000 km of astrometric error is worth. They choose a CONFIDENCE: "with the
 * first six months of data, a good team should be about 65% sure which side of
 * the equator it lands on." This file turns that sentence into a number.
 *
 * HOW
 * ---
 * The impact latitude φ is a smooth function of the nineteen numbers that
 * define the system: eighteen for the initial positions and velocities of the
 * three bodies, and one for GM of the Sun. Observations constrain those
 * nineteen. So:
 *
 *   1. Differentiate the observations with respect to all nineteen parameters
 *      (finite differences — nineteen extra integrations, once per round).
 *   2. Differentiate the impact latitude with respect to the same nineteen.
 *   3. Fisher information F = HᵀWH + prior. Covariance C = F⁻¹.
 *      The uncertainty in the latitude is σ_φ² = gᵀ C g.
 *   4. The chance of calling the side correctly is Φ(|φ*| / σ_φ).
 *
 * Step 4 inverts cleanly, which is the whole trick: σ_φ scales linearly with
 * the observation noise, so "what noise gives 65%?" is one bisection, not a
 * Monte Carlo.
 *
 * WHY LATER DATA IS CLEANER
 * -------------------------
 * One smooth curve, σ = k · range^p, not a per-release staircase. The asteroid
 * is closing, so it is brighter and better resolved, and astrometric error
 * genuinely falls as an object approaches. Students see the error bar on every
 * row, so nothing is hidden.
 *
 * WHAT THE CURVE ACTUALLY LOOKS LIKE
 * ----------------------------------
 * Flat, then steep. From six months out to about three months out the extra
 * weeks barely help — two and a half years of arc are already in hand and
 * another thirty rows add little. The gain arrives in the last stretch, when
 * the range finally collapses and the same telescope suddenly measures a far
 * smaller distance. That is the honest shape of orbit determination and the
 * operator is shown the real per-release numbers rather than a straight line
 * that was never available.
 */

import { rngFrom, gaussian } from "./rng.js";
import {
  propagate, posOf, velOf, packState, sub, unit, dot, norm, scale,
  AU_KM, GM_SUN, M_SUN, M_EARTH, AST, EARTH, SUN,
} from "./orbits.js";

/* ── the normal distribution, both ways ───────────────────────────────── */

/** Φ(z). Abramowitz & Stegun 7.1.26 on erf; good to ~1e-7, plenty here. */
export function normalCdf(z) {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

/** Φ⁻¹(p), by bisection. Called a handful of times per round. */
export function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let lo = -9, hi = 9;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/* ── observation schedule ─────────────────────────────────────────────── */

/**
 * Observation epochs, in days from the start of the record.
 * The final entry is the impact itself — never published, used to measure
 * where the answer moves when a parameter is nudged.
 */
export function observationEpochs(tImpact, cadence = { far: 5, mid: 2, near: 1 }) {
  const epochs = [];
  let t = 0;
  while (t <= tImpact - 0.5) {
    epochs.push(round6(t));
    const lead = tImpact - t;
    // A survey looks at a rock more often once it is obviously coming.
    t += lead > 365 ? cadence.far : lead > 180 ? cadence.mid : cadence.near;
  }
  return epochs;
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/* ── the derivative machinery ─────────────────────────────────────────── */

/**
 * Steps for the finite differences. Chosen per parameter type so each one
 * produces a change well above the integrator's noise floor and well below
 * anything non-linear.
 */
function parameterSteps() {
  const steps = new Array(19);
  for (let i = 0; i < 9; i++) steps[i] = 1e-8; // positions, AU
  for (let i = 9; i < 18; i++) steps[i] = 1e-10; // velocities, AU/day
  steps[18] = GM_SUN * 1e-8; // GM of the Sun
  return steps;
}

/** The latitude observable, as a smooth function that survives a near miss. */
function latObservable(yT, axis) {
  const d = sub(posOf(yT, AST), posOf(yT, EARTH));
  return Math.asin(Math.max(-1, Math.min(1, dot(unit(d), axis))));
}

/**
 * Build the sensitivity tables for one scenario. This is the expensive part of
 * setting up a round — twenty three-year integrations — and it is done once.
 *
 * Returns H (one row per scalar observation, one column per parameter, already
 * scaled so every column is in units of its own step) and g (the same for the
 * impact latitude).
 */
export function buildSensitivity(scenario, epochs) {
  const { y0, mass, tImpact, axis } = scenario;
  // Differentiate the SAME dynamics the round is played on, or the covariance
  // describes a solar system nobody is trading.
  const relativistic = scenario.relativistic ?? false;
  const steps = parameterSteps();
  const sample = [...epochs, tImpact];

  const run = (state, gmScale) => {
    const opts = {
      mass: gmScale === 1 ? mass : mass.map((m, i) => (i === SUN ? m * gmScale : m)),
      relativistic,
      rtol: 1e-12,
      atol: 1e-14,
    };
    const out = [];
    let y = Float64Array.from(state);
    let t = 0;
    for (const e of sample) {
      y = propagate(y, t, e, opts);
      t = e;
      out.push(Float64Array.from(y));
    }
    return out;
  };

  const base = run(y0, 1);
  const baseLat = latObservable(base[base.length - 1], axis);

  const nObs = epochs.length * 9; // three bodies × three components
  const H = [];
  for (let i = 0; i < nObs; i++) H.push(new Float64Array(19));
  const g = new Float64Array(19);

  // How far away the asteroid is at each epoch. The noise model is driven by
  // this, so it comes out of the same integration rather than a second one.
  const range = epochs.map((_, e) => norm(sub(posOf(base[e], AST), posOf(base[e], EARTH))));

  for (let p = 0; p < 19; p++) {
    let states;
    if (p === 18) {
      // GM enters through the mass array, not the state vector.
      states = run(y0, 1 + 1e-8);
    } else {
      const bumped = Float64Array.from(y0);
      bumped[p] += steps[p];
      states = run(bumped, 1);
    }
    for (let e = 0; e < epochs.length; e++) {
      for (let k = 0; k < 9; k++) {
        H[e * 9 + k][p] = states[e][k] - base[e][k];
      }
    }
    g[p] = latObservable(states[states.length - 1], axis) - baseLat;
  }

  // Each epoch contributes w · Gᵉ to the Fisher matrix, where Gᵉ is fixed and
  // w is one over its variance. Precomputing Gᵉ turns every later evaluation
  // into a weighted sum instead of a full pass over two thousand rows, which
  // is what makes solving for the noise model affordable.
  const blocks = epochs.map((_, e) => {
    const G = [];
    for (let i = 0; i < 19; i++) G.push(new Float64Array(19));
    for (let k = 0; k < 9; k++) {
      const row = H[e * 9 + k];
      for (let i = 0; i < 19; i++) {
        if (row[i] === 0) continue;
        for (let j = i; j < 19; j++) G[i][j] += row[i] * row[j];
      }
    }
    return G;
  });

  return { H, g, steps, epochs, baseLat, nObs, range, blocks };
}

/* ── linear algebra, small and symmetric ──────────────────────────────── */

/** Solve F x = b for symmetric positive definite F, with a jitter fallback. */
function spdSolve(F, b) {
  const n = b.length;
  for (let attempt = 0; attempt < 8; attempt++) {
    const jitter = attempt === 0 ? 0 : Math.pow(10, -12 + attempt);
    const L = [];
    for (let i = 0; i < n; i++) L.push(new Float64Array(n));
    let okay = true;
    for (let i = 0; i < n && okay; i++) {
      for (let j = 0; j <= i; j++) {
        let s = F[i][j] + (i === j ? jitter * (Math.abs(F[i][i]) + 1) : 0);
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (s <= 0) {
            okay = false;
            break;
          }
          L[i][i] = Math.sqrt(s);
        } else {
          L[i][j] = s / L[j][j];
        }
      }
    }
    if (!okay) continue;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = b[i];
      for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
      y[i] = s / L[i][i];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
      x[i] = s / L[i][i];
    }
    return x;
  }
  return null;
}

/**
 * σ of the impact latitude, in radians, given a noise level per epoch.
 *
 * `sigmaFor(epochIndex)` returns the 1σ position error on that epoch's rows,
 * in AU, or null for an epoch that has not been released.
 */
export function latitudeSigma(sens, sigmaFor, gmPriorRel = 5e-6) {
  const n = 19;
  const F = [];
  for (let i = 0; i < n; i++) F.push(new Float64Array(n));

  for (let e = 0; e < sens.epochs.length; e++) {
    const s = sigmaFor(e);
    if (!s || !Number.isFinite(s) || s <= 0) continue;
    const w = 1 / (s * s);
    const G = sens.blocks[e];
    for (let i = 0; i < n; i++) {
      const gi = G[i];
      const fi = F[i];
      for (let j = i; j < n; j++) fi[j] += w * gi[j];
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) F[i][j] = F[j][i];

  // The mass measurement is a prior on GM, in units of its own step.
  const gmSigmaInSteps = (GM_SUN * gmPriorRel) / sens.steps[18];
  F[18][18] += 1 / (gmSigmaInSteps * gmSigmaInSteps);
  // A very weak prior everywhere else keeps a half-determined direction from
  // blowing the inverse up before enough data has been released.
  for (let i = 0; i < 18; i++) F[i][i] += 1e-14;

  const x = spdSolve(F, sens.g);
  if (!x) return Infinity;
  const varPhi = dot2(sens.g, x);
  return varPhi > 0 ? Math.sqrt(varPhi) : Infinity;
}

const dot2 = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Chance a perfect analyst calls the side right, given σ on the latitude. */
export const confidenceFrom = (latRad, sigmaRad) =>
  sigmaRad <= 0 ? 1 : Math.min(0.999, normalCdf(Math.abs(latRad) / sigmaRad));

/* ── the release schedule ─────────────────────────────────────────────── */

/**
 * Cut the record into the batch the students start with and the batches the
 * operator drips out afterwards.
 */
export function releasePlan(tImpact, epochs, { firstCutDays = 180, stepDays = 30 } = {}) {
  const cuts = [];
  for (let lead = firstCutDays; lead >= stepDays; lead -= stepDays) cuts.push(tImpact - lead);
  // Anything still unseen at the last release stays unseen: the final month is
  // the part nobody gets, which is what keeps the question open.
  const batches = [];
  let from = -Infinity;
  for (const cut of cuts) {
    const idx = [];
    for (let i = 0; i < epochs.length; i++) if (epochs[i] > from && epochs[i] <= cut) idx.push(i);
    batches.push({ cutDay: cut, leadDays: tImpact - cut, indices: idx });
    from = cut;
  }
  return batches;
}

/**
 * Choose the observing noise from two numbers the operator understands.
 *
 * The model is physical rather than fitted per batch:
 *
 *     σ(t)  =  k · range(t)²  ·  e^(−λ·t)
 *
 * The range term is photon-limited astrometry: flux falls as 1/range², so the
 * signal-to-noise falls as 1/range, the centroid error grows as range, and the
 * POSITION error — centroid times range — grows as range².
 *
 * The time term is the survey getting better at this particular rock. Once it
 * is confirmed to be on an impact trajectory it stops being one faint dot in a
 * catalogue and starts getting deliberate, repeated, well-instrumented looks.
 *
 * Both axes are needed. Range alone cannot separate the opening data from the
 * closing data, because the record already contains a close pass years before
 * impact — steepen the range term and the FIRST release sharpens exactly as
 * much as the last, and the confidence ladder does not move at all.
 *
 * k anchors the first release and λ anchors the last, so solving the pair
 * against "65% now, 90% by the end" is a nested bisection. One smooth curve,
 * never a staircase of implausible jumps between releases.
 */
/** Photon-limited astrometry: flux ∝ 1/r², SNR ∝ 1/r, centroid ∝ r, position ∝ r². */
const RANGE_P = 2;

export function calibrateNoise(
  sens,
  latRad,
  batches,
  { startConf = 0.65, endConf = 0.9, gmPriorRel = 5e-6, rangeFloor = 0.2, pRange = [0, 5.7] } = {}
) {
  const rng = sens.range.map((r) => Math.max(r, rangeFloor));
  const lastCut = batches[batches.length - 1].cutDay;
  const firstCut = batches[0].cutDay;

  // Two axes, because range alone cannot separate early from late: the record
  // already contains a close pass years before impact, so steepening the range
  // term sharpens the OPENING data just as much as the closing data and the
  // two cancel. The second axis is time — a rock confirmed to be on an impact
  // trajectory stops being one dot among millions and starts getting the big
  // telescopes, so the survey's precision on it improves over the record.
  const span = sens.epochs[sens.epochs.length - 1] || 1;
  const sigmaAt = (k, p, e) => k * Math.pow(rng[e], RANGE_P) * Math.exp(-p * (sens.epochs[e] / span));
  const confAt = (k, p, cutDay) => {
    const sig = latitudeSigma(sens, (e) => (sens.epochs[e] <= cutDay ? sigmaAt(k, p, e) : null), gmPriorRel);
    return confidenceFrom(latRad, sig);
  };

  // For a given exponent, find the scale that nails the FIRST release.
  const scaleFor = (p) => {
    let lo = 1e-12, hi = 1;
    for (let i = 0; i < 70; i++) {
      const mid = Math.sqrt(lo * hi);
      if (confAt(mid, p, firstCut) > startConf) lo = mid;
      else hi = mid;
    }
    return Math.sqrt(lo * hi);
  };

  // Then find the exponent that lands the LAST release where it should.
  // The decay stays inside a band that can be defended out loud: e^5.7 is
  // about a 300-fold improvement over three years, which is roughly a faint
  // survey detection becoming a confirmed impactor under dedicated large-
  // telescope astrometry. Past that nobody would believe the data, so the
  // solver is allowed to FALL SHORT of the requested confidence and say so
  // rather than quietly inventing a telescope that does not exist. At the top
  // of it the implied ANGULAR precision runs from a few arcseconds on a faint
  // distant dot to a few hundredths on a bright, close, heavily-tracked one —
  // a wide range, but a real one. Past that the data stops being believable,
  // so the solver is allowed to fall short of the target instead.
  let [pLo, pHi] = pRange;
  let p = 2;
  let k = scaleFor(p);
  if (batches.length > 1) {
    for (let i = 0; i < 34; i++) {
      p = 0.5 * (pLo + pHi);
      k = scaleFor(p);
      if (confAt(k, p, lastCut) < endConf) pLo = p;
      else pHi = p;
    }
    p = 0.5 * (pLo + pHi);
    k = scaleFor(p);
  }
  const improvement = Math.exp(p); // how much sharper the last rows are than the first

  const sigmas = sens.epochs.map((_, e) => sigmaAt(k, p, e));
  const releases = batches.map((b, i) => {
    const target = batches.length === 1 ? startConf : startConf + ((endConf - startConf) * i) / (batches.length - 1);
    const sig = latitudeSigma(sens, (e) => (sens.epochs[e] <= b.cutDay ? sigmas[e] : null), gmPriorRel);
    const idx = b.indices;
    const lo = idx.length ? Math.min(...idx.map((e) => sigmas[e])) : 0;
    const hi = idx.length ? Math.max(...idx.map((e) => sigmas[e])) : 0;
    return {
      cutDay: b.cutDay,
      leadDays: b.leadDays,
      count: idx.length,
      sigmaLoKm: lo * AU_KM,
      sigmaHiKm: hi * AU_KM,
      latSigmaDeg: (sig * 180) / Math.PI,
      confidence: confidenceFrom(latRad, sig),
      target,
    };
  });

  // Say plainly whether the requested finish was actually reachable inside the
  // physical band, rather than quietly reporting a number nobody can hit.
  const achievedEnd = releases[releases.length - 1].confidence;
  return {
    sigmas,
    releases,
    scale: k,
    /** The time-decay rate. exp(rate) is how much the survey improved overall. */
    exponent: p,
    rangeExponent: RANGE_P,
    surveyImprovement: improvement,
    cappedExponent: p >= pRange[1] - 1e-3,
    endShortfall: endConf - achievedEnd,
  };
}

/* ── making the actual numbers students download ──────────────────────── */

/**
 * The published record: true positions with Gaussian noise on every component,
 * plus the masses, measured badly like everything else.
 */
export function makeObservations(scenario, epochs, sigmas, seed) {
  const opts = { mass: scenario.mass, relativistic: scenario.relativistic ?? false, rtol: 1e-12, atol: 1e-14 };
  const rand = rngFrom(`w4|obs|${seed}`);
  const rows = [];
  let y = Float64Array.from(scenario.y0);
  let t = 0;
  for (let i = 0; i < epochs.length; i++) {
    y = propagate(y, t, epochs[i], opts);
    t = epochs[i];
    const s = sigmas[i] ?? sigmas[sigmas.length - 1] ?? 1e-5;
    const jitter = () => gaussian(rand) * s;
    rows.push({
      day: round6(epochs[i]),
      sigmaAu: s,
      sun: [y[0] + jitter(), y[1] + jitter(), y[2] + jitter()],
      earth: [y[3] + jitter(), y[4] + jitter(), y[5] + jitter()],
      ast: [y[6] + jitter(), y[7] + jitter(), y[8] + jitter()],
    });
  }
  return rows;
}

/** The three masses, in kilograms, as measured rather than as they are. */
export function measuredMasses(scenario, seed, relNoise = 5e-6) {
  const rand = rngFrom(`w4|mass|${seed}`);
  const SOLAR_KG = 1.98847e30;
  const truth = [M_SUN * SOLAR_KG, M_EARTH * SOLAR_KG, scenario.astMassKg];
  // The asteroid's own mass is hopeless to measure remotely, so it carries a
  // far wider error bar than the two bodies that actually steer the problem.
  const rel = [relNoise, relNoise * 40, 0.25];
  return truth.map((m, i) => ({
    kg: m * (1 + gaussian(rand) * rel[i]),
    relError: rel[i],
    trueKg: m,
  }));
}

/**
 * The download. A comment block naming the units and the masses, then one row
 * per epoch. Every row carries its own error bar, because a measurement
 * without one is not a measurement.
 */
export function toCSV(rows, masses, meta = {}) {
  const L = [];
  L.push("# Deep Sky Survey — astrometric record");
  L.push("# frame: solar-system barycentric, ecliptic of J2000");
  L.push("# positions in AU; day 0 is the first observation");
  L.push("# sigma_au is the 1-sigma error on EVERY position component in that row");
  if (meta.note) L.push(`# ${meta.note}`);
  L.push(`# mass_sun_kg      = ${masses[0].kg.toExponential(8)}  +/- ${(masses[0].relError * 100).toFixed(5)}%`);
  L.push(`# mass_earth_kg    = ${masses[1].kg.toExponential(8)}  +/- ${(masses[1].relError * 100).toFixed(4)}%`);
  L.push(`# mass_asteroid_kg = ${masses[2].kg.toExponential(4)}  +/- ${(masses[2].relError * 100).toFixed(0)}%`);
  L.push("day,sun_x,sun_y,sun_z,earth_x,earth_y,earth_z,ast_x,ast_y,ast_z,sigma_au");
  const f = (v) => v.toExponential(11);
  for (const r of rows) {
    L.push(
      [
        r.day.toFixed(4),
        ...r.sun.map(f),
        ...r.earth.map(f),
        ...r.ast.map(f),
        r.sigmaAu.toExponential(4),
      ].join(",")
    );
  }
  return L.join("\n") + "\n";
}
