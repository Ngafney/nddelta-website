/**
 * Week 4 — building a round: one rock, a handful of noisy sightings.
 *
 * THE WHOLE PROBLEM
 * -----------------
 * A telescope has caught an asteroid a few times over a few weeks. Each
 * sighting gives its position to a few hundred kilometres. Does it hit the
 * Earth on its next pass, or miss?
 *
 * There is no formula for that. The measurement errors run through an orbit
 * fit and then through a year of nonlinear propagation, and the only way to
 * find out what they do is to try: jitter the sightings inside their error
 * bars, refit, propagate, and count how often the rock comes within one Earth
 * radius. That is exactly how impact probability is computed for real, and it
 * is the whole of what a team has to do here.
 *
 * WHAT IS UNCERTAIN, AND WHY EACH ONE IS IN HERE
 * ----------------------------------------------
 *   the sightings      a few hundred km each, and occasionally one is simply
 *                      WRONG - a misidentified field star, a bad plate solve.
 *                      Spotting that and deciding what to do about it is a
 *                      student's call, and on a short arc it flips the market.
 *   the Earth          its ephemeris is not perfect either. A small offset,
 *                      constant within a round, that shifts the target.
 *   the Sun            GM is known to about a part in 10^10, which sounds
 *                      irrelevant and is not: it compounds over a whole orbit.
 *
 * WHAT THE RELEASES ARE
 * ---------------------
 * More sightings. That is all. The arc lengthens, the fit tightens, and the
 * probability can move enormously and in either direction - which is what
 * really happens to these objects, and what makes the market worth trading.
 */

import {
  AU_KM, GM_SUN, EARTH_RADIUS_AU, EARTH, propagate, closestApproach, encounterState, trail,
} from "./orbit.js";

/** Position error on one sighting, km. Good radar-and-optical astrometry. */
export const SIGHTING_SIGMA_KM = 700;

/** How far the Earth's own ephemeris might be out, km. */
export const EARTH_EPHEM_SIGMA_KM = 250;

/** Fractional uncertainty on the Sun's GM. Small, and it still matters. */
export const GM_SUN_REL_SIGMA = 2e-8;

/** Day of the encounter, and how far past it the round looks. */
export const T_ENCOUNTER = 430;
export const T_END = 520;

/** How many sightings the room has after each release. */
export const RELEASE_COUNTS = [7, 10, 14, 19, 25, 32];
/** And over how many days those sightings are spread. */
export const RELEASE_ARCS = [18, 30, 46, 66, 90, 120];

/**
 * Pick the true orbit.
 *
 * The encounter is CONSTRUCTED rather than searched for: a near miss is a few
 * Earth radii across and the space of orbits is not. Place the rock beside the
 * Earth at the encounter and integrate backwards to the epoch. The backward
 * leg uses the Sun alone - running it through the Earth's own gravity means
 * starting a few thousand km from a point mass, and for a hit, starting BELOW
 * THE SURFACE, which came back 342 million km wrong when it was tried.
 */
export function makeTruth(rand, opts = {}) {
  const wantHit = opts.wantHit ?? rand() < 0.5;
  // In Earth radii, measured centre to centre. Either just inside or just out:
  // a round that is not marginal is not worth a market.
  const radii = wantHit ? 0.25 + rand() * 0.65 : 1.25 + rand() * 2.2;
  const state = encounterState({
    tEncDays: T_ENCOUNTER,
    missAu: radii * EARTH_RADIUS_AU,
    approachDeg: 25 + rand() * 30,
    relSpeedAuDay: 0.0045 + rand() * 0.0025,
    side: rand() < 0.5 ? 1 : -1,
  });
  // What it ACTUALLY does, with the Earth's gravity included - focusing pulls
  // a near miss inward, so the truth is measured rather than assumed.
  const ca = closestApproach(state, 0, T_END);
  return { state, missAu: ca.missAu, tDays: ca.tDays, hit: ca.missAu <= EARTH_RADIUS_AU };
}

/** A standard normal from a uniform generator. */
export const gaussFrom = (rand) => () => {
  const u = rand() || 1e-9;
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/**
 * The sightings, and the bad one.
 *
 * One observation in roughly every twelve is a blunder rather than noise, off
 * by five to forty sigma. Real astrometric sets are like this, and a team that
 * fits everything it is given without looking at the residuals will price the
 * market confidently and wrongly.
 */
export function makeSightings(truth, count, arcDays, rand, gauss) {
  const sigma = SIGHTING_SIGMA_KM / AU_KM;
  const obs = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (arcDays * i) / (count - 1);
    const st = propagate(truth.state, 0, t);
    let x = st[0] + sigma * gauss();
    let y = st[1] + sigma * gauss();
    let bad = false;
    if (i > 0 && i < count - 1 && rand() < 1 / 25) {
      const kick = (5 + rand() * 35) * sigma * (rand() < 0.5 ? -1 : 1);
      if (rand() < 0.5) x += kick; else y += kick;
      bad = true;
    }
    obs.push({ t: Number(t.toFixed(4)), x, y, bad });
  }
  return obs;
}

/**
 * The whole observing campaign, once.
 *
 * Releases reveal a PREFIX of this list, so the sightings a team already has
 * never change underneath them - only new ones arrive. Drawing a fresh set per
 * release instead made the market lurch at random, because the same night's
 * observation came back with different noise each time.
 */
export function makeCampaign(truth, rand, gauss) {
  const total = RELEASE_COUNTS[RELEASE_COUNTS.length - 1];
  const arc = RELEASE_ARCS[RELEASE_ARCS.length - 1];
  return makeSightings(truth, total, arc, rand, gauss);
}

/** What the room can see after release `r` (1-based). */
export function visible(campaign, r) {
  const n = RELEASE_COUNTS[Math.max(0, Math.min(r, RELEASE_COUNTS.length) - 1)];
  return campaign.slice(0, n);
}

/* ── the fit, which the server also has to do to price the round ───────── */

function solve4(A, b) {
  const M = Array.from({ length: 4 }, (_, i) => [...A[i], b[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!Number.isFinite(M[p][c]) || Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const o = [M[0][4] / M[0][0], M[1][4] / M[1][1], M[2][4] / M[2][2], M[3][4] / M[3][3]];
  return o.every(Number.isFinite) ? o : null;
}

/**
 * Gauss-Newton on the epoch state [x, y, vx, vy].
 *
 * Four numbers, fitted to two per sighting. It converges from a crude starting
 * guess because the orbit is a gentle one - a couple of AU and a dozen km/s.
 * An earlier version of this week used a sungrazer at 167 km/s where a
 * velocity error of one part in 10^8 moved the answer 456 km; nothing
 * converged and the week was unplayable. Conditioning is a design choice.
 */
export function fitState(obs, guess, earth = EARTH, iters = 25) {
  let s = guess.slice();
  for (let it = 0; it < iters; it++) {
    const n = 2 * obs.length;
    const res = new Float64Array(n);
    const base = [];
    let r = 0;
    for (const o of obs) {
      const p = propagate(s, 0, o.t, earth);
      base.push(p);
      res[r++] = o.x - p[0];
      res[r++] = o.y - p[1];
    }
    const D = [];
    for (let k = 0; k < 4; k++) {
      const h = k < 2 ? 1e-8 : 1e-11;
      const sp = s.slice();
      sp[k] += h;
      const col = new Float64Array(n);
      let q = 0;
      for (let i = 0; i < obs.length; i++) {
        const p = propagate(sp, 0, obs[i].t, earth);
        col[q++] = (p[0] - base[i][0]) / h;
        col[q++] = (p[1] - base[i][1]) / h;
      }
      D.push(col);
    }
    const A = Array.from({ length: 4 }, () => new Float64Array(4));
    const b = new Float64Array(4);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let a = 0;
        for (let q = 0; q < n; q++) a += D[i][q] * D[j][q];
        A[i][j] = a;
      }
      let a = 0;
      for (let q = 0; q < n; q++) a += D[i][q] * res[q];
      b[i] = a;
    }
    const dx = solve4(A, b);
    if (!dx) return null;
    for (let k = 0; k < 4; k++) s[k] += dx[k];
    if (Math.hypot(dx[0], dx[1]) < 1e-13 && Math.hypot(dx[2], dx[3]) < 1e-16) break;
  }
  return s.every(Number.isFinite) ? s : null;
}

/** A starting guess anyone would make: first point, and a crude velocity. */
export function guessFrom(obs) {
  const a = obs[0];
  const b = obs[obs.length - 1];
  const dt = b.t - a.t || 1;
  return [a.x, a.y, (b.x - a.x) / dt, (b.y - a.y) / dt];
}

/**
 * The house price: refit the jittered sightings and count the hits.
 *
 * This is the same calculation the room is being asked to do, done here so the
 * operator can see roughly where the market should sit. `refits` is kept small
 * because a round has to build inside a serverless timeout; a team with numpy
 * and a minute should use many more.
 */
/**
 * Throw out the sightings that cannot be right.
 *
 * Fit everything, look at the residuals, drop anything past five sigma, refit.
 * One defensible strategy among several - a team might weight instead of
 * cutting, or cut harder, or go back and re-examine the night in question. The
 * house does this so the operator's reference price is not nonsense; the room
 * gets the raw list and has to decide for itself.
 */
export function clipOutliers(obs, nSigma = 5) {
  const sigma = SIGHTING_SIGMA_KM / AU_KM;
  const s = fitState(obs, guessFrom(obs));
  if (!s) return { kept: obs, dropped: [] };
  const kept = [];
  const dropped = [];
  for (const o of obs) {
    const p = propagate(s, 0, o.t);
    const e = Math.hypot(o.x - p[0], o.y - p[1]) / sigma;
    (e > nSigma ? dropped : kept).push({ ...o, residualSigma: e });
  }
  return kept.length >= 4 ? { kept, dropped } : { kept: obs, dropped: [] };
}

export function housePrice(rawObs, rand, gauss, refits = 20) {
  const sigma = SIGHTING_SIGMA_KM / AU_KM;
  const eSig = EARTH_EPHEM_SIGMA_KM / AU_KM;
  const { kept, dropped } = clipOutliers(rawObs);
  const obs = kept;
  const seed = fitState(obs, guessFrom(obs));
  if (!seed) return { pHit: null, fits: 0, dropped: dropped.length };
  let hits = 0;
  let ok = 0;
  const misses = [];
  for (let m = 0; m < refits; m++) {
    const jittered = obs.map((o) => ({ t: o.t, x: o.x + sigma * gauss(), y: o.y + sigma * gauss() }));
    // The Earth is not exactly where the ephemeris says either.
    const earth = { ...EARTH, M0: EARTH.M0 + (eSig * gauss()) / EARTH.aAu };
    const s = fitState(jittered, seed, earth, 12);
    if (!s) continue;
    const ca = closestApproach(s, 0, T_END, earth);
    misses.push(ca.missAu);
    if (ca.missAu <= EARTH_RADIUS_AU) hits++;
    ok++;
  }
  misses.sort((a, b) => a - b);
  return {
    pHit: ok ? hits / ok : null,
    fits: ok,
    medianMissKm: ok ? misses[Math.floor(misses.length / 2)] * AU_KM : null,
    dropped: dropped.length,
  };
}

/** What the picture needs: the best-fit path, and a fan of alternatives. */
export function pathsFor(rawObs, rand, gauss, fan = 24) {
  const obs = clipOutliers(rawObs).kept;
  const seed = fitState(obs, guessFrom(obs));
  if (!seed) return { best: [], cloud: [] };
  const sigma = SIGHTING_SIGMA_KM / AU_KM;
  const best = trail(seed, 0, T_END, 240).map(([x, y]) => [round5(x), round5(y)]);
  const cloud = [];
  for (let i = 0; i < fan; i++) {
    const jit = obs.map((o) => ({ t: o.t, x: o.x + sigma * gauss(), y: o.y + sigma * gauss() }));
    const s = fitState(jit, seed, EARTH, 10);
    if (!s) continue;
    cloud.push(trail(s, 0, T_END, 120).map(([x, y]) => [round5(x), round5(y)]));
  }
  return { best, cloud };
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

export { GM_SUN, AU_KM, EARTH_RADIUS_AU };
