/**
 * Step 5 — tune the reader. Sweep the probe timing, the retaliation threshold
 * and the early bail-out against the full field (all reciprocator hypotheses).
 */
import { evaluateRobust, evaluate } from "./engine.mjs";

export const build = ({ openC = 6, probes = 2, settle = 14, thresh = 0.25, bail = 3, endgame = 0, steady = true }) => `
if (state.round >= ${bail} && state.oppCoops === 0) return "DEFECT";
if (state.round < ${openC}) return "COOPERATE";
if (state.round < ${openC + probes}) return "DEFECT";
if (state.round < ${settle}) return "COOPERATE";
${endgame ? `if (state.round >= state.rounds - ${endgame}) return "DEFECT";` : ""}
var opp = state.oppMoves;
var mine = state.myMoves;
var afterD = opp.filter((m, i) => i > 0 && mine[i - 1] === "DEFECT");
var afterC = opp.filter((m, i) => i > 0 && mine[i - 1] === "COOPERATE");
var pdd = afterD.filter((m) => m === "DEFECT").length / lib.max(1, afterD.length);
var pdc = afterC.filter((m) => m === "DEFECT").length / lib.max(1, afterC.length);
if (pdd - pdc > ${thresh}) {
${steady
  ? `  var l2 = opp.slice(-2);
  if (l2.length === 2 && l2[0] === "DEFECT" && l2[1] === "DEFECT") return "DEFECT";
  return "COOPERATE";`
  : `  return state.oppLast;`}
}
return "DEFECT";`;

const grid = [];
for (const openC of [4, 6]) {
  for (const probes of [1, 2]) {
    for (const thresh of [0.2, 0.3]) {
      for (const steady of [true, false]) {
        for (const endgame of [0, 2]) {
          const cfg = { openC, probes, settle: openC + probes + 6, thresh, bail: 3, endgame, steady };
          const r = evaluateRobust(build(cfg));
          if (r.ok) grid.push({ cfg, avg: r.avg, worst: r.worst });
        }
      }
    }
  }
}
grid.sort((a, b) => b.avg - a.avg);
console.log("TOP 12 CONFIGURATIONS (avg across every reciprocator hypothesis)");
console.log("open probes thresh steady endgame |    avg   worst");
for (const g of grid.slice(0, 12)) {
  const c = g.cfg;
  console.log(
    `${String(c.openC).padStart(4)} ${String(c.probes).padStart(6)} ${String(c.thresh).padStart(6)} ${String(c.steady).padStart(6)} ${String(c.endgame).padStart(7)} | ${String(g.avg).padStart(6)} ${String(g.worst).padStart(7)}`
  );
}
const best = grid[0];
console.log("\nBEST CONFIG:", JSON.stringify(best.cfg));
console.log("\n── breakdown (tit-for-tat field) ──");
const d = evaluate(build(best.cfg), { detail: true, variantIndex: 0 });
for (const row of d.rows) console.log(`  vs ${row.vs.padEnd(22)} ×${String(row.teams).padStart(2)}   ${String(row.avg).padStart(6)}`);
