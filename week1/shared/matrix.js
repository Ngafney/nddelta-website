/**
 * The matrix-game engine: Chicken and Split-or-Steal share everything but
 * their payoff table and action names.
 *
 * Matches are seeded per (botA, botB, matchIndex) with the bot ids sorted,
 * so a randomized strategy still produces the exact same match every time
 * it is recomputed — which is what makes replays truthful rather than
 * "a representative game".
 */

import { rngFrom } from "./rng.js";
import { evalCond } from "./dsl.js";
import { PAYOFFS, ACTIONS, COOPERATIVE, MATCH } from "./rules.js";

/* ── one bot's view of the match so far ───────────────────────────────── */

function makeSide() {
  return { moves: [], counts: {}, score: 0 };
}

function lookupFor(game, me, opp, round) {
  return (ref) => {
    if (typeof ref === "string") {
      switch (ref) {
        case "round": return round;
        case "myScore": return me.score;
        case "oppScore": return opp.score;
        case "myLast": return me.moves[me.moves.length - 1] ?? "NONE";
        case "oppLast": return opp.moves[opp.moves.length - 1] ?? "NONE";
      }
      if (ACTIONS[game].includes(ref)) return ref; // action literal in an eq/neq
    }
    if (ref.oppCount !== undefined) return opp.counts[ref.oppCount] ?? 0;
    if (ref.myCount !== undefined) return me.counts[ref.myCount] ?? 0;
    if (ref.oppStreak !== undefined) return streak(opp.moves, ref.oppStreak);
    if (ref.myStreak !== undefined) return streak(me.moves, ref.myStreak);
    return 0;
  };
}

function streak(moves, action) {
  let s = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i] === action) s++;
    else break;
  }
  return s;
}

function decide(spec, game, me, opp, round, rand) {
  const lookup = lookupFor(game, me, opp, round);
  let act = COOPERATIVE[game];
  for (const rule of spec.rules) {
    if (evalCond(rule.if, lookup)) {
      act = resolveAction(rule.then, game, opp, rand);
      break;
    }
  }
  return act;
}

function resolveAction(act, game, opp, rand) {
  if (typeof act === "string") return act;
  const oppLast = opp.moves[opp.moves.length - 1];
  if (act.mirror) return oppLast ?? COOPERATIVE[game];
  if (act.opposite) {
    if (!oppLast) return COOPERATIVE[game];
    const [a, b] = ACTIONS[game];
    return oppLast === a ? b : a;
  }
  if (act.chance) {
    const [p, first, second] = act.chance;
    return rand() < p ? first : second;
  }
  return COOPERATIVE[game];
}

/* ── matches and tournaments ──────────────────────────────────────────── */

/** Play one 10-round match. Deterministic in (game, idA, idB, matchIndex). */
export function playMatch(game, botA, botB, matchIndex) {
  // Sort ids into the seed so A-vs-B and B-vs-A are the same match.
  const [lo, hi] = [botA.id, botB.id].sort();
  const seed = `${game}|${lo}|${hi}|m${matchIndex}`;
  const randA = rngFrom(seed + "|" + botA.id);
  const randB = rngFrom(seed + "|" + botB.id);

  const a = makeSide();
  const b = makeSide();
  const rounds = [];

  for (let r = 0; r < MATCH.rounds; r++) {
    const actA = decide(botA.spec, game, a, b, r, randA);
    const actB = decide(botB.spec, game, b, a, r, randB);
    const payA = PAYOFFS[game][actA][actB];
    const payB = PAYOFFS[game][actB][actA];
    a.moves.push(actA); a.counts[actA] = (a.counts[actA] ?? 0) + 1; a.score += payA;
    b.moves.push(actB); b.counts[actB] = (b.counts[actB] ?? 0) + 1; b.score += payB;
    rounds.push({ a: actA, b: actB, pa: payA, pb: payB });
  }
  return { rounds, scoreA: a.score, scoreB: b.score };
}

/**
 * Full round-robin over all bots: every pairing plays MATCH.matchesPerPairing
 * matches, no self-play. Rankings are AVERAGE POINTS PER MATCH so scores
 * don't inflate as more teams join.
 *
 * bots: [{ id, name, spec, seed? }]
 * Returns { standings, pairs } where pairs["lo|hi"] holds full match logs
 * (the replay source).
 */
export function roundRobin(game, bots) {
  const totals = Object.fromEntries(bots.map((b) => [b.id, { points: 0, matches: 0, wins: 0, losses: 0, draws: 0 }]));
  const pairs = {};

  for (let i = 0; i < bots.length; i++) {
    for (let j = i + 1; j < bots.length; j++) {
      const A = bots[i];
      const B = bots[j];
      const [lo, hi] = [A.id, B.id].sort();
      const key = `${lo}|${hi}`;
      const matches = [];
      for (let m = 0; m < MATCH.matchesPerPairing; m++) {
        const res = playMatch(game, A, B, m);
        matches.push(res);
        totals[A.id].points += res.scoreA;
        totals[B.id].points += res.scoreB;
        totals[A.id].matches++;
        totals[B.id].matches++;
        if (res.scoreA > res.scoreB) { totals[A.id].wins++; totals[B.id].losses++; }
        else if (res.scoreB > res.scoreA) { totals[B.id].wins++; totals[A.id].losses++; }
        else { totals[A.id].draws++; totals[B.id].draws++; }
      }
      // Store logs keyed lo|hi with scores oriented to (lo, hi).
      pairs[key] = { a: lo, b: hi, matches: matches.map((m2) => orient(m2, A.id === lo)) };
    }
  }

  const standings = bots
    .map((b) => {
      const t = totals[b.id];
      return {
        id: b.id,
        name: b.name,
        seed: !!b.seedBot,
        avg: t.matches ? Math.round((t.points / t.matches) * 100) / 100 : 0,
        matches: t.matches,
        wins: t.wins,
        losses: t.losses,
        draws: t.draws,
      };
    })
    .sort((x, y) => y.avg - x.avg);

  return { standings, pairs };
}

function orient(match, aIsLo) {
  if (aIsLo) return match;
  return {
    rounds: match.rounds.map((r) => ({ a: r.b, b: r.a, pa: r.pb, pb: r.pa })),
    scoreA: match.scoreB,
    scoreB: match.scoreA,
  };
}
