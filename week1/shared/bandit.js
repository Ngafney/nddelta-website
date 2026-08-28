/**
 * The bandit engine: world generation, spin payoffs, strategy execution.
 *
 * DETERMINISM CONTRACT
 * A world is fully determined by its seed string. A spin payoff is fully
 * determined by (worldSeed, spinIndex, machine) — NOT by draw order — so
 * the server can re-simulate a manual player's exact choice sequence and
 * get the exact payoffs the player saw. Algorithm runs use worlds
 * hash(baseSeed, j) for j = 0..N-1: every team faces the same 10,000
 * worlds, which is what makes the algorithm leaderboard a fair race.
 */

import { hash32, rngFrom, gaussian, gaussFrom } from "./rng.js";
import { evalCond } from "./dsl.js";
import { BANDIT } from "./rules.js";

const M = BANDIT.machines;
const SPINS = BANDIT.spins;

/** Draw a world's true parameters from its seed. */
export function makeWorld(worldSeed) {
  const rand = rngFrom(worldSeed + "|world");
  const mu = [];
  const sigma = [];
  for (let i = 0; i < M; i++) {
    mu.push(10 * gaussian(rand)); // μᵢ ~ N(0, 10)
    sigma.push(Math.max(0, 10 + 2 * gaussian(rand))); // σᵢ ~ max(0, N(10, 2))
  }
  return { mu, sigma };
}

/** The payoff of spin t on machine m — position-keyed, see contract above. */
export function payoffAt(worldSeed, world, t, m) {
  const z = gaussFrom(`${worldSeed}|spin|${t}|${m}`);
  return world.mu[m] + world.sigma[m] * z;
}

/** Best possible expected total on this world (play the truly-best machine 50×). */
export function oracle(world) {
  return SPINS * Math.max(...world.mu);
}

/* ── strategy execution ────────────────────────────────────────────────── */

function makeState() {
  return {
    // Everything a player writing things down could track, per machine:
    plays: new Array(M).fill(0),
    sums: new Array(M).fill(0),
    last: new Array(M).fill(null), // most recent payoff
    maxv: new Array(M).fill(null), // best single payoff seen
    minv: new Array(M).fill(null), // worst single payoff seen
    pos: new Array(M).fill(0), // how many payoffs were positive
    hist: Array.from({ length: M }, () => []), // the full record of every payoff
    spinsUsed: 0,
    total: 0,
    lastPayoff: null,
    lastMachine: null,
  };
}

function mean(state, i) {
  return state.plays[i] === 0 ? null : state.sums[i] / state.plays[i];
}

/** Per-machine metric used by best/worst selectors and by {metric:i} refs. */
function metricOf(state, i, metric) {
  switch (metric) {
    case "mean": return mean(state, i);
    case "plays": return state.plays[i];
    case "sum": return state.sums[i];
    case "last": return state.last[i];
    case "max": return state.maxv[i];
    case "min": return state.minv[i];
    case "countPos": return state.pos[i];
    default: return null;
  }
}

/**
 * Pick the machine a selector points at. `rand` is the strategy's own
 * seeded random stream (for random / epsilonGreedy / thompson), separate
 * from the payoff stream so randomness never perturbs the world.
 */
function select(sel, state, rand) {
  if (typeof sel === "string") {
    switch (sel) {
      case "leastPlayed":
        return argmin(state.plays);
      case "random":
        return Math.floor(rand() * M);
      case "highestMean": {
        // Untried machines are tried first (optimistic), lowest index first.
        const untried = state.plays.indexOf(0);
        if (untried !== -1) return untried;
        return argmax(state.plays.map((_, i) => mean(state, i)));
      }
      case "highestLastPayoff": {
        const untried = state.last.indexOf(null);
        if (untried !== -1) return untried;
        return argmax(state.last);
      }
      case "stay":
        // Keep the machine you just pulled — the "stick with it" move.
        // Nothing pulled yet (first spin) → a random machine to start.
        return state.lastMachine == null ? Math.floor(rand() * M) : state.lastMachine;
      case "thompson": {
        // Normal Thompson sampling with the proper conjugate posterior:
        // prior N(0, τ²=100) on each machine's mean, observation noise σ²≈100.
        // Posterior after n pulls with sample mean x̄:
        //   var  = 1 / (1/τ² + n/σ²) = 100 / (1 + n)
        //   mean = var · (n·x̄/σ²)    = x̄ · n / (1 + n)
        // This shrinks early estimates toward the prior and cuts the wild
        // over-exploration of the naive "x̄ ± 10/√n" version.
        const TAU2 = 100, SIG2 = 100;
        const samples = [];
        for (let i = 0; i < M; i++) {
          const n = state.plays[i];
          const postVar = 1 / (1 / TAU2 + n / SIG2);
          const postMean = n === 0 ? 0 : postVar * ((n * mean(state, i)) / SIG2);
          samples.push(postMean + Math.sqrt(postVar) * gaussian(rand));
        }
        return argmax(samples);
      }
    }
  }
  if (sel.fixed !== undefined) return sel.fixed;
  // "play the machine with the highest / lowest <metric> so far" — the
  // general form. Untried machines (metric null) are tried first so the
  // strategy has data before it commits.
  if (sel.best !== undefined || sel.worst !== undefined) {
    const metric = sel.best ?? sel.worst;
    const untried = state.plays.indexOf(0);
    if (untried !== -1) return untried;
    const vals = Array.from({ length: M }, (_, i) => metricOf(state, i, metric) ?? 0);
    return sel.best !== undefined ? argmax(vals) : argmin(vals);
  }
  if (sel.epsilonGreedy !== undefined) {
    if (rand() < sel.epsilonGreedy) return Math.floor(rand() * M);
    return select("highestMean", state, rand);
  }
  if (sel.ucb !== undefined) {
    const untried = state.plays.indexOf(0);
    if (untried !== -1) return untried;
    const t = state.spinsUsed + 1;
    return argmax(
      state.plays.map((n, i) => mean(state, i) + sel.ucb * Math.sqrt(Math.log(t) / n))
    );
  }
  return 0; // unreachable after validation
}

function argmax(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

function argmin(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] < arr[best]) best = i;
  return best;
}

function lookupFor(state) {
  return (ref) => {
    if (typeof ref === "string") {
      switch (ref) {
        case "spinsUsed": return state.spinsUsed;
        case "spinsLeft": return SPINS - state.spinsUsed;
        case "total": return state.total;
        case "lastPayoff": return state.lastPayoff ?? 0;
        case "lastMachine": return state.lastMachine ?? -1;
      }
    }
    // Per-machine metrics: {plays:i},{mean:i},{sum:i},{last:i},{max:i},
    // {min:i},{countPos:i}, and {countAbove:[i,x]}/{countBelow:[i,x]}.
    if (ref.plays !== undefined) return state.plays[ref.plays];
    if (ref.mean !== undefined) return mean(state, ref.mean) ?? 0;
    if (ref.sum !== undefined) return state.sums[ref.sum];
    if (ref.last !== undefined) return state.last[ref.last] ?? 0;
    if (ref.max !== undefined) return state.maxv[ref.max] ?? 0;
    if (ref.min !== undefined) return state.minv[ref.min] ?? 0;
    if (ref.countPos !== undefined) return state.pos[ref.countPos];
    if (ref.countAbove !== undefined) {
      const [i, x] = ref.countAbove;
      return state.hist[i].reduce((n, p) => n + (p > x ? 1 : 0), 0);
    }
    if (ref.countBelow !== undefined) {
      const [i, x] = ref.countBelow;
      return state.hist[i].reduce((n, p) => n + (p < x ? 1 : 0), 0);
    }
    return 0;
  };
}

/** Run one validated spec over one world. Returns the total (and history if asked). */
export function simulate(spec, worldSeed, { withHistory = false } = {}) {
  const world = makeWorld(worldSeed);
  const state = makeState();
  const rand = rngFrom(worldSeed + "|strat"); // the strategy's private randomness
  const history = withHistory ? [] : null;

  for (let t = 0; t < SPINS; t++) {
    const lookup = lookupFor(state);
    let machine = 0;
    for (const rule of spec.rules) {
      if (evalCond(rule.if, lookup)) {
        machine = select(rule.then.play, state, rand);
        break;
      }
    }
    const pay = payoffAt(worldSeed, world, t, machine);
    applySpin(state, machine, pay);
    if (history) history.push({ t, machine, pay: round2(pay) });
  }
  return { total: state.total, world, history, state };
}

/** Shared bookkeeping for both simulated and manual spins. */
export function applySpin(state, machine, pay) {
  state.plays[machine]++;
  state.sums[machine] += pay;
  state.last[machine] = pay;
  state.maxv[machine] = state.maxv[machine] == null ? pay : Math.max(state.maxv[machine], pay);
  state.minv[machine] = state.minv[machine] == null ? pay : Math.min(state.minv[machine], pay);
  if (pay > 0) state.pos[machine]++;
  state.hist[machine].push(pay);
  state.total += pay;
  state.spinsUsed++;
  state.lastPayoff = pay;
  state.lastMachine = machine;
}

export { makeState as makeManualState, mean as machineMean };

/**
 * Run a spec across the shared world set. Returns average score, average
 * % of oracle, and score distribution stats.
 */
export function runMany(spec, baseSeed, n = BANDIT.simulations) {
  let sum = 0;
  let sumSq = 0;
  let oracleSum = 0;
  let best = -Infinity;
  let worst = Infinity;
  for (let j = 0; j < n; j++) {
    const worldSeed = `${baseSeed}|w${j}`;
    const { total, world } = simulate(spec, worldSeed);
    sum += total;
    sumSq += total * total;
    oracleSum += oracle(world);
    if (total > best) best = total;
    if (total < worst) worst = total;
  }
  const avg = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - avg * avg));
  return {
    n,
    avg: round2(avg),
    sd: round2(sd),
    best: round2(best),
    worst: round2(worst),
    // Average score as a % of the average oracle across the same worlds.
    oraclePct: round2((100 * sum) / oracleSum),
    avgOracle: round2(oracleSum / n),
  };
}

export function round2(x) {
  return Math.round(x * 100) / 100;
}

/** Oracle % for a single finished run (manual leaderboard's second column). */
export function oraclePctFor(total, world) {
  const o = oracle(world);
  return o > 0 ? round2((100 * total) / o) : null;
}

export { hash32 };
