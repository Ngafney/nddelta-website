/**
 * Week 4 — a sun, an earth, and a rock.
 *
 * Two dimensions, Newtonian gravity, nothing else. The whole physics is one
 * line — every body pulls every other body as GM/r² — and a student can write
 * the integrator in ten lines and check it against a circular orbit.
 *
 * WHY THE PROBLEM IS HARD ANYWAY
 * ------------------------------
 * You do not get the rock's orbit. You get a handful of noisy positions over a
 * few weeks, and you have to work out whether the thing hits the Earth a year
 * later. A position error of a few hundred kilometres over a short arc becomes
 * a velocity error, and a velocity error compounds for a year. That is the
 * whole game: small errors now, enormous consequences later, and the only way
 * to find out how enormous is to try it many times.
 *
 * WHY IT IS A MONTE CARLO AND NOT A FORMULA
 * -----------------------------------------
 * This is how impact probability is actually computed. Perturb the
 * observations inside their error bars, refit the orbit, propagate it, and see
 * how often the rock comes within one Earth radius. There is no closed form
 * for "probability of collision" because the map from measurement error to
 * miss distance runs through an orbit fit and a year of nonlinear propagation.
 *
 * WHAT THE EARLIER VERSION GOT WRONG
 * ----------------------------------
 * An earlier attempt used a sungrazing orbit: 167 km/s at perihelion, where a
 * velocity error of one part in 10⁸ moved the impact 456 km. The fit was
 * hopeless and nobody solved it, me included, at 4.6 million sigma. The orbit
 * here is deliberately gentle — a couple of AU, moderate eccentricity, tens of
 * km/s — so that a least-squares fit on a few weeks of data converges and its
 * residuals mean what they should. Conditioning is a design parameter, not an
 * accident.
 */

/** AU in km, and the gravitational parameters in AU³/day². */
export const AU_KM = 149_597_870.7;
export const GM_SUN = 2.959122082855911e-4;
export const GM_EARTH = 8.887692446706779e-10;
export const EARTH_RADIUS_KM = 6371.0088;
export const EARTH_RADIUS_AU = EARTH_RADIUS_KM / AU_KM;

/**
 * The Earth's orbit: a real Kepler ellipse, not a circle.
 *
 * The eccentricity is only 0.0167, so a circle would look identical on any
 * drawing - but it would be made-up physics, and the whole round rests on
 * students trusting that the model they are handed is the model that settles.
 * Solving Kepler's equation is eight lines and it removes the lie.
 */
export const EARTH = {
  aAu: 1.00000011,
  e: 0.01671022,
  periodDays: 365.256363,
  /** Longitude of perihelion, radians. */
  peri: 1.7965956,
  /** Mean anomaly at t = 0, radians. */
  M0: 0,
};

/** Kepler's equation, by Newton. Converges in a handful of steps at this e. */
function eccentricAnomaly(M, e) {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

function earthElements(t, earth = EARTH) {
  const n = (2 * Math.PI) / earth.periodDays;
  const M = earth.M0 + n * t;
  const E = eccentricAnomaly(M, earth.e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const a = earth.aAu;
  const e = earth.e;
  // Position in the orbital frame, perihelion on the local x axis.
  const px = a * (cosE - e);
  const py = a * Math.sqrt(1 - e * e) * sinE;
  const rdot = (n * a) / (1 - e * cosE);
  const vx = -rdot * sinE;
  const vy = rdot * Math.sqrt(1 - e * e) * cosE;
  const c = Math.cos(earth.peri);
  const sn = Math.sin(earth.peri);
  return {
    pos: [px * c - py * sn, px * sn + py * c],
    vel: [vx * c - vy * sn, vx * sn + vy * c],
  };
}

/** Where the Earth is at time t (days since epoch). */
export function earthAt(t, earth = EARTH) {
  return earthElements(t, earth).pos;
}

/** And how fast it is going, which the encounter geometry needs. */
export function earthVelAt(t, earth = EARTH) {
  return earthElements(t, earth).vel;
}

/**
 * Acceleration on the rock: the Sun, plus the Earth.
 *
 * The Earth's pull is a millionth of the Sun's at this distance and utterly
 * irrelevant until the last few days, when it is the difference between a hit
 * and a miss. A team that leaves it out gets a defensible answer that is
 * wrong in one specific way, which is a good thing to argue about.
 */
export function accel(pos, t, earth = EARTH) {
  const [x, y] = pos;
  const r2 = x * x + y * y;
  const r = Math.sqrt(r2);
  const kSun = -GM_SUN / (r2 * r);
  let ax = kSun * x;
  let ay = kSun * y;

  if (!earth) return [ax, ay]; // Sun only: used to build an encounter safely
  const [ex, ey] = earthAt(t, earth);
  const dx = x - ex;
  const dy = y - ey;
  const d2 = dx * dx + dy * dy;
  const d = Math.sqrt(d2);
  const kE = -GM_EARTH / (d2 * d);
  ax += kE * dx;
  ay += kE * dy;
  return [ax, ay];
}

/** One RK4 step of the four-vector [x, y, vx, vy]. */
export function step(s, t, dt, earth = EARTH) {
  const f = (st, tt) => {
    const a = accel([st[0], st[1]], tt, earth);
    return [st[2], st[3], a[0], a[1]];
  };
  const add = (a, b, h) => [a[0] + b[0] * h, a[1] + b[1] * h, a[2] + b[2] * h, a[3] + b[3] * h];
  const k1 = f(s, t);
  const k2 = f(add(s, k1, dt / 2), t + dt / 2);
  const k3 = f(add(s, k2, dt / 2), t + dt / 2);
  const k4 = f(add(s, k3, dt), t + dt);
  return [
    s[0] + ((k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) * dt) / 6,
    s[1] + ((k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) * dt) / 6,
    s[2] + ((k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) * dt) / 6,
    s[3] + ((k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]) * dt) / 6,
  ];
}

/**
 * How big a step is safe here.
 *
 * A quarter of a day is fine while the rock is crossing empty space, and
 * catastrophic near the encounter: at 10 km/s it moves 200,000 km in a quarter
 * day, so a fixed-step integrator steps straight over the Earth and reports a
 * clean miss. The step therefore shrinks with the distance to the Earth, which
 * is the only place anything happens quickly.
 */
export function safeStep(st, t, earth = EARTH) {
  if (!earth) return 0.25;
  const [ex, ey] = earthAt(t, earth);
  const d = Math.hypot(st[0] - ex, st[1] - ey);
  const v = Math.hypot(st[2], st[3]) || 1e-9;
  // Cross no more than a fiftieth of the current separation in one step.
  return Math.min(0.25, Math.max(2e-5, d / (50 * v)));
}

/** Propagate from t0 to t1, stepping finely near the Earth. */
export function propagate(s, t0, t1, earth = EARTH) {
  let st = s;
  let t = t0;
  const dir = t1 >= t0 ? 1 : -1;
  let guard = 0;
  while ((t1 - t) * dir > 1e-12 && guard++ < 2_000_000) {
    const rem = Math.abs(t1 - t);
    const h = dir * Math.min(safeStep(st, t, earth), rem);
    st = step(st, t, h, earth);
    t += h;
  }
  return st;
}

/** The whole path, for drawing. */
export function trail(s, t0, t1, samples = 400, earth = EARTH) {
  const out = [];
  const dt = (t1 - t0) / samples;
  let st = s;
  let t = t0;
  out.push([st[0], st[1]]);
  for (let i = 0; i < samples; i++) {
    st = propagate(st, t, t + dt, earth);
    t += dt;
    out.push([st[0], st[1]]);
  }
  return out;
}

const distTo = (st, t, earth) => {
  const [ex, ey] = earthAt(t, earth);
  return Math.hypot(st[0] - ex, st[1] - ey);
};

/**
 * Closest the rock gets to the Earth between t0 and t1, in AU.
 *
 * Scan at half a day to bracket the approach, then refine inside the bracket.
 * The distance can fall by a lunar distance in a few hours, so the scan alone
 * would report whichever sample happened to land nearest and a round would
 * settle on an artefact of the step size.
 */
export function closestApproach(s, t0, t1, earth = EARTH) {
  const dt = 0.5;
  let st = s;
  let t = t0;
  let prev = { t, st, d: distTo(st, t, earth) };
  let best = prev;
  let bracket = null;
  while (t < t1) {
    const nt = Math.min(t + dt, t1);
    st = propagate(st, t, nt, earth);
    t = nt;
    const d = distTo(st, t, earth);
    if (d < best.d) {
      best = { t, st, d };
      bracket = prev;
    }
    // Once it is inside the Earth the question is already answered, and the
    // point-mass singularity below the surface is not physics anyone wants.
    if (d <= EARTH_RADIUS_AU) return { missAu: d, tDays: t, hit: true };
    prev = { t, st, d };
  }
  // Golden-section on the half-day either side of the best sample.
  let lo = bracket ? bracket.t : t0;
  let stLo = bracket ? bracket.st : s;
  let hi = Math.min(t1, lo + 2 * dt);
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 80 && hi - lo > 1e-10; k++) {
    const m1 = hi - phi * (hi - lo);
    const m2 = lo + phi * (hi - lo);
    const s1 = propagate(stLo, lo, m1, earth);
    const s2 = propagate(stLo, lo, m2, earth);
    if (distTo(s1, m1, earth) < distTo(s2, m2, earth)) hi = m2;
    else { lo = m1; stLo = s1; }
  }
  const tm = (lo + hi) / 2;
  const sm = propagate(stLo, lo, tm, earth);
  const dm = distTo(sm, tm, earth);
  return dm < best.d ? { missAu: dm, tDays: tm } : { missAu: best.d, tDays: best.t };
}

/**
 * Build a rock that passes the Earth at a chosen distance on a chosen day.
 *
 * Searching for a near miss does not work - the target is a few Earth radii
 * across and the space of orbits is not - so the encounter is CONSTRUCTED.
 * Place the rock beside the Earth at the encounter, give it a velocity that
 * makes a sensible heliocentric orbit, and integrate backwards to the epoch.
 */
export function encounterState(opts) {
  const { tEncDays, missAu, approachDeg = 35, relSpeedAuDay = 0.006, earth = EARTH, side = 1 } = opts;
  const [ex, ey] = earthAt(tEncDays, earth);
  const ev = earthVelAt(tEncDays, earth);
  // Relative velocity, rotated off the Earth's own motion.
  const th = (approachDeg * Math.PI) / 180;
  const evHat = [ev[0] / Math.hypot(ev[0], ev[1]), ev[1] / Math.hypot(ev[0], ev[1])];
  const relHat = [
    evHat[0] * Math.cos(th) - evHat[1] * Math.sin(th),
    evHat[0] * Math.sin(th) + evHat[1] * Math.cos(th),
  ];
  // Offset perpendicular to the relative velocity: that IS the miss distance.
  const perp = [-relHat[1] * side, relHat[0] * side];
  const pos = [ex + perp[0] * missAu, ey + perp[1] * missAu];
  const vel = [ev[0] + relHat[0] * relSpeedAuDay, ev[1] + relHat[1] * relSpeedAuDay];
  // Backwards with the SUN ONLY. Running the backward leg through the Earth's
  // own gravity means starting the integration a few thousand kilometres from
  // a point mass - and for a hit, starting it BELOW THE SURFACE, where the
  // acceleration is two thousand times the Sun's and climbing. That leg came
  // back 342 million kilometres wrong. Sun-only backwards is perfectly
  // conditioned; the forward flight then feels the Earth as it should, so the
  // real closest approach is measured afterwards rather than assumed.
  return propagate([pos[0], pos[1], vel[0], vel[1]], tEncDays, 0, null);
}

/** Does it hit? One Earth radius, measured centre to centre. */
export const isHit = (missAu) => missAu <= EARTH_RADIUS_AU;
