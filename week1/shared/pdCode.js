/**
 * Executable Iterated-Prisoner's-Dilemma strategies.
 *
 * A team's bot is a REAL JavaScript function the AI writes for them — the body
 * of `decide(state)` that returns "SPLIT" or "STEAL" for the current round. It
 * sees the full history of the CURRENT match (both sides' moves, scores, counts,
 * streaks) and a seeded rng, but NEVER the opponent's identity — reading an
 * opponent from their moves alone is part of the game. This lets a strategy do
 * genuinely arbitrary logic (reactive rules, randomness, a little linear model)
 * instead of a fixed rule format.
 *
 * SAFETY — identical lockdown to the bandit sandbox: a static denylist rejects
 * loops and every host escape BEFORE compile; the code runs in strict mode with
 * only `state` and a curated `lib` in scope; randomness is a SEEDED state.rng()
 * so matches (and replays) are deterministic; the return is validated to a real
 * action every round.
 */

import { rngFrom } from "./rng.js";
import { PAYOFFS, ACTIONS, COOPERATIVE, MATCH } from "./rules.js";

const GAME = "pd";
const [A0, A1] = ACTIONS[GAME]; // ["SPLIT","STEAL"]
const DEFAULT = COOPERATIVE[GAME]; // "SPLIT"

const DENY = [
  "\\bfor\\b", "\\bwhile\\b", "\\bdo\\b", "\\bfunction\\b",
  "\\bthis\\b", "\\barguments\\b", "\\bconstructor\\b", "__proto__", "\\bprototype\\b",
  "\\bimport\\b", "\\brequire\\b", "\\bprocess\\b", "\\bglobal\\b", "\\bglobalThis\\b",
  "\\beval\\b", "\\bFunction\\b", "\\bReflect\\b", "\\bProxy\\b", "\\bSymbol\\b",
  "\\bfetch\\b", "\\bXMLHttpRequest\\b", "\\bWebAssembly\\b", "\\bAtomics\\b",
  "\\bSharedArrayBuffer\\b", "\\bBuffer\\b", "\\bmodule\\b", "\\bexports\\b",
  "\\basync\\b", "\\bawait\\b", "\\byield\\b",
  "\\bsetTimeout\\b", "\\bsetInterval\\b", "\\bsetImmediate\\b", "\\bqueueMicrotask\\b",
  "\\bPromise\\b", "\\.\\s*random", "\\.\\s*constructor",
];
const DENY_RE = new RegExp(DENY.join("|"), "i");

const LIB = Object.freeze({
  max: Math.max, min: Math.min, abs: Math.abs, floor: Math.floor,
  ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, log: Math.log,
  pow: Math.pow, exp: Math.exp, sign: Math.sign,
  clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
});

export function validatePdCode(src) {
  if (typeof src !== "string" || !src.trim()) return { ok: false, error: "empty code" };
  if (src.length > 4000) return { ok: false, error: "code is too long" };
  if (/[`]/.test(src)) return { ok: false, error: "template literals (backticks) aren't allowed" };
  const m = src.match(DENY_RE);
  if (m) return { ok: false, error: `"${m[0].trim()}" isn't allowed — use array methods over state.myMoves/state.oppMoves instead of loops, and state.rng() instead of Math.random.` };
  return { ok: true };
}

/** Normalize whatever the strategy returned into "SPLIT"/"STEAL". */
function normalize(out) {
  if (typeof out === "string") {
    const u = out.trim().toUpperCase();
    if (u === A0 || u === A1) return u;
    return null;
  }
  if (typeof out === "number") return out ? A1 : A0; // 0=SPLIT, nonzero=STEAL
  if (typeof out === "boolean") return out ? A1 : A0;
  return null;
}

export function compilePdCode(src) {
  // eslint-disable-next-line no-new-func
  const raw = new Function("state", "lib", `"use strict";\n${src}`);
  return (state) => normalize(raw(state, LIB));
}

function counts(moves) {
  let s = 0, t = 0;
  for (const m of moves) { if (m === A0) s++; else if (m === A1) t++; }
  return [s, t];
}

/** The per-round view handed to a strategy. No opponent identity. */
function makeState(me, opp, round, rng) {
  const [mySplits, mySteals] = counts(me.moves);
  const [oppSplits, oppSteals] = counts(opp.moves);
  return {
    round,
    rounds: MATCH.rounds,
    myMoves: me.moves,
    oppMoves: opp.moves,
    myLast: me.moves.length ? me.moves[me.moves.length - 1] : null,
    oppLast: opp.moves.length ? opp.moves[opp.moves.length - 1] : null,
    myScore: me.score,
    oppScore: opp.score,
    mySplits, mySteals, oppSplits, oppSteals,
    SPLIT: A0, STEAL: A1,
    rng,
  };
}

/**
 * Play one match between two compiled bots. Deterministic in
 * (idA, idB, matchIndex) with ids sorted, so a randomized bot yields the exact
 * same match on every recompute — which is what makes replays truthful.
 */
export function playMatchCode(botA, botB, matchIndex) {
  const [lo, hi] = [botA.id, botB.id].sort();
  const seed = `${GAME}|${lo}|${hi}|m${matchIndex}`;
  const randA = rngFrom(seed + "|" + botA.id);
  const randB = rngFrom(seed + "|" + botB.id);
  const a = { moves: [], score: 0 };
  const b = { moves: [], score: 0 };
  const rounds = [];
  for (let r = 0; r < MATCH.rounds; r++) {
    let actA, actB;
    try { actA = botA.fn(makeState(a, b, r, randA)); } catch { actA = null; }
    try { actB = botB.fn(makeState(b, a, r, randB)); } catch { actB = null; }
    actA = actA ?? DEFAULT;
    actB = actB ?? DEFAULT;
    const payA = PAYOFFS[GAME][actA][actB];
    const payB = PAYOFFS[GAME][actB][actA];
    a.moves.push(actA); a.score += payA;
    b.moves.push(actB); b.score += payB;
    rounds.push({ a: actA, b: actB, pa: payA, pb: payB });
  }
  return { rounds, scoreA: a.score, scoreB: b.score };
}

function orient(match, aIsLo) {
  if (aIsLo) return match;
  return {
    rounds: match.rounds.map((r) => ({ a: r.b, b: r.a, pa: r.pb, pb: r.pa })),
    scoreA: match.scoreB,
    scoreB: match.scoreA,
  };
}

/**
 * Full round-robin. bots: [{ id, name, fn, seedBot? }].
 * Returns { standings, pairs } — standings ranked by avg points/match, pairs
 * keyed "lo|hi" with oriented match logs (the replay + CSV source).
 */
export function roundRobinCode(bots) {
  const totals = Object.fromEntries(bots.map((b) => [b.id, { points: 0, matches: 0, wins: 0, losses: 0, draws: 0 }]));
  const pairs = {};
  for (let i = 0; i < bots.length; i++) {
    for (let j = i + 1; j < bots.length; j++) {
      const A = bots[i], B = bots[j];
      const [lo, hi] = [A.id, B.id].sort();
      const matches = [];
      for (let m = 0; m < MATCH.matchesPerPairing; m++) {
        const res = playMatchCode(A, B, m);
        matches.push(res);
        totals[A.id].points += res.scoreA; totals[B.id].points += res.scoreB;
        totals[A.id].matches++; totals[B.id].matches++;
        if (res.scoreA > res.scoreB) { totals[A.id].wins++; totals[B.id].losses++; }
        else if (res.scoreB > res.scoreA) { totals[B.id].wins++; totals[A.id].losses++; }
        else { totals[A.id].draws++; totals[B.id].draws++; }
      }
      pairs[`${lo}|${hi}`] = { a: lo, b: hi, matches: matches.map((mm) => orient(mm, A.id === lo)) };
    }
  }
  const standings = bots.map((b) => {
    const t = totals[b.id];
    return {
      id: b.id, name: b.name, seed: !!b.seedBot,
      avg: t.matches ? Math.round((t.points / t.matches) * 100) / 100 : 0,
      matches: t.matches, wins: t.wins, losses: t.losses, draws: t.draws,
    };
  }).sort((x, y) => y.avg - x.avg);
  return { standings, pairs };
}

/**
 * One team's results against every opponent, for the downloadable CSV.
 * nameOf: id → display name.
 */
export function opponentBreakdown(pairs, teamId, nameOf) {
  const rows = [];
  for (const key of Object.keys(pairs)) {
    const p = pairs[key];
    if (p.a !== teamId && p.b !== teamId) continue;
    const meIsA = p.a === teamId;
    const oppId = meIsA ? p.b : p.a;
    let myPts = 0, oppPts = 0, splits = 0, steals = 0, rounds = 0;
    for (const mtch of p.matches) {
      const sFor = meIsA ? mtch.scoreA : mtch.scoreB;
      const sAgs = meIsA ? mtch.scoreB : mtch.scoreA;
      myPts += sFor; oppPts += sAgs;
      for (const rnd of mtch.rounds) {
        const mine = meIsA ? rnd.a : rnd.b;
        if (mine === A0) splits++; else steals++;
        rounds++;
      }
    }
    const n = p.matches.length || 1;
    rows.push({
      opponent: nameOf(oppId) || oppId,
      matches: p.matches.length,
      avgFor: Math.round((myPts / n) * 100) / 100,
      avgAgainst: Math.round((oppPts / n) * 100) / 100,
      result: myPts > oppPts ? "win" : myPts < oppPts ? "loss" : "tie",
      mySplitRate: rounds ? Math.round((100 * splits) / rounds) : 0,
      mySteals: steals,
    });
  }
  return rows.sort((x, y) => y.avgFor - x.avgFor);
}

/** Compile + smoke test. Returns { ok, run } or { ok:false, error }. */
export function preparePdCode(src) {
  const v = validatePdCode(src);
  if (!v.ok) return v;
  let fn;
  try { fn = compilePdCode(src); } catch (e) { return { ok: false, error: `syntax error: ${e.message}` }; }
  try {
    const first = makeState({ moves: [], score: 0 }, { moves: [], score: 0 }, 0, rngFrom("smoke"));
    const mid = makeState(
      { moves: [A0, A1, A0], score: 100 },
      { moves: [A1, A1, A0], score: 150 },
      3, rngFrom("smoke2"),
    );
    if (fn(first) == null || fn(mid) == null) {
      return { ok: false, error: `the code didn't return a valid move (return "${A0}" or "${A1}")` };
    }
  } catch (e) {
    return { ok: false, error: `the code crashed when run: ${e.message}` };
  }
  return { ok: true, run: fn };
}
