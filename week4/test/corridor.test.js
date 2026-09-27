/**
 * The geometry and the statistics the whole round rests on.
 *
 * Two things have to be true or the week teaches nothing:
 *
 *   1. Walking down a real corridor bends. If latitude were linear in distance
 *      along the ground, Φ((line − µ)/σ) would be exactly right and there would
 *      be no reason to simulate anything.
 *   2. The published solution is NOT the true impact point. If it were, the
 *      favoured side would always be the winning side and the correct play
 *      would be to buy it at any price without thinking.
 */
import assert from "node:assert";
import {
  R_EARTH_KM, toUnit, toLatLon, walk, corridorOf, latAt,
  covariance, chol2, northProbability, confidenceOf, placeLine,
} from "../shared/corridor.js";
import { EVENTS, EVENT_KEYS, eventByKey, OTHER_IMPACTS } from "../shared/events.js";
import { SCENARIO, MARKETS, aiPrompt } from "../shared/rules.js";

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 3).join("\n      ")}`);
  }
}

const rand = (() => {
  let a = 12345;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();

console.log("\ncorridor");

/* ── the real events ──────────────────────────────────────────────────── */

ok("every event carries a real impact point and says where its geometry came from", () => {
  assert.ok(EVENTS.length >= 4, "not enough events to give a round any variety");
  for (const e of EVENTS) {
    assert.ok(Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180, `${e.name} is not on Earth`);
    assert.ok(e.speedKms > 5 && e.speedKms < 80, `${e.name} entry speed ${e.speedKms} km/s`);
    assert.ok(e.leadHours > 0 && e.leadHours < 48, `${e.name} warning ${e.leadHours} h`);
    assert.ok(new Date(e.when).getUTCFullYear() >= 2008, `${e.name} predates the first prediction`);
    assert.ok(["published", "modelled"].includes(e.geometry), `${e.name} does not say where its corridor came from`);
    assert.ok(e.story && e.story.length > 80, `${e.name} has no story to tell at the reveal`);
  }
  // Exactly one event has a published trajectory solution, and it is the one
  // that does: 2008 TC3, azimuth 101°, 21° above the horizon.
  const pub = EVENTS.filter((e) => e.geometry === "published");
  assert.strictEqual(pub.length, 1);
  assert.strictEqual(pub[0].key, "2008TC3");
  assert.strictEqual(pub[0].azimuthDeg, 101);
  assert.strictEqual(pub[0].entryAngleDeg, 21);
});

ok("both hemispheres are represented, so the answer is not always the same", () => {
  assert.ok(EVENTS.some((e) => e.lat > 0) && EVENTS.some((e) => e.lat < 0));
});

/* ── walking the ground ───────────────────────────────────────────────── */

ok("a zero walk stays put, and walking is reversible", () => {
  const p = walk(20.9, 31.4, 101, 0, 0);
  assert.ok(Math.abs(p.lat - 20.9) < 1e-9 && Math.abs(p.lon - 31.4) < 1e-9);
  const out = walk(20.9, 31.4, 101, 800, 120);
  const back = walk(out.lat, out.lon, 101, -800, -120);
  // Not exact — the two rotations do not commute on a sphere — but close.
  assert.ok(Math.abs(back.lat - 20.9) < 0.5 && Math.abs(back.lon - 31.4) < 0.5);
});

ok("walking north from the equator goes north by the right amount", () => {
  const p = walk(0, 0, 0, 1111.95); // 10° of arc
  assert.ok(Math.abs(p.lat - 10) < 0.01, `walked to ${p.lat}°`);
  assert.ok(Math.abs(p.lon) < 1e-6);
});

ok("THE POINT: latitude bends along the corridor", () => {
  // If this were linear, nobody would need a Monte Carlo.
  for (const e of EVENTS) {
    const c = corridorOf(e);
    const d = 900;
    const a = latAt(e, c, -d);
    const b = latAt(e, c, 0);
    const z = latAt(e, c, d);
    // A straight line would put the middle exactly between the two ends.
    const bend = Math.abs((a + z) / 2 - b);
    assert.ok(bend > 0.004, `${e.name}: corridor bends only ${bend.toFixed(5)}° over ±${d} km`);
  }
});

ok("and the bend makes the latitude distribution genuinely skewed", () => {
  // The claim the rules make to the room, checked rather than asserted.
  const e = eventByKey("2024RW1");
  const c = corridorOf(e);
  const sigma = 700;
  const lats = [];
  for (let i = 0; i < 40000; i++) {
    let u = 0;
    while (u === 0) u = rand();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    lats.push(latAt(e, c, sigma * z));
  }
  const mean = lats.reduce((s, v) => s + v, 0) / lats.length;
  const sd = Math.sqrt(lats.reduce((s, v) => s + (v - mean) ** 2, 0) / lats.length);
  const skew = lats.reduce((s, v) => s + ((v - mean) / sd) ** 3, 0) / lats.length;
  assert.ok(Math.abs(skew) > 0.3, `skew is only ${skew.toFixed(3)} — a normal approximation would be fine`);
});

/* ── the uncertainty ──────────────────────────────────────────────────── */

ok("the covariance is a real covariance, and it is correlated", () => {
  const C = covariance(600, SCENARIO.ratio, SCENARIO.tiltDeg);
  assert.ok(C[0][0] > 0 && C[1][1] > 0, "a variance is not positive");
  assert.ok(Math.abs(C[0][1] - C[1][0]) < 1e-9, "not symmetric");
  assert.ok(C[0][0] * C[1][1] - C[0][1] * C[1][0] > 0, "not positive definite");
  // If this were zero a team could sample the two numbers separately and still
  // be right, and the lesson would be lost.
  assert.ok(Math.abs(C[0][1]) > 1, "the ellipse is axis-aligned — no correlation to get wrong");
  const L = chol2(C);
  assert.ok(Math.abs(L[0][0] * L[0][0] - C[0][0]) < 1e-6);
  assert.ok(Math.abs(L[1][0] * L[0][0] - C[1][0]) < 1e-6);
  assert.ok(Math.abs(L[1][0] ** 2 + L[1][1] ** 2 - C[1][1]) < 1e-6);
});

ok("sampling the components apart gives a different, wrong answer", () => {
  const e = eventByKey("2008TC3");
  const c = corridorOf(e);
  const C = covariance(600, SCENARIO.ratio, SCENARIO.tiltDeg);
  const line = e.lat - 0.4;
  const right = northProbability(e, c, C, line, 30000, rand);
  // The mistake: keep the variances, throw the correlation away.
  const diag = [[C[0][0], 0], [0, C[1][1]]];
  const wrong = northProbability(e, c, diag, line, 30000, rand);
  assert.ok(Math.abs(right - wrong) > 0.004, `correlated ${right.toFixed(4)} vs diagonal ${wrong.toFixed(4)}`);
});

ok("more certainty means a tighter answer", () => {
  const e = eventByKey("2019MO");
  const c = corridorOf(e);
  const line = e.lat - 0.5;
  let last = 0;
  for (const s of [900, 600, 400, 250]) {
    const { confidence } = confidenceOf(e, c, covariance(s), line, 20000, rand);
    assert.ok(confidence >= last - 0.02, `confidence fell from ${last} to ${confidence} as sigma shrank`);
    last = confidence;
  }
  assert.ok(last > 0.8, `the tightest solution only reaches ${(last * 100).toFixed(0)}%`);
});

ok("the line can be placed to make any event as hard as asked", () => {
  for (const e of EVENTS) {
    const c = corridorOf(e);
    const { lineDeg, confidence } = placeLine(e, c, SCENARIO.sigma0Km, 0.65, { draws: 2500 });
    assert.ok(Math.abs(confidence - 0.65) < 0.05, `${e.name}: landed at ${(confidence * 100).toFixed(1)}%`);
    assert.ok(Math.abs(lineDeg - e.lat) < 9, `${e.name}: line ${lineDeg}° is nowhere near the impact`);
    // A line a person can say out loud.
    assert.ok(Math.abs(lineDeg * 10 - Math.round(lineDeg * 10)) < 1e-9, `${lineDeg} is not a round number`);
  }
});

/* ── the hand-off to an AI ────────────────────────────────────────────── */

ok("the AI prompt carries the numbers, the assumptions, and the warning", () => {
  const e = eventByKey("2008TC3");
  const c = corridorOf(e);
  const C = covariance(600, SCENARIO.ratio, SCENARIO.tiltDeg);
  const text = aiPrompt({
    eventName: e.name,
    nominalLat: e.lat,
    nominalLon: e.lon,
    azimuthDeg: c.azimuthDeg,
    covarianceKm2: C,
    lineDeg: 20,
  });
  // Every number needed to solve it.
  assert.ok(text.includes("20.900"), "no nominal latitude");
  assert.ok(text.includes("31.400"), "no nominal longitude");
  assert.ok(text.includes("101.0"), "no corridor azimuth");
  assert.ok(text.includes("6371"), "no Earth radius");
  assert.ok(/20\.0°/.test(text), "no line");
  assert.ok(text.includes(C[0][0].toFixed(1)), "the covariance is not actually in the prompt");
  // The things that make the answer right rather than plausible.
  assert.ok(/NOT diagonal/i.test(text), "never says the covariance is correlated");
  assert.ok(/SIMULATE/i.test(text), "never says to simulate");
  assert.ok(/nonlinear/i.test(text), "never says why a normal approximation fails");
  assert.ok(/ASSUMPTIONS/i.test(text), "gives nothing to argue with");
  // And it must not give the game away.
  assert.ok(!/winner|answer is|actually landed/i.test(text), "the prompt leaks the outcome");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
