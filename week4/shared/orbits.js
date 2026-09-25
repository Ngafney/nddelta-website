/**
 * Week 4 — the solar system, done honestly.
 *
 * Three bodies: the Sun, the Earth, one asteroid. The asteroid starts on the
 * far side of the Sun, falls in past it on a tight perihelion, and comes back
 * out to meet the Earth about three years later. The operator says how far
 * north or south of the equator it should land, and this file finds the launch
 * state that makes that true.
 *
 * WHY THE RELATIVITY IS NOT DECORATION
 * ------------------------------------
 * The asteroid's perihelion sits around 0.05 AU — roughly ten solar radii.
 * Each pass advances the line of apsides by
 *
 *     Δϖ  =  6π GM / (c² a (1 − e²))   per orbit
 *
 * which at that perihelion is a few microradians a lap, and it makes four or
 * five laps. Carried out to 1 AU that is a couple of thousand kilometres of
 * cross-track displacement — comfortably more than an Earth radius. So a
 * Newtonian fit and a relativistic fit do not merely differ in the last
 * decimal: they land on opposite sides of the equator. The students are not
 * told this. It is the whole trick of the round.
 *
 * UNITS, everywhere in this file, without exception:
 *     length  AU
 *     time    days
 *     mass    solar masses
 * so that GM_sun = k² with k the Gaussian gravitational constant. Mixing units
 * is the classic way to lose a spacecraft, so there is exactly one system here
 * and conversions live only at the edges.
 */

import { rngFrom, gaussian } from "./rng.js";

/* ── constants ────────────────────────────────────────────────────────── */

/** Gaussian gravitational constant; GM_sun = K_GAUSS² exactly, by definition. */
const K_GAUSS = 0.01720209895;
export const GM_SUN = K_GAUSS * K_GAUSS; // AU³/day²

/** Speed of light in AU/day. */
export const C_LIGHT = 173.14463267424964;

export const AU_KM = 149597870.7;
export const DAY_S = 86400;

/** Masses in solar masses. */
export const M_SUN = 1;
export const M_EARTH = 3.003489596331057e-6;

/** Earth's equatorial radius, in AU. */
export const R_EARTH = 6378.137 / AU_KM;

/** Obliquity of the ecliptic, radians. The tilt that makes latitude mean something. */
export const OBLIQUITY = (23.4392911 * Math.PI) / 180;

export const YEAR_DAYS = 365.25;

const DEG = Math.PI / 180;

/**
 * Somewhere harmless to leave a body that is not part of a calculation.
 * Far enough out to be irrelevant, finite so nothing divides by zero.
 */
export const PARK = [50, 0, 0];

/** Below this separation gravity switches to the uniform-sphere interior law. */
const SOFT_R = R_EARTH;
const INV_SOFT3 = 1 / (SOFT_R * SOFT_R * SOFT_R);

/* ── small vector helpers ─────────────────────────────────────────────── */

export const v3 = (x, y, z) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => Math.sqrt(dot(a, a));
export const unit = (a) => {
  const n = norm(a);
  return n === 0 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
};

/**
 * The Earth's spin axis, in ecliptic coordinates.
 *
 * Tilted by the obliquity away from the ecliptic pole, toward the direction
 * the equinox points. Precession moves this by about 50 arcseconds a year, so
 * over the three years of a round it is fixed to far better than we need.
 */
export function spinAxis(nodeAngle = 0) {
  return [
    Math.sin(OBLIQUITY) * Math.sin(nodeAngle),
    -Math.sin(OBLIQUITY) * Math.cos(nodeAngle),
    Math.cos(OBLIQUITY),
  ];
}

/* ── the state vector ─────────────────────────────────────────────────── */

/**
 * 18 numbers: three positions then three velocities, Sun, Earth, asteroid.
 * A flat array rather than objects — this is touched millions of times.
 *
 *   y[0..2]   Sun position        y[9..11]   Sun velocity
 *   y[3..5]   Earth position      y[12..14]  Earth velocity
 *   y[6..8]   asteroid position   y[15..17]  asteroid velocity
 */
export const SUN = 0;
export const EARTH = 1;
export const AST = 2;

export const posOf = (y, b) => [y[b * 3], y[b * 3 + 1], y[b * 3 + 2]];
export const velOf = (y, b) => [y[9 + b * 3], y[9 + b * 3 + 1], y[9 + b * 3 + 2]];

export function packState(rs, vs) {
  const y = new Float64Array(18);
  for (let b = 0; b < 3; b++) {
    for (let k = 0; k < 3; k++) {
      y[b * 3 + k] = rs[b][k];
      y[9 + b * 3 + k] = vs[b][k];
    }
  }
  return y;
}

/* ── the equations of motion ──────────────────────────────────────────── */

/**
 * Accelerations for the three bodies.
 *
 * Newtonian gravity between every pair, plus — when `relativistic` — the first
 * post-Newtonian correction from the Sun acting on the other two:
 *
 *     a_PN = (GM / (c² r³)) · [ (4GM/r − v²) r⃗  +  4 (r⃗·v⃗) v⃗ ]
 *
 * This is the Schwarzschild term in the standard PN gauge. It is the piece
 * that produces Mercury's 43 arcseconds a century, and `test/physics.test.js`
 * checks exactly that number before trusting any of it.
 *
 * The Sun's own PN reaction is dropped: it scales with the companion masses,
 * which here are 3e-6 and 1e-15 of a solar mass, so it is far below the
 * integration tolerance.
 */
export function derivatives(y, mass, relativistic, out) {
  // positions first, so velocities are the derivative of position
  for (let i = 0; i < 9; i++) out[i] = y[9 + i];
  for (let i = 9; i < 18; i++) out[i] = 0;

  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const dx = y[j * 3] - y[i * 3];
      const dy = y[j * 3 + 1] - y[i * 3 + 1];
      const dz = y[j * 3 + 2] - y[i * 3 + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      const r = Math.sqrt(r2);
      // Inside a body, gravity is not 1/r². The enclosed mass falls as (r/R)³,
      // so the acceleration goes as r and vanishes at the centre. Without this
      // the moment after impact is a true singularity and the integrator
      // shrinks its step to nothing trying to resolve it. This never fires
      // before contact, so nothing about the game changes — it just means the
      // sweep can safely look past the impact without falling off a cliff.
      const inv3 = r < SOFT_R ? INV_SOFT3 : 1 / (r2 * r);
      const gi = GM_SUN * mass[j] * inv3;
      const gj = GM_SUN * mass[i] * inv3;
      out[9 + i * 3] += gi * dx;
      out[9 + i * 3 + 1] += gi * dy;
      out[9 + i * 3 + 2] += gi * dz;
      out[9 + j * 3] -= gj * dx;
      out[9 + j * 3 + 1] -= gj * dy;
      out[9 + j * 3 + 2] -= gj * dz;
    }
  }

  if (!relativistic) return out;

  const mu = GM_SUN * mass[SUN];
  const c2 = C_LIGHT * C_LIGHT;
  for (const b of [EARTH, AST]) {
    const rx = y[b * 3] - y[SUN * 3];
    const ry = y[b * 3 + 1] - y[SUN * 3 + 1];
    const rz = y[b * 3 + 2] - y[SUN * 3 + 2];
    const vx = y[9 + b * 3] - y[9 + SUN * 3];
    const vy = y[9 + b * 3 + 1] - y[9 + SUN * 3 + 1];
    const vz = y[9 + b * 3 + 2] - y[9 + SUN * 3 + 2];
    const r2 = rx * rx + ry * ry + rz * rz;
    const r = Math.sqrt(r2);
    const v2 = vx * vx + vy * vy + vz * vz;
    const rv = rx * vx + ry * vy + rz * vz;
    const k = mu / (c2 * r2 * r);
    const a = 4 * (mu / r) - v2;
    out[9 + b * 3] += k * (a * rx + 4 * rv * vx);
    out[9 + b * 3 + 1] += k * (a * ry + 4 * rv * vy);
    out[9 + b * 3 + 2] += k * (a * rz + 4 * rv * vz);
  }
  return out;
}

/* ── Dormand–Prince 5(4), adaptive ────────────────────────────────────── */

// Butcher tableau. Standard DOPRI5 coefficients.
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const B1 = 35 / 384, B3 = 500 / 1113, B4 = 125 / 192, B5 = -2187 / 6784, B6 = 11 / 84;
// 4th-order weights, for the embedded error estimate
const E1 = 5179 / 57600, E3 = 7571 / 16695, E4 = 393 / 640,
  E5 = -92097 / 339200, E6 = 187 / 2100, E7 = 1 / 40;

const N = 18;

/**
 * One adaptive integration from t0 to t1. Returns the state at t1.
 *
 * Step size is chosen by the usual embedded 5(4) error estimate with a mild PI
 * controller. Perihelion is where all the steps go: the asteroid is moving at
 * over 100 km/s at 0.05 AU, so the step collapses by three orders of magnitude
 * for a day or so and then opens back up.
 */
export function propagate(y0, t0, t1, opts = {}) {
  const { mass, relativistic = true, rtol = 1e-12, atol = 1e-14 } = opts;
  const y = Float64Array.from(y0);
  if (t1 === t0) return y;

  const dir = t1 > t0 ? 1 : -1;
  const span = Math.abs(t1 - t0);
  const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N);
  const k4 = new Float64Array(N), k5 = new Float64Array(N), k6 = new Float64Array(N);
  const k7 = new Float64Array(N), tmp = new Float64Array(N), y5 = new Float64Array(N);

  let t = t0;
  let h = dir * Math.min(span, opts.h0 ?? 0.5);
  let prevErr = 1;
  let steps = 0;
  const maxSteps = opts.maxSteps ?? 4_000_000;

  derivatives(y, mass, relativistic, k1);

  while ((t - t1) * dir < 0) {
    if (++steps > maxSteps) throw new Error(`propagate: step budget exhausted at t=${t}`);
    if ((t + h - t1) * dir > 0) h = t1 - t;

    for (let i = 0; i < N; i++) tmp[i] = y[i] + h * A21 * k1[i];
    derivatives(tmp, mass, relativistic, k2);
    for (let i = 0; i < N; i++) tmp[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
    derivatives(tmp, mass, relativistic, k3);
    for (let i = 0; i < N; i++) tmp[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
    derivatives(tmp, mass, relativistic, k4);
    for (let i = 0; i < N; i++) tmp[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
    derivatives(tmp, mass, relativistic, k5);
    for (let i = 0; i < N; i++)
      tmp[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
    derivatives(tmp, mass, relativistic, k6);
    for (let i = 0; i < N; i++)
      y5[i] = y[i] + h * (B1 * k1[i] + B3 * k3[i] + B4 * k4[i] + B5 * k5[i] + B6 * k6[i]);
    derivatives(y5, mass, relativistic, k7);

    let err = 0;
    for (let i = 0; i < N; i++) {
      const y4 = y[i] + h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(y5[i]));
      const e = (y5[i] - y4) / sc;
      err += e * e;
    }
    err = Math.sqrt(err / N);

    if (err <= 1) {
      t += h;
      y.set(y5);
      k1.set(k7); // FSAL
      const fac = err === 0 ? 5 : 0.92 * Math.pow(err, -0.2) * Math.pow(prevErr, 0.08);
      h *= Math.min(5, Math.max(0.2, fac));
      prevErr = Math.max(err, 1e-8);
    } else {
      h *= Math.max(0.1, 0.92 * Math.pow(err, -0.25));
    }
    if (Math.abs(h) < 1e-13) throw new Error(`propagate: step underflow at t=${t}`);
  }
  return y;
}

/** States at a rising list of epochs, integrating straight through. */
export function sampleAt(y0, t0, epochs, opts) {
  const out = [];
  let y = Float64Array.from(y0);
  let t = t0;
  for (const e of epochs) {
    y = propagate(y, t, e, opts);
    t = e;
    out.push(Float64Array.from(y));
  }
  return out;
}

/* ── impact geometry ──────────────────────────────────────────────────── */

/** Separation of asteroid and Earth centres. */
export const missDistance = (y) => norm(sub(posOf(y, AST), posOf(y, EARTH)));

/**
 * Geodetic-ish latitude of the point on Earth directly under the asteroid.
 *
 * Latitude is set by the spin axis alone — Earth's rotation moves the longitude
 * underneath, never the latitude — so the daily spin plays no part here, and
 * the round does not have to pin down a time of day.
 */
export function latitudeOf(y, axis) {
  const d = sub(posOf(y, AST), posOf(y, EARTH));
  return Math.asin(Math.max(-1, Math.min(1, dot(unit(d), axis))));
}

/**
 * Closest the asteroid ever comes to the Earth, and — if it gets inside one
 * Earth radius — the moment and state of first contact.
 *
 * A coarse sweep CANNOT look for the surface crossing directly. The two close
 * at something like 30 km/s, so the whole 12,700 km of Earth is traversed in
 * under a second; any sane sweep step straddles the entire impact and sees a
 * large positive distance on both sides. So the sweep looks for the closest
 * approach instead, which is smooth on the scale of days, refines it with a
 * golden section, and only then asks whether that minimum is below a radius.
 */
export function findContact(y0, t0, t1, opts, coarse = 900) {
  const dt = (t1 - t0) / coarse;
  const dist = (y) => missDistance(y);

  // Sweep, remembering the state at each sample so refinement is cheap.
  let tPrev = t0;
  let yPrev = Float64Array.from(y0);
  let best = { d: dist(yPrev), t: t0, y: yPrev, tBack: t0, yBack: yPrev };
  let backT = t0;
  let backY = yPrev;
  for (let i = 1; i <= coarse; i++) {
    const t = t0 + i * dt;
    const y = propagate(yPrev, tPrev, t, opts);
    const d = dist(y);
    if (d < best.d) best = { d, t, y, tBack: tPrev, yBack: yPrev };
    backT = tPrev;
    backY = yPrev;
    tPrev = t;
    yPrev = y;
  }

  // Golden-section on the bracket around the best sample. The separation is
  // unimodal there: over a few days the relative motion is effectively a
  // straight line past a point.
  const lo0 = Math.max(t0, best.t - dt);
  const hi0 = Math.min(t1, best.t + dt);
  const anchorT = best.tBack;
  const anchorY = best.yBack;
  const at = (t) => propagate(anchorY, anchorT, t, opts);
  const PHI = (Math.sqrt(5) - 1) / 2;
  let lo = lo0, hi = hi0;
  let c = hi - PHI * (hi - lo), d2 = lo + PHI * (hi - lo);
  let fc = dist(at(c)), fd = dist(at(d2));
  for (let k = 0; k < 90 && hi - lo > 1e-12; k++) {
    if (fc < fd) {
      hi = d2;
      d2 = c;
      fd = fc;
      c = hi - PHI * (hi - lo);
      fc = dist(at(c));
    } else {
      lo = c;
      c = d2;
      fc = fd;
      d2 = lo + PHI * (hi - lo);
      fd = dist(at(d2));
    }
  }
  const tMin = 0.5 * (lo + hi);
  const yMin = at(tMin);
  const dMin = dist(yMin);

  if (dMin > R_EARTH) {
    return { hit: false, missAu: dMin, missKm: dMin * AU_KM, t: tMin, y: yMin };
  }

  // Inside the sphere: walk back to the surface. Everything before the
  // approach leg is outside, so the bracket is [approach start, closest].
  let a = anchorT, b = tMin;
  for (let k = 0; k < 90 && b - a > 1e-13; k++) {
    const mid = 0.5 * (a + b);
    if (dist(at(mid)) - R_EARTH > 0) a = mid;
    else b = mid;
  }
  const yHit = at(b);
  return { hit: true, t: b, y: yHit, missAu: dMin, missKm: dMin * AU_KM };
}

/**
 * The surface point at a given latitude that most directly faces an incoming
 * velocity. Among all points on that parallel this is the one the asteroid can
 * actually reach head-on, which keeps the solver on the near hemisphere.
 */
export function aimPoint(latRad, axis, vRel) {
  const v = unit(vRel);
  const along = dot(v, axis);
  let perp = sub(v, scale(axis, along));
  const n = norm(perp);
  // Dead-on polar approach: any meridian will do, pick one deterministically.
  perp = n < 1e-12 ? unit(cross(axis, [1, 0, 0])) : scale(perp, 1 / n);
  return add(scale(axis, Math.sin(latRad)), scale(perp, -Math.cos(latRad)));
}

/* ── solving for a chosen impact latitude ─────────────────────────────── */

/**
 * Adjust the asteroid's launch velocity until it touches down exactly where
 * the operator asked.
 *
 * Three unknowns (the launch velocity) against three residuals (the vector
 * from Earth's centre to the asteroid at the impact epoch, minus one Earth
 * radius in the aimed direction). Square, and well conditioned once the
 * initial guess is a real trajectory: a day/second of launch velocity moves
 * the arrival point by millions of kilometres, so the Jacobian is strong.
 *
 * The aim point depends on the arrival direction, which depends on the answer,
 * so it sits in an outer loop that re-aims and re-solves. Two or three passes
 * is plenty.
 */
export function solveImpact(y0, tImpact, latRad, axis, opts, tune = {}) {
  const { outer = 4, inner = 8, tol = 1e-13 } = tune;
  const y = Float64Array.from(y0);
  let best = null;

  for (let o = 0; o < outer; o++) {
    // Where are we aiming this pass?
    const yT = propagate(y, 0, tImpact, opts);
    const vRel = sub(velOf(yT, AST), velOf(yT, EARTH));
    const aim = aimPoint(latRad, axis, vRel);
    const target = scale(aim, R_EARTH);

    const residual = (vTrial) => {
      const yy = Float64Array.from(y);
      yy[15] = vTrial[0];
      yy[16] = vTrial[1];
      yy[17] = vTrial[2];
      const yEnd = propagate(yy, 0, tImpact, opts);
      const d = sub(posOf(yEnd, AST), posOf(yEnd, EARTH));
      return { r: sub(d, target), yEnd };
    };

    let v = [y[15], y[16], y[17]];
    let cur = residual(v);
    for (let it = 0; it < inner; it++) {
      const rn = norm(cur.r);
      if (rn < tol) break;
      // Numerical Jacobian. The step is small enough to stay linear and large
      // enough to stay clear of the integrator's own noise floor.
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const eps = 1e-11;
      for (let c = 0; c < 3; c++) {
        const vp = v.slice();
        vp[c] += eps;
        const rp = residual(vp).r;
        for (let rIdx = 0; rIdx < 3; rIdx++) J[rIdx][c] = (rp[rIdx] - cur.r[rIdx]) / eps;
      }
      const step = solve3(J, cur.r.map((x) => -x));
      if (!step) break;
      let lambda = 1;
      let next = null;
      // Damped: a full Newton step can overshoot on the first pass.
      for (let k = 0; k < 12; k++) {
        const trial = [v[0] + lambda * step[0], v[1] + lambda * step[1], v[2] + lambda * step[2]];
        const t = residual(trial);
        if (norm(t.r) < rn) {
          next = { v: trial, res: t };
          break;
        }
        lambda *= 0.5;
      }
      if (!next) break;
      v = next.v;
      cur = next.res;
    }
    y[15] = v[0];
    y[16] = v[1];
    y[17] = v[2];
    best = { y: Float64Array.from(y), residual: norm(cur.r), yEnd: cur.yEnd };
  }
  return best;
}

/** 3×3 solve by Gaussian elimination with partial pivoting. */
function solve3(A, b) {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/* ── building a scenario ──────────────────────────────────────────────── */

/**
 * Earth on its orbit at a given phase, as a two-body state about the Sun.
 * Good enough as a starting point; the real integration takes over from here.
 */
function earthStart(phase, ecc = 0.0167) {
  const a = 1.00000011;
  const r = a * (1 - ecc); // start at perihelion, then rotate by phase
  const vPeri = Math.sqrt(GM_SUN * (1 + ecc) / (a * (1 - ecc)));
  const cp = Math.cos(phase), sp = Math.sin(phase);
  return {
    r: [r * cp, r * sp, 0],
    v: [-vPeri * sp, vPeri * cp, 0],
  };
}

/**
 * Lay out a round: where everything starts, and the launch that lands the
 * asteroid at the requested latitude.
 *
 * The search over semi-major axis is what makes each game different and still
 * legal. For a candidate orbit we work BACKWARDS — put the asteroid where it
 * has to end up, give it the arrival velocity that orbit implies, and
 * integrate the two-body problem back three years to see where it came from.
 * A candidate is kept only if it started on the far side of the Sun, dipped
 * inside the perihelion band on the way, and made at least three passes.
 */
export function buildScenario(seed, targetLatDeg, cfg = {}) {
  const {
    years = 3,
    /**
     * Well clear of the Sun. A sungrazing perihelion makes the round
     * spectacular and the orbit determination impossible -- see the long note
     * in rules.js before pulling this back in.
     */
    perihelion = [0.35, 0.8],
    minPasses = 1,
    /** How far round the Sun the asteroid must start. -1 is dead opposite. */
    farSide = -0.35,
    /**
     * The two lead times the round is scored on: how far away the asteroid is
     * when the first data is released, and when the last is. A big drop
     * between them is what makes later data worth more than earlier data, and
     * therefore what makes the round a game rather than a coin toss.
     */
    scoreLeads = [180, 30],
    astMassKg = 1.6e12,
    /**
     * Whether the round's truth includes the post-Newtonian term.
     *
     * The physics is implemented and checked against Mercury, but a round is
     * played on whichever model the operator chose, and the students have to
     * be able to FIT it. See the note in rules.js.
     */
    relativistic = false,
    /** The asteroid must start out here, slow, not whipping past the Sun. */
    minStartRadius = 0.9,
  } = cfg;

  const rand = rngFrom(`w4|scenario|${seed}`);
  const tImpact = years * YEAR_DAYS;
  const latRad = targetLatDeg * DEG;

  const astMass = astMassKg / 1.98847e30;
  const mass = [M_SUN, M_EARTH, astMass];
  const opts = { mass, relativistic, rtol: 1e-12, atol: 1e-14 };
  const twoBody = { mass: [M_SUN, 0, 0], relativistic, rtol: 1e-12, atol: 1e-14 };

  // Everything about the round that varies game to game.
  const earthPhase = rand() * 2 * Math.PI;
  const nodeAngle = rand() * 2 * Math.PI;
  const axis = spinAxis(nodeAngle);
  const inc = (0.5 + rand() * 3.5) * DEG; // asteroid's tilt out of the ecliptic
  const incNode = rand() * 2 * Math.PI;

  // Earth first: integrate the pair forward so we know where it will be.
  const e0 = earthStart(earthPhase);
  const sunStart = { r: [0, 0, 0], v: [0, 0, 0] };
  // Put the barycentre at rest at the origin, which is the frame the students
  // are given. Without this the whole system drifts and the data looks odd.
  const totalM = M_SUN + M_EARTH;
  const comR = scale(e0.r, M_EARTH / totalM);
  const comV = scale(e0.v, M_EARTH / totalM);
  sunStart.r = scale(comR, -1);
  sunStart.v = scale(comV, -1);
  e0.r = sub(e0.r, comR);
  e0.v = sub(e0.v, comV);

  const pairY = packState([sunStart.r, e0.r, [10, 0, 0]], [sunStart.v, e0.v, [0, 0.01, 0]]);
  const pairOpts = { ...opts, mass: [M_SUN, M_EARTH, 0] };
  const pairAtImpact = propagate(pairY, 0, tImpact, pairOpts);
  const rArrive = posOf(pairAtImpact, EARTH);
  const rEarth0 = posOf(pairY, EARTH);
  // Where the Earth is at the two epochs a candidate is scored on.
  const earthAt = scoreLeads.map((lead) => posOf(propagate(pairY, 0, tImpact - lead, pairOpts), EARTH));

  // Orbit-plane normal: the ecliptic pole, tipped by the inclination.
  const hHat = unit([
    Math.sin(inc) * Math.sin(incNode),
    -Math.sin(inc) * Math.cos(incNode),
    Math.cos(inc),
  ]);

  const rA = norm(rArrive);
  const candidates = [];
  // When no orbit qualifies it is never obvious which constraint did the
  // killing, so count them. The tally rides along in the error message.
  const why = { aphelion: 0, ecc: 0, speed: 0, threw: 0, distance: 0, opposition: 0, passes: 0 };
  // The perihelion is the thing we actually care about, so it drives the grid
  // and the eccentricity follows. Going the other way -- picking e first --
  // can never reach a sungrazing pass on an orbit this small.
  for (let k = 0; k <= 120; k++) {
    const a = 0.53 + (k / 120) * 0.42; // 0.53 .. 0.95 AU
    for (let j = 0; j <= 10; j++) {
      const peri = perihelion[0] + (j / 10) * (perihelion[1] - perihelion[0]);
      // Aphelion has to reach out past the Earth or the two never meet.
      if (2 * a - peri <= rA * 1.004) {
        why.aphelion++;
        continue;
      }
      const ecc = 1 - peri / a;
      if (!(ecc > 0.3 && ecc < 0.985)) {
        why.ecc++;
        continue;
      }
      const h = Math.sqrt(GM_SUN * a * (1 - ecc * ecc));
      const speed2 = GM_SUN * (2 / rA - 1 / a);
      if (speed2 <= 0) {
        why.speed++;
        continue;
      }
      const vT = h / rA;
      const vR2 = speed2 - vT * vT;
      if (vR2 < 0) {
        why.speed++;
        continue;
      }
      // Inbound: falling toward the Sun as it arrives.
      const vR = -Math.sqrt(vR2);
      const rHat = unit(rArrive);
      const tHat = unit(cross(hHat, rHat));
      const vArrive = add(scale(tHat, vT), scale(rHat, vR));

      // Where did that come from three years ago?
      // The Earth slot is massless here and only along for the ride, but it
      // must not sit on top of the Sun: a zero separation is a division by
      // zero, and the integrator rejects every step forever rather than fail.
      const back = packState([[0, 0, 0], PARK, rArrive], [[0, 0, 0], [0, 0, 0], vArrive]);
      let start;
      // Walk back in legs so the scoring epochs are visited on the way. That
      // makes the approach ratio free instead of a second pass over the same
      // trajectory, which matters when this runs a thousand times.
      const ranges = [];
      try {
        let y = back;
        let t = tImpact;
        for (let k = 0; k < scoreLeads.length; k++) {
          const tn = tImpact - scoreLeads[k];
          y = propagate(y, t, tn, twoBody);
          t = tn;
          ranges.push(norm(sub(posOf(y, AST), earthAt[k])));
        }
        start = propagate(y, t, 0, twoBody);
      } catch {
        why.threw++;
        continue;
      }
      // How much closer the rock gets between the first release and the last.
      const ratio = ranges[1] > 1e-9 ? ranges[0] / ranges[1] : 0;
      const r0 = posOf(start, AST);
      const d0 = norm(r0);
      // The far side of the Sun, on an orbit this eccentric, IS the perihelion
      // side: arrival happens near aphelion, so the point diametrically
      // opposite it is the point closest in. Demanding the asteroid also start
      // far out asks for two incompatible things, and nothing qualifies.
      if (!Number.isFinite(d0) || d0 < minStartRadius || d0 > 3.5) {
        why.distance++;
        continue;
      }
      // Must start on the FAR side of the Sun from Earth.
      const opposition = dot(unit(r0), unit(rEarth0));
      if (opposition > farSide) {
        why.opposition++;
        continue;
      }
      const passes = Math.floor(tImpact / (365.25 * Math.pow(a, 1.5)));
      if (passes < minPasses) {
        why.passes++;
        continue;
      }
      candidates.push({ a, ecc, peri, passes, opposition, ratio, r0, v0: velOf(start, AST) });
    }
  }

  if (!candidates.length) {
    throw new Error(
      `buildScenario: no legal orbit for seed ${seed} — rejected by ` +
        Object.entries(why)
          .filter(([, n]) => n)
          .map(([k, n]) => `${k}:${n}`)
          .join(" ")
    );
  }
  // Rank on the range ratio, because that is what decides whether the later
  // releases actually tell anybody anything. A round where the asteroid is
  // barely closer at the last release than the first is a round where the
  // extra data is worthless and the market never moves.
  candidates.sort((x, z) => z.ratio - x.ratio);
  const pool = candidates.slice(0, Math.max(1, Math.floor(candidates.length * 0.25)));
  const pick = pool[Math.floor(rand() * pool.length)];

  const guess = packState(
    [posOf(pairY, SUN), posOf(pairY, EARTH), pick.r0],
    [velOf(pairY, SUN), velOf(pairY, EARTH), pick.v0]
  );

  const solved = solveImpact(guess, tImpact, latRad, axis, opts);
  if (!solved || solved.residual > 1e-9) {
    throw new Error(`buildScenario: impact solve did not converge (residual ${solved?.residual})`);
  }

  return {
    seed,
    y0: Array.from(solved.y),
    mass,
    astMassKg,
    tImpact,
    years,
    axis,
    nodeAngle,
    targetLatDeg,
    relativistic,
    orbit: {
      a: pick.a,
      ecc: pick.ecc,
      perihelion: pick.peri,
      passes: pick.passes,
      /** Approach ratio from the guess, before the solver nudged anything. */
      rangeRatio: pick.ratio,
      opposition: pick.opposition,
    },
    residual: solved.residual,
  };
}

/** Confirm a built scenario really lands where it claims. */
export function verifyScenario(sc, opts = {}) {
  const o = { mass: sc.mass, relativistic: sc.relativistic ?? true, rtol: 1e-12, atol: 1e-14, ...opts };
  const y0 = Float64Array.from(sc.y0);
  const hit = findContact(y0, 0, sc.tImpact + 1, o);
  if (!hit.hit) return { ok: false, reason: `closest approach ${hit.missKm.toFixed(0)} km — no contact` };
  const lat = (latitudeOf(hit.y, sc.axis) * 180) / Math.PI;
  const yT = propagate(y0, 0, sc.tImpact, o);

  // Same launch, the OTHER gravity model: where would it have gone? For a
  // Newtonian round that means switching relativity ON, which is how the
  // reveal can honestly say by how much it would have mattered. Comparing a
  // model against itself just reports zero.
  const other = { ...o, relativistic: !o.relativistic };
  const newt = findContact(y0, 0, sc.tImpact + 30, other);
  const newtLat = newt.hit ? (latitudeOf(newt.y, sc.axis) * 180) / Math.PI : null;
  const yTn = propagate(y0, 0, sc.tImpact, other);
  const driftKm = norm(sub(posOf(yT, AST), posOf(yTn, AST))) * AU_KM;

  return {
    ok: Math.abs(lat - sc.targetLatDeg) < 0.05,
    latDeg: lat,
    targetLatDeg: sc.targetLatDeg,
    contactDay: hit.t,
    contactError: hit.t - sc.tImpact,
    newtonianLatDeg: newtLat,
    newtonianMisses: !newt.hit,
    newtonianMissKm: newt.hit ? 0 : newt.missKm,
    /** How far the impact moves if you swap the gravity model. */
    relativisticDriftKm: driftKm,
  };
}

/** Minimum Sun distance reached, for the reveal copy. */
export function closestApproachToSun(sc, samples = 3000) {
  const o = { mass: sc.mass, relativistic: sc.relativistic ?? true, rtol: 1e-11, atol: 1e-13 };
  const dist = (y) => norm(sub(posOf(y, AST), posOf(y, SUN)));
  let y = Float64Array.from(sc.y0);
  let t = 0;
  let best = { d: dist(y), t: 0, anchorT: 0, anchorY: y };
  const dt = sc.tImpact / samples;
  for (let i = 1; i <= samples; i++) {
    const tn = i * dt;
    const prevT = t, prevY = y;
    y = propagate(y, t, tn, o);
    t = tn;
    const d = dist(y);
    if (d < best.d) best = { d, t: tn, anchorT: prevT, anchorY: prevY };
  }
  // Perihelion is sharp — a sample grid always overstates it. Refine.
  const at = (tt) => propagate(best.anchorY, best.anchorT, tt, o);
  const PHI = (Math.sqrt(5) - 1) / 2;
  let lo = Math.max(0, best.t - dt), hi = Math.min(sc.tImpact, best.t + dt);
  let c = hi - PHI * (hi - lo), d2 = lo + PHI * (hi - lo);
  let fc = dist(at(c)), fd = dist(at(d2));
  for (let k = 0; k < 80 && hi - lo > 1e-11; k++) {
    if (fc < fd) {
      hi = d2; d2 = c; fd = fc; c = hi - PHI * (hi - lo); fc = dist(at(c));
    } else {
      lo = c; c = d2; fc = fd; d2 = lo + PHI * (hi - lo); fd = dist(at(d2));
    }
  }
  const tMin = 0.5 * (lo + hi);
  const min = dist(at(tMin));
  return { au: min, solarRadii: min / 0.00465047, day: tMin };
}
