/**
 * Week 5 — the hidden process. Pure, seeded, no I/O, no clock.
 *
 *   Y_{t+1} = μ + φ_t (Y_t − μ) + σ·ε,     ε ~ N(0, 1)
 *
 * φ = 1 is a random walk (μ drops out). φ_t is φ1 up to a "switch tick" S and
 * φ2 after it: live tick s is generated with φ2 exactly when s > S. The switch,
 * if there is one, is always in the LIVE part of the path, never in the history.
 *
 * ── Why the history is generated backwards ──────────────────────────────
 * The admin picks the opening value Y_open, and the history has to END there.
 * A stationary Gaussian AR(1) is time-reversible — the reversed sequence has
 * the same joint law — so stepping BACKWARD from Y_0 = Y_open with the same
 * recursion (and φ1) draws a past that is exactly as likely as any forward one
 * that happened to finish at Y_open. A random walk (φ = 1) is reversible in the
 * same sense: its increments are i.i.d. and symmetric. The live ticks then run
 * forward from Y_open.
 *
 * Every value is rounded to 4 dp AS IT IS GENERATED, and the next value is
 * computed from the rounded one. So the CSV a player downloads IS the process:
 * nobody is fitting a rounded copy of something else.
 */
import { rngFrom, gaussian } from "./rng.js";

const DP = 1e4;
export const round4 = (v) => Math.round(v * DP) / DP;

/* ── Φ, the standard normal CDF ──────────────────────────────────────────
 * Hart's double-precision algorithm as given by West (2005), "Better
 * approximations to cumulative normal functions". Absolute error is ~1e-14
 * across the line, comfortably inside the 1e-6 the tests demand. */
export function Phi(x) {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const z = Math.abs(x);
  let c;
  if (z > 37) {
    c = 0;
  } else {
    const e = Math.exp((-z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165;
      n = n * z + 33.912866078383;
      n = n * z + 112.079291497871;
      n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      c = (e * n) / d;
    } else {
      let b = z + 0.65;
      b = z + 4 / b;
      b = z + 3 / b;
      b = z + 2 / b;
      b = z + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/* ── the spec ─────────────────────────────────────────────────────────── */

/** φ for the step that PRODUCES live tick s (s = 1 … T). */
export function phiAt(spec, s) {
  return spec.switchTick != null && s > spec.switchTick ? spec.phi2 : spec.phi1;
}

/**
 * Draw a round: the history ending at Y_open, and every live tick.
 *
 *   history[i] is Y at t = i − (H − 1), so history[H − 1] = Y_0 = Y_open.
 *   path[s]    is Y at live tick s; path[0] = Y_open too, for convenience.
 *
 * Two independent streams off the seed, so changing T never changes the
 * history and changing H never changes the live ticks.
 */
export function makePath(p) {
  const { phi1, sigma, mu, yOpen, H, T, seed } = p;
  const back = rngFrom(`${seed}|history`);
  const hist = new Array(H);
  hist[H - 1] = round4(yOpen);
  for (let i = H - 2; i >= 0; i--) {
    hist[i] = round4(mu + phi1 * (hist[i + 1] - mu) + sigma * gaussian(back));
  }
  const fwd = rngFrom(`${seed}|live`);
  const path = new Array(T + 1);
  path[0] = hist[H - 1];
  for (let s = 1; s <= T; s++) {
    const phi = phiAt(p, s);
    path[s] = round4(mu + phi * (path[s - 1] - mu) + sigma * gaussian(fwd));
  }
  return { history: hist, path };
}

/* ── fair value ───────────────────────────────────────────────────────── */

/**
 * The TRUE P(Y_T > K) standing at live tick `tick`, under the true spec,
 * scheduled switch included. Mean and variance are carried one step at a time
 * because φ can change on the way:
 *
 *     m ← μ + φ_s (m − μ),    v ← φ_s² v + σ²,    from (Y_tick, 0)
 *
 * At the bell there is nothing left to propagate and the answer is 0 or 1.
 */
export function fairValue(spec, path, tick) {
  const t = Math.max(0, Math.min(spec.T, tick));
  const y = path[t];
  if (t >= spec.T) return y > spec.K ? 1 : 0;
  let m = y;
  let v = 0;
  for (let s = t + 1; s <= spec.T; s++) {
    const phi = phiAt(spec, s);
    m = spec.mu + phi * (m - spec.mu);
    v = phi * phi * v + spec.sigma * spec.sigma;
  }
  return Phi((m - spec.K) / Math.sqrt(v));
}

/** fairValue at every tick 0 … T. */
export function fairSeries(spec, path) {
  const out = [];
  for (let t = 0; t <= spec.T; t++) out.push(fairValue(spec, path, t));
  return out;
}

/* ── estimation, from public data only ────────────────────────────────── */

/**
 * OLS of Y_t on Y_{t−1}: Y_t = a + b·Y_{t−1} + e. Returns φ̂ = b, its standard
 * error, μ̂ = a / (1 − b) (undefined when b is 1), and σ̂ from the residuals.
 */
export function fitAR1(ys) {
  const n = ys.length - 1;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 1; i <= n; i++) {
    sx += ys[i - 1];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 1; i <= n; i++) {
    const dx = ys[i - 1] - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i] - my);
  }
  const phi = sxx > 0 ? sxy / sxx : 1;
  const a = my - phi * mx;
  let sse = 0;
  for (let i = 1; i <= n; i++) {
    const r = ys[i] - a - phi * ys[i - 1];
    sse += r * r;
  }
  const sigma = Math.sqrt(sse / Math.max(1, n - 2));
  const sePhi = sxx > 0 ? sigma / Math.sqrt(sxx) : Infinity;
  const mu = Math.abs(1 - phi) > 1e-9 ? a / (1 - phi) : null;
  return { phi, sePhi, mu, sigma, n };
}

/** Standard deviation of first differences — the random-walk σ̂. */
export function diffSigma(ys) {
  const n = ys.length - 1;
  if (n < 2) return null;
  let s = 0;
  let ss = 0;
  for (let i = 1; i <= n; i++) {
    const d = ys[i] - ys[i - 1];
    s += d;
    ss += d * d;
  }
  const mean = s / n;
  return Math.sqrt(Math.max(0, (ss - n * mean * mean) / (n - 1)));
}

/**
 * What someone who assumes a random walk would say: P = Φ((Y_now − K)/(σ̂√h)),
 * with σ̂ from the public data alone. Right when φ = 1, wrong when it is not —
 * and that gap is the round.
 */
export function naivePrice(publicYs, K, h) {
  const y = publicYs[publicYs.length - 1];
  if (h <= 0) return y > K ? 1 : 0;
  const s = diffSigma(publicYs) || 1;
  return Phi((y - K) / (s * Math.sqrt(h)));
}

/* ── the round's numbers, validated ───────────────────────────────────── */

export const BOUNDS = {
  phi: [-0.99, 1],
  sigma: [0.01, 50],
  level: [-1e6, 1e6],
  H: [20, 1000],
  T: [5, 300],
  secondsPerTick: [1, 30],
  researchMinutes: [0.25, 60],
};

/**
 * Turn whatever the admin typed into a spec, or say exactly what is wrong.
 * Empty fields mean "default", never zero. Throws Error with a readable message.
 */
export function normalizeParams(raw, defaults) {
  const num = (k) => {
    const v = raw?.[k];
    if (v == null || v === "") return defaults[k];
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${k} must be a number`);
    return n;
  };
  const inRange = (k, v, [lo, hi], int = false) => {
    if (int && !Number.isInteger(v)) throw new Error(`${k} must be a whole number`);
    if (v < lo || v > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
    return v;
  };
  const phi1 = inRange("φ1", num("phi1"), BOUNDS.phi);
  const T = inRange("T (live ticks)", num("T"), BOUNDS.T, true);
  const H = inRange("H (history length)", num("H"), BOUNDS.H, true);
  let switchTick = raw?.switchTick == null || raw.switchTick === "" ? null : Number(raw.switchTick);
  if (switchTick != null) {
    if (!Number.isInteger(switchTick) || switchTick < 1 || switchTick >= T) {
      throw new Error(`the switch tick must be a whole number from 1 to ${T - 1} (or blank for no switch)`);
    }
  }
  const phi2Raw = raw?.phi2 == null || raw.phi2 === "" ? null : Number(raw.phi2);
  const phi2 = switchTick == null ? phi1 : inRange("φ2", phi2Raw ?? defaults.phi2 ?? phi1, BOUNDS.phi);
  return {
    phi1,
    phi2,
    switchTick,
    sigma: inRange("σ", num("sigma"), BOUNDS.sigma),
    mu: inRange("μ", num("mu"), BOUNDS.level),
    K: inRange("K", num("K"), BOUNDS.level),
    // Rounded to the grid the series lives on, so the history ends EXACTLY here.
    yOpen: round4(inRange("Y_open", num("yOpen"), BOUNDS.level)),
    H,
    T,
    secondsPerTick: inRange("seconds per tick", num("secondsPerTick"), BOUNDS.secondsPerTick),
    researchMinutes: inRange("research minutes", num("researchMinutes"), BOUNDS.researchMinutes),
    naiveBot: raw?.naiveBot == null ? defaults.naiveBot : raw.naiveBot === true || raw.naiveBot === "true" || raw.naiveBot === 1,
  };
}
