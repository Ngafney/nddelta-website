/**
 * Deterministic RNG for every game in Week 1.
 *
 * Everything downstream (bandit worlds, per-spin payoffs, tournament
 * matches, replays) is keyed off string seeds run through these functions,
 * so the same seed always produces the same universe — on the client, on
 * the server, today and after a redeploy. That determinism is what makes
 * server-side verification of manual runs and replayable tournaments
 * possible at all.
 */

/** FNV-1a 32-bit string hash. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good-enough PRNG. Returns () => [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG from a string key. */
export function rngFrom(key) {
  return mulberry32(hash32(key));
}

/** One standard-normal draw from a PRNG (Box–Muller, no spare kept). */
export function gaussian(rand) {
  let u1 = 0;
  // u1 must be strictly positive for the log.
  while (u1 === 0) u1 = rand();
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** One standard-normal draw keyed directly off a string. */
export function gaussFrom(key) {
  return gaussian(rngFrom(key));
}
