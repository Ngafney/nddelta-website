/**
 * The physics, checked against things with known answers.
 *
 * None of the game is worth anything if the dynamics are wrong, and a wrong
 * relativistic term is invisible — the orbits still look like orbits. So the
 * first test here is the one Einstein published in 1915: Mercury's perihelion
 * advances 43 arcseconds a century, and no Newtonian model produces it.
 */
import assert from "node:assert";
import {
  GM_SUN, C_LIGHT, AU_KM, R_EARTH, M_EARTH, M_SUN, YEAR_DAYS,
  propagate, packState, posOf, velOf, derivatives,
  sub, add, scale, dot, cross, norm, unit,
  spinAxis, latitudeOf, findContact, buildScenario, verifyScenario, closestApproachToSun, PARK,
} from "../shared/orbits.js";

let passed = 0;
let failed = 0;
function ok(name, fn) {
  const t0 = Date.now();
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name} ${Date.now() - t0 > 400 ? `(${((Date.now() - t0) / 1000).toFixed(1)}s)` : ""}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 3).join("\n      ")}`);
  }
}

const ARCSEC = 206264.806247;
const TWO_BODY = { mass: [M_SUN, 0, 0], relativistic: false, rtol: 1e-13, atol: 1e-16 };
/** The Kepler period. 2π a^1.5 / k — NOT 365.25 a^1.5, which is out by 600 s. */
const period = (a) => (2 * Math.PI * Math.pow(a, 1.5)) / 0.01720209895;

/** A test particle on a Kepler orbit about the Sun, in the ecliptic. */
function particle(a, e) {
  const rPeri = a * (1 - e);
  const vPeri = Math.sqrt((GM_SUN * (1 + e)) / (a * (1 - e)));
  // Slot 1 is unused here; park it far away rather than on top of the Sun.
  return packState([[0, 0, 0], PARK, [rPeri, 0, 0]], [[0, 0, 0], [0, 0, 0], [0, vPeri, 0]]);
}

/** Laplace–Runge–Lenz vector: points at perihelion, length e. */
function eccVector(y) {
  const r = sub(posOf(y, 2), posOf(y, 0));
  const v = sub(velOf(y, 2), velOf(y, 0));
  const h = cross(r, v);
  return sub(scale(cross(v, h), 1 / GM_SUN), unit(r));
}

const energy = (y) => {
  const r = sub(posOf(y, 2), posOf(y, 0));
  const v = sub(velOf(y, 2), velOf(y, 0));
  return 0.5 * dot(v, v) - GM_SUN / norm(r);
};

console.log("\nphysics");

/* ── the integrator ───────────────────────────────────────────────────── */

ok("a Kepler orbit comes back to where it started after exactly one period", () => {
  const a = 0.723332; // Venus
  const P = period(a);
  const y0 = particle(a, 0.00677);
  const y1 = propagate(y0, 0, P, TWO_BODY);
  const drift = norm(sub(posOf(y1, 2), posOf(y0, 2))) * AU_KM;
  assert.ok(drift < 60, `came back ${drift.toFixed(1)} km away after one period`);
});

ok("energy holds across a very eccentric Newtonian orbit", () => {
  const y0 = particle(0.75, 0.93); // perihelion 0.0525 AU, like the round's asteroid
  const E0 = energy(y0);
  const y1 = propagate(y0, 0, YEAR_DAYS * 3, TWO_BODY);
  const rel = Math.abs((energy(y1) - E0) / E0);
  assert.ok(rel < 1e-9, `energy moved by ${rel.toExponential(2)}`);
});

ok("under relativity the Newtonian energy wobbles but never drifts", () => {
  // 0.5v² − GM/r is NOT the conserved quantity once the PN term is on: it
  // carries a position-dependent offset of order (GM/rc²). What must not
  // happen is SECULAR growth, so sample at the same phase each orbit and
  // check the value simply repeats.
  const a = 0.75, e = 0.93;
  const P = period(a);
  const spreadAt = (rtol) => {
    const rel = { mass: [M_SUN, 0, 0], relativistic: true, rtol, atol: 1e-16 };
    const seen = [];
    let y = particle(a, e);
    let t = 0;
    for (let k = 1; k <= 8; k++) {
      y = propagate(y, t, P * k, rel);
      t = P * k;
      seen.push(energy(y));
    }
    return Math.max(...seen.map((v) => Math.abs((v - seen[0]) / seen[0])));
  };

  const loose = spreadAt(1e-12);
  assert.ok(loose < 1e-6, `energy at matching phase moved by ${loose.toExponential(2)} over 8 orbits`);

  // It is not exactly zero, and it should not be: relativity precesses the
  // orbit, so after one KEPLER period the particle is not quite back at the
  // same phase, and the offset is sampled somewhere slightly different. The
  // proof that this is the precession and not the integrator losing ground:
  // tightening the tolerance a hundredfold does not shrink it.
  const tight = spreadAt(1e-14);
  const ratio = tight / loose;
  assert.ok(
    ratio > 0.5 && ratio < 2,
    `spread went ${loose.toExponential(2)} → ${tight.toExponential(2)} when the tolerance tightened ` +
      `100×, so it is integration error, not precession`
  );
});

ok("the integration is reversible", () => {
  const y0 = particle(0.75, 0.93);
  const there = propagate(y0, 0, YEAR_DAYS * 3, TWO_BODY);
  const back = propagate(there, YEAR_DAYS * 3, 0, TWO_BODY);
  const err = norm(sub(posOf(back, 2), posOf(y0, 2))) * AU_KM;
  assert.ok(err < 5, `three years out and back missed by ${err.toFixed(2)} km`);
});

/* ── general relativity ───────────────────────────────────────────────── */

ok("Mercury's perihelion advances 43 arcseconds per century", () => {
  const a = 0.38709893;
  const e = 0.20563069;
  const P = period(a);
  const orbits = 60;
  const y0 = particle(a, e);
  const y1 = propagate(y0, 0, P * orbits, { ...TWO_BODY, relativistic: true });

  const e0 = eccVector(y0);
  const e1 = eccVector(y1);
  const ang0 = Math.atan2(e0[1], e0[0]);
  const ang1 = Math.atan2(e1[1], e1[0]);
  let d = ang1 - ang0;
  while (d < -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;

  const perOrbit = d / orbits;
  const perCentury = perOrbit * (36525 / P) * ARCSEC;

  // The textbook closed form, for comparison.
  const analytic = (6 * Math.PI * GM_SUN) / (C_LIGHT * C_LIGHT * a * (1 - e * e));
  const analyticCentury = analytic * (36525 / P) * ARCSEC;

  assert.ok(Math.abs(analyticCentury - 42.98) < 0.1, `closed form says ${analyticCentury.toFixed(2)}"`);
  assert.ok(
    Math.abs(perCentury - analyticCentury) < 0.25,
    `integrated ${perCentury.toFixed(2)}" vs closed form ${analyticCentury.toFixed(2)}"`
  );
});

ok("with relativity off, the perihelion does not move at all", () => {
  const a = 0.38709893, e = 0.20563069;
  const P = period(a);
  const y0 = particle(a, e);
  const y1 = propagate(y0, 0, P * 60, { ...TWO_BODY, relativistic: false });
  const e0 = eccVector(y0), e1 = eccVector(y1);
  let d = Math.atan2(e1[1], e1[0]) - Math.atan2(e0[1], e0[0]);
  while (d < -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const perCentury = Math.abs((d / 60) * (36525 / P) * ARCSEC);
  assert.ok(perCentury < 0.5, `Newtonian gravity precessed by ${perCentury.toFixed(3)}" — integrator error`);
});

ok("the relativistic term grows as perihelion shrinks, the way the formula says", () => {
  for (const [a, e] of [[0.75, 0.90], [0.75, 0.94], [0.8, 0.95]]) {
    const P = period(a);
    const y0 = particle(a, e);
    const n = 6;
    const y1 = propagate(y0, 0, P * n, { ...TWO_BODY, relativistic: true });
    const e0 = eccVector(y0), e1 = eccVector(y1);
    let d = Math.atan2(e1[1], e1[0]) - Math.atan2(e0[1], e0[0]);
    while (d < -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    const analytic = (6 * Math.PI * GM_SUN) / (C_LIGHT * C_LIGHT * a * (1 - e * e));
    const ratio = d / n / analytic;
    assert.ok(Math.abs(ratio - 1) < 0.02, `q=${(a * (1 - e)).toFixed(4)}: integrated/analytic = ${ratio.toFixed(4)}`);
  }
});

/* ── geometry ─────────────────────────────────────────────────────────── */

ok("latitude is read off the spin axis and ignores the daily spin", () => {
  const axis = spinAxis(0.7);
  const mk = (off) => packState([[0, 0, 0], [1, 0, 0], add([1, 0, 0], off)], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  // Straight up the axis is the pole.
  const north = latitudeOf(mk(scale(axis, R_EARTH)), axis) * (180 / Math.PI);
  assert.ok(Math.abs(north - 90) < 1e-9, `axis-aligned point read ${north}`);
  // Perpendicular to the axis is the equator.
  const perp = unit(cross(axis, [0, 0, 1]));
  const eq = latitudeOf(mk(scale(perp, R_EARTH)), axis) * (180 / Math.PI);
  assert.ok(Math.abs(eq) < 1e-9, `equatorial point read ${eq}`);
});

/* ── a whole scenario ─────────────────────────────────────────────────── */

ok("a scenario lands the asteroid exactly where the operator asked", () => {
  for (const lat of [3.5, -3.5]) {
    const sc = buildScenario(`phys-${lat}`, lat, {});
    const v = verifyScenario(sc);
    assert.ok(v.ok, `target ${lat}° but landed ${v.latDeg?.toFixed(4)}°`);
    assert.ok(Math.abs(v.contactError) < 0.02, `contact was ${v.contactError.toFixed(4)} days off the schedule`);
  }
});

ok("the asteroid stays well clear of the Sun, so the arc stays fittable", () => {
  // This assertion is inverted from where it started. The round used to send
  // the rock past the Sun at ten solar radii because relativity then moved the
  // impact by tens of thousands of kilometres -- wonderful, and completely
  // unfittable: a velocity error of one part in 10^8 put it 456 km off by day
  // 400, so nobody could ever determine the orbit from the published record.
  const sc = buildScenario("phys-gentle", 2.5, {});
  const close = closestApproachToSun(sc);
  assert.ok(close.au > 0.3, `perihelion ${close.au.toFixed(3)} AU is close enough to wreck the fit`);

  // And it must START somewhere slow, not at perihelion doing 167 km/s, or a
  // finite-difference first guess is worse than useless.
  const r0 = norm(sub(posOf(sc.y0, 2), posOf(sc.y0, 0)));
  const v0 = norm(sub(velOf(sc.y0, 2), velOf(sc.y0, 0))) * AU_KM / 86400;
  assert.ok(r0 > 0.6, `starts ${r0.toFixed(2)} AU out — too close in`);
  assert.ok(v0 < 60, `starts at ${v0.toFixed(0)} km/s — too fast to difference`);
});

ok("rounds are played Newtonian, and relativity is a small correction here", () => {
  const sc = buildScenario("phys-model", 3, {});
  assert.strictEqual(sc.relativistic, false, "the round must be built on the model it is played on");
  const v = verifyScenario(sc);
  assert.ok(v.ok, `aimed at 3° and landed ${v.latDeg?.toFixed(3)}`);

  // Not zero — it is real physics — but small enough that fitting Newtonian
  // gravity reproduces the record to its error bars, which is the promise the
  // rules make to the room.
  assert.ok(v.relativisticDriftKm > 0, "the relativistic term is not being computed at all");
  assert.ok(
    v.relativisticDriftKm < 20000,
    `relativity would move the impact ${Math.round(v.relativisticDriftKm)} km — too much to promise a Newtonian fit`
  );
});

ok("the same seed builds the same solar system every time", () => {
  const a = buildScenario("repeat-me", 3, {});
  const b = buildScenario("repeat-me", 3, {});
  assert.deepStrictEqual(a.y0, b.y0);
  const c = buildScenario("different", 3, {});
  assert.notDeepStrictEqual(a.y0, c.y0, "two seeds produced identical systems");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
