/**
 * Step 3 — the test bench.
 *
 * Candidate strategies run through the REAL game sandbox (preparePdCode), so
 * anything that scores here is guaranteed to compile and behave identically
 * in the live tournament. Opponents come from the reconstructed field.
 *
 * Scoring mirrors the live board: AVERAGE POINTS PER MATCH across the whole
 * field, weighted by how many real teams each archetype stands for.
 */
import { preparePdCode } from "../shared/pdCode.js";
import { PAYOFFS, MATCH } from "../shared/rules.js";
import { rngFrom } from "../shared/rng.js";
import { FIELD, C, D } from "./field.mjs";

const P = PAYOFFS.pd;
const ROUNDS = MATCH.rounds;

/** Play one match: my compiled bot vs an opponent model. */
export function play(myFn, oppFn, seed) {
  const myRng = rngFrom(seed + "|me");
  const oppRng = rngFrom(seed + "|opp");
  const me = { moves: [], score: 0 };
  const op = { moves: [], score: 0 };
  const view = (a, b, rng) => ({
    round: a.moves.length, rounds: ROUNDS,
    myMoves: Object.freeze(a.moves.slice()), oppMoves: Object.freeze(b.moves.slice()),
    myLast: a.moves.length ? a.moves[a.moves.length - 1] : null,
    oppLast: b.moves.length ? b.moves[b.moves.length - 1] : null,
    myScore: a.score, oppScore: b.score,
    myCoops: a.moves.filter((m) => m === C).length,
    myDefects: a.moves.filter((m) => m === D).length,
    oppCoops: b.moves.filter((m) => m === C).length,
    oppDefects: b.moves.filter((m) => m === D).length,
    COOPERATE: C, DEFECT: D, rng,
  });
  for (let r = 0; r < ROUNDS; r++) {
    let mine, theirs;
    try { mine = myFn(view(me, op, myRng)); } catch { mine = null; }
    try { theirs = oppFn(oppRng, view(op, me, oppRng)); } catch { theirs = null; }
    mine = mine === C || mine === D ? mine : C;
    theirs = theirs === C || theirs === D ? theirs : C;
    me.score += P[mine][theirs];
    op.score += P[theirs][mine];
    me.moves.push(mine);
    op.moves.push(theirs);
  }
  return { mine: me.score, theirs: op.score, myMoves: me.moves, oppMoves: op.moves };
}

/** Average points per match for a strategy across the whole weighted field. */
export function evaluate(code, { variantIndex = null, detail = false } = {}) {
  const prep = preparePdCode(code);
  if (!prep.ok) return { ok: false, error: prep.error };
  let points = 0, matches = 0;
  const rows = [];
  for (const f of FIELD) {
    // pick the model (a variant when the archetype has alternatives)
    const maker = variantIndex != null && f.variants ? f.variants[variantIndex % f.variants.length] : f.make;
    let sum = 0;
    for (let m = 0; m < MATCH.matchesPerPairing; m++) {
      const opp = maker();
      const r = play(prep.run, opp, `${f.name}|m${m}`);
      sum += r.mine;
      points += r.mine * f.teams;
      matches += f.teams;
    }
    if (detail) rows.push({ vs: f.name, teams: f.teams, avg: +(sum / MATCH.matchesPerPairing).toFixed(1) });
  }
  return { ok: true, avg: +(points / matches).toFixed(1), rows };
}

/** Worst-case + average across every reciprocator hypothesis. */
export function evaluateRobust(code) {
  const nVariants = Math.max(...FIELD.map((f) => (f.variants ? f.variants.length : 1)));
  const scores = [];
  for (let v = 0; v < nVariants; v++) {
    const r = evaluate(code, { variantIndex: v });
    if (!r.ok) return r;
    scores.push(r.avg);
  }
  return {
    ok: true,
    avg: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1),
    worst: Math.min(...scores),
    best: Math.max(...scores),
    scores,
  };
}
