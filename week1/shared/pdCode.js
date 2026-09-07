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

// Each helper is its OWN frozen wrapper. Handing out `Math.max` itself let a
// strategy write properties onto the real global (lib.max.n = ...), which
// survived across matches and teams in the server process — cross-run memory
// and cross-team contamination. Wrappers keep the globals untouchable.
const frz = (f) => Object.freeze(f);

const LIB = Object.freeze({
  max: frz((...a) => Math.max(...a)), min: frz((...a) => Math.min(...a)),
  abs: frz((x) => Math.abs(x)), floor: frz((x) => Math.floor(x)),
  ceil: frz((x) => Math.ceil(x)), round: frz((x) => Math.round(x)),
  sqrt: frz((x) => Math.sqrt(x)), log: frz((x) => Math.log(x)),
  pow: frz((x, y) => Math.pow(x, y)), exp: frz((x) => Math.exp(x)),
  sign: frz((x) => Math.sign(x)),
  clamp: frz((x, lo, hi) => Math.max(lo, Math.min(hi, x))),
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

/**
 * The per-round view handed to a strategy. No opponent identity.
 *
 * The move arrays are frozen COPIES, never the engine's own arrays: handing
 * over the live ones let a bot run `state.oppMoves.length = 0` every round,
 * erasing the history that reactive opponents read. That blinded tit-for-tat
 * and farmed a perfect 1000–0 — a tournament-winning cheat. Copies cost a
 * little work per round and make the exploit impossible.
 */
function makeState(me, opp, round, rng) {
  const [mySplits, mySteals] = counts(me.moves);
  const [oppSplits, oppSteals] = counts(opp.moves);
  return {
    round,
    rounds: MATCH.rounds,
    myMoves: Object.freeze(me.moves.slice()),
    oppMoves: Object.freeze(opp.moves.slice()),
    myLast: me.moves.length ? me.moves[me.moves.length - 1] : null,
    oppLast: opp.moves.length ? opp.moves[opp.moves.length - 1] : null,
    myScore: me.score,
    oppScore: opp.score,
    myCoops: mySplits, myDefects: mySteals, oppCoops: oppSplits, oppDefects: oppSteals,
    COOPERATE: A0, DEFECT: A1,
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

/** Flip a match's orientation so scores/rounds read from the "lo" bot's side. */
export function orient(match, aIsLo) {
  if (aIsLo) return match;
  return {
    rounds: match.rounds.map((r) => ({ a: r.b, b: r.a, pa: r.pb, pb: r.pa })),
    scoreA: match.scoreB,
    scoreB: match.scoreA,
  };
}

/**
 * Full round-robin. bots: [{ id, name, fn, seedBot? }].
 *
 * At Axelrod's length (200 rounds × 5 matches × every pairing) the round logs
 * are far too big to persist, so we keep only SUMMARIES here — per-pair scores
 * and cooperation rates, which is everything the standings and the CSV need.
 * Replays are recomputed on demand from the seeded (deterministic) match.
 *
 * Returns { standings, pairSummaries } where pairSummaries is keyed "lo|hi".
 */
export function roundRobinCode(bots) {
  const totals = Object.fromEntries(bots.map((b) => [b.id, { points: 0, matches: 0, wins: 0, losses: 0, draws: 0 }]));
  const pairSummaries = {};
  for (let i = 0; i < bots.length; i++) {
    for (let j = i + 1; j < bots.length; j++) {
      const A = bots[i], B = bots[j];
      const [lo, hi] = [A.id, B.id].sort();
      let ptsA = 0, ptsB = 0, coopA = 0, coopB = 0, rounds = 0;
      const perMatch = [];
      for (let m = 0; m < MATCH.matchesPerPairing; m++) {
        const res = playMatchCode(A, B, m);
        ptsA += res.scoreA; ptsB += res.scoreB;
        for (const r of res.rounds) {
          if (r.a === A0) coopA++;
          if (r.b === A0) coopB++;
          rounds++;
        }
        totals[A.id].points += res.scoreA; totals[B.id].points += res.scoreB;
        totals[A.id].matches++; totals[B.id].matches++;
        if (res.scoreA > res.scoreB) { totals[A.id].wins++; totals[B.id].losses++; }
        else if (res.scoreB > res.scoreA) { totals[B.id].wins++; totals[A.id].losses++; }
        else { totals[A.id].draws++; totals[B.id].draws++; }
        perMatch.push({ a: res.scoreA, b: res.scoreB });
      }
      const aIsLo = A.id === lo;
      pairSummaries[`${lo}|${hi}`] = {
        a: lo, b: hi,
        matches: MATCH.matchesPerPairing,
        scoreA: aIsLo ? ptsA : ptsB,
        scoreB: aIsLo ? ptsB : ptsA,
        coopA: aIsLo ? coopA : coopB,
        coopB: aIsLo ? coopB : coopA,
        rounds,
        perMatch: perMatch.map((pm) => (aIsLo ? pm : { a: pm.b, b: pm.a })),
      };
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
  return { standings, pairSummaries };
}

/**
 * One team's results against every opponent, for the downloadable CSV.
 * nameOf: id → display name.
 */
export function opponentBreakdown(pairSummaries, teamId, nameOf) {
  const rows = [];
  for (const key of Object.keys(pairSummaries)) {
    const p = pairSummaries[key];
    if (p.a !== teamId && p.b !== teamId) continue;
    const meIsA = p.a === teamId;
    const oppId = meIsA ? p.b : p.a;
    const myPts = meIsA ? p.scoreA : p.scoreB;
    const oppPts = meIsA ? p.scoreB : p.scoreA;
    const myCoops = meIsA ? p.coopA : p.coopB;
    const n = p.matches || 1;
    rows.push({
      opponent: nameOf(oppId) || oppId,
      matches: p.matches,
      avgFor: Math.round((myPts / n) * 100) / 100,
      avgAgainst: Math.round((oppPts / n) * 100) / 100,
      result: myPts > oppPts ? "win" : myPts < oppPts ? "loss" : "tie",
      myCoopRate: p.rounds ? Math.round((100 * myCoops) / p.rounds) : 0,
      myDefects: p.rounds - myCoops,
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
      { moves: [A0, A1, A0], score: 9 },
      { moves: [A1, A1, A0], score: 12 },
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
