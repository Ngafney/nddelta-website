/**
 * How fast is a 10,000-game bandit run, and what do the textbook strategies
 * score? `node bench.mjs` — handy for sanity-checking the leaderboard scale.
 */
import { prepareCode, runMany } from "./shared/bandit.js";

const strategies = {
  random: `return lib.floor(state.rng() * 5);`,
  explore15: `if (state.flip < 15) return state.flip % 5;\nreturn lib.argmax(state.coins.map(c => c.rate));`,
  greedy: `return lib.argmax(state.coins.map(c => c.flips === 0 ? 2 : c.rate));`,
  ucb: `const u = state.coins.map(c => c.flips === 0 ? 1e9 : c.rate + lib.sqrt(2 * lib.log(state.flip + 1) / c.flips));\nreturn lib.argmax(u);`,
  thompson: `return lib.argmax(state.coins.map(c => state.betaSample(c.heads + 1, c.tails + 1)));`,
  rejectedLoop: `for (;;) {}`,
  arrayIsAFineName: `const array = [1]; return array[0];`,
};

for (const [k, src] of Object.entries(strategies)) {
  const p = prepareCode(src);
  if (!p.ok) {
    console.log(k.padEnd(18), "REJECTED:", p.error);
    continue;
  }
  const s = runMany(p.run, "bench");
  console.log(k.padEnd(18), `avg $${s.avg}`.padEnd(14), `${s.oraclePct}% of oracle`.padEnd(18), `sd ${s.sd}`.padEnd(12), `${s.ms} ms`);
}
