/**
 * Does the week actually teach its lesson?
 *
 * Week 4 is built on one claim: that you must SIMULATE where the rock lands,
 * because latitude is a curved function of distance along the corridor and a
 * normal approximation will price it wrong. Every other test here checks that
 * the machinery is correct. None of them checked that the claim was worth
 * anything, and it quietly stopped being: a playtester was handed a round where
 * reaching for PHI(z) instead of running the Monte Carlo cost him 0.9 points of
 * price. One tick. Correct, and worth nothing - the round had put the line
 * where latitude is very nearly linear, which is exactly where a Gaussian is
 * right.
 *
 * So the size of the effect is now a tested property, not an aspiration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { EVENTS } from "../shared/events.js";
import {
  corridorOf, covariance, latAt, northProbability,
  gaussianNorthProbability, nonlinearityPts,
} from "../shared/corridor.js";
import { SCENARIO } from "../shared/rules.js";

/** Deterministic, so a failure is a real failure and not a bad afternoon. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("the normal approximation is a good approximation, which is the point", () => {
  // If PHI(z) were wildly wrong everywhere, the lesson would be trivial and the
  // week would be about arithmetic rather than about geometry. It is not: on a
  // SHORT corridor the shortcut is nearly exact, and a team using it would be
  // fine. The lesson has to be earned by the corridor being long.
  const e = EVENTS[0];
  const c = corridorOf(e);
  const short = covariance(120); // a corridor tens of km long, not thousands
  const line = e.lat + 0.1;
  const { pts } = nonlinearityPts(e, c, short, line, 60000, seeded(7));
  assert.ok(
    Math.abs(pts) < 1,
    `on a 120 km corridor the shortcut should be nearly exact, was off ${pts.toFixed(2)} points`
  );
});

test("on the corridor the round actually uses, the shortcut costs real money", () => {
  // The default corridor width exists to make this true. Checked per event and
  // over the best line available, which is what line placement is searching.
  const draws = 60000;
  const worst = [];
  for (const e of EVENTS) {
    const c = corridorOf(e);
    const C = covariance(SCENARIO.sigma0Km, SCENARIO.ratio, SCENARIO.tiltDeg);
    const rand = seeded(11);
    let best = 0;
    for (let t = -60; t <= 60; t++) {
      const line = Math.round((e.lat + t * 0.2) * 10) / 10;
      const p = northProbability(e, c, C, line, 4000, rand);
      const conf = Math.max(p, 1 - p);
      if (conf < 0.55 || conf > 0.85) continue; // only lines worth asking about
      const gap = Math.abs(p - gaussianNorthProbability(e, c, C, line)) * 100;
      if (gap > best) best = gap;
    }
    worst.push({ name: e.name, best });
  }
  for (const w of worst) {
    assert.ok(
      w.best >= 3,
      `${w.name}: the best available line only costs the shortcut ${w.best.toFixed(1)} points - ` +
        `not enough for the Monte Carlo to be worth running. Lengthen SCENARIO.sigma0Km.`
    );
  }
  // And at least one event should be dramatic, so the week has a showpiece.
  const star = Math.max(...worst.map((w) => w.best));
  assert.ok(star >= 8, `no event costs the shortcut more than ${star.toFixed(1)} points`);
  void draws;
});

test("the error comes from curvature, so it tracks the asymmetry of the swing", () => {
  // The mechanism, not just the magnitude. Latitude along the corridor climbs,
  // flattens and falls; a Gaussian cannot represent that. Where the swing is
  // symmetric the two methods agree closely even though the swing is huge, and
  // where it is lopsided they diverge. If this ever inverts, the effect being
  // measured is not the one the week claims to teach.
  const sigma = SCENARIO.sigma0Km;
  const rows = EVENTS.map((e) => {
    const c = corridorOf(e);
    const C = covariance(sigma, SCENARIO.ratio, SCENARIO.tiltDeg);
    const up = latAt(e, c, 2 * sigma) - e.lat;
    const down = latAt(e, c, -2 * sigma) - e.lat;
    // How lopsided the two directions are, as a ratio of the larger to the sum.
    const skew = Math.abs(Math.abs(up) - Math.abs(down)) / (Math.abs(up) + Math.abs(down));
    const rand = seeded(23);
    let best = 0;
    for (let t = -60; t <= 60; t++) {
      const line = Math.round((e.lat + t * 0.2) * 10) / 10;
      const p = northProbability(e, c, C, line, 4000, rand);
      const conf = Math.max(p, 1 - p);
      if (conf < 0.55 || conf > 0.85) continue;
      const gap = Math.abs(p - gaussianNorthProbability(e, c, C, line)) * 100;
      if (gap > best) best = gap;
    }
    return { name: e.name, skew, gap: best };
  });
  const bySkew = [...rows].sort((a, b) => b.skew - a.skew);
  const byGap = [...rows].sort((a, b) => b.gap - a.gap);
  assert.strictEqual(
    bySkew[0].name,
    byGap[0].name,
    `the most lopsided corridor (${bySkew[0].name}) should be the most mispriced, ` +
      `but the most mispriced was ${byGap[0].name}`
  );
});

test("the two methods agree in the limit, so the simulator is not simply wrong", () => {
  // A Monte Carlo that disagreed with PHI(z) because of a bug would fail this:
  // as the corridor shrinks toward a point, curvature vanishes and the two must
  // converge. This is the control for the experiment above.
  const e = EVENTS[3];
  const c = corridorOf(e);
  let prev = Infinity;
  for (const sigma of [2000, 800, 300, 100, 30]) {
    const C = covariance(sigma);
    const line = e.lat + 0.02;
    const { pts } = nonlinearityPts(e, c, C, line, 80000, seeded(5));
    const gap = Math.abs(pts);
    assert.ok(
      gap <= prev + 0.6,
      `shortening the corridor to ${sigma} km made the gap grow: ${gap.toFixed(2)} after ${prev.toFixed(2)}`
    );
    prev = gap;
  }
  assert.ok(prev < 0.6, `at a 30 km corridor the two methods still differ by ${prev.toFixed(2)} points`);
});
