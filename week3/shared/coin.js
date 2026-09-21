/**
 * The hidden coin: drawing p, and flipping it.
 *
 * Everything is keyed off a seed string through the same deterministic PRNG
 * week 1 used, so a round can be replayed exactly from its seed and the tests
 * can pin every number.
 */
import { rngFrom, gaussian } from "./rng.js";

/**
 * One Gamma(k, 1) draw — Marsaglia & Tsang, with the k < 1 boost
 * (Gamma(k) = Gamma(k + 1) · U^(1/k)) so Beta(0.3, 0.3) works too.
 */
export function gammaDraw(k, rand) {
  if (k < 1) {
    let u = 0;
    while (u === 0) u = rand();
    return gammaDraw(k + 1, rand) * Math.pow(u, 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = gaussian(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** One Beta(a, b) draw. */
export function betaDraw(a, b, rand) {
  const x = gammaDraw(a, rand);
  const y = gammaDraw(b, rand);
  // Beta(0.3, 0.3) can underflow both gammas to 0; that is a coin at an edge.
  if (x + y === 0) return rand() < a / (a + b) ? 1 : 0;
  return x / (x + y);
}

/**
 * The round's secret: p, and — if the round settles on a final flip — that
 * flip, decided now so nothing about it depends on when the bell rings.
 */
export function makeCoin(seed, prior, settlement) {
  const rand = rngFrom(`${seed}|coin`);
  const p = betaDraw(prior.a, prior.b, rand);
  const finalHeads = rngFrom(`${seed}|final`)() < p;
  const settleValue = settlement === "flip" ? (finalHeads ? 100 : 0) : Math.round(p * 10000) / 100;
  return { p, finalHeads, settlement, settleValue, prior: prior.key };
}

/** Flip the coin n times for one player. Returns "HTTH…". */
export function flipMany(p, n, seed) {
  const rand = rngFrom(seed);
  let out = "";
  for (let i = 0; i < n; i++) out += rand() < p ? "H" : "T";
  return out;
}
