/**
 * Week 2 — Gradient Trading. The rules, written once.
 *
 * ONE game. A differentiable function f is drawn on a hidden domain. Its global
 * minimum sits at x*, drawn from a normal distribution with mean 500 and
 * standard deviation 100, and x* is the settlement price of the only contract
 * on the board: one lot pays x* dollars at the end of the round.
 *
 * Everyone starts with the same cash and ONE private point on the curve, with
 * its gradient. More points cost money. The market aggregates what the room
 * knows; the leaderboard pays whoever read it best.
 *
 * ── What players are NOT told ───────────────────────────────────────────
 * The domain of f, the range of f, the settlement bounds, and the distribution
 * x* was drawn from. They are blind apart from the points they have paid for
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
 *   gradient   — the curve game. Ticks of 5. Settlement is x*, the location of
 *                the hidden minimum, drawn N(500, 100) on a domain of
 *                [0, 1000]. Nobody, including the admin, can move it: it is
 *                fixed when the round is created and proved correct then.
 *   prediction — a plain prediction market on a question the admin writes,
 *                forced to ticks of 1 settling between 0 and 100, so the price
 *                reads as a probability in percent. No curve, no points, no
 *                lottery; the admin resolves it when the clock stops.
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
    blurb: "Hunt the minimum of a hidden function. Settles at x*, automatically, with no say from you.",
    hasCurve: true,
    settleMin: 0,
    settleMax: 1000,
    tick: 5,
    ladderPad: 8,
    /** Where the ladder opens, and the only hint about the range players see. */
    center: 500,
    /** x* ~ N(mean, sd), clamped a hair inside the domain. */
    xStarMean: 500,
    xStarSd: 100,
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

/** The curve's domain is exactly the settlement range of its mode. */
export function domainFor(mode) {
  const m = MODES[mode] ?? MODES.gradient;
  return { lo: m.settleMin, hi: m.settleMax, mean: m.xStarMean ?? (m.settleMin + m.settleMax) / 2, sd: m.xStarSd ?? (m.settleMax - m.settleMin) / 10 };
}

export const GAME = {
  key: "gradient",
  name: "Gradient Trading",
  subtitle: "One unknown function · one hidden minimum",
  icon: "📉",
};

/** Money is integer CENTS everywhere on the server. Never floats. */
export const MONEY = {
  startCashC: 10_000_000, // $100,000.00
  /** One more point, anywhere you like. */
  probeCostPct: 0.05,
  /**
    * One gradient-descent step from a point you own. A FLAT fee, not a share
    * of cash: the other two get cheaper as you spend, so late in a round they
    * cost a broke player almost nothing. A fixed price means a step is a real
    * decision at every stack size, and it is the only purchase whose cost does
    * not shrink as you lose.
    */
  descentCostC: 100_000, // $1,000.00
  /** One lottery ticket. */
  ticketCostPct: 0.05,
  /** Chance the lottery ticket reveals the entire function. */
  revealOdds: 20,
};

export const LIMITS = {
  teamSize: 4,
  teamNameMax: 20,
  codeLength: 4,
  maxLotsPerOrder: 50,
  maxOrdersPerPlayer: 40,
  maxOpenOrders: 4000,
  maxPointsPerPlayer: 60,
  tapeLength: 80,
  fillsKept: 40,
  nameMin: 2,
  nameMax: 18,
  /** A single probe cannot jump further than this, so nobody can binary-search
   *  the edges of the domain for the price of one point. */
  maxProbeStep: 250,
  /** Learning rates the descent slider spans, log-scaled between them. */
  learningRate: [0.01, 10000],
};

/**
 * Difficulty presets the admin picks from.
 *
 * Every length here is written in units of ONE HUNDREDTH OF THE DOMAIN, so the
 * presets read the same whatever the domain is and makeCurve scales them once.
 * `lambda` is how much of the random texture (sines, cosines, a high-degree
 * polynomial, an exponential, decoy dips) rides on the convex core; the well
 * under x* is then dug exactly deep enough to keep the global minimum where it
 * belongs, so a harder curve is never a wrong curve. See shared/curve.js.
 */
export const DIFFICULTIES = {
  parabola: {
    key: "parabola",
    name: "Parabola",
    blurb: "A clean quadratic. The gradient points straight at the answer.",
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
    blurb: "Everything at once. Local minima that look exactly like the real one.",
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

export const RULES_TEXT = `**The contract.** One lot settles at **x\\***, the x-coordinate of the global minimum of a hidden function f. The price you pay is a guess at where the bottom is. Nobody tells you the domain, the range, or what f looks like — that is the whole game.

**What you start with.** $100,000 each and exactly one point on the curve: its x, its height f(x), and its gradient f'(x) — drawn as an arrow and printed as a number. Your point is yours alone. Everyone else got a different one.

**Buying information.** Three things to spend on. The point and the ticket cost a share of your *current* cash, so they get cheaper as you spend; the descent is a flat fee:
· **a point anywhere** — 5%. Pick an x-offset from a point you already own.
· **one step of gradient descent** — a flat **$1,000**. Pick a learning rate; the step is −rate × f'(x) from the point you pick. A fixed price, so it stays a real decision however much you have left.
· **a lottery ticket** — 5%, for a 1-in-20 chance to see the **entire function**.

**Trading.** Click the bid column to post a 1-lot bid at that tick, the ask column to post a 1-lot offer. Cross the book and you trade immediately against the best resting price. Price–time priority, no self-trading. The ladder scrolls as far as you like in both directions.

**Money you must actually have.** A resting order ties up the most it could ever cost you, so you can never be filled into a negative balance. You will see exactly how much each order is holding.

**Teams.** Up to four players per team. You keep your own money, your own position and your own points — a teammate is a separate trader you happen to be scored with, and you may trade with them. The leaderboard ranks the sum of a team's members.

**The end.** When the clock hits zero the curve is revealed — spreading outward from the last point you saw — the minimum is marked, every lot settles at x*, and the leaderboard is final. Final score = cash + lots × x*.`;

export const PREDICTION_RULES = `**The contract.** One lot settles at whatever the market's question resolves to, on a 0–100 scale in ticks of 1. A yes/no question resolves at **100** for yes and **0** for no, so the price is the room's probability in percent. Some questions resolve somewhere in between.

**What you start with.** $100,000 each.

**Trading.** Click the bid column to post a 1-lot bid at that tick, the ask column to post a 1-lot offer. Cross the book and you trade immediately against the best resting price. Price–time priority, no self-trading.

**Money you must actually have.** A resting bid reserves price × lots. A resting offer reserves (100 − price) × lots, because that is the worst a short lot can cost when settlement is capped at 100. You can never be filled into a negative balance.

**Teams.** Up to four players per team. You keep your own money and your own P&L; the leaderboard ranks the sum of a team's members.

**The end.** When the clock stops, trading stops. The admin resolves the question, every lot settles there, and the leaderboard is final. Final score = cash + lots × the resolution.`;

export const GRADIENT_TIP = `f is differentiable everywhere you can stand on it. A gradient of zero means you are on a critical point — but on the harder curves that is not proof you are on THE minimum.`;
