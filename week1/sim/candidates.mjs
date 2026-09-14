/**
 * Step 4 — candidate strategies, scored against the reconstructed field.
 *
 * Field: 5 pushovers (1000 each if you defect), 14 reciprocators (~600 if you
 * cooperate, 200 if you don't), 14 committed defectors (200 if you defect, 0
 * if you don't), plus a few mixed. Ceiling is ~512/match. No fixed move gets
 * near it — the points are in telling the blocs apart.
 *
 * NOTE: the sandbox denylist scans COMMENTS as well as code, so nothing here
 * may contain the words for / while / do / function. Callbacks are arrows.
 */
import { evaluate, evaluateRobust } from "./engine.mjs";

export const CANDIDATES = {
  /* baselines */
  "ALL DEFECT": `return "DEFECT";`,
  "ALL COOPERATE": `return "COOPERATE";`,
  "TIT FOR TAT": `if (state.round === 0) return "COOPERATE";\nreturn state.oppLast;`,
  "GRUDGER": `if (state.oppDefects > 0) return "DEFECT";\nreturn "COOPERATE";`,

  /* ── the key idea: one probe separates a pushover from a reciprocator ──
     Both look identical if you only ever cooperate — both just cooperate back.
     Defecting once tells them apart: a reciprocator punishes, a pushover
     doesn't. Then you farm the pushover and partner with the reciprocator. */
  "PROBE THEN SORT": `
if (state.round < 5) return "COOPERATE";
if (state.round === 5) return "DEFECT";
if (state.round < 9) return "COOPERATE";
if (state.oppDefects === 0) return "DEFECT";
if (state.oppCoops === 0) return "DEFECT";
return state.oppLast;`,

  "PROBE THEN SORT (forgiving)": `
if (state.round < 5) return "COOPERATE";
if (state.round === 5) return "DEFECT";
if (state.round < 9) return "COOPERATE";
if (state.oppDefects === 0) return "DEFECT";
if (state.oppCoops === 0) return "DEFECT";
if (state.oppLast === "DEFECT" && state.rng() < 0.15) return "COOPERATE";
return state.oppLast;`,

  "PROBE EARLY (round 2)": `
if (state.round < 2) return "COOPERATE";
if (state.round === 2) return "DEFECT";
if (state.round < 6) return "COOPERATE";
if (state.oppDefects === 0) return "DEFECT";
if (state.oppCoops === 0) return "DEFECT";
return state.oppLast;`,

  "DOUBLE PROBE": `
if (state.round < 4) return "COOPERATE";
if (state.round === 4 || state.round === 20) return "DEFECT";
if (state.round < 8 || (state.round > 20 && state.round < 24)) return "COOPERATE";
if (state.oppDefects === 0) return "DEFECT";
if (state.oppCoops === 0) return "DEFECT";
return state.oppLast;`,

  "PROBE + ENDGAME": `
if (state.round < 5) return "COOPERATE";
if (state.round === 5) return "DEFECT";
if (state.round < 9) return "COOPERATE";
if (state.round >= state.rounds - 2) return "DEFECT";
if (state.oppDefects === 0) return "DEFECT";
if (state.oppCoops === 0) return "DEFECT";
return state.oppLast;`,

  "PROBE + RATIO + ENDGAME": `
if (state.round < 5) return "COOPERATE";
if (state.round === 5) return "DEFECT";
if (state.round < 9) return "COOPERATE";
if (state.round >= state.rounds - 2) return "DEFECT";
if (state.oppDefects === 0) return "DEFECT";
var seen = state.oppCoops + state.oppDefects;
var niceRate = state.oppCoops / seen;
if (niceRate < 0.12) return "DEFECT";
if (niceRate > 0.93 && state.round > 30) return "DEFECT";
return state.oppLast;`,


  /* ── measure RETALIATION directly: how much more do they defect right after
     we defect than right after we cooperate? That separates a reciprocator
     from a soft cooperator even when the soft one defects at random. ── */
  "RETALIATION READER": `
if (state.round < 6) return "COOPERATE";
if (state.round === 6 || state.round === 7) return "DEFECT";
if (state.round < 14) return "COOPERATE";
var opp = state.oppMoves;
var mine = state.myMoves;
var afterD = opp.filter((m, i) => i > 0 && mine[i - 1] === "DEFECT");
var afterC = opp.filter((m, i) => i > 0 && mine[i - 1] === "COOPERATE");
var pdd = afterD.filter((m) => m === "DEFECT").length / lib.max(1, afterD.length);
var pdc = afterC.filter((m) => m === "DEFECT").length / lib.max(1, afterC.length);
if (state.oppCoops === 0) return "DEFECT";
if (pdd - pdc > 0.25) return state.oppLast;
return "DEFECT";`,

  "RETALIATION READER (steady partner)": `
if (state.round < 6) return "COOPERATE";
if (state.round === 6 || state.round === 7) return "DEFECT";
if (state.round < 14) return "COOPERATE";
var opp = state.oppMoves;
var mine = state.myMoves;
var afterD = opp.filter((m, i) => i > 0 && mine[i - 1] === "DEFECT");
var afterC = opp.filter((m, i) => i > 0 && mine[i - 1] === "COOPERATE");
var pdd = afterD.filter((m) => m === "DEFECT").length / lib.max(1, afterD.length);
var pdc = afterC.filter((m) => m === "DEFECT").length / lib.max(1, afterC.length);
if (state.oppCoops === 0) return "DEFECT";
if (pdd - pdc > 0.25) {
  var last2 = opp.slice(-2);
  if (last2.length === 2 && last2[0] === "DEFECT" && last2[1] === "DEFECT") return "DEFECT";
  return "COOPERATE";
}
return "DEFECT";`,

  "RETALIATION READER + ENDGAME": `
if (state.round < 6) return "COOPERATE";
if (state.round === 6 || state.round === 7) return "DEFECT";
if (state.round < 14) return "COOPERATE";
if (state.round >= state.rounds - 2) return "DEFECT";
var opp = state.oppMoves;
var mine = state.myMoves;
var afterD = opp.filter((m, i) => i > 0 && mine[i - 1] === "DEFECT");
var afterC = opp.filter((m, i) => i > 0 && mine[i - 1] === "COOPERATE");
var pdd = afterD.filter((m) => m === "DEFECT").length / lib.max(1, afterD.length);
var pdc = afterC.filter((m) => m === "DEFECT").length / lib.max(1, afterC.length);
if (state.oppCoops === 0) return "DEFECT";
if (pdd - pdc > 0.25) {
  var l2 = opp.slice(-2);
  if (l2.length === 2 && l2[0] === "DEFECT" && l2[1] === "DEFECT") return "DEFECT";
  return "COOPERATE";
}
return "DEFECT";`,
  "PATIENT PARTNER (probe late)": `
if (state.round < 40) {
  if (state.round > 3 && state.oppCoops === 0) return "DEFECT";
  return "COOPERATE";
}
if (state.round === 40) return "DEFECT";
if (state.round < 44) return "COOPERATE";
if (state.oppDefects === 0) return "DEFECT";
if (state.oppCoops === 0) return "DEFECT";
return state.oppLast;`,
};

const results = [];
for (const [name, code] of Object.entries(CANDIDATES)) {
  const r = evaluateRobust(code);
  if (!r.ok) { console.log(name.padEnd(30), "COMPILE FAIL:", r.error.slice(0, 60)); continue; }
  results.push({ name, ...r });
}
results.sort((a, b) => b.avg - a.avg);
console.log("STRATEGY                        AVG/MATCH   WORST   BEST");
for (const r of results) {
  console.log(`${r.name.padEnd(30)} ${String(r.avg).padStart(9)} ${String(r.worst).padStart(8)} ${String(r.best).padStart(7)}`);
}

const best = results[0];
console.log(`\n── ${best.name}: where the points come from (vs a tit-for-tat field) ──`);
const d = evaluate(CANDIDATES[best.name], { detail: true, variantIndex: 0 });
let tot = 0, n = 0;
for (const row of d.rows) {
  console.log(`  vs ${row.vs.padEnd(22)} ×${String(row.teams).padStart(2)}   ${String(row.avg).padStart(6)} pts/match`);
  tot += row.avg * row.teams; n += row.teams;
}
console.log(`  weighted average: ${(tot / n).toFixed(1)}`);
