/**
 * Week 2 — Gradient Trading. The rules, written once.
 *
 * ONE game. A differentiable function f is drawn on a hidden domain. The
 * contract on the board settles at **y* = min f(x)** — HOW LOW the function
 * gets, not where it gets there — and y* is drawn from a normal distribution
 * with mean 500 and standard deviation 100. One share pays y* dollars at the
 * end of the round.
 *
 * So a player's own points are quoted in the same units as the ladder: if you
 * have seen f(37) = 612, you know the answer is at most 612, and the whole game
 * is working out how much further down it goes.
 *
 * There is exactly ONE thing to buy: another step of gradient descent, at a
 * flat $1,000. One purchase, one price, no menu — the only question a player
 * ever has to answer is how big a step to take, which is the question the game
 * is actually about.
 *
 * ── What players are NOT told ───────────────────────────────────────────
 * The domain of f, the range of f, the settlement bounds, and the distribution
 * y* was drawn from. They are blind apart from the points they have walked to
 * and whatever the room's own quotes imply. Nothing in the player-facing copy,
 * the chart axes, the ladder or an error message names any of those numbers —
 * the admin says as much or as little as they like, out loud.
 *
 * Players sit in TEAMS of up to four. A team is a scoring unit and nothing
 * else: every member keeps their own cash, their own position, their own
 * points, and their own P&L, and members are free to trade with each other.
 * The leaderboard adds a team's members together; the "you" panel never stops
 * showing you your own number.
 */

/**
 * Two modes, one market. The book, the money rules, the teams and the
 * leaderboard are identical; only the price grid and where the settlement
 * comes from change.
 *
 *   gradient   — the curve game. Ticks of 5. Settlement is min f(x), drawn
 *                N(500, 100). Nobody, including the admin, can move it: it is
 *                fixed when the round is created and proved correct then.
 *   prediction — a plain prediction market on a question the admin writes,
 *                forced to ticks of 1 settling between 0 and 100, so the price
 *                reads as a probability in percent. No curve and nothing to
 *                buy; the admin resolves it when the clock stops.
 *
 * ── settleMin/settleMax versus the ladder ───────────────────────────────
 * settleMin and settleMax are where settlement can possibly land, and they are
 * what the margin rules are built on. They are NOT where the ladder stops: the
 * book runs `ladderPad` times the settlement span past both ends, so scrolling
 * never hits a wall and a refused click never discloses a bound. Quoting out
 * there is fully margined and perfectly safe — just a bad idea. See
 * shared/engine.js for why that takes four reserve terms rather than two.
 */
export const MODES = {
  gradient: {
    key: "gradient",
    name: "Gradient Trading",
    icon: "📉",
    blurb: "Trade how low a hidden function gets. Settles itself, with no say from you.",
    hasCurve: true,
    /** Settlement is min f(x), so these bound the VALUE, not the domain. */
    settleMin: 0,
    settleMax: 1000,
    tick: 5,
    ladderPad: 8,
    /** Where the ladder opens, and the only hint about the range players see. */
    center: 500,
    /** The x axis the curve lives on. Nothing to do with the price ladder. */
    xDomain: [0, 100],
    /** y* = min f ~ N(mean, sd), clamped inside the settlement range. */
    yStarMean: 500,
    yStarSd: 100,
    yStarClamp: [20, 980],
    /** How far f climbs above its own floor across the domain. */
    climb: [60, 700],
  },
  prediction: {
    key: "prediction",
    name: "Prediction Market",
    icon: "🎯",
    blurb: "Trade a question. Settles 0 to 100, so the price reads as a probability in percent.",
    hasCurve: false,
    settleMin: 0,
    settleMax: 100,
    tick: 1,
    ladderPad: 4,
    center: 50,
  },
};

export const MODE_ORDER = ["gradient", "prediction"];

/**
 * Everything makeCurve needs: the x axis the function lives on, and the
 * distribution of its minimum VALUE, which is what the market settles on.
 */
export function curveConfigFor(mode) {
  const m = MODES[mode] ?? MODES.gradient;
  const [lo, hi] = m.xDomain ?? [0, 100];
  return {
    lo,
    hi,
    yMean: m.yStarMean ?? (m.settleMin + m.settleMax) / 2,
    ySd: m.yStarSd ?? (m.settleMax - m.settleMin) / 10,
    yClamp: m.yStarClamp ?? [m.settleMin, m.settleMax],
    climb: m.climb ?? [60, 700],
  };
}

export const GAME = {
  key: "gradient",
  name: "Gradient Trading",
  subtitle: "One unknown function · one hidden floor",
  icon: "📉",
};

/** Money is integer CENTS everywhere on the server. Never floats. */
export const MONEY = {
  startCashC: 10_000_000, // $100,000.00
  /**
   * The DEFAULT price of the only thing you can buy: one more step downhill.
   * Flat, so it stays a real decision at every stack size instead of getting
   * cheaper as you lose. The admin can set a different price per round, and
   * the round carries whatever they chose.
   */
  descentCostC: 100_000, // $1,000.00
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
  maxPointsPerPlayer: 60,
  tapeLength: 80,
  fillsKept: 40,
  nameMin: 2,
  nameMax: 18,
  /**
   * How far one step may move, in domain units. A cap is what stops anyone
   * binary-searching the edges of a domain they are supposed to be blind to
   * for the price of a single step.
   */
  maxStep: 25,
  /** Learning rates the slider spans, log-scaled between them. */
  learningRate: [0.0001, 1000],
  /** Seconds the team code stays up before you can walk onto the floor. */
  codeHoldSeconds: 6,
};

/**
 * Difficulty presets the admin picks from.
 *
 * Every length here is written in units of ONE HUNDREDTH OF THE DOMAIN, so the
 * presets read the same whatever the domain is and makeCurve scales them once.
 * `lambda` is how much of the random texture (sines, cosines, a high-degree
 * polynomial, an exponential, decoy dips) rides on the convex core; the well
 * under the minimum is then dug exactly deep enough to keep the global minimum
 * where it belongs, so a harder curve is never a wrong curve. See curve.js.
 */
export const DIFFICULTIES = {
  parabola: {
    key: "parabola",
    name: "Parabola",
    blurb: "A clean quadratic. Walk downhill and you are there.",
    lambda: 0,
    sines: 0,
    decoys: 0,
    polyDeg: 0,
    exp: false,
    wellWidth: [14, 14],
    maxOmega: 0,
  },
  tilted: {
    key: "tilted",
    name: "Tilted",
    blurb: "A quadratic with a lazy wave and a cubic lean. Still honest.",
    lambda: 0.55,
    sines: 1,
    decoys: 0,
    polyDeg: 3,
    exp: false,
    wellWidth: [10, 16],
    maxOmega: 0.14,
  },
  wavy: {
    key: "wavy",
    name: "Wavy",
    blurb: "Sines on top of a shallow bowl. Your slope can lie locally.",
    lambda: 0.78,
    sines: 2,
    decoys: 1,
    polyDeg: 4,
    exp: true,
    wellWidth: [8, 14],
    maxOmega: 0.3,
  },
  rugged: {
    key: "rugged",
    name: "Rugged",
    blurb: "Decoy valleys, a flat floor and an exponential drift. Nasty.",
    lambda: 0.9,
    sines: 3,
    decoys: 2,
    polyDeg: 6,
    exp: true,
    wellWidth: [6, 12],
    maxOmega: 0.48,
  },
  diabolical: {
    key: "diabolical",
    name: "Diabolical",
    blurb: "Everything at once. False bottoms that look exactly like the real one.",
    lambda: 1,
    sines: 4,
    decoys: 3,
    polyDeg: 7,
    exp: true,
    wellWidth: [5, 10],
    maxOmega: 0.72,
  },
};

export const DIFFICULTY_ORDER = ["parabola", "tilted", "wavy", "rugged", "diabolical"];

/* ── player-facing copy. Names no bound, no range, no distribution. ───── */

export const RULES_TEXT = `**The contract.** One share settles at **min f(x)** — how low a hidden function gets. Not *where* it gets there: the number you are trading is a **height**, on the same scale as the prices on the ladder.

**What you start with.** $100,000 and one point on the curve: its x, its height **f(x)**, and its gradient f'(x) — drawn as an arrow pointing **downhill** and printed as a number. Your point is yours alone; everyone else got a different one.

So you already know something. The answer is **at or below** the lowest height you have seen. The game is working out how much further down it goes — and whether the room agrees with you.

**The one thing you can buy.** One step of gradient descent, from a point you own, for a flat **$1,000**:

> x ← x − rate × f'(x)

You pick the learning rate and see exactly where the step lands before you pay. Too small and you creep; too large and you sail past the bottom and up the far side. Nothing else is for sale — everything you learn, you walk to, and every dollar of walking comes off your score.

**Trading.** Click the bid column to post a 1-share bid at that tick, the ask column to offer there. Cross the book and you trade immediately at the best resting price. Price–time priority, no trading with yourself. The ladder scrolls as far as you like in both directions.

**Money you must actually have.** A resting order ties up the most it could ever cost you, so you can never be filled into a negative balance. Each order shows exactly what it is holding.

**Teams.** Up to four players per team. You keep your own money, your own position and your own points — a teammate is a separate trader you happen to be scored with, and you may trade with them. The leaderboard ranks the sum of a team's members.

**The end.** When the clock hits zero the curve is revealed, spreading outward from the last point you saw, the floor is marked, every share settles at min f, and the leaderboard is final. Final score = cash + shares × min f.`;

export const PREDICTION_RULES = `**The contract.** One share settles at whatever the market's question resolves to, on a 0–100 scale in ticks of 1. A yes/no question resolves at **100** for yes and **0** for no, so the price is the room's probability in percent. Some questions resolve somewhere in between.

**What you start with.** $100,000 each.

**Trading.** Click the bid column to post a 1-share bid at that tick, the ask column to offer there. Cross the book and you trade immediately at the best resting price. Price–time priority, no trading with yourself.

**Money you must actually have.** A resting bid reserves price × shares. A resting offer reserves (100 − price) × shares, because that is the worst a short share can cost when settlement is capped at 100. You can never be filled into a negative balance.

**Teams.** Up to four players per team. You keep your own money and your own P&L; the leaderboard ranks the sum of a team's members.

**The end.** When the clock stops, trading stops. The admin resolves the question, every share settles there, and the leaderboard is final. Final score = cash + shares × the resolution.`;

export const GRADIENT_TIP = `f is differentiable everywhere you can stand on it, and the arrow always points downhill. A gradient of zero means you have stopped on a critical point — but on the harder curves a flat spot is not proof you are at THE bottom, only at A bottom.`;
