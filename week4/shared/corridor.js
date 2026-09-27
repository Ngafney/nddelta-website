/**
 * Where on Earth does it land, and how sure can anyone be?
 *
 * WHAT THIS REPLACED, AND WHY
 * ---------------------------
 * The first version of this round made the room determine an orbit: three
 * years of noisy astrometry, a sungrazing asteroid, fit it yourself. That is a
 * genuinely hard inverse problem and it ate the whole session — a velocity
 * error of one part in 10^8 moved the impact 456 km, so the orbit had to be
 * known to eight figures before the residuals meant anything, and nobody's fit
 * converged, mine included.
 *
 * The Monte Carlo was never the hard part. So this file throws the inverse
 * problem away and keeps the forward one, which is what the round is actually
 * about: you are handed an uncertainty, and you have to turn it into a price.
 *
 * THE MODEL
 * ---------
 * A small asteroid on its last few hours arrives on a nearly straight line.
 * The point on the ground beneath it sweeps out a track — a great circle, near
 * enough, once the Earth's rotation is folded in. Being early or late along
 * that track by δt moves the impact point ALONG the corridor; being off to one
 * side moves it across.
 *
 * So the published product is the one real impact-warning products use: a
 * nominal point, the corridor it lies on, and a covariance.
 *
 * THE BIT THAT MAKES IT A MONTE CARLO
 * -----------------------------------
 * Latitude is NOT a linear function of distance along a great circle. A track
 * running mostly east-west climbs slowly, flattens at its highest point, then
 * falls — so a Gaussian spread along the corridor maps to a badly skewed, and
 * near a turning point bimodal, spread in latitude. Push the numbers through
 * Φ((line − μ)/σ) and you get a confidently wrong answer; sample and count and
 * you get the right one. That is the whole lesson, and it is real geometry
 * rather than a puzzle anyone invented.
 */

import { EVENTS, eventByKey } from "./events.js";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Mean Earth radius, km. Spherical is plenty — the corridor is a few hundred km. */
export const R_EARTH_KM = 6371.0088;
/** Sidereal rotation rate, radians per second. */
export const OMEGA = 7.292115e-5;

/* ── small spherical helpers ──────────────────────────────────────────── */

export const toUnit = (latDeg, lonDeg) => {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

export const toLatLon = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return {
    lat: Math.asin(v[2] / n) * RAD,
    lon: Math.atan2(v[1], v[0]) * RAD,
  };
};

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a) => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n === 0 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
};

/**
 * Greenwich mean sidereal time, radians, from a Date.
 *
 * Needed once per event: CNEOS publishes the velocity in an inertial frame and
 * the ground track lives in the rotating one, so the two have to be lined up.
 * IAU 1982 series, which is good to well under an arcsecond here — far finer
 * than anything downstream cares about.
 */
export function gmst(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  let s = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
  s = ((s % 86400) + 86400) % 86400; // seconds of sidereal time
  return (s / 240) * DEG; // 360° per 86400 s
}

/* ── an event's corridor ──────────────────────────────────────────────── */

/**
 * The ground track, straight off the event.
 *
 * This used to derive the azimuth from the CNEOS velocity components at run
 * time. It no longer does, because the derivation could not be validated: on
 * 2008 TC3, the one event with a published trajectory solution, it returned 87°
 * against a documented 101° and got the sign of the vertical component wrong.
 * Shipping a conversion that fails its only check would have been worse than
 * shipping a number with its provenance written on it, so events.js carries the
 * azimuth and says where each one came from.
 */
export function corridorOf(event) {
  return {
    azimuthDeg: event.azimuthDeg,
    groundSpeedKms: event.groundSpeedKms,
    entryAngleDeg: event.entryAngleDeg,
    geometry: event.geometry,
  };
}

/**
 * Walk from a point along a great circle.
 *
 * `along` is kilometres in the corridor direction; `cross` is kilometres to the
 * right of it. This is the function whose curvature makes the Monte Carlo
 * worth running.
 */
export function walk(latDeg, lonDeg, azimuthDeg, alongKm, crossKm = 0) {
  const p = toUnit(latDeg, lonDeg);
  const up = p;
  const east = unit(cross([0, 0, 1], up));
  const north = cross(up, east);
  const az = azimuthDeg * DEG;
  // Heading, and the direction 90° to its right, both tangent to the sphere.
  const head = add(scale(north, Math.cos(az)), scale(east, Math.sin(az)));
  const right = add(scale(north, Math.cos(az + Math.PI / 2)), scale(east, Math.sin(az + Math.PI / 2)));

  // Rotate about the axis perpendicular to the travel plane, twice.
  let v = rotate(p, unit(cross(p, head)), alongKm / R_EARTH_KM);
  if (crossKm !== 0) v = rotate(v, unit(cross(p, right)), crossKm / R_EARTH_KM);
  return toLatLon(v);
}

/** Rodrigues rotation of `v` about unit axis `k` by angle `a`. */
function rotate(v, k, a) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return add(add(scale(v, ca), scale(cross(k, v), sa)), scale(k, dot(k, v) * (1 - ca)));
}

/** Latitude reached by walking `alongKm` down the corridor. The nonlinear map. */
export const latAt = (event, corridor, alongKm, crossKm = 0) =>
  walk(event.lat, event.lon, corridor.azimuthDeg, alongKm, crossKm).lat;

/* ── the uncertainty ──────────────────────────────────────────────────── */

/**
 * The covariance of the impact point, in the corridor frame, in km².
 *
 * MODELLED, not measured. Nobody published a covariance for a four-metre rock
 * found nineteen hours before it arrived, so the shape is taken from what such
 * warnings actually look like — an along-track error far larger than the
 * cross-track one, because a short arc pins the direction of approach far
 * better than the time of arrival — and the SCALE is then solved so that a
 * good team reaches the confidence the operator asked for.
 *
 * `ratio` is how many times longer the ellipse is than it is wide.
 * `tilt` is a small correlation, so the ellipse is not axis-aligned and a team
 * that samples the two numbers independently gets the wrong answer.
 */
export function covariance(alongSigmaKm, ratio = 6, tiltDeg = 12) {
  const a = alongSigmaKm;
  const b = alongSigmaKm / ratio;
  const t = tiltDeg * DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // R · diag(a², b²) · Rᵀ
  return [
    [a * a * c * c + b * b * s * s, (a * a - b * b) * c * s],
    [(a * a - b * b) * c * s, a * a * s * s + b * b * c * c],
  ];
}

/** Lower-triangular Cholesky of a 2×2, for drawing correlated samples. */
export function chol2(C) {
  const l11 = Math.sqrt(C[0][0]);
  const l21 = C[1][0] / l11;
  const l22 = Math.sqrt(Math.max(1e-300, C[1][1] - l21 * l21));
  return [
    [l11, 0],
    [l21, l22],
  ];
}

/**
 * The honest answer: sample the covariance, walk each sample down the
 * corridor, and count which side of the line it lands on.
 *
 * This is exactly the calculation the room is being asked to do, which is the
 * point — the server prices the round with the same method it expects a team
 * to use, so the target confidence means what it says.
 */
export function northProbability(event, corridor, C, lineDeg, draws, rand) {
  const L = chol2(C);
  let north = 0;
  for (let i = 0; i < draws; i++) {
    const [z1, z2] = twoNormals(rand);
    const along = L[0][0] * z1;
    const crossKm = L[1][0] * z1 + L[1][1] * z2;
    if (latAt(event, corridor, along, crossKm) > lineDeg) north++;
  }
  return north / draws;
}

/** Box–Muller, both draws used. */
function twoNormals(rand) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

/**
 * How sure a perfect analyst should be, given a covariance and a line.
 *
 * Confidence is "probability of calling the side correctly", so it is whichever
 * of p and 1−p is bigger.
 */
export function confidenceOf(event, corridor, C, lineDeg, draws, rand) {
  const p = northProbability(event, corridor, C, lineDeg, draws, rand);
  return { p, confidence: Math.max(p, 1 - p) };
}

/**
 * Solve for the along-track sigma that makes a good team exactly `target` sure.
 *
 * Bigger sigma means a vaguer answer, so confidence falls as sigma grows and
 * the bisection is monotone. Done with a fixed sample stream so the search
 * sees a smooth function rather than Monte Carlo hash.
 */
export function sigmaForConfidence(event, corridor, lineDeg, target, opts = {}) {
  const { draws = 4000, lo = 1, hi = 6000, ratio = 6, tiltDeg = 12, seed = 1 } = opts;
  const stream = fixedStream(seed, draws * 2 + 8);
  const conf = (sig) =>
    confidenceOf(event, corridor, covariance(sig, ratio, tiltDeg), lineDeg, draws, stream()).confidence;

  if (conf(hi) > target) return { sigmaKm: hi, confidence: conf(hi), capped: true };
  if (conf(lo) < target) return { sigmaKm: lo, confidence: conf(lo), capped: true };
  let a = lo;
  let b = hi;
  for (let i = 0; i < 40; i++) {
    const m = Math.sqrt(a * b);
    if (conf(m) > target) a = m;
    else b = m;
  }
  const sigmaKm = Math.sqrt(a * b);
  return { sigmaKm, confidence: conf(sigmaKm), capped: false };
}

/**
 * One fixed list of uniforms, replayed for every trial.
 *
 * Without this the bisection is comparing different random worlds at each step
 * and never settles; with it the confidence is a smooth monotone function of
 * sigma and forty halvings land on a clean answer.
 */
function fixedStream(seed, n) {
  let a = seed >>> 0;
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    xs[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return () => {
    let i = 0;
    return () => xs[i++ % n];
  };
}

/**
 * Where to put the line so the question is worth asking.
 *
 * Too far from the nominal point and everyone knows the answer; right on top of
 * it and it is a coin toss nobody can beat. This puts it where a good team is
 * `target` sure, then rounds it to something a person would say out loud.
 */
export function placeLine(event, corridor, sigmaKm, target, opts = {}) {
  const { draws = 4000, ratio = 6, tiltDeg = 12, seed = 7 } = opts;
  const C = covariance(sigmaKm, ratio, tiltDeg);
  const stream = fixedStream(seed, draws * 2 + 8);
  // Search outward from the nominal latitude for the line giving the target.
  let best = { line: event.lat, conf: 1, d: Infinity };
  for (let off = -8; off <= 8; off += 0.05) {
    const line = event.lat + off;
    const { confidence } = confidenceOf(event, corridor, C, line, draws, stream());
    const d = Math.abs(confidence - target);
    if (d < best.d) best = { line, conf: confidence, d };
  }
  return { lineDeg: Math.round(best.line * 10) / 10, confidence: best.conf };
}
