/**
 * Step 2 — the reconstructed field, as playable bots.
 *
 * Each opponent is modelled from the numbers infer.mjs recovered. Where the
 * data can't separate two hypotheses (a reciprocator that opens by cooperating
 * vs one that opens by defecting, say), the model set deliberately includes
 * BOTH so a strategy has to be robust rather than tuned to a guess.
 */
import { rngFrom } from "../shared/rng.js";

const C = "COOPERATE", D = "DEFECT";

/* ── behavioural archetypes ───────────────────────────────────────────── */
const allC = () => () => C;
const allD = () => () => D;
const randomP = (p) => (rng) => () => (rng() < p ? C : D);           // coop w.p. p
const tft = () => (_rng, s) => (s.round === 0 ? C : s.oppLast);      // classic
const suspiciousTft = () => (_rng, s) => (s.round === 0 ? D : s.oppLast);
const generousTft = (f) => () => (rng, s) => {
  if (s.round === 0) return C;
  if (s.oppLast === D && rng() < f) return C;                        // forgive
  return s.oppLast;
};
const tit2tat = () => (_rng, s) => {
  const l = s.oppMoves.slice(-2);
  return l.length === 2 && l[0] === D && l[1] === D ? D : C;
};
const grim = () => (_rng, s) => (s.oppMoves.some((m) => m === D) ? D : C);
/** mostly-defect bot that only cooperates after sustained cooperation */
const hardReciprocator = () => (_rng, s) => {
  const l = s.oppMoves.slice(-2);
  return l.length === 2 && l[0] === C && l[1] === C ? C : D;
};
/** cooperates a fixed fraction of the time regardless (noisy cooperator) */
const noisyCoop = (p) => (rng) => () => (rng() < p ? C : D);

/**
 * The field. `weight` lets a single archetype stand for several real teams.
 * `variants` are alternative models consistent with the same observed data —
 * every candidate strategy is scored against ALL combinations, so what we pick
 * has to work whichever hypothesis is true.
 */
export const FIELD = [
  // ── pure pushovers (3 teams): cooperated 100% even while being defected
  { name: "RS/ava/pl", teams: 3, make: allC },
  // ── near-pushovers
  { name: "el (95% coop)", teams: 1, make: () => noisyCoop(0.95)(rngFrom("el")) },
  { name: "ka (90% coop)", teams: 1, make: () => noisyCoop(0.90)(rngFrom("ka")) },
  // ── the reciprocator bloc (14 teams). Data shows they cooperate far more
  //    after we cooperate, but can't pin the exact flavour → model several.
  { name: "reciprocators", teams: 14, make: tft,
    variants: [tft, generousTft(0.1), tit2tat, suspiciousTft, grim, hardReciprocator] },
  // ── committed defectors (14 teams)
  { name: "defectors", teams: 14, make: allD },
  // ── mixed / random
  { name: "Hudson (66%)", teams: 1, make: () => noisyCoop(0.66)(rngFrom("hud")) },
  { name: "COIN (house, 50%)", teams: 1, make: () => randomP(0.5)(rngFrom("coin")) },
  { name: "Danny (49%)", teams: 1, make: () => noisyCoop(0.49)(rngFrom("dan")) },
  { name: "Jack (10%)", teams: 1, make: () => noisyCoop(0.10)(rngFrom("jack")) },
  // ── george: a near-pure reciprocator that cooperated 84% overall
  { name: "george", teams: 1, make: generousTft(0.05) },
];

export const TOTAL_TEAMS = FIELD.reduce((n, f) => n + f.teams, 0);
export { C, D };
