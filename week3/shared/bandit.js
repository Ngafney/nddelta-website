/**
 * The bandit lab: five coins, 100 flips, $100 a heads.
 *
 * A strategy is a real JavaScript function the AI writes for a team — the body
 * of `pick(state)` — that returns which coin to flip next. Adapted from week 1's
 * slot-machine lab, with coins instead of bell-curve machines.
 *
 * ── Fairness ──────────────────────────────────────────────────────────────
 * World j of a run is fully determined by `${baseSeed}|w${j}`: every team's
 * strategy faces the SAME 10,000 sets of coins. Each coin also has its own
 * fixed stream of flips — the k-th time anyone flips coin C in world j it comes
 * up the same way — so two strategies that make the same choices get the same
 * luck, and the leaderboard measures decisions rather than dice.
 *
 * ── Safety ────────────────────────────────────────────────────────────────
 * The code runs on the server, so it is locked down the way week 1's was:
 *   • a static denylist rejects loops, the `function` keyword, `new`, and every
 *     host escape (require/process/globalThis/constructor/eval/Function/…)
 *     BEFORE anything is compiled;
 *   • it runs in strict mode with only `state` and a frozen `lib` in scope;
 *   • randomness is a SEEDED state.rng() (Math.random is blocked), so runs are
 *     deterministic and fair;
 *   • the return value is validated to a real coin on every flip;
 *   • and the server only ever runs code IT compiled: the compile route signs
 *     the code, and the run and save routes refuse anything unsigned. So the
 *     only way code gets here is through the AI and this denylist.
 */

import { rngFrom } from "./rng.js";
import { betaDraw } from "./coin.js";
import { BANDIT } from "./rules.js";

const K = BANDIT.coins;
const FLIPS = BANDIT.flips;
const PAY = BANDIT.payout;
const NAMES = BANDIT.names.slice(0, K);
const NAME_INDEX = Object.fromEntries(NAMES.map((n, i) => [n, i]));

export const round2 = (x) => Math.round(x * 100) / 100;

/* ── the world ────────────────────────────────────────────────────────── */

/** Five hidden probabilities, each uniform on [0, 1]. */
export function makeWorld(worldSeed) {
  const rand = rngFrom(`${worldSeed}|coins`);
  return Array.from({ length: K }, () => rand());
}

/** The expected payout of a psychic who flips the best coin every time. */
export const oracle = (ps) => FLIPS * PAY * Math.max(...ps);

/* ── the sandbox ──────────────────────────────────────────────────────── */

// Word-boundary matched so "format" doesn't trip "for", but "for(" does.
const DENY = [
  "\\bfor\\b", "\\bwhile\\b", "\\bdo\\b", "\\bfunction\\b", "\\bnew\\b", "\\bclass\\b",
  "\\bthis\\b", "\\barguments\\b", "\\bconstructor\\b", "__proto__", "\\bprototype\\b",
  "\\bimport\\b", "\\brequire\\b", "\\bprocess\\b", "\\bglobal\\b", "\\bglobalThis\\b", "\\bwindow\\b",
  "\\beval\\b", "\\bFunction\\b", "\\bReflect\\b", "\\bProxy\\b", "\\bSymbol\\b", "\\bArray\\b",
  "\\bfetch\\b", "\\bXMLHttpRequest\\b", "\\bWebAssembly\\b", "\\bAtomics\\b",
  "\\bSharedArrayBuffer\\b", "\\bBuffer\\b", "\\bmodule\\b", "\\bexports\\b",
  "\\basync\\b", "\\bawait\\b", "\\byield\\b",
  "\\bsetTimeout\\b", "\\bsetInterval\\b", "\\bsetImmediate\\b", "\\bqueueMicrotask\\b",
  "\\bPromise\\b", "\\.\\s*random", "\\.\\s*constructor", "\\brepeat\\b", "\\bpadStart\\b", "\\bpadEnd\\b",
];
// Case-sensitive, because JavaScript is: `array` is a fine variable name,
// `Array` is the constructor.
const DENY_RE = new RegExp(DENY.join("|"));

export function validateCode(src) {
  if (typeof src !== "string" || !src.trim()) return { ok: false, error: "empty code" };
  if (src.length > 4000) return { ok: false, error: "code is too long" };
  if (/[`]/.test(src)) return { ok: false, error: "template literals (backticks) aren't allowed" };
  const m = src.match(DENY_RE);
  if (m) {
    return {
      ok: false,
      error: `"${m[0].trim()}" isn't allowed — use array methods (.filter/.map/.reduce) over state.coins instead of loops, state.rng() instead of Math.random, and only the state object.`,
    };
  }
  return { ok: true };
}

// Each helper is its OWN frozen wrapper. Handing out Math.max itself would let
// a strategy write properties onto the real global and carry memory between
// runs and teams.
const frz = (f) => Object.freeze(f);
const LIB = Object.freeze({
  max: frz((...a) => Math.max(...a)),
  min: frz((...a) => Math.min(...a)),
  abs: frz((x) => Math.abs(x)),
  floor: frz((x) => Math.floor(x)),
  ceil: frz((x) => Math.ceil(x)),
  round: frz((x) => Math.round(x)),
  sqrt: frz((x) => Math.sqrt(x)),
  log: frz((x) => Math.log(x)),
  exp: frz((x) => Math.exp(x)),
  pow: frz((x, y) => Math.pow(x, y)),
  sign: frz((x) => Math.sign(x)),
  clamp: frz((x, lo, hi) => Math.max(lo, Math.min(hi, x))),
  sum: frz((a) => a.reduce((s, x) => s + x, 0)),
  mean: frz((a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)),
  argmax: frz((a) => a.reduce((b, x, i) => (x > a[b] ? i : b), 0)),
  argmin: frz((a) => a.reduce((b, x, i) => (x < a[b] ? i : b), 0)),
});

/** Compile to (state) => coin index, or null for an invalid answer. */
export function compileCode(src) {
  // eslint-disable-next-line no-new-func
  const raw = new Function("state", "lib", `"use strict";\n${src}`);
  return (state) => {
    const out = raw(state, LIB);
    const idx = typeof out === "string" ? NAME_INDEX[out.trim().toUpperCase()] : Math.trunc(Number(out));
    return Number.isInteger(idx) && idx >= 0 && idx < K ? idx : null;
  };
}

/* ── running a strategy ───────────────────────────────────────────────── */

/**
 * What the strategy sees for one decision. The results arrays are live
 * references (copying them every flip would dominate the run time); the
 * scoring never reads them back, so a strategy that scribbles on its own view
 * only confuses itself.
 */
function viewFor(rec, ctx) {
  return {
    flip: ctx.t,
    flipsLeft: FLIPS - ctx.t,
    total: ctx.total,
    lastCoin: ctx.lastCoin,
    lastResult: ctx.lastResult,
    coins: rec.map((r, i) => ({
      name: NAMES[i],
      index: i,
      flips: r.n,
      heads: r.h,
      tails: r.n - r.h,
      rate: r.n ? r.h / r.n : 0,
      last: r.n ? r.results[r.n - 1] : null,
      results: r.results,
    })),
    history: ctx.history,
    rng: ctx.rng,
    betaSample: ctx.betaSample,
  };
}

function freshRun(worldSeed) {
  const rng = rngFrom(`${worldSeed}|strategy`);
  return {
    rec: Array.from({ length: K }, () => ({ n: 0, h: 0, results: [] })),
    ctx: {
      t: 0,
      total: 0,
      lastCoin: null,
      lastResult: null,
      history: [],
      rng,
      betaSample: (a, b) => betaDraw(Math.max(1e-3, Number(a) || 1), Math.max(1e-3, Number(b) || 1), rng),
    },
  };
}

/** Play one world. `withHistory` also returns every flip, for the replay. */
export function simulate(fn, worldSeed, { withHistory = false } = {}) {
  const ps = makeWorld(worldSeed);
  const streams = ps.map((_, i) => rngFrom(`${worldSeed}|c${i}`));
  const { rec, ctx } = freshRun(worldSeed);
  let faults = 0;
  const log = withHistory ? [] : null;

  for (let t = 0; t < FLIPS; t++) {
    ctx.t = t;
    let c;
    try {
      c = fn(viewFor(rec, ctx));
    } catch {
      c = null;
    }
    if (c == null) {
      // A stray bad turn falls back to the least-flipped coin rather than
      // sinking the run; a strategy that ALWAYS faults is caught at compile.
      faults++;
      c = rec.reduce((b, r, i) => (r.n < rec[b].n ? i : b), 0);
    }
    const heads = streams[c]() < ps[c] ? 1 : 0;
    const r = rec[c];
    r.n++;
    r.h += heads;
    r.results.push(heads);
    ctx.total += heads * PAY;
    ctx.lastCoin = c;
    ctx.lastResult = heads;
    ctx.history.push({ coin: c, heads });
    if (log) log.push({ t, coin: c, heads });
  }
  return { total: ctx.total, ps, faults, log };
}

/** Compile + smoke test. { ok, run } or { ok:false, error }. */
export function prepareCode(src) {
  const v = validateCode(src);
  if (!v.ok) return v;
  let fn;
  try {
    fn = compileCode(src);
  } catch (e) {
    return { ok: false, error: `syntax error: ${e.message}` };
  }
  try {
    // Must answer on an empty board and a busy one without throwing.
    const a = freshRun("smoke-a");
    const b = freshRun("smoke-b");
    b.rec.forEach((r, i) => {
      r.results = [1, 0, i % 2, 1].slice(0, i + 1);
      r.n = r.results.length;
      r.h = r.results.reduce((s, x) => s + x, 0);
    });
    b.ctx.t = 15;
    b.ctx.total = 800;
    b.ctx.lastCoin = 2;
    b.ctx.lastResult = 1;
    if (fn(viewFor(a.rec, a.ctx)) == null || fn(viewFor(b.rec, b.ctx)) == null) {
      return { ok: false, error: `the code didn't return a coin (return an index 0–${K - 1} or a name "${NAMES.join('", "')}")` };
    }
  } catch (e) {
    return { ok: false, error: `the code crashed when run: ${e.message}` };
  }
  return { ok: true, run: fn };
}

/**
 * Play the shared world set. `budgetMs` stops a pathologically slow strategy
 * from holding the server hostage: it is checked between games.
 */
export function runMany(fn, baseSeed, n = BANDIT.simulations, { budgetMs = 20_000 } = {}) {
  const t0 = Date.now();
  let sum = 0;
  let sumSq = 0;
  let oracleSum = 0;
  let best = -Infinity;
  let worst = Infinity;
  let faults = 0;
  const buckets = new Array(21).fill(0); // $0–$10,000 in $500 bins
  for (let j = 0; j < n; j++) {
    const { total, ps, faults: f } = simulate(fn, `${baseSeed}|w${j}`);
    sum += total;
    sumSq += total * total;
    oracleSum += oracle(ps);
    if (total > best) best = total;
    if (total < worst) worst = total;
    faults += f;
    buckets[Math.min(20, Math.floor(total / 500))]++;
    if ((j & 63) === 63 && Date.now() - t0 > budgetMs) {
      throw Object.assign(new Error("that strategy is too slow to run 10,000 games — simplify it"), { status: 400 });
    }
  }
  const avg = sum / n;
  return {
    n,
    avg: round2(avg),
    sd: round2(Math.sqrt(Math.max(0, sumSq / n - avg * avg))),
    best,
    worst,
    oraclePct: round2((100 * sum) / oracleSum),
    avgOracle: round2(oracleSum / n),
    faultRate: round2(faults / (n * FLIPS)),
    buckets,
    ms: Date.now() - t0,
  };
}

export { NAMES as COIN_NAMES };
