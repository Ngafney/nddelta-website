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
  maxOrdersPerPlayer: 40,
  maxOpenOrders: 4000,
  tapeLength: 80,
  fillsKept: 40,
  nameMin: 2,
  nameMax: 18,
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
  sigma0Km: 600,
  /** How many times narrower the ellipse is across the corridor than along it. */
  ratio: 6,
  /** A tilt, so the two components are correlated and cannot be sampled apart. */
  tiltDeg: 12,
  /**
   * What each successive release multiplies sigma by — more observations, a
   * longer arc, a tighter solution.
   */
  // Gentle on purpose. A steeper schedule reaches certainty by the third
  // release and the last two have nothing left to say, which kills the trading
  // they were meant to cause.
  shrink: [1, 0.88, 0.78, 0.7, 0.63, 0.57],
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

**More data arrives.** The operator releases updated solutions as the round runs — a tighter ellipse each time, the way a real warning sharpens as the arc grows. Every release is announced loudly and should move your price.

**Your money.** **$10,000**. A resting bid ties up price × shares. A resting offer ties up (100 − price) × shares. Holding NORTH and SOUTH together is far cheaper than holding either alone — one of them is going to pay, and the margin knows it.

**There are bots.** An uninformed desk trades both books on a fixed schedule regardless of what the data says. It is liquidity, and it is noise.

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
  3. A displacement follows a great circle on a sphere of radius 6371 km.
  4. Geodetic and geocentric latitude are close enough here to ignore.
  5. The covariance is NOT diagonal, so the two components must be drawn
     together — a Cholesky factor, or numpy's multivariate_normal.

WHAT I WANT

  Python that draws at least 100,000 samples and reports P(north).

  Please SIMULATE rather than using a normal approximation on latitude.
  Latitude is a nonlinear function of distance along a great circle — the track
  climbs, flattens and falls — so a Gaussian along the ground does not stay
  Gaussian in latitude, and Φ((line − µ)/σ) will be confidently wrong.`;
}
