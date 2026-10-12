/**
 * Week 6 — the pot's arithmetic. Pure, no I/O, no clock.
 *
 * S is the sum of N whole numbers in 0 … 10. Three payoffs, all in whole
 * dollars per share at integer S:
 *
 *   fut   S
 *   call  max(S − K, 0)
 *   put   max(K − S, 0)
 *
 * Everything the engine needs to keep people solvent, and everything the
 * reveal needs to say what things were worth, lives here.
 */
import { NUMBER_MAX, BOOK_ORDER, BOUNDS, LIMITS } from "./rules.js";
import { rngFrom } from "./rng.js";

/** The payoff of one share of `key` at settlement S, in dollars. */
export function payoff(key, S, K) {
  if (key === "fut") return S;
  if (key === "call") return Math.max(S - K, 0);
  if (key === "put") return Math.max(K - S, 0);
  throw new Error(`no such book: ${key}`);
}

/**
 * The least and most a share of `key` can pay when S is known to lie in
 * [lo, hi]. Every payoff is monotone in S, so the extremes sit at the ends.
 */
export function payRange(key, lo, hi, K) {
  const a = payoff(key, lo, K);
  const b = payoff(key, hi, K);
  return a <= b ? [a, b] : [b, a];
}

/** Where S can still land, given what has come out of the pot. */
export function sumBounds(N, revealed) {
  let sum = 0;
  for (const n of revealed) sum += n;
  const left = Math.max(0, N - revealed.length);
  return { sum, left, lo: sum, hi: sum + NUMBER_MAX * left };
}

/* ── the uniform prior ────────────────────────────────────────────────── */

const pmfCache = new Map();

/**
 * The exact distribution of the sum of m independent uniforms on 0 … 10:
 * pmf[s] = P(sum = s), s = 0 … 10m. A convolution, cached per m.
 */
export function sumPmf(m) {
  if (pmfCache.has(m)) return pmfCache.get(m);
  let p = [1];
  for (let i = 0; i < m; i++) {
    const q = new Array(p.length + NUMBER_MAX).fill(0);
    for (let s = 0; s < p.length; s++) {
      if (!p[s]) continue;
      const w = p[s] / (NUMBER_MAX + 1);
      for (let d = 0; d <= NUMBER_MAX; d++) q[s + d] += w;
    }
    p = q;
  }
  pmfCache.set(m, p);
  return p;
}

/**
 * What a share of `key` is worth if the unrevealed numbers were uniform and
 * independent: E[payoff(sum + U)] over the convolution. The "naive" fair
 * value — right if the room picked at random, which it did not.
 */
export function fairUniform(key, N, revealed, K) {
  const { sum, left } = sumBounds(N, revealed);
  const p = sumPmf(left);
  let v = 0;
  for (let s = 0; s < p.length; s++) if (p[s]) v += p[s] * payoff(key, sum + s, K);
  return v;
}

/** fairUniform for every book at once. */
export function fairAll(N, revealed, K) {
  const out = {};
  for (const k of BOOK_ORDER) out[k] = fairUniform(k, N, revealed, K);
  return out;
}

/* ── the draw ─────────────────────────────────────────────────────────── */

/** A seeded shuffle (Fisher–Yates) — the order the numbers come out. */
export function shuffle(items, seed) {
  const a = items.slice();
  const rand = rngFrom(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A number for a team that never picked one, drawn from the seed. */
export function drawNumber(seed) {
  return Math.floor(rngFrom(seed)() * (NUMBER_MAX + 1));
}

/** Is this a legal number for the pot? */
export function validNumber(n) {
  return Number.isInteger(n) && n >= 0 && n <= NUMBER_MAX;
}

/* ── the round's settings, validated ──────────────────────────────────── */

const bool = (v, d) => (v == null || v === "" ? d : v === true || v === "true" || v === 1 || v === "1" || v === "on");

/**
 * Turn whatever the admin typed into settings, or say exactly what is wrong.
 * Empty fields mean "default", never zero. Throws Error with a readable message.
 */
export function normalizeParams(raw, defaults) {
  const num = (v, fallback, label) => {
    if (v == null || v === "") return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
    return n;
  };
  const inRange = (label, v, [lo, hi], int = false) => {
    if (int && !Number.isInteger(v)) throw new Error(`${label} must be a whole number`);
    if (v < lo || v > hi) throw new Error(`${label} must be between ${lo} and ${hi}`);
    return v;
  };
  const K = raw?.K == null || raw.K === "" ? null : inRange("K", num(raw.K, null, "K"), BOUNDS.K, true);
  const noiseRaw = raw?.noise ?? {};
  const booksRaw = raw?.books ?? {};
  return {
    K,
    pickSeconds: inRange("pick seconds", num(raw?.pickSeconds, defaults.pickSeconds, "pick seconds"), BOUNDS.pickSeconds),
    autoEverySec: inRange("auto reveal seconds", num(raw?.autoEverySec, defaults.autoEverySec, "auto reveal seconds"), BOUNDS.autoEverySec),
    autoOn: bool(raw?.autoOn, defaults.autoOn),
    books: {
      fut: bool(booksRaw.fut, defaults.books.fut),
      call: bool(booksRaw.call, defaults.books.call),
      put: bool(booksRaw.put, defaults.books.put),
    },
    noise: {
      on: bool(noiseRaw.on, defaults.noise.on),
      desks: inRange("noise desks", num(noiseRaw.desks, defaults.noise.desks, "noise desks"), BOUNDS.desks, true),
      everySec: inRange("noise seconds", num(noiseRaw.everySec, defaults.noise.everySec, "noise seconds"), BOUNDS.everySec),
      size: inRange("noise size", num(noiseRaw.size, defaults.noise.size, "noise size"), BOUNDS.size, true),
      sweep: inRange("noise sweep", num(noiseRaw.sweep, defaults.noise.sweep, "noise sweep"), BOUNDS.sweep, true),
    },
  };
}

/** The insider's settings, checked. Blanks mean "keep what there is". */
export function normalizeSharp(raw, current) {
  const num = (v, fallback, label) => {
    if (v == null || v === "") return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
    return n;
  };
  const inRange = (label, v, [lo, hi], int = false) => {
    if (int && !Number.isInteger(v)) throw new Error(`${label} must be a whole number`);
    if (v < lo || v > hi) throw new Error(`${label} must be between ${lo} and ${hi}`);
    return v;
  };
  // `edge` is DOLLARS (0.10 = ten cents); `edgeC` is cents, for callers that have them.
  let edgeC = raw?.edge == null || raw.edge === "" ? current.edgeC : Math.round(num(raw.edge, current.edgeC / 100, "edge") * 100);
  if (raw?.edgeC != null && raw.edgeC !== "") edgeC = Math.round(num(raw.edgeC, current.edgeC, "edge"));
  return {
    edgeC: inRange("edge (cents)", edgeC, BOUNDS.edgeC, true),
    size: inRange("shares per strike", num(raw?.size, current.size, "shares per strike"), BOUNDS.sharpSize, true),
    everySec: inRange("loop seconds", num(raw?.everySec, current.everySec, "loop seconds"), BOUNDS.sharpEverySec),
  };
}

/**
 * The strike the round actually uses. The host's K if it fits inside the
 * range S can take; otherwise the uniform mean 5N, which always does for N ≥ 1.
 * Returns { K, auto } so the caller can say which happened.
 */
export function resolveStrike(Kreq, N) {
  const Smax = NUMBER_MAX * N;
  if (Kreq != null && Number.isInteger(Kreq) && Kreq >= 1 && Kreq <= Smax - 1) return { K: Kreq, auto: false };
  return { K: Math.max(1, Math.min(Smax - 1, Math.round((NUMBER_MAX / 2) * N))), auto: true };
}

export const MAX_TEAMS = LIMITS.maxTeams;
