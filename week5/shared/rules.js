/**
 * Week 5 — The Horizon Market. The rules, written once.
 *
 * A hidden process Y ticks live on the screen. One contract: does Y finish
 * ABOVE K at the final tick T? It pays $100 a share if it does and nothing if
 * it does not, quoted 1–99 like every other week.
 *
 * Every round the host picks the process in secret. The room gets the same
 * kind of chart every time — and the lesson is that the same chart is worth
 * very different prices depending on one number, φ: how hard the series is
 * pulled back toward its mean. Near 1 a gap of five points is a gap that
 * stays; at 0.9 it is gone in twenty ticks.
 */

/** One book, the week 3 ladder. Nothing here is secret. */
export const MODES = {
  horizon: {
    key: "horizon",
    name: "The Horizon Market",
    settleMin: 0,
    settleMax: 100,
    tick: 1,
    ladderPad: 0,
    orderMin: 1,
    orderMax: 99,
    center: 50,
  },
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
  defaultOrderSize: 10,
  maxOrdersPerPlayer: 40,
  maxOpenOrders: 4000,
  tapeLength: 80,
  fillsKept: 40,
  nameMin: 2,
  nameMax: 18,
  codeHoldSeconds: 6,
  /** The mid recorded at each tick for the reveal. T is capped at 300. */
  midsKept: 320,
};

/* ── the process the host picks ───────────────────────────────────────── */

/** What every field means when it is left blank. */
export const DEFAULTS = {
  phi1: 0.9,
  phi2: 1.0,
  switchTick: null,
  sigma: 1,
  mu: 100,
  K: 100,
  yOpen: 105,
  H: 150,
  T: 60,
  secondsPerTick: 4,
  researchMinutes: 3,
  naiveBot: true,
};

/**
 * The three rounds the lesson is built around, plus "custom". A preset only
 * fills the φ fields; everything else is whatever is in the form.
 */
export const PRESETS = {
  meanrev: {
    key: "meanrev",
    name: "Mean-reverting",
    blurb: "φ = 0.9 — a gap from μ halves in about 7 ticks.",
    phi1: 0.9,
    phi2: null,
    switchTick: null,
  },
  rw: {
    key: "rw",
    name: "Random walk",
    blurb: "φ = 1 — no pull back at all. μ is irrelevant.",
    phi1: 1,
    phi2: null,
    switchTick: null,
  },
  switch: {
    key: "switch",
    name: "Regime switch",
    blurb: "φ = 0.9 for the first 30 live ticks, then φ = 1.0.",
    phi1: 0.9,
    phi2: 1.0,
    switchTick: 30,
  },
  custom: {
    key: "custom",
    name: "Custom",
    blurb: "Type your own φ1, φ2 and switch tick.",
  },
};

export const PRESET_ORDER = ["meanrev", "rw", "switch", "custom"];

/* ── phases ───────────────────────────────────────────────────────────── */

export const PHASES = {
  lobby: { key: "lobby", name: "LOBBY", blurb: "Waiting for the host." },
  research: { key: "research", name: "RESEARCH", blurb: "The history is out. The book is shut. Fit it." },
  live: { key: "live", name: "LIVE", blurb: "Y is ticking and the book is open." },
  settled: { key: "settled", name: "SETTLED", blurb: "Tick T has printed. Count the money." },
};

/* ── the house desks ──────────────────────────────────────────────────── */

/**
 * The bots are public: the room is told they exist and exactly what they do.
 * Each sits under its own player id at one hidden table, so self-trade
 * prevention treats them as separate traders and they never show on the board.
 */
export const BOTS = {
  team: { id: "house-desks", name: "HOUSE DESKS", code: "----" },
  /** Each desk's stack, as a multiple of a player's: they must never run dry. */
  cashMultiple: 400,
  naive: {
    key: "naive",
    pid: "bot-naive",
    name: "NAIVE DESK",
    everySec: 10,
    halfSpread: 4,
    size: 30,
  },
  noise: [
    { key: "noise-1", pid: "bot-noise-1", name: "NOISE DESK A", everySec: 13, size: 30 },
    { key: "noise-2", pid: "bot-noise-2", name: "NOISE DESK B", everySec: 19, size: 30 },
  ],
  /** How far through the touch a noise desk's market order may sweep. */
  maxSweep: 15,
};

/* ── player-facing copy ───────────────────────────────────────────────── */

export const RULES_TEXT = `**The contract.** A hidden process **Y** ticks live on the screen, one new value every few seconds. One contract: **will Y be above K at the final tick T?** If Y_T > K a share pays **$100**; otherwise it pays **$0**. Prices run 1 to 99, so a price reads as a probability in percent.

**What you can see.** The whole history of Y up to the open, and every live tick as it prints. Nothing else. Whatever made the series is hidden, and the host picks it fresh every round.

**Step 1 — research.** Before the book opens there is a short research window. Download the data (a CSV, or a block of text to paste into an AI) and work out what kind of process this is. The usual first guess is an **AR(1)**: Y_{t+1} = μ + φ(Y_t − μ) + noise. **φ is the number that matters.** Near 1 the series wanders and a gap stays a gap; well below 1 it is dragged back toward μ.

**Step 2 — trade.** The book opens and Y starts to tick. Click the bid side to buy at a price, the offer side to sell. Cross the book and you trade immediately. As ticks print, the data grows — download it again and re-fit. **Do not assume the process stays the same all round.**

**The desks.** A **NAIVE DESK** quotes a bid and an offer about four either side of the price you would get if Y were a **random walk**. It re-quotes every ten seconds. Sometimes that is right. Two **NOISE DESKS** buy or sell 30 shares at random, every 13 and 19 seconds, so the book is never dead.

**Your money.** **$10,000**. A resting bid ties up **$price × shares**; a resting offer ties up **$(100 − price) × shares**. You can never be filled into a negative balance.

**Teams.** Up to four players per team. You keep your own money and position; the leaderboard ranks each team's **average**.

**The end.** When tick T prints the round settles by itself: $100 a share if Y_T > K, $0 if not. Then the reveal shows what the process really was — and what the contract was really worth at every tick.`;

export const DATA_NOTE = `t is the tick number: the history runs up to t = 0, which is the moment the book opened, and live ticks count up from 1 to T. y is Y at that tick, to four decimal places. Nothing else about the process is published, and nothing is withheld that you could not, in principle, estimate from this column.`;

/* ── the data, as a player gets it ────────────────────────────────────── */

/** The rows a player may see: history, then every live tick revealed so far. */
export function publicRows(d) {
  const rows = [];
  for (let i = 0; i < d.history.length; i++) rows.push({ t: i - (d.history.length - 1), y: d.history[i] });
  for (let s = 1; s <= d.tick; s++) rows.push({ t: s, y: d.live[s - 1] });
  return rows;
}

/** The CSV. Header comments carry the contract and the clock; never the process. */
export function csvText(d) {
  const head = [
    `# DELTA week 5 - the horizon market - round ${d.roundId}`,
    `# contract: pays $100 a share if Y at tick T=${d.T} is ABOVE K=${d.K}, else $0`,
    `# seconds per tick: ${d.secondsPerTick}`,
    `# current tick: ${d.tick} of ${d.T} (history runs t=${1 - d.history.length}..0; live ticks t=1..${d.T})`,
    "t,y",
  ];
  return head.concat(publicRows(d).map((r) => `${r.t},${r.y.toFixed(4)}`)).join("\n") + "\n";
}

/**
 * The block a team pastes into an AI. Modelled on week 4's: the contract, the
 * whole table, and a list of things to CHECK rather than accept. It says
 * nothing about which process this round is, and nothing about switches —
 * only that the process "may not stay the same", which is true of every
 * series anybody has ever traded.
 */
export function aiPrompt(d) {
  const rows = publicRows(d)
    .map((r) => `  ${String(r.t).padStart(5)}   ${r.y.toFixed(4).padStart(12)}`)
    .join("\n");
  const left = d.T - d.tick;
  return `I need to price a binary contract on a time series.

THE CONTRACT
  A hidden process Y prints one value per tick, one tick every ${d.secondsPerTick === 1 ? "second" : `${d.secondsPerTick} seconds`}.
  The contract pays $100 per share if Y at the final tick T = ${d.T} is ABOVE
  K = ${d.K}, and $0 otherwise. Prices are quoted 1 to 99, i.e. a price is a
  probability in percent. I want P(Y_T > K).

  The data below runs from t = ${1 - d.history.length} up to the current tick t = ${d.tick}.
  There are ${left} tick${left === 1 ? "" : "s"} still to come (h = ${left}). The last value is
  Y_now = ${publicRows(d).at(-1).y.toFixed(4)}.

THE DATA (${d.history.length + d.tick} rows)
      t              y
${rows}

WHAT I WANT - and treat every assumption below as something to CHECK on the
data, not something to accept.

  1. Plot Y against t, and plot its autocorrelation function (ACF). Tell me what
     the ACF looks like: a slow, nearly straight decay, or a geometric one that
     dies out quickly?

  2. Fit an AR(1), Y_t = mu + phi (Y_{t-1} - mu) + sigma e_t with e_t ~ N(0, 1),
     by regressing Y_t on Y_{t-1} with ordinary least squares. Report phi-hat,
     mu-hat and sigma-hat WITH their uncertainty (standard errors or a
     confidence interval). Tell me plainly whether phi is distinguishable from
     1 on this data, and remember that the OLS estimate of phi is biased
     downward in short samples. Check the residuals: do they look like
     independent normal noise? Does the fit look the same on the first half of
     the data as on the second?

  3. Compute P(Y_T > K) from the h-step-ahead forecast, h = ${left}:
       AR(1), |phi| < 1:  mean = mu + phi^h (Y_now - mu)
                          variance = sigma^2 (1 - phi^(2h)) / (1 - phi^2)
       random walk (phi = 1):  mean = Y_now,  variance = h sigma^2
     and P = Phi((mean - K) / sd), where Phi is the standard normal CDF.
     Give me the answer under the fitted AR(1) AND under a random walk, and
     tell me how sensitive it is to phi: what is P if phi is one standard error
     higher, or lower?

  4. Explain how I should update as new ticks arrive: what to recompute, how h
     changes, and what would tell me the model has stopped fitting. Warn me
     clearly if anything suggests the process may not stay the same for the
     rest of the round.

  Show your working, keep the numbers to 2-3 significant figures, and finish
  with one number: the probability you would trade at.`;
}
