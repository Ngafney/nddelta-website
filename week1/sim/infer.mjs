/**
 * Step 1 — reverse-engineer every opponent from the results CSV.
 *
 * We know exactly what george3's bot did against each opponent (its defect
 * count and cooperation rate), and Axelrod's payoffs are linear, so the
 * opponent's behaviour is recoverable by solving two equations.
 *
 * Per match (200 rounds): let D = rounds george3 DEFECTED, C = 200 - D.
 *   x = rounds the opponent COOPERATED while george3 defected
 *   y = rounds the opponent COOPERATED while george3 cooperated
 *
 *   george3 points  = 5x + 1(D-x) + 3y + 0(C-y)  =  4x + D + 3y
 *   opponent points = 0x + 1(D-x) + 3y + 5(C-y)  =  D - x + 5C - 2y
 *
 * Solving those gives how often each opponent cooperated, split by what
 * george3 had just done — which is exactly what distinguishes an
 * unconditional bot from a reciprocator.
 */
import fs from "node:fs";

const CSV = "C:/Users/georg/Downloads/george3_prisoners-dilemma_results.csv";
const ROUNDS = 200;

const rows = fs.readFileSync(CSV, "utf8").trim().split(/\r?\n/).slice(1).map((line) => {
  // team names can contain spaces/+ but not commas in this export
  const p = line.split(",");
  return {
    opponent: p[0],
    matches: +p[1],
    mine: +p[2],
    theirs: +p[3],
    result: p[4],
    myCoopPct: +p[5],
    myDefectsTotal: +p[6],
  };
});

const out = [];
for (const r of rows) {
  const D = r.myDefectsTotal / r.matches;       // my defect rounds per match
  const C = ROUNDS - D;                          // my coop rounds per match
  // 4x + 3y = mine - D        and       x + 2y = D + 5C - theirs
  const k1 = r.mine - D;
  const k2 = D + 5 * C - r.theirs;
  // 4x + 3y = k1 ; x + 2y = k2  →  x = (2*k1 - 3*k2)/5 , y = (4*k2 - k1)/5
  const x = (2 * k1 - 3 * k2) / 5;
  const y = (4 * k2 - k1) / 5;
  const coopAfterMyDefect = D > 0.5 ? x / D : null;  // P(they coop | I defected)
  const coopAfterMyCoop = C > 0.5 ? y / C : null;    // P(they coop | I cooperated)
  const totalCoop = (x + y) / ROUNDS;

  let type;
  if (totalCoop > 0.97) type = "ALWAYS COOPERATE";
  else if (totalCoop < 0.03) type = "ALWAYS DEFECT";
  else if (coopAfterMyCoop != null && coopAfterMyDefect != null && coopAfterMyCoop - coopAfterMyDefect > 0.25)
    type = "RECIPROCATOR (tit-for-tat-like)";
  else if (totalCoop > 0.8) type = "MOSTLY COOPERATE";
  else if (totalCoop < 0.25) type = "MOSTLY DEFECT";
  else type = "MIXED";

  out.push({ ...r, D: +D.toFixed(1), x: +x.toFixed(1), y: +y.toFixed(1),
    pCoopAfterMyDefect: coopAfterMyDefect == null ? null : +coopAfterMyDefect.toFixed(3),
    pCoopAfterMyCoop: coopAfterMyCoop == null ? null : +coopAfterMyCoop.toFixed(3),
    totalCoop: +totalCoop.toFixed(3), type });
}

console.log("opponent".padEnd(24), "type".padEnd(32), "coop%", " P(coop|I coop)", "P(coop|I defect)");
for (const o of out.sort((a, b) => b.totalCoop - a.totalCoop)) {
  console.log(
    o.opponent.padEnd(24),
    o.type.padEnd(32),
    String((o.totalCoop * 100).toFixed(0)).padStart(4),
    String(o.pCoopAfterMyCoop ?? "—").padStart(14),
    String(o.pCoopAfterMyDefect ?? "—").padStart(16),
  );
}

const tally = {};
for (const o of out) tally[o.type] = (tally[o.type] ?? 0) + 1;
console.log("\nFIELD COMPOSITION:", JSON.stringify(tally, null, 0));
fs.writeFileSync("sim/inferred.json", JSON.stringify(out, null, 1));
