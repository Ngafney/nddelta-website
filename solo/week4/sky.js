/**
 * Week 4, solo: the arithmetic a team does, written fast.
 *
 * Everything here takes the published data block (what `GET data` returns to
 * any player: the sightings, GM_sun, GM_earth, the Earth's elements, the error
 * bars) and nothing else. It is the code a good team would write in the
 * research window: fit [x, y, vx, vy] to the sightings, look at the
 * residuals, throw out what cannot be right, then sample orbits from the fit's
 * covariance and fly each one past the Earth.
 *
 * Why not just call week4/shared/round.js? Because it is written to be read,
 * not to be fast: every sighting is propagated from t = 0, so a 32-sighting fit
 * takes four seconds and the server's 15-refit house price for one round takes
 * over a minute. Here each trajectory is flown once, in order, with no
 * allocation in the inner loop: the same physics (Sun + Earth, RK4, the same
 * step rule, the Earth on its Kepler ellipse), checked against the original in
 * solo/sim/week4.mjs.
 *
 * Pure functions, no imports from the game: the bots' worker and the headless
 * harness both load this file.
 */

/* ── randomness ────────────────────────────────────────────────────────── */

export function mulberry(seedStr) {
  let h = 2166136261 >>> 0;
  const s = String(seedStr);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Φ, for the people who reach for it. */
export function Phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/* ── the system, from the published block ──────────────────────────────── */

/**
 * `d` is the data response. Returns a closure-heavy physics object so the
 * inner loops read plain numbers.
 */
export function physics(d, m0Shift = 0) {
  const GS = d.gmSun;
  const GE = d.gmEarth;
  const E = d.earth;
  const n = (2 * Math.PI) / E.periodDays;
  const a = E.aAu;
  const e = E.e;
  const b = Math.sqrt(1 - e * e);
  const cp = Math.cos(E.peri);
  const sp = Math.sin(E.peri);
  const M0 = E.M0 + m0Shift;
  // Earth position and velocity at t, written into `o` = [x, y, vx, vy].
  // The same instant is asked for three or four times a step (the step rule,
  // the segment check, RK4's ends), so the last two answers are remembered.
  let t1 = NaN, t2 = NaN;
  const c1 = new Float64Array(4), c2 = new Float64Array(4);
  const earth = (t, o) => {
    if (t === t1) {
      o[0] = c1[0]; o[1] = c1[1]; o[2] = c1[2]; o[3] = c1[3];
      return;
    }
    if (t === t2) {
      o[0] = c2[0]; o[1] = c2[1]; o[2] = c2[2]; o[3] = c2[3];
      return;
    }
    solve(t, o);
    t2 = t1; c2.set(c1);
    t1 = t; c1.set(o);
  };
  const solve = (t, o) => {
    const M = M0 + n * t;
    let En = M + e * Math.sin(M);
    for (let i = 0; i < 8; i++) {
      const dE = (En - e * Math.sin(En) - M) / (1 - e * Math.cos(En));
      En -= dE;
      if (Math.abs(dE) < 1e-15) break;
    }
    const cE = Math.cos(En);
    const sE = Math.sin(En);
    const px = a * (cE - e);
    const py = a * b * sE;
    const rd = (n * a) / (1 - e * cE);
    const vx = -rd * sE;
    const vy = rd * b * cE;
    o[0] = px * cp - py * sp;
    o[1] = px * sp + py * cp;
    o[2] = vx * cp - vy * sp;
    o[3] = vx * sp + vy * cp;
  };
  return { GS, GE, earth, R: d.earthRadiusAu };
}

const EW = new Float64Array(4);

/**
 * One RK4 step of s (Float64Array(4)) from t by h, in place. Earth position
 * is evaluated at t, t+h/2 and t+h, as the original does.
 */
function rk4(P, s, t, h) {
  const { GS, GE, earth } = P;
  let x = s[0], y = s[1], vx = s[2], vy = s[3];
  // k1
  earth(t, EW);
  let ex = EW[0], ey = EW[1];
  let r2 = x * x + y * y, r = Math.sqrt(r2), k = -GS / (r2 * r);
  let dx = x - ex, dy = y - ey, d2 = dx * dx + dy * dy, dd = Math.sqrt(d2), ke = -GE / (d2 * dd);
  const a1x = k * x + ke * dx, a1y = k * y + ke * dy;
  const v1x = vx, v1y = vy;
  // k2
  earth(t + h / 2, EW);
  const exm = EW[0], eym = EW[1];
  let x2 = x + (v1x * h) / 2, y2 = y + (v1y * h) / 2;
  const v2x = vx + (a1x * h) / 2, v2y = vy + (a1y * h) / 2;
  r2 = x2 * x2 + y2 * y2; r = Math.sqrt(r2); k = -GS / (r2 * r);
  dx = x2 - exm; dy = y2 - eym; d2 = dx * dx + dy * dy; dd = Math.sqrt(d2); ke = -GE / (d2 * dd);
  const a2x = k * x2 + ke * dx, a2y = k * y2 + ke * dy;
  // k3
  const x3 = x + (v2x * h) / 2, y3 = y + (v2y * h) / 2;
  const v3x = vx + (a2x * h) / 2, v3y = vy + (a2y * h) / 2;
  r2 = x3 * x3 + y3 * y3; r = Math.sqrt(r2); k = -GS / (r2 * r);
  dx = x3 - exm; dy = y3 - eym; d2 = dx * dx + dy * dy; dd = Math.sqrt(d2); ke = -GE / (d2 * dd);
  const a3x = k * x3 + ke * dx, a3y = k * y3 + ke * dy;
  // k4
  earth(t + h, EW);
  ex = EW[0]; ey = EW[1];
  const x4 = x + v3x * h, y4 = y + v3y * h;
  const v4x = vx + a3x * h, v4y = vy + a3y * h;
  r2 = x4 * x4 + y4 * y4; r = Math.sqrt(r2); k = -GS / (r2 * r);
  dx = x4 - ex; dy = y4 - ey; d2 = dx * dx + dy * dy; dd = Math.sqrt(d2); ke = -GE / (d2 * dd);
  const a4x = k * x4 + ke * dx, a4y = k * y4 + ke * dy;
  s[0] = x + (h * (v1x + 2 * v2x + 2 * v3x + v4x)) / 6;
  s[1] = y + (h * (v1y + 2 * v2y + 2 * v3y + v4y)) / 6;
  s[2] = vx + (h * (a1x + 2 * a2x + 2 * a3x + a4x)) / 6;
  s[3] = vy + (h * (a1y + 2 * a2y + 2 * a3y + a4y)) / 6;
}

const EP = new Float64Array(4);
/** The original's step rule: a quarter day, shrinking to 1/50 of the distance to the Earth. */
function stepAt(P, s, t) {
  P.earth(t, EP);
  const d = Math.hypot(s[0] - EP[0], s[1] - EP[1]);
  const v = Math.hypot(s[2], s[3]) || 1e-9;
  return Math.min(0.25, Math.max(2e-5, d / (50 * v)));
}

/** Positions at each of `times` (ascending, >= 0), flying the orbit once. */
export function track(P, s0, times, out) {
  const s = Float64Array.from(s0);
  let t = 0;
  for (let i = 0; i < times.length; i++) {
    const ti = times[i];
    while (ti - t > 1e-12) {
      const h = Math.min(stepAt(P, s, t), ti - t);
      rk4(P, s, t, h);
      t += h;
    }
    out[2 * i] = s[0];
    out[2 * i + 1] = s[1];
  }
  return out;
}

/**
 * Closest approach to the Earth between 0 and tEnd. Inside each step the
 * relative motion is a straight line to well under a kilometre (steps near
 * the Earth cross a fiftieth of the distance), so the minimum is taken along
 * that segment rather than read off the step ends.
 */
export function closest(P, s0, tEnd) {
  const s = Float64Array.from(s0);
  const R = P.R;
  let t = 0;
  let best = Infinity;
  let bestT = 0;
  while (tEnd - t > 1e-12) {
    const h = Math.min(stepAt(P, s, t), tEnd - t);
    P.earth(t, EP);
    const rx = s[0] - EP[0], ry = s[1] - EP[1];
    const ux = s[2] - EP[2], uy = s[3] - EP[3];
    const uu = ux * ux + uy * uy;
    let tau = uu > 0 ? -(rx * ux + ry * uy) / uu : 0;
    tau = Math.max(0, Math.min(h, tau));
    const dm = Math.hypot(rx + ux * tau, ry + uy * tau);
    if (dm < best) {
      best = dm;
      bestT = t + tau;
    }
    if (best <= R) return { missAu: best, tDays: bestT, hit: true };
    rk4(P, s, t, h);
    t += h;
  }
  P.earth(t, EP);
  const dEnd = Math.hypot(s[0] - EP[0], s[1] - EP[1]);
  if (dEnd < best) {
    best = dEnd;
    bestT = t;
  }
  return { missAu: best, tDays: bestT, hit: best <= R };
}

/* ── the fit ───────────────────────────────────────────────────────────── */

function inv4(A) {
  const M = A.map((r, i) => [...r, ...[0, 1, 2, 3].map((j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!Number.isFinite(M[p][c]) || Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    for (let k = 0; k < 8; k++) M[c][k] /= piv;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f) for (let k = 0; k < 8; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r) => r.slice(4));
}

function chol4(C) {
  const L = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j <= i; j++) {
      let s = C[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

/**
 * Gauss-Newton on [x, y, vx, vy] at t = 0, unweighted (every sighting has the
 * same error). Returns the state, the residual of every sighting in sigma,
 * and the covariance σ²(JᵀJ)⁻¹.
 */
export function fit(P, obs, sigmaAu, guess, iters = 20) {
  const times = obs.map((o) => o.t);
  const n = obs.length;
  let s = guess ? guess.slice() : guessFrom(obs);
  const base = new Float64Array(2 * n);
  const cols = [0, 1, 2, 3].map(() => new Float64Array(2 * n));
  let A = null;
  for (let it = 0; it < iters; it++) {
    track(P, s, times, base);
    for (let k = 0; k < 4; k++) {
      const h = k < 2 ? 1e-8 : 1e-11;
      const sp = s.slice();
      sp[k] += h;
      track(P, sp, times, cols[k]);
      for (let q = 0; q < 2 * n; q++) cols[k][q] = (cols[k][q] - base[q]) / h;
    }
    A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const g = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j <= i; j++) {
        let v = 0;
        for (let q = 0; q < 2 * n; q++) v += cols[i][q] * cols[j][q];
        A[i][j] = A[j][i] = v;
      }
      let v = 0;
      for (let q = 0; q < n; q++) {
        v += cols[i][2 * q] * (obs[q].x - base[2 * q]) + cols[i][2 * q + 1] * (obs[q].y - base[2 * q + 1]);
      }
      g[i] = v;
    }
    const Ai = inv4(A);
    if (!Ai) return null;
    const dx = [0, 1, 2, 3].map((i) => Ai[i][0] * g[0] + Ai[i][1] * g[1] + Ai[i][2] * g[2] + Ai[i][3] * g[3]);
    for (let k = 0; k < 4; k++) s[k] += dx[k];
    if (!s.every(Number.isFinite)) return null;
    if (Math.hypot(dx[0], dx[1]) < 1e-12 && Math.hypot(dx[2], dx[3]) < 1e-15) break;
  }
  track(P, s, times, base);
  const resid = obs.map((o, i) => Math.hypot(o.x - base[2 * i], o.y - base[2 * i + 1]) / sigmaAu);
  const Ai = inv4(A);
  const cov = Ai ? Ai.map((r) => r.map((v) => v * sigmaAu * sigmaAu)) : null;
  return { s, resid, cov };
}

export function guessFrom(obs) {
  const a = obs[0];
  const b = obs[obs.length - 1];
  const dt = b.t - a.t || 1;
  return [a.x, a.y, (b.x - a.x) / dt, (b.y - a.y) / dt];
}

/**
 * Look at the residuals and throw out what cannot be right: the worst one at
 * a time, refitting after each, while it sits past `cut` sigma. One at a time
 * because a forty-sigma blunder drags the fit and inflates its neighbours.
 */
export function cleanFit(P, obs, sigmaAu, cut = 4.5) {
  let kept = obs.slice();
  let f = fit(P, kept, sigmaAu);
  const dropped = [];
  while (f && kept.length > 6) {
    let w = 0;
    for (let i = 1; i < f.resid.length; i++) if (f.resid[i] > f.resid[w]) w = i;
    if (f.resid[w] <= cut) break;
    dropped.push(kept[w]);
    kept = kept.filter((_, i) => i !== w);
    f = fit(P, kept, sigmaAu, f.s);
  }
  return f ? { ...f, kept, dropped } : null;
}

/**
 * The Monte Carlo: `count` orbits drawn from the fit's covariance (the same
 * distribution as jitter-the-sightings-and-refit, without paying for the
 * refits), each flown past an Earth that is itself uncertain by the published
 * ephemeris error. Returns every sample's miss distance and whether it hit.
 */
export function sampleMisses(d, f, count, rand, { earthJitter = true } = {}) {
  const L = f.cov && chol4(f.cov);
  if (!L) return null;
  const auKm = d.auKm;
  const eSig = d.earthEphemSigmaKm / auKm;
  const out = [];
  for (let k = 0; k < count; k++) {
    const z = [normal(rand), normal(rand), normal(rand), normal(rand)];
    const s = [0, 1, 2, 3].map((i) => f.s[i] + L[i][0] * z[0] + L[i][1] * z[1] + L[i][2] * z[2] + L[i][3] * z[3]);
    const P = physics(d, earthJitter ? (eSig * normal(rand)) / d.earth.aAu : 0);
    const ca = closest(P, s, d.tEnd);
    out.push({ km: ca.missAu * auKm, hit: ca.hit });
  }
  return out;
}

/**
 * Everything the room's bots need for one release, from the published block.
 * Done once per release and shared: they all hold the same sightings.
 *
 *   clean   residuals checked, blunders dropped, then sampled   (the right way)
 *   raw     every sighting trusted, then sampled                (the blunder trap)
 *   nominal the single best-fit orbit's miss distance           (no Monte Carlo at all)
 */
export function analyse(d, { clean = 400, raw = 200, seed = "x" } = {}) {
  const rand = mulberry(`${seed}|${d.release}|${d.sightings.length}`);
  const sigmaAu = d.sightingSigmaKm / d.auKm;
  const P0 = physics(d);
  const obs = d.sightings;
  const fc = cleanFit(P0, obs, sigmaAu);
  const fr = fit(P0, obs, sigmaAu);
  const out = { release: d.release, n: obs.length, dropped: fc ? fc.dropped.map((o) => obs.indexOf(o)) : [] };
  if (fc) {
    const nom = closest(P0, fc.s, d.tEnd);
    out.nominalKm = nom.missAu * d.auKm;
    out.clean = sampleMisses(d, fc, clean, rand);
  }
  if (fr) out.raw = sampleMisses(d, fr, raw, rand, { earthJitter: false });
  out.radiusKm = d.earthRadiusKm;
  return out;
}

/** P(hit) from a list of samples. */
export const pHit = (samples) => (samples?.length ? samples.filter((x) => x.hit).length / samples.length : null);

/**
 * The shortcut: treat the miss distance as a normal and read P(miss < R) off Φ.
 * It is what someone does who ran twenty refits, took the mean and the spread,
 * and stopped thinking. A miss distance is not a normal variable: it cannot be
 * negative, and the Earth's gravity bends the close ones in.
 */
export function phiShortcut(samples, R, n = 30) {
  const xs = samples.slice(0, n).map((x) => x.km);
  if (xs.length < 3) return null;
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1)) || 1;
  return Phi((R - mu) / sd);
}
