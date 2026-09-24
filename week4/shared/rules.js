/**
 * Week 4 — Monte Carlo. The rules, written once.
 *
 * An asteroid is going to hit the Earth in three years. A survey has been
 * watching it, badly, and the record is public: positions of the Sun, the
 * Earth and the rock, every few days, each with an honest error bar, plus the
 * three masses measured about as well as anyone can measure a mass.
 *
 * It will land just north or just south of the equator. Two order books are
 * open — NORTH and SOUTH — and exactly one of them pays $100 a share.
 *
 * The room gets the record up to six months before impact. That is not enough
 * to be sure. More of it arrives as the operator releases it, and the closer
 * the rock gets the better the survey's measurements of it become, so the
 * answer sharpens as the clock runs down. Whoever works out where it is going
 * first gets to buy the answer cheaply from everyone who has not.
 */

/** The two books. The order here is the order they appear on screen. */
export const MARKETS = ["north", "south"];

export const MARKET_META = {
  north: {
    key: "north",
    name: "NORTH",
    long: "Impact NORTH of the equator",
    tint: "north",
    blurb: "Pays $100 a share if the asteroid lands in the northern hemisphere.",
  },
  south: {
    key: "south",
    name: "SOUTH",
    long: "Impact SOUTH of the equator",
    tint: "south",
    blurb: "Pays $100 a share if the asteroid lands in the southern hemisphere.",
  },
};

/**
 * One grid for both books. Nothing here is secret: a prediction market's price
 * IS a probability in percent, and everybody knows a probability lives between
 * nothing and certainty.
 */
export const BOOK = {
  settleMin: 0,
  settleMax: 100,
  tick: 1,
  orderMin: 1,
  orderMax: 99,
  center: 50,
};

/** Money is integer CENTS on the server. Never floats. */
export const MONEY = {
  startCashC: 1_000_000, // $10,000.00
};

export const LIMITS = {
  teamSize: 4,
  teamNameMax: 20,
  codeLength: 4,
  maxSharesPerOrder: 50,
  /** How many shares one click buys or sells, unless the admin says otherwise. */
  defaultOrderSize: 10,
  /** Counted across BOTH books together. */
  maxOrdersPerPlayer: 40,
  maxOpenOrders: 4000,
  tapeLength: 80,
  fillsKept: 40,
  nameMin: 2,
  nameMax: 18,
  /** Seconds the team code stays up before you can walk onto the floor. */
  codeHoldSeconds: 6,
};

/* ── the scenario ─────────────────────────────────────────────────────── */

export const SCENARIO = {
  /** Length of the observing record, in years. */
  years: 3,
  /** How far north or south of the equator, in degrees, unless the admin says. */
  defaultImpactLatDeg: 3,
  /** The operator may aim anywhere in this band. */
  latRange: [0.5, 12],
  /** Perihelion band for the asteroid's orbit, in AU. Sungrazing, on purpose. */
  perihelion: [0.042, 0.075],
  minPasses: 3,
  astMassKg: 1.6e12,
};

export const DATA = {
  /** Days before impact that the first release stops at. */
  firstCutDays: 180,
  /** How much each later release adds. The operator picks from these. */
  stepChoices: [30, 60],
  defaultStepDays: 30,
  /** Observation cadence, in days, by how far out the rock still is. */
  cadence: { far: 5, mid: 2, near: 0.5 },
  /** Relative error on the published masses. */
  massRelError: 5e-6,
};

export const CONFIDENCE = {
  /** What a good team should be able to reach on the opening data. */
  defaultStart: 0.65,
  /** …and by the final release. */
  defaultEnd: 0.9,
  range: [0.52, 0.95],
};

/* ── phases ───────────────────────────────────────────────────────────── */

/**
 * A round runs: lobby → research → live → ended → settled.
 *
 * RESEARCH is the quiet window. The opening data is out, the books are shut,
 * and teams do the actual work. Trading only opens when the operator says so,
 * or when the research clock runs out.
 */
export const PHASES = {
  lobby: { key: "lobby", name: "LOBBY", blurb: "Waiting for the operator." },
  research: { key: "research", name: "RESEARCH", blurb: "Data is out. Books are shut. Work." },
  live: { key: "live", name: "TRADING", blurb: "Both books are open." },
  ended: { key: "ended", name: "IMPACT", blurb: "Books shut. The asteroid is arriving." },
  settled: { key: "settled", name: "SETTLED", blurb: "It landed. Count the money." },
};

export const TIMERS = {
  defaultResearchMinutes: 15,
  defaultTradingMinutes: 20,
  minMinutes: 0.5,
  maxMinutes: 180,
};

/* ── the noise traders ────────────────────────────────────────────────── */

/**
 * Four slots, one per (market × direction). Each fires a market order of a
 * chosen size every so many seconds. The room is told these exist — an
 * uninformed flow everyone can see is a feature, not a trap.
 */
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
  /** How far through the book one bot order is allowed to sweep. */
  maxSweep: 25,
  name: "SURVEY DESK",
};

/* ── player-facing copy ───────────────────────────────────────────────── */

export const RULES_TEXT = `**The situation.** An asteroid will strike the Earth in three years. It will land close to the equator — just north of it, or just south. Nobody knows which.

**Two markets, one answer.** There are two order books: **NORTH** and **SOUTH**. Exactly one of them pays **$100 a share** at impact; the other pays nothing. Prices run 1 to 99, so a price reads as a probability in percent.

Because exactly one pays, NORTH and SOUTH should add up to about 100. If they do not, someone is wrong and there is money on the table.

**What you get.** The survey's full record: the positions of the Sun, the Earth and the asteroid every few days for three years, each with the error bar on that measurement, plus the three masses. Download it with one click and do whatever you like to it.

The record is noisy. Observing is hard, and it was hardest when the rock was far away. With the opening data a good team can get a real edge — but not certainty.

**More data arrives.** The operator releases further stretches of the record as the round goes on. Every release is announced loudly. The newer measurements are sharper, because the asteroid is closer and brighter, so each release should move your estimate.

**Research, then trading.** First a quiet window with the data and no market. Then the books open.

**Your money.** **$10,000**. A resting bid ties up price × shares. A resting offer ties up (100 − price) × shares. Holding NORTH and SOUTH together is far cheaper than holding either alone — one of them is going to pay, and the margin knows it.

**There are bots.** An uninformed desk trades both books on a fixed schedule, buying and selling regardless of what the data says. It is not trying to beat you and it is not reading the sky. It is liquidity, and it is noise.

**Teams.** Up to four players. You keep your own money and your own positions; the leaderboard ranks each team's **average** portfolio.

**The end.** The books shut, the asteroid arrives, and you watch where it lands. Then everything settles and the board is final.`;

export const DATA_NOTE = `Positions are in AU in the solar-system barycentric frame, on the ecliptic of J2000. Day 0 is the first observation. \`sigma_au\` is the one-sigma error on every position component in that row — it is not the same on every row.`;
