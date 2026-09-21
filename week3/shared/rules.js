/**
 * Week 3 — Probability. The rules, written once.
 *
 * Two games share one app, one join, one set of teams:
 *
 *   COIN MARKET  — a coin with a hidden probability of heads p is drawn at the
 *                  start of the round. Before trading opens every player gets a
 *                  short window to buy SIMULATIONS (one flip of that coin each)
 *                  at a flat price. Then the whole room trades a contract on the
 *                  Week 2 order book, quoted 1–99 like a prediction market, and
 *                  it settles either at 100·p or at one final flip (the admin
 *                  picks). Information costs money; money is what you quote
 *                  with. That tension is the game.
 *
 *   BANDIT LAB   — the classic five-coin multi-armed bandit. Every coin's
 *                  probability of heads is drawn uniformly from 0–1 and hidden.
 *                  100 flips, $100 per heads. Teams describe a strategy in plain
 *                  English, the AI writes the code, and it plays 10,000 shared
 *                  games for the leaderboard.
 *
 * Players sit in TEAMS of up to four. A team is a scoring unit: in the market
 * every member trades their own money and the team scores the AVERAGE; in the
 * bandit lab the team shares one strategy library and one best score.
 */

/**
 * The market's single mode. The engine reads settleMin/settleMax/tick from
 * here; unlike week 2 nothing about the range is secret — a probability lives
 * between 0 and 100 and everyone knows it — so the ladder simply runs 1–99.
 */
export const MODES = {
  coin: {
    key: "coin",
    name: "Coin Market",
    icon: "🪙",
    blurb: "Buy simulations of a hidden coin, then trade what it is worth.",
    settleMin: 0,
    settleMax: 100,
    tick: 1,
    ladderPad: 0,
    orderMin: 1,
    orderMax: 99,
    center: 50,
  },
};

export const MODE_ORDER = ["coin"];

/**
 * How the hidden probability p is drawn. Beta(a, b); a = b = 1 is uniform.
 * Measured spread of p over many draws (in points on the 0–100 ladder):
 * uniform ≈ 29, Beta(½,½) ≈ 35, Beta(0.3,0.3) ≈ 39.
 */
export const PRIORS = {
  uniform: {
    key: "uniform",
    name: "Uniform",
    blurb: "Every p from 0 to 1 equally likely. Spread ≈ 29 points.",
    a: 1,
    b: 1,
  },
  beta05: {
    key: "beta05",
    name: "Beta(½, ½)",
    blurb: "U-shaped: extreme coins are common. Spread ≈ 35 points.",
    a: 0.5,
    b: 0.5,
  },
  beta03: {
    key: "beta03",
    name: "Beta(0.3, 0.3)",
    blurb: "Very U-shaped: most coins sit near 0 or near 1. Spread ≈ 39 points.",
    a: 0.3,
    b: 0.3,
  },
};

export const PRIOR_ORDER = ["uniform", "beta05", "beta03"];

/** What one share pays at the bell. */
export const SETTLEMENTS = {
  prob: {
    key: "prob",
    name: "The true probability",
    blurb: "Each share pays 100 × p. If p = 0.37, a share pays $37.",
  },
  flip: {
    key: "flip",
    name: "One final flip",
    blurb: "The coin is flipped once more: heads pays $100 a share, tails pays $0.",
  },
};

export const SETTLEMENT_ORDER = ["prob", "flip"];

/** Money is integer CENTS everywhere on the server. Never floats. */
export const MONEY = {
  startCashC: 1_000_000, // $10,000.00
  simCostC: 10_000, // $100.00 per simulated flip
};

export const SIMS = {
  /** The most flips one player can buy in a round. $100 × 100 = the whole stack. */
  max: 100,
  /** Default length of the pre-trading simulation window. */
  seconds: 120,
};

export const LIMITS = {
  teamSize: 4,
  teamNameMax: 20,
  codeLength: 4,
  maxSharesPerOrder: 50,
  /** How many shares one click buys or sells, unless the admin says otherwise. */
  defaultOrderSize: 10,
  maxOrdersPerPlayer: 40,
  maxOpenOrders: 4000,
  tapeLength: 80,
  fillsKept: 40,
  nameMin: 2,
  nameMax: 18,
  /** Seconds the team code stays up before you can walk onto the floor. */
  codeHoldSeconds: 6,
};

/** The bandit lab. */
export const BANDIT = {
  coins: 5,
  flips: 100,
  /** Dollars per heads. */
  payout: 100,
  simulations: 10_000,
  names: ["A", "B", "C", "D", "E"],
  maxStrategies: 30,
};

/* ── player-facing copy ───────────────────────────────────────────────── */

export const MARKET_RULES = `**The coin.** At the start of the round a coin is made with a hidden probability of heads, **p**, somewhere between 0 and 1. Nobody knows it — not you, not the room.

**The contract.** One share is worth **100 × p** dollars at the bell (or, if the admin says so this round, the coin is flipped one last time and a share pays **$100 on heads, $0 on tails** — the expected value is the same, the variance is not). The ladder runs **1 to 99**, so a price reads as a probability in percent.

**What you start with.** **$10,000**, and nothing else.

**Step 1 — simulations (the clock at the top).** Before anyone trades, you get a short window to decide how many times to flip the coin yourself, at **$100 a flip**, up to 100. Change your mind as often as you like until the clock runs out. Then the flips happen, you see your heads and tails, and the money is gone for good.

More flips, sharper estimate — but every flip is $100 you can no longer quote with. Buy all 100 and you know the coin cold with no money left to trade on it. Buy none and you are trading blind.

**Step 2 — trading.** Click the bid column to buy at that price, the offer column to sell. Cross the book and you trade immediately at the best resting price. Everyone saw different flips, so everyone has a different fair value. That is the whole point.

**Money you must actually have.** A resting bid ties up price × shares. A resting offer ties up (100 − price) × shares, because that is the most a short share can cost you. You can never be filled into a negative balance.

**Teams.** Up to four players per team. You keep your own money, flips and position; the leaderboard ranks each team's **average**.

**The end.** When the clock stops, p is revealed, every share settles, and the leaderboard is final. Final score = cash + shares × settlement.`;

export const BANDIT_RULES = `**Five coins.** Each has its own hidden probability of heads, drawn at random anywhere from 0 to 1. Some are great, some are terrible, and you cannot tell by looking.

**100 flips.** Each flip you pick one coin. Heads pays **$100**, tails pays **$0**. Maximise your total.

**The catch.** To find the good coin you have to spend flips on the bad ones. Explore too little and you commit to a dud; explore too much and you waste flips you could have spent on the winner. This is the **multi-armed bandit** problem — explore versus exploit.

**You don't flip by hand.** Describe a strategy in plain English and the AI writes it as code. You check that it does what you meant, then run it: your strategy plays **10,000 games**, each with five fresh coins, and your **average payout** goes on the board. Every team plays the exact same 10,000 sets of coins, so it is a pure strategy race.

**For scale.** Picking at random averages about **$5,000**. A psychic who always knew the best coin would average about **$8,333**. Where do you land in between?

**Save and iterate.** Save as many strategies as you like to your team's library and re-run them. Only your team's best average counts.`;
