/**
 * The curve: a random, smooth f on a domain [lo, hi] whose GLOBAL minimum sits
 * exactly at a location x* drawn from a normal distribution.
 *
 * The domain, the mean and the standard deviation come from the round (today:
 * [0, 1000] with x* ~ N(500, 100)). Everything below is written in terms of the
 * domain's center C and half-width H, so the construction does not care what
 * those numbers are and `lo` is free to be negative. The difficulty presets are
 * written per hundredth of the domain and scaled once, here.
 *
 * The construction, and why it is provably right rather than hopefully right:
 *
 *   1. Draw x* ~ N(mean, sd), clamped a hair inside the domain. This is the
 *      settlement price, so the function is built around it, not the other way
 *      round — and a bell curve gives the room a real prior to trade against,
 *      which a uniform draw never would.
 *
 *   2. Draw a random texture g from a basis with derivatives everywhere: sines,
 *      a high-degree polynomial, an exponential, and Gaussian "decoy" dips.
 *      Every term has an exact analytic derivative, so the gradient we hand a
 *      player is the real gradient, not a finite difference.
 *
 *   3. Detrend it so x* is already a critical point of the texture:
 *          h(x) = g(x) - g'(x*)*(x - x*) - g(x*)
 *      Now h(x*) = 0 and h'(x*) = 0. (g0 and gp0 are stored at FULL precision:
 *      rounding gp0 to 4dp leaves a residual tilt that walks the true minimum
 *      a fraction of a tick off x*, which would settle the contract at a lie.)
 *
 *   4. Add a core that also vanishes with zero slope at x* — a localized well
 *      plus a gentle global bowl:
 *          core(x) = A*(1 - exp(-(x-x*)^2 / (2*sw^2)))  +  B*((x-x*)/H)^2
 *      so f(x) = core(x) + L*h(x) has f(x*) = 0 and f'(x*) = 0 for every A, B
 *      and L. The minimum is a critical point by construction.
 *
 *      The well is what makes hard curves possible. A plain quadratic core is
 *      almost flat near x*, so ANY negative curvature in the texture forces L
 *      down to near zero and every difficulty collapses back to a parabola. A
 *      well of depth A reaches full depth within a few sw of x* and then stops
 *      growing, so the texture keeps its designed strength everywhere else.
 *
 *   5. f(x) > 0 away from x* is what makes it the GLOBAL minimum. f is affine
 *      in A and w(x) = 1 - exp(...) >= 0, so the smallest sufficient depth is
 *          A_min = max over {x : B*u^2 + L*h(x) < 0} of -(B*u^2 + L*h(x)) / w(x)
 *      - computed, not guessed. Near x* that ratio tends to the finite limit
 *      -2*sw^2*(B/H^2 + L*h''(x*)/2), which is exactly the condition that x*
 *      curves upward; we take the max of the grid ratios and that limit, add
 *      headroom, then re-verify BETWEEN grid points with golden-section
 *      refinement and deepen the well until nothing undercuts x*. Frequencies
 *      are capped relative to the grid so a sample cannot step over a dip.
 *
 *   6. Finally an affine vertical transform (positive scale + offset). It moves
 *      the range, which players do not know, and leaves the argmin alone.
 *
 * Everything is deterministic in the seed, so a round can be replayed, and the
 * spec is small enough to live in one KV value.
 */

/* ── deterministic RNG ────────────────────────────────────────────────── */

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(seed) {
  const r = mulberry32(hash32(seed));
  for (let i = 0; i < 12; i++) r(); // warm up
  return {
    next: r,
    uni: (lo, hi) => lo + (hi - lo) * r(),
    /** magnitude in [lo, hi], random sign */
    sym: (lo, hi) => (r() < 0.5 ? -1 : 1) * (lo + (hi - lo) * r()),
    int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
    /** Standard normal, Box–Muller. Deterministic in the seed like the rest. */
    gauss: () => {
      let u = 0;
      let v = 0;
      while (u === 0) u = r();
      while (v === 0) v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

/* ── the texture basis ────────────────────────────────────────────────── */
/*
 * u = (x - C)/H keeps polynomial powers inside [-1, 1] so a degree-7 term
 * cannot explode, wherever the domain sits on the number line. Sines run on x
 * directly so the wavelength is readable in domain units.
 *
 *   { t: "pow",   k, c }      c * u^k
 *   { t: "sin",   a, w, p }   a * sin(w*x + p)
 *   { t: "exp",   a, k }      a * e^(k*u)
 *   { t: "gauss", a, c, s }   a * e^(-(x-c)^2 / (2 s^2))
 */

function termVal(t, x, C, H) {
  switch (t.t) {
    case "pow": {
      const u = (x - C) / H;
      return t.c * Math.pow(u, t.k);
    }
    case "sin":
      return t.a * Math.sin(t.w * x + t.p);
    case "exp":
      return t.a * Math.exp((t.k * (x - C)) / H);
    case "gauss": {
      const d = x - t.c;
      return t.a * Math.exp(-(d * d) / (2 * t.s * t.s));
    }
    default:
      return 0;
  }
}

function termDeriv(t, x, C, H) {
  switch (t.t) {
    case "pow": {
      const u = (x - C) / H;
      return (t.c * t.k * Math.pow(u, t.k - 1)) / H;
    }
    case "sin":
      return t.a * t.w * Math.cos(t.w * x + t.p);
    case "exp":
      return (t.a * t.k * Math.exp((t.k * (x - C)) / H)) / H;
    case "gauss": {
      const s2 = t.s * t.s;
      const d = x - t.c;
      return t.a * -(d / s2) * Math.exp(-(d * d) / (2 * s2));
    }
    default:
      return 0;
  }
}

function termDeriv2(t, x, C, H) {
  switch (t.t) {
    case "pow": {
      if (t.k < 2) return 0;
      const u = (x - C) / H;
      return (t.c * t.k * (t.k - 1) * Math.pow(u, t.k - 2)) / (H * H);
    }
    case "sin":
      return -t.a * t.w * t.w * Math.sin(t.w * x + t.p);
    case "exp":
      return (t.a * t.k * t.k * Math.exp((t.k * (x - C)) / H)) / (H * H);
    case "gauss": {
      const s2 = t.s * t.s;
      const d = x - t.c;
      return t.a * ((d * d) / (s2 * s2) - 1 / s2) * Math.exp(-(d * d) / (2 * s2));
    }
    default:
      return 0;
  }
}

function sumTerms(terms, x, fn, C, H) {
  let s = 0;
  for (let i = 0; i < terms.length; i++) s += fn(terms[i], x, C, H);
  return s;
}

/* ── evaluation ───────────────────────────────────────────────────────── */

/** The well: zero at x* with zero slope, rising to 1 within a few sw. */
function wellVal(spec, x) {
  const d = x - spec.xStar;
  return 1 - Math.exp(-(d * d) / (2 * spec.sw * spec.sw));
}
function wellDeriv(spec, x) {
  const d = x - spec.xStar;
  const s2 = spec.sw * spec.sw;
  return (d / s2) * Math.exp(-(d * d) / (2 * s2));
}
function wellDeriv2(spec, x) {
  const d = x - spec.xStar;
  const s2 = spec.sw * spec.sw;
  return (1 / s2 - (d * d) / (s2 * s2)) * Math.exp(-(d * d) / (2 * s2));
}

/** core(x) = A*w(x) + B*u^2 with u = (x - x*)/H. Zero with zero slope at x*. */
function coreVal(spec, x) {
  const u = (x - spec.xStar) / spec.half;
  return spec.A * wellVal(spec, x) + spec.B * u * u;
}
function coreDeriv(spec, x) {
  const u = (x - spec.xStar) / spec.half;
  return spec.A * wellDeriv(spec, x) + (spec.B * 2 * u) / spec.half;
}
function coreDeriv2(spec, x) {
  return spec.A * wellDeriv2(spec, x) + (spec.B * 2) / (spec.half * spec.half);
}

/** The shape before the vertical transform: 0 at x*, positive everywhere else. */
function shape(spec, x) {
  const h = sumTerms(spec.terms, x, termVal, spec.center, spec.half) - spec.g0 - spec.gp0 * (x - spec.xStar);
  return coreVal(spec, x) + spec.lambda * h;
}
function shapeDeriv(spec, x) {
  return (
    coreDeriv(spec, x) +
    spec.lambda * (sumTerms(spec.terms, x, termDeriv, spec.center, spec.half) - spec.gp0)
  );
}

/** f(x) — the function the players are hunting. */
export function fAt(spec, x) {
  return spec.yOffset + spec.yScale * shape(spec, x);
}

/** f'(x) — exact, analytic. This is the arrow. */
export function dAt(spec, x) {
  return spec.yScale * shapeDeriv(spec, x);
}

/** f''(x) — exact. Shown at reveal, because curvature is the punchline. */
export function d2At(spec, x) {
  return (
    spec.yScale *
    (coreDeriv2(spec, x) + spec.lambda * sumTerms(spec.terms, x, termDeriv2, spec.center, spec.half))
  );
}

const round2 = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000;

/** n+1 evenly spaced [x, y] pairs across the whole domain, for drawing. */
export function sampleCurve(spec, n = 600) {
  const out = new Array(n + 1);
  const span = spec.hi - spec.lo;
  for (let i = 0; i <= n; i++) {
    const x = spec.lo + (span * i) / n;
    out[i] = [round4(x), round4(fAt(spec, x))];
  }
  return out;
}

/** A point a player owns: x, height, gradient — rounded for display. */
export function pointAt(spec, x) {
  return { x: round2(x), y: round4(fAt(spec, x)), d: round4(dAt(spec, x)) };
}

/* ── construction ─────────────────────────────────────────────────────── */

const VERIFY_N = 20000; // 20,001 samples across the domain

/**
 * Build a curve. Deterministic in (seed, difficulty, domain).
 *
 * `domain` is { lo, hi, mean, sd } — where the function lives and where its
 * minimum is drawn from. `lo` may be negative; nothing here assumes otherwise.
 * Returns the compact spec plus the diagnostics the admin panel shows.
 */
export function makeCurve(seed, diff, domain) {
  const lo = domain.lo;
  const hi = domain.hi;
  const span = hi - lo;
  const center = (lo + hi) / 2;
  const half = span / 2;
  // Presets are written per hundredth of the domain; scale them once.
  const k = span / 100;

  const r = rngFor(`${seed}|${diff.key}|${lo}|${hi}`);

  // 1. The answer. Normal around the mean, clamped a hair inside the domain so
  //    the minimum is always interior and always reachable on the ladder.
  const margin = Math.max(1e-6, span * 0.01);
  const xStar = round2(clamp(domain.mean + domain.sd * r.gauss(), lo + margin, hi - margin));

  // 2. The texture.
  const terms = [];
  for (let i = 0; i < diff.sines; i++) {
    // Wavelengths from about a tenth of the domain up to the whole of it,
    // capped so the verification grid samples every wave hundreds of times.
    const w = r.uni(0.035, diff.maxOmega) / k;
    terms.push({
      t: "sin",
      a: round4(r.uni(0.25, 1) / (1 + 2 * w * k)),
      w,
      p: round4(r.uni(0, Math.PI * 2)),
    });
  }
  for (let deg = 1; deg <= diff.polyDeg; deg++) {
    // Odd powers lean the curve, even powers bowl it; both shrink with degree.
    terms.push({ t: "pow", k: deg, c: round4(r.sym(0.05, 0.8) / Math.pow(deg, 1.35)) });
  }
  if (diff.exp) terms.push({ t: "exp", a: round4(r.sym(0.08, 0.5)), k: round4(r.sym(0.6, 2.4)) });
  for (let i = 0; i < diff.decoys; i++) {
    // Decoy valleys: real, smooth local minima, placed away from the answer.
    const pick = () => r.uni(lo + 0.04 * span, hi - 0.04 * span);
    let c = pick();
    for (let tries = 0; tries < 24 && Math.abs(c - xStar) < 14 * k; tries++) c = pick();
    terms.push({ t: "gauss", a: round4(-r.uni(0.5, 1.5)), c: round4(c), s: round4(r.uni(4, 12) * k) });
  }

  // 3. Detrend. FULL precision: a rounded gp0 is a residual tilt, and a tilt
  //    moves the true minimum off x*.
  const g0 = sumTerms(terms, xStar, termVal, center, half);
  const gp0 = sumTerms(terms, xStar, termDeriv, center, half);
  const hpp0 = sumTerms(terms, xStar, termDeriv2, center, half); // h''(x*); the detrend is linear

  const spec = {
    v: 2,
    seed,
    difficulty: diff.key,
    lo,
    hi,
    center,
    half,
    domain: span,
    xStar,
    terms,
    g0,
    gp0,
    sw: round4(r.uni(diff.wellWidth[0], diff.wellWidth[1]) * k),
    B: round4(r.uni(0.35, 1.4)),
    A: 0,
    lambda: diff.lambda,
    yScale: 1,
    yOffset: 0,
  };

  // 4+5. How deep the well has to be.
  const xs = new Float64Array(VERIFY_N + 1);
  const wells = new Float64Array(VERIFY_N + 1);
  const rest = new Float64Array(VERIFY_N + 1); // B*u^2 + L*h
  for (let i = 0; i <= VERIFY_N; i++) {
    const x = lo + (span * i) / VERIFY_N;
    const u = (x - xStar) / half;
    xs[i] = x;
    wells[i] = wellVal(spec, x);
    rest[i] =
      spec.B * u * u + spec.lambda * (sumTerms(terms, x, termVal, center, half) - g0 - gp0 * (x - xStar));
  }

  // The x -> x* limit of the same ratio: the condition that x* curves upward.
  let need = -2 * spec.sw * spec.sw * (spec.B / (half * half) + (spec.lambda * hpp0) / 2);
  const skip = span * 0.0002; // w is ~0 this close to x*; the limit covers it
  for (let i = 0; i <= VERIFY_N; i++) {
    if (Math.abs(xs[i] - xStar) <= skip) continue;
    if (rest[i] >= 0) continue;
    const ratio = -rest[i] / wells[i];
    if (ratio > need) need = ratio;
  }
  if (!Number.isFinite(need) || need < 0) need = 0;

  // Headroom, then verify BETWEEN grid points and deepen until nothing
  // undercuts x*. A deeper well only ever helps, so this always terminates.
  spec.A = diff.lambda === 0 ? 0 : Math.max(need * 1.15, 1e-6);
  if (diff.lambda !== 0) {
    for (let attempt = 0; attempt < 14; attempt++) {
      if (deepestOffGrid(spec, xs) > 0) break;
      spec.A *= 1.3;
    }
  }

  // 6. Vertical transform. Positive scale, so the argmin is untouched; the
  //    range is a mystery the players never get for free.
  let top = 0;
  for (let i = 0; i <= VERIFY_N; i++) {
    const s = spec.A * wells[i] + rest[i];
    if (s > top) top = s;
  }
  if (!(top > 0)) top = 1;
  spec.yScale = round4(r.uni(40, 900) / top);
  spec.yOffset = round2(r.uni(-500, 500));

  return { spec, diagnostics: diagnose(spec, need) };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The lowest value of shape() anywhere except x*, checked BETWEEN grid points.
 * Takes every sampled local minimum outside a small exclusion zone around x*
 * and golden-section refines it. A positive answer means x* is the strict
 * global minimum — the invariant the whole game rests on.
 */
function deepestOffGrid(spec, xs) {
  const n = xs.length - 1;
  const keepOut = spec.domain * 0.0025;
  const cand = [];
  let prev = shape(spec, xs[0]);
  let cur = shape(spec, xs[1]);
  for (let i = 1; i < n; i++) {
    const next = shape(spec, xs[i + 1]);
    if (cur <= prev && cur <= next && Math.abs(xs[i] - spec.xStar) >= keepOut) cand.push({ i, v: cur });
    prev = cur;
    cur = next;
  }
  // Endpoints are minima too.
  cand.push({ i: 0, v: shape(spec, xs[0]) });
  cand.push({ i: n, v: shape(spec, xs[n]) });
  cand.sort((a, b) => a.v - b.v);

  let worst = Infinity;
  for (const c of cand.slice(0, 48)) {
    const a = xs[Math.max(0, c.i - 1)];
    const b = xs[Math.min(n, c.i + 1)];
    const m = goldenMin(spec, a, b);
    if (Math.abs(m.x - spec.xStar) < keepOut) continue;
    if (m.y < worst) worst = m.y;
  }
  return worst;
}

/** Golden-section minimization of shape() on [lo, hi]. */
function goldenMin(spec, lo, hi) {
  const gr = 0.618033988749895;
  let a = lo;
  let b = hi;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = shape(spec, c);
  let fd = shape(spec, d);
  const tol = Math.max(1e-10, (hi - lo) * 1e-12);
  for (let i = 0; i < 90 && b - a > tol; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = shape(spec, c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = shape(spec, d);
    }
  }
  const x = (a + b) / 2;
  const y = shape(spec, x);
  // The bracket endpoints matter when the minimum sits on the domain edge.
  const ya = shape(spec, lo);
  const yb = shape(spec, hi);
  if (ya < y && ya <= yb) return { x: lo, y: ya };
  if (yb < y) return { x: hi, y: yb };
  return { x, y };
}

/**
 * Admin-facing facts about the finished curve, and a hard self-check: the true
 * numeric argmin over a fine grid + refinement must land on x*.
 */
export function diagnose(spec, wellNeeded = null) {
  const N = 40000;
  const span = spec.hi - spec.lo;
  const at = (i) => spec.lo + (span * i) / N;
  let bestX = spec.lo;
  let bestY = Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  let localMinima = 0;
  const vals = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const y = fAt(spec, at(i));
    vals[i] = y;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
    if (y < bestY) {
      bestY = y;
      bestX = at(i);
    }
  }
  const keepOut = span * 0.005;
  for (let i = 1; i < N; i++) {
    if (vals[i] <= vals[i - 1] && vals[i] <= vals[i + 1] && Math.abs(at(i) - spec.xStar) > keepOut) localMinima++;
  }
  const step = span / N;
  const ref = goldenMin(spec, Math.max(spec.lo, bestX - step), Math.min(spec.hi, bestX + step));
  const argmin = Math.abs(ref.x - spec.xStar) < Math.abs(bestX - spec.xStar) ? ref.x : bestX;
  // A tick of tolerance scaled to the domain: on [0, 1000] this is 0.2.
  const tol = Math.max(0.01, span * 0.0002);
  return {
    xStar: spec.xStar,
    numericArgmin: round4(argmin),
    argminError: round4(Math.abs(argmin - spec.xStar)),
    ok: Math.abs(argmin - spec.xStar) < tol,
    fMin: round4(lo),
    fMax: round4(hi),
    range: round4(hi - lo),
    localMinima,
    lambda: round4(spec.lambda),
    wellDepth: round4(spec.A),
    wellWidth: spec.sw,
    wellNeeded: wellNeeded == null || !Number.isFinite(wellNeeded) ? null : round4(wellNeeded),
    difficulty: spec.difficulty,
    domain: [spec.lo, spec.hi],
  };
}
