/**
 * Turn a validated spec back into plain English, one line per rule.
 * This is the verification surface: a team that can't read JSON reads
 * this instead, and it is generated from the spec itself — never from
 * the prompt — so it can't flatter the strategy into something it isn't.
 */

const SELECTOR_TEXT = {
  highestMean: "the machine with the highest average payoff so far (trying untried machines first)",
  leastPlayed: "the machine played the fewest times",
  random: "a random machine",
  highestLastPayoff: "the machine whose most recent payoff was largest",
  thompson: "a machine chosen by Thompson sampling (sample each machine's plausible mean, play the best sample)",
  stay: "the same machine you just played",
};

const METRIC_TEXT = {
  mean: "average payoff",
  plays: "number of plays",
  sum: "total winnings",
  last: "most recent payoff",
  max: "single best payoff",
  min: "single worst payoff",
  countPos: "number of winning pulls",
};

export function readback(spec) {
  return spec.rules.map((rule, i) => {
    const cond = condText(rule.if, spec.game);
    const act = actionText(rule.then, spec.game);
    if (rule.if === true) {
      return spec.rules.length === 1 ? `Always ${act}.` : `Otherwise, ${act}.`;
    }
    return `${i === 0 ? "If" : "Else if"} ${cond}: ${act}.`;
  });
}

function condText(cond, game) {
  if (cond === true) return "always";
  if (cond === false) return "never";
  const op = Object.keys(cond)[0];
  const arg = cond[op];
  switch (op) {
    case "and": return arg.map((c) => condText(c, game)).join(" and ");
    case "or": return arg.map((c) => condText(c, game)).join(" or ");
    case "not": return `not (${condText(arg, game)})`;
  }
  const [a, b] = arg;
  const A = refText(a, game);
  const B = refText(b, game);
  const cmp = { lt: "is below", lte: "is at most", gt: "is above", gte: "is at least", eq: "is", neq: "is not" }[op];
  return `${A} ${cmp} ${B}`;
}

function refText(x, game) {
  if (typeof x === "number") return String(x);
  if (typeof x === "string") {
    const names = {
      spinsUsed: "the number of spins used",
      spinsLeft: "the number of spins left",
      total: "your total score",
      lastPayoff: "your last payoff",
      round: "the round number (starting at 0)",
      myScore: "your score",
      oppScore: "the opponent's score",
      myLast: "your last move",
      oppLast: "the opponent's last move",
    };
    return names[x] ?? x;
  }
  if (x.plays !== undefined) return `machine ${x.plays + 1}'s play count`;
  if (x.mean !== undefined) return `machine ${x.mean + 1}'s average payoff`;
  if (x.sum !== undefined) return `machine ${x.sum + 1}'s total payoff`;
  if (x.last !== undefined) return `machine ${x.last + 1}'s most recent payoff`;
  if (x.max !== undefined) return `machine ${x.max + 1}'s best payoff so far`;
  if (x.min !== undefined) return `machine ${x.min + 1}'s worst payoff so far`;
  if (x.countPos !== undefined) return `how many times machine ${x.countPos + 1} paid positive`;
  if (x.countAbove !== undefined) return `how many times machine ${x.countAbove[0] + 1} paid above ${x.countAbove[1]}`;
  if (x.countBelow !== undefined) return `how many times machine ${x.countBelow[0] + 1} paid below ${x.countBelow[1]}`;
  if (x.oppCount !== undefined) return `the opponent's total ${x.oppCount}s`;
  if (x.myCount !== undefined) return `your total ${x.myCount}s`;
  if (x.oppStreak !== undefined) return `the opponent's current ${x.oppStreak} streak`;
  if (x.myStreak !== undefined) return `your current ${x.myStreak} streak`;
  return JSON.stringify(x);
}

function actionText(act, game) {
  if (game === "bandit") {
    const sel = act.play;
    if (typeof sel === "string") return `play ${SELECTOR_TEXT[sel]}`;
    if (sel.fixed !== undefined) return `play machine ${sel.fixed + 1}`;
    if (sel.epsilonGreedy !== undefined)
      return `play a random machine ${Math.round(sel.epsilonGreedy * 100)}% of the time, otherwise the best average so far`;
    if (sel.ucb !== undefined) return `play by UCB with exploration constant ${sel.ucb}`;
    if (sel.best !== undefined) return `play the machine with the highest ${METRIC_TEXT[sel.best] ?? sel.best} so far (trying untried machines first)`;
    if (sel.worst !== undefined) return `play the machine with the lowest ${METRIC_TEXT[sel.worst] ?? sel.worst} so far (trying untried machines first)`;
    return JSON.stringify(sel);
  }
  if (typeof act === "string") return act;
  if (act.mirror) return "copy the opponent's last move";
  if (act.opposite) return "do the opposite of the opponent's last move";
  if (act.chance) {
    const [p, a, b] = act.chance;
    return `${a} with probability ${Math.round(p * 100)}%, otherwise ${b}`;
  }
  return JSON.stringify(act);
}
