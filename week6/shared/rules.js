/**
 * Week 6 — The Sum. The rules, written once.
 *
 * Every team picks a secret whole number from 0 to 10 when it
 * forms. S is the sum of all of them. Three books trade on S:
 *
 *   THE SUM   a share pays $S
 *   THE CALL  a share pays max(S − K, 0)
 *   THE PUT   a share pays max(K − S, 0)
 *
 * with one strike K for both options, so that the put–call parity identity
 * CALL − PUT = SUM − K holds exactly at settlement and can be checked live on
 * the floor. The host reveals the numbers one at a time (by hand, or on a
 * clock) and the round settles the instant the last one lands.
 */

/** The three books. Nothing here is secret. */
export const BOOKS = {
  fut: { key: "fut", name: "THE SUM", short: "SUM", pays: "$S a share", blurb: "the sum itself" },
  call: { key: "call", name: "THE CALL", short: "CALL", pays: "max(S − K, 0)", blurb: "worth something only if S finishes above K" },
  put: { key: "put", name: "THE PUT", short: "PUT", pays: "max(K − S, 0)", blurb: "worth something only if S finishes below K" },
};
export const BOOK_ORDER = ["fut", "call", "put"];

/** A team's number is a whole number 0 … NUMBER_MAX. */
export const NUMBER_MAX = 10;

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
  /** Across all three books. */
  maxOrdersPerPlayer: 40,
  maxOpenOrders: 4000,
  tapeLength: 80,
  fillsKept: 40,
  nameMin: 2,
  nameMax: 18,
  codeHoldSeconds: 6,
  /** The most teams a round can carry: the ladders are 10 × this tall. */
  maxTeams: 40,
  maxDesks: 6,
};

/* ── the round the host builds ────────────────────────────────────────── */

/** What every field means when it is left blank. */
export const DEFAULTS = {
  /** blank = 5 × N at the open, the sum's mean if every number were uniform. */
  K: null,
  pickSeconds: 30,
  autoEverySec: 8,
  autoOn: false,
  books: { fut: true, call: false, put: false },
  noise: { on: true, desks: 2, everySec: 12, size: 10, sweep: 4 },
  /** The insider: edge it demands in cents, shares per strike, loop interval. */
  sharp: { edgeC: 10, size: 100, everySec: 15 },
};

export const BOUNDS = {
  K: [1, 10 * LIMITS.maxTeams - 1],
  pickSeconds: [5, 600],
  autoEverySec: [1, 120],
  desks: [0, LIMITS.maxDesks],
  everySec: [2, 120],
  size: [1, LIMITS.maxSharesPerOrder],
  sweep: [0, 50],
  edgeC: [0, 100_000],
  sharpSize: [1, 2000],
  sharpEverySec: [2, 600],
};

/* ── phases ───────────────────────────────────────────────────────────── */

export const PHASES = {
  lobby: { key: "lobby", name: "LOBBY", blurb: "Form teams. Pick your number. The books are shut." },
  live: { key: "live", name: "LIVE", blurb: "The books are open and the numbers are coming out." },
  settled: { key: "settled", name: "SETTLED", blurb: "Every number is out. Count the money." },
};

/* ── the house desks ──────────────────────────────────────────────────── */

/**
 * The noise desks are public: the room is told they exist and exactly what
 * they do. They only ever TAKE — a market order into whatever is resting —
 * so an empty book stays empty until a student quotes it. Each desk sits under
 * its own player id at one hidden table, so self-trade prevention treats them
 * as separate traders and they never show on the board.
 */
export const BOTS = {
  team: { id: "house-desks", name: "HOUSE DESKS", code: "----" },
  /** Each desk's stack, as a multiple of a player's: they must never run dry. */
  cashMultiple: 400,
  /**
   * The insider knows the answer. It only ever TAKES: on the host's click (or
   * on a loop the host switches on) it sweeps every resting order priced more
   * than `edgeC` away from the true payoff, up to `size` shares a strike.
   */
  sharp: { key: "sharp", pid: "bot-sharp", name: "THE INSIDER" },
  desks: Array.from({ length: LIMITS.maxDesks }, (_, i) => ({
    key: `noise-${i + 1}`,
    pid: `bot-noise-${i + 1}`,
    name: `NOISE DESK ${String.fromCharCode(65 + i)}`,
    /** Desks fire on slightly different clocks so they never land together. */
    stagger: 1 + 0.35 * i,
  })),
};

/* ── player-facing copy ───────────────────────────────────────────────── */

export const RULES_TEXT = `**The numbers.** Every team picks a **secret whole number from 0 to 10**. **S is the sum of all of them.** You know your own number and how many teams there are. The host draws the numbers one at a time, in a random order, without saying whose is whose.

**Three books.** **SUM** pays **$S** a share. **CALL** pays **max(S − K, 0)**. **PUT** pays **max(K − S, 0)**. One strike K for both. The host opens the books one at a time.

**Parity.** At the end **CALL − PUT = SUM − K**, exactly. Before the end the prices should line up the same way, or there is free money on the table.

**What the screen tells you.** "Fair" on each book is what it would be worth if every hidden number were uniform on 0–10. It ignores what you know — your own number, and your read of the room. "Free" is the least your money can be worth at any sum still possible, with your positions and every resting order counted together.

**Trading.** Click the bid side of a ladder to buy there, the offer side to sell. Cross the book and you trade at once. Prices are whole dollars a share. A few **noise desks** fire market orders at random — they never quote. If nobody quotes, nothing trades.

**Money.** **$10,000**. A resting order ties up the most it could lose over every sum still possible, so you can never go below zero. Teams of up to four, one number per team, scored on the team's **average**. Teams lock when trading opens.

**The end.** The last number drawn settles everything by itself.`;
