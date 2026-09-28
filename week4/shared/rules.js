/**
 * Week 4 - Monte Carlo. The rules, written once.
 *
 * A sun, an earth, an asteroid, and Newton. A telescope has caught the rock a
 * few times over a few weeks and each sighting is good to a few hundred
 * kilometres. Does it hit the Earth on its next pass, or miss?
 *
 * WHY IT IS A MONTE CARLO
 * -----------------------
 * There is no formula for the answer. The measurement errors run through an
 * orbit fit and then through a year of nonlinear propagation, and the only way
 * to find out what they do is to try: jitter the sightings inside their error
 * bars, refit, propagate, count. That is how impact probability is actually
 * computed, and it is the whole of what a team has to do.
 *
 * WHAT A TEAM HAS TO DECIDE
 * -------------------------
 * How to fit. How many samples. What to do about the sightings that are simply
 * wrong - roughly one in twenty-five is a blunder rather than noise, and on a
 * short arc a single bad one moves the probability from 15% to 0%. Whether to
 * drop it, weight it, or trust it. Nobody is told which.
 *
 * WHAT THE RELEASES ARE
 * ---------------------
 * More sightings. The arc lengthens, the fit tightens, and the probability
 * moves - hard, and in either direction.
 */



/**
 * The two books.
 *
 * The keys stay "north" and "south" because the engine, the margin model, the
 * stylesheet and the settlement tests all address them by those names and a
 * rename buys nothing. NORTH is HIT, SOUTH is MISS, and nothing outside this
 * file ever says so - every label, every question and everything the room or
 * the assistant sees comes from MARKET_META below.
 */
export const MARKETS = ["north", "south"];

export const MARKET_META = {
  north: {
    key: "north",
    name: "HIT",
    long: "It hits the Earth",
    blurb: "Pays $100 a share if the asteroid comes within one Earth radius.",
  },
  south: {
    key: "south",
    name: "MISS",
    long: "It misses the Earth",
    blurb: "Pays $100 a share if it passes by.",
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
  /** Refits the SERVER does per release, to give the operator a reference price. */
  refits: 15,
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

export const RULES_TEXT = `**The question.** An asteroid has been sighted a few times. Does it **hit** the Earth on its next pass, or **miss**? Two order books, and exactly one pays **$100 a share**. Prices run 1 to 99, so a price reads as a probability in percent.

Because exactly one pays, HIT and MISS should add to about 100. If they do not, someone is wrong and there is money on the table.

**The physics is Newton and nothing else.** The Sun pulls the rock, the Earth pulls the rock, force is GM/r squared. Two dimensions. You are given the Sun's GM, the Earth's orbit, and a list of sightings: a date, and where the asteroid was, in AU.

**The measurements are not good.** Each sighting is out by a few hundred kilometres. That sounds small next to an orbit, and it is - until you remember it becomes a velocity error, and a velocity error compounds for a year. One Earth radius is 6371 km. The fit is trying to resolve something smaller than the error bars, a year away.

**And some sightings are simply wrong.** Not noisy - wrong. A misidentified star, a bad plate solve. About one in twenty-five. Nobody will tell you which. On a short arc a single bad one can take the probability from 15% to zero, and the only way to find it is to look at the residuals after you fit.

**What to do.** Fit an orbit to the sightings. Then jitter them inside their error bars, refit, propagate to the encounter, and see how often the rock comes within one Earth radius. That fraction is what HIT is worth. There is no formula; you have to run it.

**Things that are also uncertain.** The Earth's own position is known to about 250 km. The Sun's GM to about a part in 50 million. Both sound negligible. One of them is.

**You make the market.** The books open EMPTY. Nothing trades until someone posts a price. An uninformed desk fires market orders on a schedule and never quotes, so it can only trade against your resting orders.

**Your money.** **$10,000**, every price in **dollars per share**. A resting bid ties up **$price x shares**; a resting offer ties up **$(100 - price) x shares**. Holding HIT and MISS together is nearly riskless and the margin knows it.

**More sightings arrive.** Each release adds observations. The arc lengthens, the answer sharpens, and the price can move a long way in either direction.

**The end.** The books shut and you watch it come in.`;

export const DATA_NOTE = `Positions are in AU, in the plane of the Earth's orbit, with the Sun at the origin. Times are days from the epoch. Every sighting has the same 1-sigma error. Some of them are not merely noisy.`;

export const MODEL_NOTE = `The system is invented - this is not a real asteroid - but the physics is not. Newtonian gravity, a real Kepler ellipse for the Earth, and the same integrator that settles the market. The sightings were generated by flying the true orbit and adding the stated errors.`;

/**
 * The block a team pastes into an AI.
 *
 * The round is meant to be solvable by describing it to a model and arguing
 * about the assumptions, so they are listed explicitly and framed as things to
 * check rather than accept. The final paragraph is the one that earns its
 * place: without it a model reaches for Φ(z) and is wrong.
 */
export function aiPrompt(d) {
  const rows = d.sightings
    .map((s) => `  ${String(s.t).padStart(8)}   ${s.x.toFixed(8).padStart(13)}   ${s.y.toFixed(8).padStart(13)}`)
    .join("\n");
  return `I need to price a prediction market on whether an asteroid hits the Earth.

THE SYSTEM - two dimensions, Newtonian gravity, Sun at the origin.

  GM_sun            ${d.gmSun} AU^3/day^2   (+/- ${d.gmSunRelSigma} fractional)
  Earth's orbit     a Kepler ellipse: a = ${d.earth.aAu} AU, e = ${d.earth.e},
                    period ${d.earth.periodDays} days, longitude of perihelion
                    ${d.earth.peri} rad, mean anomaly at t=0 ${d.earth.M0} rad
  GM_earth          ${d.gmEarth} AU^3/day^2
  Earth radius      ${d.earthRadiusAu} AU  (${d.earthRadiusKm} km)
  the Earth's own position is uncertain by about ${d.earthEphemSigmaKm} km

THE SIGHTINGS - ${d.sightings.length} of them, release ${d.release} of ${d.of}.
Each position is out by ${d.sightingSigmaKm} km, 1 sigma, in x and in y
independently. SOME OF THESE ARE NOT MERELY NOISY - about one in twenty-five is
a blunder, off by five to forty sigma. Nobody will tell me which.

     t (days)              x (AU)              y (AU)
${rows}

THE QUESTION

  The encounter is around day ${d.tEncounter}. Integrate to day ${d.tEnd}.
  Does the asteroid pass within one Earth radius of the Earth's centre?
  I want P(hit), a number between 0 and 1.

WHAT I WANT

  1. Fit the asteroid's state [x, y, vx, vy] at t = 0 to the sightings.
     Least squares, propagating with an RK4 integrator under the Sun AND the
     Earth. A crude starting guess works: the first sighting's position, and a
     velocity from the first and last divided by the elapsed time.
  2. Show me the residuals. I need to see which sightings do not fit, and I
     will decide what to do about them - do not silently drop anything.
  3. Then the Monte Carlo: jitter every sighting by its error, refit, propagate
     to the encounter, and record the closest approach. A few hundred refits.
     Report P(hit) and the spread of the miss distance in km.

  Two things the integrator must get right, or the answer is quietly wrong:
  the step size has to SHRINK near the Earth - a fixed quarter-day step moves
  200,000 km and walks straight past the planet - and the closest approach has
  to be refined inside the bracketing interval, not read off the scan.

  Ask me what I want to do about the suspect sightings before you price it.`;
}
