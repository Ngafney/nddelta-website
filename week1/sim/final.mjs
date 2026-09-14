/**
 * Step 7 — the five deliverables, verified end to end.
 *
 * Each is written as plain English a student would type. We send it to the
 * LIVE in-game compiler, take the code the AI actually writes, and score THAT
 * against the reconstructed field. Nothing ships unless the AI's own version
 * of it performs.
 */
import { newTeam, verify } from "./verify-prompt.mjs";

export const STRATEGIES = {
  "1. THE READER": `For the first 4 rounds, cooperate. On round 4, defect once as a deliberate test. From round 5 through round 10, cooperate again. From round 11 onwards, decide like this: if the opponent has never cooperated even once, defect for the rest of the match. Otherwise, look at their whole history and compare how often they defect in the round right after I defected versus in the round right after I cooperated. If they defect a lot more after I defect (at least 20 percentage points more), treat them as a retaliator: cooperate with them, except defect if they defected in both of the last two rounds. If they do not defect noticeably more after I defect, treat them as a pushover and defect every remaining round. Also defect on the final two rounds of the match no matter what.`,

  "2. MIRROR READER": `For the first 4 rounds, cooperate. On round 4, defect once as a test. From round 5 through round 10, cooperate again. From round 11 onwards: if the opponent has never cooperated at all, defect for the rest of the match. Otherwise compare how often the opponent defects in the round right after I defected versus in the round right after I cooperated. If they defect at least 20 percentage points more after I defect, they are a retaliator, so copy whatever they did last round. If they do not react to my defections, defect for every remaining round. Always defect on the final two rounds.`,

  "3. DOUBLE READER": `Cooperate on rounds 0 through 3. Defect on round 4 as a first test. Cooperate on rounds 5 through 10. Defect once more on round 30 as a second test. Cooperate on rounds 31 through 36. From round 11 onwards (except those test rounds): if the opponent has never cooperated once, defect for the rest of the match. Otherwise compare how often they defect in the round right after I defected versus right after I cooperated; if they defect at least 20 percentage points more after I defect, they are a retaliator, so cooperate with them unless they defected in both of the last two rounds. If they do not react to my defections, defect every remaining round. Always defect on the last two rounds.`,

  "4. LATE READER": `Cooperate on every round from 0 through 11. On round 12, defect once as a test. Cooperate on rounds 13 through 18. From round 19 onwards: if the opponent has never cooperated at all, defect for the rest of the match. Otherwise compare how often the opponent defects in the round right after I defected versus in the round right after I cooperated. If they defect at least 20 percentage points more after I defect, treat them as a retaliator and cooperate, except defect if they defected on both of the last two rounds. If they do not react to my defections, defect for every remaining round. Always defect on the final two rounds.`,

  "5. CAUTIOUS READER": `Cooperate on rounds 0 through 5. Defect on rounds 6 and 7 as a two-round test. Cooperate on rounds 8 through 13. From round 14 onwards: if the opponent has never cooperated, defect for the rest. Otherwise compare how often the opponent defects right after I defect versus right after I cooperate. If they defect at least 30 percentage points more after I defect, they are a retaliator, so cooperate with them, but defect if they defected on both of the last two rounds. If they barely react to my defections, defect for every remaining round. Defect on the final three rounds regardless. Also, if at any point after round 20 the opponent has defected in more than 60 percent of all rounds so far, defect for the rest of the match.`,
};

const auth = await newTeam();
console.log("verifying 5 strategies through the LIVE compiler…\n");
const out = [];
for (const [name, prompt] of Object.entries(STRATEGIES)) {
  const r = await verify(auth, name, prompt);
  out.push(r);
  if (!r.ok) { console.log(`${name}  ✗ ${r.reason}`); continue; }
  console.log(`${name}`);
  console.log(`   avg ${r.avg}   worst ${r.worst}   best ${r.best}`);
  console.log(`   AI read it as: ${r.explain}`);
  const key = r.rows.filter((x) => ["RS/ava/pl", "reciprocators", "defectors"].includes(x.vs));
  console.log("   " + key.map((k) => `${k.vs}=${k.avg}`).join("  "));
  console.log("");
}
out.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1));
console.log("RANKING:");
for (const r of out) console.log(`  ${(r.avg ?? "FAIL").toString().padStart(6)}  ${r.name}`);
