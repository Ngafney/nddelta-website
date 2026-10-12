/**
 * Week 6 runs the week 3 engine with one structural change: THREE books on one
 * underlying. Price-time priority, integer cents, self-trade prevention and the
 * zero-sum audit are ported as they were. The solvency rule is the part that
 * had to be rethought, and it is below.
 *
 * The matching engine and the balance rules. Pure functions over a plain state
 * object — no I/O, no clock of its own — so the server can run them inside a
 * compare-and-swap transaction and the tests can hammer them directly.
 *
 * ── The contracts ────────────────────────────────────────────────────────
 * S is the sum of the numbers in the pot, a whole number. One share of book k
 * settles at pay_k(S) dollars:
 *
 *   fut   S            call  max(S − K, 0)        put  max(K − S, 0)
 *
 * Long a share: you paid the price now, you receive pay_k(S) at the end. Short
 * a share: you received the price now, you pay pay_k(S) at the end.
 *
 * ── Money ────────────────────────────────────────────────────────────────
 * All money is INTEGER CENTS. Prices are integer dollars, so a share costs
 * px * 100 cents exactly and nothing ever drifts.
 *
 * ── Why nobody can go bust (the part that must not be wrong) ─────────────
 * At any moment S is known to lie in [lo, hi] — the revealed total, plus 0 to
 * 10 for each number still in the pot. For every whole S in that range define
 * a player's WEALTH at S:
 *
 *   W(S) = cash + Σ_k pos_k · pay_k(S)·100 − Σ_resting reserve(o, S)
 *
 *   reserve of a resting BID   at px, q shares:  (px − pay_k(S))⁺ · q · 100
 *   reserve of a resting OFFER at px, q shares:  (pay_k(S) − px)⁺ · q · 100
 *
 * The invariant is W(S) ≥ 0 for EVERY S in [lo, hi]. It is checked before an
 * order is accepted, on the state the order would leave behind (fills at the
 * prices they would really print at, the remainder resting at its limit), and
 * it is preserved by everything that can happen afterwards:
 *
 *   a fill of my resting bid for q at px:   ΔW(S) = q·100·(pay(S) − px + (px − pay(S))⁺) = q·100·(pay(S) − px)⁺ ≥ 0
 *   a fill of my resting offer, likewise:   ΔW(S) = q·100·(px − pay(S))⁺ ≥ 0
 *   a cancel:                               reserves only fall, W rises
 *   a number coming out of the pot:         [lo, hi] shrinks — fewer constraints, none new
 *   settlement at S* ∈ [lo, hi]:            resting orders are pulled, final cash = W(S*) + reserves ≥ 0
 *
 * S is an integer and every payoff is piecewise linear in S, so checking every
 * whole S in [lo, hi] is exact, not an approximation. At most 10 × maxTeams + 1
 * values, times the player's own orders: cheap. See test/engine.test.js, which
 * asserts all of this over random storms and settles at every reachable S.
 */

import { LIMITS, MONEY, BOOK_ORDER, NUMBER_MAX } from "./rules.js";
import { payoff, payRange, sumBounds, fairUniform } from "./game.js";

export class EngineError extends Error {
  constructor(message, code = "rejected") {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

const SHARE_C = 100; // cents per dollar of price, per share
const pos0 = (v) => (v > 0 ? v : 0);
const zeroPos = () => Object.fromEntries(BOOK_ORDER.map((k) => [k, 0]));

/* ── state ────────────────────────────────────────────────────────────── */

export function newMarket(round) {
  return {
    roundId: round.roundId,
    // lobby → live → settled. In the lobby teams form and pick; the books are shut.
    status: "lobby",
    startCashC: round.startCashC ?? MONEY.startCashC,
    defaultSize: round.defaultSize ?? LIMITS.defaultOrderSize,
    lateJoin: round.lateJoin !== false,
    players: {},
    teams: {},
    codes: {},
    devices: {},
    books: Object.fromEntries(BOOK_ORDER.map((k) => [k, newBook(k, round.books?.[k] ?? k === "fut")])),
    nextOrderId: 1,
    seq: 1,
    // The pot. N, K, Smax and the reveal order are fixed when trading opens
    // (lock); until then N is "teams so far" and K is the host's request.
    locked: false,
    N: 0,
    K: null,
    Kreq: round.K ?? null,
    Kauto: false,
    Smax: null,
    revealOrder: null,
    revealed: [],
    mids: [],
    pickEndsAt: null,
    liveStartedAt: null,
    settleS: null,
    payouts: null,
    settledAt: null,
  };
}

function newBook(key, open) {
  return { key, open: !!open, orders: [], last: null, tape: [], volume: 0 };
}

export function newPlayer(pid, name, deviceId, cashC, now) {
  return {
    id: pid,
    name,
    device: deviceId,
    teamId: null,
    cash: cashC,
    pos: zeroPos(),
    spentC: 0,
    fills: [],
    joinedAt: now,
    settledPos: null,
    startC: cashC,
  };
}

/** Where S can still land. Before the lock there is no pot to speak of. */
export function bounds(state) {
  return sumBounds(state.N ?? 0, revealedNumbers(state));
}

/** The numbers out of the pot so far, as plain numbers. */
export function revealedNumbers(state) {
  return (state.revealed ?? []).map((r) => (typeof r === "number" ? r : r.n));
}

/** How many teams would be in the pot if trading opened now. */
export function teamCount(state) {
  return Object.values(state.teams ?? {}).filter((t) => !t.hidden).length;
}

/**
 * The price grid of one book. Fixed at the lock; before it, provisional
 * numbers from the teams formed so far, so the ladder has a shape to show.
 */
export function grid(state, key) {
  const N = state.locked ? state.N : Math.max(1, teamCount(state));
  const Smax = NUMBER_MAX * N;
  const K = state.locked ? state.K : state.Kreq != null && state.Kreq >= 1 && state.Kreq <= Smax - 1 ? state.Kreq : Math.max(1, Math.min(Smax - 1, Math.round((NUMBER_MAX / 2) * N)));
  const [settleMin, settleMax] = payRange(key, 0, Smax, K);
  return {
    settleMin,
    settleMax,
    orderMin: settleMin,
    orderMax: settleMax,
    tick: 1,
    /** Where the ladder opens: the uniform-prior fair value, on the grid. */
    center: Math.max(settleMin, Math.min(settleMax, Math.round(fairUniform(key, N, state.locked ? revealedNumbers(state) : [], K)))),
    K,
    N,
    Smax,
  };
}

export function onTick(state, key, px) {
  const g = grid(state, key);
  return Number.isInteger(px) && px >= g.orderMin && px <= g.orderMax;
}

/* ── balances ─────────────────────────────────────────────────────────── */

/** The reserve of one resting order at settlement S, in cents. */
function reserveAtC(o, S, K) {
  const pay = payoff(o.mkt, S, K);
  return (o.side === "B" ? pos0(o.px - pay) : pos0(pay - o.px)) * o.qty * SHARE_C;
}

/**
 * Wealth at every possible S, minimised — the invariant as one number. Cash,
 * positions and resting orders are passed in so the planner can ask about a
 * state that does not exist yet.
 */
function worstC(state, cash, pos, orders) {
  return worstPoint(state, cash, pos, orders).min;
}

/** The worst wealth over every reachable S, and the S it happens at. */
function worstPoint(state, cash, pos, orders) {
  const { lo, hi } = bounds(state);
  const K = state.K ?? grid(state, "fut").K;
  let min = Infinity;
  let at = lo;
  for (let S = lo; S <= hi; S++) {
    let w = cash;
    for (const k of BOOK_ORDER) if (pos[k]) w += pos[k] * payoff(k, S, K) * SHARE_C;
    for (const o of orders) w -= reserveAtC(o, S, K);
    if (w < min) {
      min = w;
      at = S;
    }
  }
  return { min, at };
}

export function myOrders(state, pid) {
  const out = [];
  for (const k of BOOK_ORDER) for (const o of state.books[k].orders) if (o.pid === pid) out.push(o);
  return out;
}

/**
 * What one resting order is holding, as shown to its owner: the most it could
 * lose over the sums still possible.
 */
export function holdC(state, o) {
  const { lo, hi } = bounds(state);
  const K = state.K ?? grid(state, "fut").K;
  const [minPay, maxPay] = payRange(o.mkt, lo, hi, K);
  return (o.side === "B" ? pos0(o.px - minPay) : pos0(maxPay - o.px)) * o.qty * SHARE_C;
}

/**
 * The player's headroom and what each side of their book is holding.
 * `freeC` is the invariant itself: the least their wealth can be at any sum
 * still possible, with everything resting counted against them.
 */
export function powers(state, p) {
  let bidC = 0;
  let askC = 0;
  const mine = myOrders(state, p.id);
  for (const o of mine) {
    const h = holdC(state, o);
    if (o.side === "B") bidC += h;
    else askC += h;
  }
  const w = worstPoint(state, p.cash, p.pos, mine);
  return { bidC, askC, freeC: w.min, worstS: w.at };
}

/** Cash a player may spend outright without breaking the invariant. */
export function spendableC(state, p) {
  return Math.max(0, powers(state, p).freeC);
}

/* ── book ─────────────────────────────────────────────────────────────── */

/**
 * Everything this order would do, worked out without touching anything.
 *
 * The returned steps are the exact script the order then follows, so what the
 * balance check judged and what the book actually does cannot drift apart —
 * which is the only thing that makes a post-trade solvency check safe to write.
 *
 * A step is either { kill: id } (self-trade prevention removing one of my own
 * resting orders) or { id, px, qty } (a fill against someone else, at THEIR
 * price, so price improvement goes to the taker).
 */
function planMatch(book, pid, side, px, qty) {
  const steps = [];
  const done = new Set();
  const took = new Map();
  const rest = (o) => o.qty - (took.get(o.id) ?? 0);
  let left = qty;
  let fills = 0;
  for (let guard = 0; left > 0 && guard < LIMITS.maxOpenOrders + LIMITS.maxSharesPerOrder; guard++) {
    let best = null;
    for (const o of book.orders) {
      if (done.has(o.id)) continue;
      if (side === "B") {
        if (o.side !== "A" || o.px > px) continue;
        if (!best || o.px < best.px || (o.px === best.px && o.seq < best.seq)) best = o;
      } else {
        if (o.side !== "B" || o.px < px) continue;
        if (!best || o.px > best.px || (o.px === best.px && o.seq < best.seq)) best = o;
      }
    }
    if (!best) break;
    if (best.pid === pid) {
      steps.push({ kill: best.id });
      done.add(best.id);
      continue;
    }
    const t = Math.min(left, rest(best));
    steps.push({ id: best.id, px: best.px, qty: t });
    took.set(best.id, (took.get(best.id) ?? 0) + t);
    left -= t;
    fills++;
    if (rest(best) <= 0) done.add(best.id);
  }
  return { steps, left, fills };
}

/**
 * The invariant once `plan` has run and `restQty` shares are left resting.
 * Charges each fill the price it would really print at, moves the position,
 * drops any of my own orders the cross would cancel, and only then asks for
 * the worst wealth over every sum still possible.
 */
function afterPlan(state, p, mkt, side, px, plan, restQty) {
  const dir = side === "B" ? 1 : -1;
  const killed = new Set(plan.steps.filter((s) => s.kill != null).map((s) => s.kill));
  let cash = p.cash;
  const pos = { ...p.pos };
  for (const st of plan.steps) {
    if (st.kill != null) continue;
    cash -= dir * st.px * st.qty * SHARE_C;
    pos[mkt] += dir * st.qty;
  }
  const orders = myOrders(state, p.id).filter((o) => !killed.has(o.id));
  if (restQty > 0) orders.push({ mkt, side, px, qty: restQty });
  return worstC(state, cash, pos, orders);
}

/** Run a plan for real, mirroring planMatch step for step, in the same order. */
function applyPlan(state, book, pid, side, px, plan, restQty, now) {
  const taker = { pid, side };
  const trades = [];
  const selfCanceled = [];
  for (const st of plan.steps) {
    if (st.kill != null) {
      const o = book.orders.find((x) => x.id === st.kill);
      if (o) selfCanceled.push({ id: o.id, px: o.px, qty: o.qty, side: o.side });
      removeOrder(book, st.kill);
      continue;
    }
    const maker = book.orders.find((o) => o.id === st.id);
    trades.push(execute(state, book, taker, maker, st.qty, st.px, now));
    maker.qty -= st.qty;
    if (maker.qty <= 0) removeOrder(book, maker.id);
  }
  let resting = null;
  if (restQty > 0) {
    resting = { id: state.nextOrderId++, pid, mkt: book.key, side, px, qty: restQty, ts: now, seq: state.seq++ };
    book.orders.push(resting);
  }
  return { trades, resting, selfCanceled };
}

function removeOrder(book, id) {
  const i = book.orders.findIndex((o) => o.id === id);
  if (i >= 0) book.orders.splice(i, 1);
}

/** Aggregated depth per price for one book, plus this player's own shares. */
export function bookLevels(state, key, pid) {
  const bids = new Map();
  const asks = new Map();
  for (const o of state.books[key].orders) {
    const m = o.side === "B" ? bids : asks;
    const cur = m.get(o.px) ?? { px: o.px, qty: 0, mine: 0 };
    cur.qty += o.qty;
    if (o.pid === pid) cur.mine += o.qty;
    m.set(o.px, cur);
  }
  return {
    bids: [...bids.values()].sort((a, b) => b.px - a.px),
    asks: [...asks.values()].sort((a, b) => a.px - b.px),
  };
}

export function bestBid(state, key) {
  let b = null;
  for (const o of state.books[key].orders) if (o.side === "B" && (b === null || o.px > b)) b = o.px;
  return b;
}
export function bestAsk(state, key) {
  let a = null;
  for (const o of state.books[key].orders) if (o.side === "A" && (a === null || o.px < a)) a = o.px;
  return a;
}

/**
 * The midpoint of one book: the mid of the touch if there are two sides, then
 * the last trade, then the uniform-prior fair value.
 */
export function midPx(state, key) {
  const b = bestBid(state, key);
  const a = bestAsk(state, key);
  if (b != null && a != null) return (b + a) / 2;
  const last = state.books[key].last;
  if (last != null) return last;
  if (b != null) return b;
  if (a != null) return a;
  return grid(state, key).center;
}

/**
 * The price the leaderboard marks a book against: the mid of a two-sided
 * book first, then the last print, then the uniform fair value. A single
 * silly print against an empty book should not be able to move everyone's
 * portfolio.
 */
export function markPx(state, key) {
  return midPx(state, key);
}

/** The mid of the touch, or null when the book is not two-sided. */
export function touchMid(state, key) {
  const b = bestBid(state, key);
  const a = bestAsk(state, key);
  return b != null && a != null ? (b + a) / 2 : null;
}

/* ── trading ──────────────────────────────────────────────────────────── */

function pushFill(p, fill) {
  p.fills.push(fill);
  if (p.fills.length > LIMITS.fillsKept) p.fills.splice(0, p.fills.length - LIMITS.fillsKept);
}

function execute(state, book, taker, maker, qty, px, now) {
  const buyer = taker.side === "B" ? state.players[taker.pid] : state.players[maker.pid];
  const seller = taker.side === "B" ? state.players[maker.pid] : state.players[taker.pid];
  const cashC = px * qty * SHARE_C;

  buyer.cash -= cashC;
  buyer.pos[book.key] += qty;
  seller.cash += cashC;
  seller.pos[book.key] -= qty;

  book.last = px;
  book.volume += qty;
  const s = state.seq++;
  book.tape.unshift({ s, px, qty, ts: now, aggr: taker.side });
  if (book.tape.length > LIMITS.tapeLength) book.tape.length = LIMITS.tapeLength;

  pushFill(buyer, { s, mkt: book.key, market: book.key, side: "B", px, qty, ts: now, taker: taker.side === "B", cp: seller.name });
  pushFill(seller, { s, mkt: book.key, market: book.key, side: "A", px, qty, ts: now, taker: taker.side === "A", cp: buyer.name });

  return { s, px, qty, buyer: buyer.id, seller: seller.id };
}

/**
 * Place a limit order in one book. Crosses what it can at the RESTING side's
 * prices (price improvement goes to the taker), then rests the remainder.
 * Self-trade prevention cancels the resting order and keeps going.
 *
 * If the resting remainder is the only thing that would break the invariant,
 * the order becomes immediate-or-cancel: the crossing part trades and the rest
 * is dropped, reported back as `canceled`.
 */
export function placeOrder(state, pid, mkt, side, px, qty, now) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  if (state.status !== "live") throw new EngineError("the market is closed", "closed");
  if (!p.teamId) throw new EngineError("join or create a team before you trade", "no-team");
  const book = state.books[mkt];
  if (!book) throw new EngineError("no such book", "no-book");
  if (!book.open) throw new EngineError(`${mkt === "fut" ? "the sum" : `the ${mkt}`} is not open for trading yet`, "book-shut");
  if (side !== "B" && side !== "A") throw new EngineError("bad side");

  const g = grid(state, mkt);
  if (!Number.isInteger(px) || px < g.orderMin || px > g.orderMax) {
    throw new EngineError(`that price is off the ladder (${g.orderMin} to ${g.orderMax})`, "off-range");
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.maxSharesPerOrder) {
    throw new EngineError(`size must be 1 to ${LIMITS.maxSharesPerOrder} shares`);
  }
  let open = 0;
  for (const k of BOOK_ORDER) open += state.books[k].orders.length;
  if (open >= LIMITS.maxOpenOrders) throw new EngineError("the book is full", "book-full");

  const mine = myOrders(state, pid).length;
  if (mine >= LIMITS.maxOrdersPerPlayer) {
    throw new EngineError(`you already have ${LIMITS.maxOrdersPerPlayer} resting orders — cancel some first`, "too-many");
  }

  const plan = planMatch(book, pid, side, px, qty);
  const whole = afterPlan(state, p, mkt, side, px, plan, plan.left);

  let ioc = false;
  if (whole < 0) {
    const canIOC = plan.fills > 0 && plan.left > 0;
    const crossOnly = canIOC ? afterPlan(state, p, mkt, side, px, plan, 0) : whole;
    if (canIOC && crossOnly >= 0) {
      ioc = true;
    } else {
      throw new EngineError(
        `out of balance — ${qty} share${qty > 1 ? "s" : ""} at ${px} could leave you ${fmt(-whole)} short if the numbers go against you. ` +
          `cancel some resting orders, or try fewer shares.`,
        "balance"
      );
    }
  }

  const { trades, resting, selfCanceled } = applyPlan(state, book, pid, side, px, plan, ioc ? 0 : plan.left, now);
  return { trades, resting, filled: qty - plan.left, canceled: ioc ? plan.left : 0, ioc, selfCanceled };
}

export function cancelOrder(state, pid, orderId) {
  for (const k of BOOK_ORDER) {
    const book = state.books[k];
    const o = book.orders.find((x) => x.id === orderId);
    if (!o) continue;
    if (o.pid !== pid) throw new EngineError("not your order", "not-yours");
    removeOrder(book, orderId);
    return { canceled: 1, qty: o.qty };
  }
  throw new EngineError("that order is already gone", "gone");
}

/** Cancel everything this player has resting at one price on one side of one book. */
export function cancelLevel(state, pid, mkt, side, px) {
  const book = state.books[mkt];
  if (!book) throw new EngineError("no such book", "no-book");
  let n = 0;
  let qty = 0;
  for (let i = book.orders.length - 1; i >= 0; i--) {
    const o = book.orders[i];
    if (o.pid === pid && o.side === side && o.px === px) {
      qty += o.qty;
      n++;
      book.orders.splice(i, 1);
    }
  }
  if (!n) throw new EngineError("nothing of yours resting there", "gone");
  return { canceled: n, qty };
}

/** Cancel everything this player has resting, in every book (or one). */
export function cancelAll(state, pid, mkt = null) {
  let canceled = 0;
  let qty = 0;
  for (const k of BOOK_ORDER) {
    if (mkt && k !== mkt) continue;
    const book = state.books[k];
    const before = book.orders.length;
    qty += book.orders.reduce((t, o) => t + (o.pid === pid ? o.qty : 0), 0);
    book.orders = book.orders.filter((o) => o.pid !== pid);
    canceled += before - book.orders.length;
  }
  return { canceled, qty };
}

/** Shut or open one book. Shutting pulls everything resting in it. */
export function setBookOpen(state, mkt, open) {
  const book = state.books[mkt];
  if (!book) throw new EngineError("no such book", "no-book");
  book.open = !!open;
  if (!open) book.orders = [];
  return book.open;
}

/* ── settlement ───────────────────────────────────────────────────────── */

/**
 * Pull every resting order (they do not fill at the bell), then pay each share
 * its book's payoff at S, in cents. Idempotent: a settled market settles once.
 */
export function settle(state, S, now) {
  if (state.status === "settled") return state;
  const K = state.K ?? grid(state, "fut").K;
  const payouts = Object.fromEntries(BOOK_ORDER.map((k) => [k, payoff(k, S, K)]));
  for (const k of BOOK_ORDER) state.books[k].orders = [];
  for (const p of Object.values(state.players)) {
    p.settledPos = { ...p.pos };
    for (const k of BOOK_ORDER) p.cash += p.pos[k] * payouts[k] * SHARE_C;
    p.pos = zeroPos();
  }
  state.status = "settled";
  state.settleS = S;
  state.payouts = payouts;
  state.settledAt = now;
  return state;
}

/* ── views ────────────────────────────────────────────────────────────── */

/** Mark-to-market value in cents. After settlement it is simply the cash. */
export function valueC(state, p, marks = null) {
  if (state.status === "settled") return p.cash;
  const m = marks ?? allMarks(state);
  let v = p.cash;
  for (const k of BOOK_ORDER) v += p.pos[k] * m[k] * SHARE_C;
  return Math.round(v);
}

export function allMarks(state) {
  return Object.fromEntries(BOOK_ORDER.map((k) => [k, markPx(state, k)]));
}

const posView = (state, p) => (state.status === "settled" ? p.settledPos ?? zeroPos() : p.pos);

/**
 * The leaderboard is by TEAM, and a team's score is the AVERAGE of its members'
 * portfolios, not the sum. A table of three and a table of four then play the
 * same game. Hidden tables (the desks) trade but never compete.
 */
export function leaderboard(state, limit = 100) {
  const marks = allMarks(state);
  const rows = [];
  for (const team of Object.values(state.teams ?? {})) {
    if (team.hidden) continue;
    const members = team.members
      .map((pid) => state.players[pid])
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        name: p.name,
        valueC: valueC(state, p, marks),
        cashC: p.cash,
        pos: { ...posView(state, p) },
        startC: p.startC,
        spentC: p.spentC,
      }))
      .sort((a, b) => b.valueC - a.valueC);
    if (!members.length) continue;
    const totalC = members.reduce((s, m) => s + m.valueC, 0);
    const startC = members.reduce((s, m) => s + m.startC, 0);
    rows.push({
      id: team.id,
      name: team.name,
      valueC: Math.round(totalC / members.length),
      startC: Math.round(startC / members.length),
      totalC,
      totalStartC: startC,
      size: members.length,
      members,
    });
  }
  return rows
    .sort((a, b) => b.valueC - a.valueC || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

/* ── teams and their numbers ──────────────────────────────────────────── */

/** Codes avoid 0/O and 1/I so nobody mistypes one across a lecture hall. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeTeamCode(state, randomInt) {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = "";
    for (let i = 0; i < LIMITS.codeLength; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!state.codes[code]) return code;
  }
  throw new EngineError("could not allocate a team code — too many teams", "full");
}

const teamSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * A team forms with its number. Once trading has opened the pot is sealed:
 * a new team would change N and S under everybody's positions, so there are
 * no new teams — late arrivals join an existing one.
 */
export function createTeam(state, pid, name, teamId, code, number, now) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  if (p.teamId) throw new EngineError("you are already on a team", "has-team");
  if (state.locked) throw new EngineError("the numbers are locked for this round — join a team with its code instead", "locked");
  if (teamCount(state) >= LIMITS.maxTeams) throw new EngineError(`the room is full — ${LIMITS.maxTeams} teams at most`, "full");
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > LIMITS.teamNameMax) {
    throw new EngineError(`team name must be 2–${LIMITS.teamNameMax} characters`);
  }
  if (!teamSlug(clean)) throw new EngineError("team name needs some letters or numbers");
  if (!Number.isInteger(number) || number < 0 || number > NUMBER_MAX) {
    throw new EngineError(`pick a whole number from 0 to ${NUMBER_MAX}`, "bad-number");
  }
  for (const t of Object.values(state.teams)) {
    if (!t.hidden && teamSlug(t.name) === teamSlug(clean)) throw new EngineError("a team already has that name", "name-taken");
  }
  const team = {
    id: teamId,
    name: clean,
    code,
    members: [pid],
    createdAt: now ?? Date.now(),
    owner: pid,
    number,
    pickedBy: pid,
    pickedAt: now ?? Date.now(),
    drawn: false,
  };
  state.teams[teamId] = team;
  state.codes[code] = teamId;
  p.teamId = teamId;
  return team;
}

/** Any member may set the team's number while the pot is still open. */
export function setTeamNumber(state, pid, number, now) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  const team = p.teamId ? state.teams[p.teamId] : null;
  if (!team) throw new EngineError("join or create a team first", "no-team");
  if (state.locked) throw new EngineError("the numbers are locked — yours is in and cannot change", "locked");
  if (!Number.isInteger(number) || number < 0 || number > NUMBER_MAX) {
    throw new EngineError(`pick a whole number from 0 to ${NUMBER_MAX}`, "bad-number");
  }
  team.number = number;
  team.pickedBy = pid;
  team.pickedAt = now ?? Date.now();
  team.drawn = false;
  return team;
}

export function joinTeam(state, pid, code) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  if (p.teamId) throw new EngineError("you are already on a team", "has-team");
  const key = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const teamId = state.codes[key];
  const team = teamId ? state.teams[teamId] : null;
  if (!team || team.hidden) throw new EngineError("no team has that code — check it with whoever made the team", "no-team");
  if (team.members.length >= LIMITS.teamSize) {
    throw new EngineError(`${team.name} is full (${LIMITS.teamSize} players max)`, "team-full");
  }
  team.members.push(pid);
  p.teamId = teamId;
  return team;
}

/**
 * Leaving is only allowed while you are flat and have nothing resting, and
 * only before the pot is sealed: a team is a number in the pot, and a team
 * that vanished mid-round would take its number with it. A team left with no
 * members after the lock simply stays, number and all.
 */
export function leaveTeam(state, pid, { force = false } = {}) {
  const p = state.players[pid];
  if (!p || !p.teamId) throw new EngineError("you are not on a team", "no-team");
  if (state.locked && !force) throw new EngineError("teams are locked once trading opens", "locked");
  if (BOOK_ORDER.some((k) => p.pos[k] !== 0)) throw new EngineError("settle your positions before leaving a team", "has-position");
  if (myOrders(state, pid).length) throw new EngineError("cancel your orders before leaving a team", "has-orders");
  const team = state.teams[p.teamId];
  if (team) {
    team.members = team.members.filter((m) => m !== pid);
    if (!team.members.length && !state.locked) {
      delete state.codes[team.code];
      delete state.teams[team.id];
    } else if (team.owner === pid) {
      team.owner = team.members[0] ?? null;
    }
  }
  p.teamId = null;
  return { ok: true };
}

/** The team as its own members see it — the only view that carries the number. */
export function teamView(state, p) {
  if (!p?.teamId) return null;
  const team = state.teams[p.teamId];
  if (!team) return null;
  const marks = allMarks(state);
  const members = team.members
    .map((pid) => state.players[pid])
    .filter(Boolean)
    .map((m) => ({
      id: m.id,
      name: m.name,
      valueC: valueC(state, m, marks),
      pos: { ...posView(state, m) },
      me: m.id === p.id,
    }))
    .sort((a, b) => b.valueC - a.valueC);
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    size: members.length,
    max: LIMITS.teamSize,
    valueC: Math.round(members.reduce((s, m) => s + m.valueC, 0) / (members.length || 1)),
    totalC: members.reduce((s, m) => s + m.valueC, 0),
    members,
    number: team.number ?? null,
    pickedBy: team.pickedBy ? state.players[team.pickedBy]?.name ?? null : null,
    drawn: !!team.drawn,
    canPick: !state.locked,
  };
}

/* ── formatting and audit ─────────────────────────────────────────────── */

export function fmt(cents) {
  const neg = cents < 0;
  const v = Math.abs(cents) / 100;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "-" : ""}$${s}`;
}

/** Every invariant the engine promises, checked. Used by tests and by /health. */
export function auditState(state) {
  const problems = [];
  for (const p of Object.values(state.players)) {
    const w = worstC(state, p.cash, p.pos, myOrders(state, p.id));
    if (w < 0) problems.push(`${p.name}: could end ${fmt(w)} short at some reachable sum (cash ${p.cash}, pos ${JSON.stringify(p.pos)})`);
    if (!Number.isInteger(p.cash)) problems.push(`${p.name}: cash is not an integer number of cents`);
    for (const k of BOOK_ORDER) if (!Number.isInteger(p.pos[k])) problems.push(`${p.name}: ${k} position is not an integer`);
  }
  // Each book is zero-sum in shares: they only ever move between players.
  for (const k of BOOK_ORDER) {
    let pos = 0;
    for (const p of Object.values(state.players)) pos += posView(state, p)[k] ?? 0;
    if (pos !== 0) problems.push(`${k}: open interest does not net to zero: ${pos}`);
  }
  // Trades only move cash between players, so total cash is the starting money
  // less what the room spent — until settlement, when the payouts land. After
  // settlement every book's payout nets to zero across players too (positions
  // net to zero), so the identity still holds.
  let cash = 0;
  let start = 0;
  let spent = 0;
  for (const p of Object.values(state.players)) {
    cash += p.cash;
    start += p.startC;
    spent += p.spentC;
  }
  if (cash !== start - spent) problems.push(`cash does not reconcile: ${cash} vs ${start - spent}`);

  for (const k of BOOK_ORDER) {
    const book = state.books[k];
    for (const o of book.orders) {
      if (!state.players[o.pid]) problems.push(`order ${o.id} belongs to nobody`);
      if (o.qty <= 0) problems.push(`order ${o.id} has non-positive size`);
      if (o.mkt !== k) problems.push(`order ${o.id} is in the wrong book`);
      if (!onTick(state, k, o.px)) problems.push(`order ${o.id} is off the ladder at ${o.px}`);
      if (!book.open) problems.push(`order ${o.id} is resting in a shut book`);
    }
    const b = bestBid(state, k);
    const a = bestAsk(state, k);
    if (b != null && a != null && b >= a) problems.push(`${k} book is crossed: ${b} / ${a}`);
  }
  for (const t of Object.values(state.teams ?? {})) {
    if (!t.hidden && t.members.length > LIMITS.teamSize) problems.push(`team ${t.name} has ${t.members.length} members`);
    if (!t.hidden && state.codes[t.code] !== t.id) problems.push(`team ${t.name} has a dangling code`);
    if (!t.hidden && state.locked && !Number.isInteger(t.number)) problems.push(`team ${t.name} has no number after the lock`);
    for (const pid of t.members) {
      if (state.players[pid]?.teamId !== t.id) problems.push(`team ${t.name} lists a player who is not on it`);
    }
  }
  for (const p of Object.values(state.players)) {
    if (p.teamId && !state.teams[p.teamId]?.members.includes(p.id)) {
      problems.push(`${p.name} points at a team that does not list them`);
    }
  }
  if (state.locked) {
    const teams = Object.values(state.teams).filter((t) => !t.hidden);
    if (teams.length !== state.N) problems.push(`N is ${state.N} but there are ${teams.length} teams`);
    if (state.revealed.length > state.N) problems.push(`more numbers revealed than teams`);
    if (state.revealed.length === state.N) {
      const S = teams.reduce((s, t) => s + t.number, 0);
      const R = revealedNumbers(state).reduce((s, n) => s + n, 0);
      if (R !== S) problems.push(`the revealed numbers sum to ${R} but the teams' numbers sum to ${S}`);
      if (state.status === "settled" && state.settleS !== R) problems.push(`settled at ${state.settleS} but the numbers sum to ${R}`);
    }
    if (state.status === "settled") {
      const { lo, hi } = bounds(state);
      if (state.settleS < lo || state.settleS > hi) problems.push(`settled at ${state.settleS}, outside the reachable ${lo}..${hi}`);
    }
  }
  return problems;
}
