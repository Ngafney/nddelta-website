/**
 * Week 4 — Monte Carlo. The rules, written once.
 *
 * A real asteroid, really detected before it hit, really tracked for a few
 * hours, and it really did land somewhere. You are put back at the moment the
 * warning went out: there is a corridor across the ground, an uncertainty
 * ellipse on it, and a line of latitude. North of the line or south of it?
 *
 * WHAT THE ROUND ASKS OF A TEAM
 * -----------------------------
 * Exactly one thing: turn an uncertainty into a price. Draw from the published
 * covariance, walk each draw down the corridor, count which side it lands on,
 * and that fraction is what NORTH is worth.
 *
 * WHAT IT DELIBERATELY DOES NOT ASK
 * ---------------------------------
 * Orbit determination. The first version handed out three years of noisy
 * astrometry and asked the room to fit a sungrazing asteroid — a hard inverse
 * problem that ate the whole session and that nobody solved, me included. The
 * Monte Carlo was never the hard part; the fitting was. So the fitting is gone.
 *
 * WHY IT IS NOT JUST Φ(z)
 * -----------------------
 * Latitude is a curved function of distance along a great circle. A Gaussian
 * spread along the corridor comes out skewed in latitude, and near the track's
 * highest point it is not even single-peaked. A team that reaches for a normal
 * approximation gets a confidently wrong price; a team that samples gets the
 * right one. Real geometry, not a trick.
 */

import { EVENT_KEYS } from "./events.js";

/** The two books. The order here is the order they appear on screen. */
export const MARKETS = ["north", "south"];

export const MARKET_META = {
  north: {
    key: "north",
    name: "NORTH",
    long: "Lands NORTH of the line",
    blurb: "Pays $100 a share if the impact point is north of the line.",
  },
  south: {
    key: "south",
    name: "SOUTH",
    long: "Lands SOUTH of the line",
    blurb: "Pays $100 a share if the impact point is south of the line.",
  },
};

/** One grid for both books. Nothing here is secret. */
export const BOOK = { settleMin: 0, settleMax: 100, tick: 1, orderMin: 1, orderMax: 99, center: 50 };

/** Money is integer CENTS on the server. Never floats. */
export const MONEY = { startCashC: 1_000_000 }; // $10,000.00

export const LIMITS = {
  teamSize: 4,
  teamNameMax: 20,
  codeLength: 4,
  maxSharesPerOrder: 50,
  defaultOrderSize: 10,
  // A safety rail, not the binding constraint - margin runs out first, and how
  // much sooner depends entirely on whether you hedge. Forty one-sided bids
  // near 50 would need $20,000 and you have $10,000; forty orders paired
  // NORTH-against-SOUTH cost almost nothing, because one of the pair is going
  // to pay. Reaching this number at all means you worked that out.
  maxOrdersPerPlayer: 40,
  maxOpenOrders: 4000,
  tapeLength: 80,
  fillsKept: 40,
  nameMin: 2,
  nameMax: 18,
  /** How long a freshly issued team code stays on screen before it is hidden. */
  codeHoldSeconds: 6,
};

/* ── the scenario ─────────────────────────────────────────────────────── */

export const SCENARIO = {
  events: EVENT_KEYS,
  /**
   * Along-track sigma at the FIRST release, in km. Modelled.
   *
   * A few hundred kilometres is what an impact corridor looks like when an
   * object has been tracked for a handful of hours — long enough to know the
   * direction of approach well, not long enough to pin the arrival time. The
   * SHAPE (long, thin, tilted) matters more than the scale, and the line is
   * then placed to make the question as hard as the operator asked for.
   */
  // Long on purpose, and this is the number the whole week turns on.
  //
  // The lesson is "simulate, do not reach for PHI(z)", so the honest test is how
  // many points the shortcut actually costs. Measured over real rounds, on the
  // line the placer picks and the data the room opens with:
  //
  //       600 km   under 1 point      an assertion, not an edge
  //      1000 km   1.4 points
  //      1500 km   2.5 points
  //      2400 km   4.2 points         four ticks, and worth taking
  //
  // These are smaller than the same measurement taken over the BEST line for
  // each event (3-9 points at 1500 km), because line placement spends some of
  // the nonlinearity buying the difficulty the operator asked for. The tails
  // are where a Gaussian is most wrong and also where nobody is uncertain, so
  // the two goals genuinely compete and this is the settlement between them.
  //
  // It is also the more honest figure physically. These objects are found hours
  // out on arcs of minutes, and arrival TIME is the least constrained thing
  // about them, so the first corridor published for one really does run for
  // thousands of kilometres - 2018 LA's crossed southern Africa and an ocean.
  sigma0Km: 2400,
  /** How many times narrower the ellipse is across the corridor than along it. */
  ratio: 6,
  /** A tilt, so the two components are correlated and cannot be sampled apart. */
  tiltDeg: 12,
  /**
   * What each successive release multiplies sigma by — more observations, a
   * longer arc, a tighter solution.
   */
  // This schedule is fixed by the brief, not by taste. "About 65% confident at
  // six months, rising to about 90% by one month" is a demand about sigma: at a
  // fixed line, 65% is a 0.39-sigma question and 90% is a 1.28-sigma one, so
  // sigma has to come down by a factor of about 3.3 across the round. Ending at
  // 0.57, as an earlier version did, buys a factor of 1.75 - not enough, and
  // the consequence was not a subtle mispricing but an unplayable round: line
  // placement could not find any line that opened uncertain AND closed decided,
  // so it fled to lines twelve degrees away where the answer was never in
  // doubt. Measured, 14 rounds in a row opening at 99-100%.
  shrink: [1, 0.8, 0.63, 0.5, 0.4, 0.31],
  /** Monte Carlo draws the SERVER uses to price and to settle. */
  draws: 20000,
};

export const CONFIDENCE = {
  defaultStart: 0.65,
  defaultEnd: 0.9,
  range: [0.52, 0.95],
};

/* ── phases ───────────────────────────────────────────────────────────── */

export const PHASES = {
  lobby: { key: "lobby", name: "LOBBY", blurb: "Waiting for the operator." },
  research: { key: "research", name: "RESEARCH", blurb: "Data is out. Books are shut. Work." },
  live: { key: "live", name: "TRADING", blurb: "Both books are open." },
  ended: { key: "ended", name: "IMPACT", blurb: "Books shut. It is arriving." },
  settled: { key: "settled", name: "SETTLED", blurb: "It landed. Count the money." },
};

export const TIMERS = {
  defaultResearchMinutes: 15,
  defaultTradingMinutes: 20,
  minMinutes: 0.5,
  maxMinutes: 180,
};

/* ── the noise traders ────────────────────────────────────────────────── */

export const BOTS = {
  slots: [
    { key: "north-buy", market: "north", side: "B", label: "BUY NORTH" },
    { key: "north-sell", market: "north", side: "A", label: "SELL NORTH" },
    { key: "south-buy", market: "south", side: "B", label: "BUY SOUTH" },
    { key: "south-sell", market: "south", side: "A", label: "SELL SOUTH" },
  ],
  maxShares: 500,
  minSeconds: 2,
  maxSeconds: 600,
  maxSweep: 25,
  name: "SURVEY DESK",

  /**
   * The desk also leaves a standing two-sided quote in both books.
   *
   * Without this there is nothing to trade against. The four slots above only
   * TAKE liquidity - they fire a market order and cancel whatever does not
   * fill - so a round opened with no resting orders stayed empty until a human
   * posted one, and the first thing anyone tries is to buy. A playtester priced
   * the market correctly to within a point, found nothing on the other side of
   * either book, and reported the trading half as unplayable. Fairly.
   *
   * The quote is deliberately IGNORANT: anchored at 50 in both books, never
   * moved by the data, never moved by the news. That makes it the thing a team
   * with a real number is playing against, which is the point of the week.
   *
   * The spread is what keeps it from being free money in a way that teaches
   * nothing. Anchored at 50 with an 8-tick half-spread, the two books quote
   * 42 bid / 58 offer each: buying both sides costs 116 to collect 100, and
   * selling both collects 84 to owe 100. So there is no arbitrage against the
   * desk itself - the only way to take its money is to be right about where
   * the rock came down.
   */
  maker: {
    anchor: 50,
    halfSpread: 8,
    shares: 15,
    refreshSec: 15,
  },
};

/* ── player-facing copy ───────────────────────────────────────────────── */

export const RULES_TEXT = `**This really happened.** Every round is a real asteroid that was really spotted on the way in and really hit. You are put back at the moment the warning went out, with what was known then.

**The question.** There is a line of latitude. Does the impact point land **north** of it or **south** of it? Two order books, NORTH and SOUTH, and exactly one pays **$100 a share**. Prices run 1 to 99, so a price reads as a probability in percent.

Because exactly one pays, NORTH and SOUTH should add to about 100. If they do not, someone is wrong and there is money on the table.

**What you get.** Not raw telescope data — you are not being asked to determine an orbit. You get what a real impact warning actually contains:

- the **nominal impact point**, where the current solution says it lands,
- the **corridor**, the direction the fireball travels across the ground,
- and the **covariance** of the impact point, in kilometres along and across that corridor.

**What to do with it.** Draw a few thousand samples from that covariance. Walk each one down the corridor from the nominal point. Read off its latitude. The fraction landing north of the line is what NORTH is worth. That is the whole calculation and it is about fifteen lines of code.

**One warning worth taking seriously.** Latitude is *not* a straight-line function of distance along the corridor — a great circle climbs, flattens and falls. So a Gaussian spread along the ground comes out lopsided in latitude, and a normal approximation will hand you a confident wrong answer. Simulate. That is why the week is called what it is.

**More data arrives.** The operator releases updated solutions as the round runs — the way a real warning sharpens as the arc grows. Every release is announced loudly and should move your price.

Two things change each time, and they are not the same thing. The **ellipse always shrinks**. The **nominal point also moves**, and it can move either way — a new solution is a new fit, not the old one with the error rubbed off. So a release can make you more confident, or less, or flip you. Re-price it; do not assume the last update just points harder in the same direction.

**Your money.** **$10,000** — and every price on this screen is **dollars per share**. A share of NORTH pays **$100** if it lands north and **$0** if it does not, so a price of 30 means $30 a share.

A resting bid ties up **$price × shares**: bidding 30 for 10 shares holds $300. A resting offer ties up **$(100 − price) × shares**: offering 10 at 30 holds $700, because that is what you owe if it pays. **Reserved** is what your resting orders tie up in the worse of the two outcomes, so **reserved + free = your cash**.

Holding NORTH *and* SOUTH together is far cheaper than holding either alone — exactly one of them pays $100, so the pair is nearly riskless and the margin knows it. This is the most useful sentence on this page.

**There are bots.** An uninformed desk trades both books on a fixed schedule, regardless of what the data says. It is always there, it never learns, and it is why there is something on the other side of your first order. It is liquidity, it is noise, and it is where your money comes from.

**Limits.** At most 50 shares an order and 40 resting orders each. You will
almost never meet the second one: margin runs out first, and how much sooner
depends on whether you hedge. Forty one-sided bids near 50 would need $20,000
and you have $10,000 — but forty paired NORTH-and-SOUTH orders cost almost
nothing.

**Teams.** Up to four. You keep your own money and positions; the leaderboard ranks each team's **average**.

**The end.** The books shut and you find out where it actually landed — because it actually landed somewhere, and people went and picked up the pieces.`;

export const DATA_NOTE = `Distances are kilometres. "Along" is the corridor direction; "cross" is 90° clockwise from it. The covariance is km² in that frame and it is NOT diagonal — the two components are correlated, so draw them together.`;

export const MODEL_NOTE = `The event is real: the object, the date, where it hit, how much warning there was. The uncertainty is modelled — nobody publishes a covariance for a four-metre rock found hours before arrival — and it is scaled so the question is as hard as the operator chose.`;

/**
 * The block a team pastes into an AI.
 *
 * The round is meant to be solvable by describing it to a model and arguing
 * about the assumptions, so they are listed explicitly and framed as things to
 * check rather than accept. The final paragraph is the one that earns its
 * place: without it a model reaches for Φ(z) and is wrong.
 */
export function aiPrompt(d) {
  const C = d.covarianceKm2;
  const f = (v) => v.toFixed(1).padStart(12);
  return `I need to price a prediction market on where an asteroid lands.

WHAT I HAVE — a real impact warning for ${d.eventName}:

  nominal impact point   latitude ${d.nominalLat.toFixed(3)}°, longitude ${d.nominalLon.toFixed(3)}°
  corridor azimuth       ${d.azimuthDeg.toFixed(1)}°  (direction of travel across the
                         ground, clockwise from north)
  impact-point covariance, km², in the corridor frame [along, cross]:

      [[${f(C[0][0])}, ${f(C[0][1])} ],
       [${f(C[1][0])}, ${f(C[1][1])} ]]

THE QUESTION

  Does it land north or south of latitude ${d.lineDeg.toFixed(1)}°?
  I want P(north), a number between 0 and 1.

ASSUMPTIONS I AM MAKING — please tell me if any are wrong before you write code:

  1. The true impact point is the nominal point displaced by (along, cross)
     kilometres, drawn from a 2-D normal with the covariance above, zero mean.
  2. "Along" is the corridor direction; "cross" is 90° clockwise from it.
  3. A displacement of (along, cross) means: travel "along" km from the nominal
     point along the great circle whose initial bearing is the corridor azimuth,
     then "cross" km along the great circle leaving THAT point at 90 degrees to
     the right of it - 90 degrees off the track WHERE IT NOW IS, not off the
     original heading. Two legs, in that order, and that is what settlement
     uses. (The obvious alternative, one combined step of hypot(along, cross)
     km on a single bearing, can put an individual sample up to 1000 km away
     from the two-leg answer on a corridor this long, but the two disagree on
     P(north) by only about 0.2 points - measured. So it will not change your
     price; it will change where you think any one sample landed.)
  4. A sphere of radius 6371.0088 km, with geodetic latitude equal to
     geocentric. This is the assumption to distrust hardest: on the real
     ellipsoid the two differ by up to about 0.19 degrees at mid-latitudes, and
     the line can sit less than a degree away. It is also what settlement uses,
     so it is the right assumption for pricing THIS market - just do not take
     the answer outdoors.
  5. The covariance is NOT diagonal, so the two components must be drawn
     together — a Cholesky factor, or numpy's multivariate_normal.

WHAT I WANT

  Python that draws at least 100,000 samples and reports P(north).

  Please SIMULATE rather than using a normal approximation on latitude.
  Latitude is a nonlinear function of distance along a great circle — the track
  climbs, flattens and falls — so a Gaussian along the ground does not stay
  Gaussian in latitude, and Φ((line − µ)/σ) will be confidently wrong.`;
}
