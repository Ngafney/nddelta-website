/**
 * The matching engine and the balance rules. Pure functions over a plain state
 * object — no I/O, no clock of its own — so the server can run them inside a
 * compare-and-swap transaction and the tests can hammer them directly.
 *
 * ── The contract ─────────────────────────────────────────────────────────
 * One share settles at S. Long a share: you paid the price now, you receive S at
 * the end. Short a share: you received the price now, you pay S at the end.
 *
 * Two ranges matter, and they are deliberately NOT the same range:
 *
 *   settleMin / settleMax   where S can possibly land: 0 to 100, because the
 *                           contract pays 100 × a probability.
 *   orderMin / orderMax      how far the ladder lets you price an order: 1 to 99,
 *                           like a prediction market. (Week 2 ran the ladder far
 *                           past the settlement range to hide it; here the range
 *                           is common knowledge, so there is nothing to hide.)
 *
 * Either bound may be negative; nothing below assumes otherwise.
 *
 * ── Money ────────────────────────────────────────────────────────────────
 * All money is INTEGER CENTS. Prices are integer dollars on the tick grid, so
 * a share costs px * 100 cents exactly and nothing ever drifts.
 *
 * ── Why nobody can go bust (the part that must not be wrong) ─────────────
 * Final cash is linear in S, so its worst case over [settleMin, settleMax] is
 * at one of the two endpoints. That gives two invariants, and every resting
 * order contributes to whichever one it can hurt:
 *
 *   (A)  cash + settleMin*position  >=  reserveA
 *   (B)  cash + settleMax*position  >=  reserveB
 *
 *        a resting BID at px, q shares:  reserveA += (px - settleMin)+ * q
 *                                      reserveB += (px - settleMax)+ * q
 *        a resting OFFER at px, q:     reserveB += (settleMax - px)+ * q
 *                                      reserveA += (settleMin - px)+ * q
 *
 * (x+ means max(0, x).) The usual two terms are the first and third: a bid
 * hurts you if settlement comes in low, an offer hurts you if it comes in
 * high. The other two are what let the ladder run past the settlement range
 * at all — a bid priced ABOVE the highest possible settlement loses money on
 * every fill, so it has to be margined against invariant B as well, and
 * symmetrically for an offer below the lowest. Without those terms a bid above
 * settleMax degrades (B) on each fill and can be walked into a negative
 * balance; with them, EVERY price is safe to quote.
 *
 * Both invariants are checked BEFORE an order is accepted, at the order's limit
 * price and full size — the most expensive thing that order could ever do — and
 * both are preserved by every fill. For a bid at px filling q shares:
 *
 *     Δ(cash + settleMin*position) = -(px - settleMin)*q   = -Δ reserveA   ✓
 *     Δ(cash + settleMax*position) = -(px - settleMax)*q   = -Δ reserveB   ✓
 *
 * and symmetrically for an offer. So both invariants are exactly conserved by
 * fills, whatever the price, and a player who was solvent when an order was
 * accepted is solvent after any sequence of fills. Since final cash is
 * cash + position*S and S lies between the two endpoints, settlement cannot
 * push anyone below zero either.
 *
 * Crossing only improves things: a buy that executes at px' <= px spends less
 * than the check assumed. Spending cash on information is checked against BOTH
 * invariants for the same reason. See test/engine.test.js, which asserts all of
 * this over random storms and over settlement at every reachable price.
 */

import { LIMITS, MONEY, MODES } from "./rules.js";

export class EngineError extends Error {
  constructor(message, code = "rejected") {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

const SHARE_C = 100; // cents per dollar of price, per share
const pos0 = (v) => (v > 0 ? v : 0);

/* ── state ────────────────────────────────────────────────────────────── */

export function newMarket(round) {
  const mode = round.mode ?? "coin";
  const m = MODES[mode] ?? MODES.coin;
  const settleMin = round.settleMin ?? m.settleMin;
  const settleMax = round.settleMax ?? m.settleMax;
  const tick = round.tick ?? m.tick;
  // The ladder runs far outside the settlement range so it never shows a wall.
  const pad = (settleMax - settleMin) * (m.ladderPad ?? 8);
  return {
    roundId: round.roundId,
    mode,
    difficulty: round.difficulty,
    question: round.question ?? null,
    settleMin,
    settleMax,
    tick,
    orderMin: round.orderMin ?? m.orderMin ?? snapDown(settleMin - pad, settleMin, tick),
    orderMax: round.orderMax ?? m.orderMax ?? snapUp(settleMax + pad, settleMin, tick),
    /** Where the ladder opens. The one number about the range players do see. */
    center: round.center ?? Math.round((settleMin + settleMax) / 2),
    // lobby → sims → live → settled. "sims" is the pre-trading window where
    // players choose how many flips to buy; the book is shut until it ends.
    status: "lobby",
    startedAt: null,
    endsAt: null,
    startCashC: round.startCashC ?? MONEY.startCashC,
    simCostC: round.simCostC ?? MONEY.simCostC,
    defaultSize: round.defaultSize ?? LIMITS.defaultOrderSize,
    lateJoin: round.lateJoin !== false,
    players: {},
    teams: {},
    codes: {},
    devices: {},
    orders: [],
    nextOrderId: 1,
    seq: 1,
    last: null,
    tape: [],
    volume: 0,
    settleC: null,
    xStar: null,
  };
}

const snapDown = (v, base, tick) => base + Math.floor((v - base) / tick) * tick;
const snapUp = (v, base, tick) => base + Math.ceil((v - base) / tick) * tick;

export function newPlayer(pid, name, deviceId, cashC, now) {
  return {
    id: pid,
    name,
    device: deviceId,
    teamId: null,
    cash: cashC,
    pos: 0,
    spentC: 0,
    // Flips ordered during the simulation window, and what they came up.
    simOrder: 0,
    sims: null,
    fills: [],
    joinedAt: now,
    settledPos: null,
    startC: cashC,
  };
}

/** The round's price grid. Fallbacks keep an older document readable. */
export function grid(state) {
  return {
    settleMin: state.settleMin ?? 0,
    settleMax: state.settleMax ?? 100,
    orderMin: state.orderMin ?? 0,
    orderMax: state.orderMax ?? 100,
    tick: state.tick ?? 1,
    center: state.center ?? 50,
  };
}

export function onTick(state, px) {
  const g = grid(state);
  return Number.isInteger(px) && px >= g.orderMin && px <= g.orderMax && (px - g.settleMin) % g.tick === 0;
}

/** Snap any number onto the nearest quotable tick. */
export function snapTick(state, px) {
  const g = grid(state);
  const snapped = g.settleMin + Math.round((px - g.settleMin) / g.tick) * g.tick;
  return Math.min(g.orderMax, Math.max(g.orderMin, snapped));
}

/* ── balances ─────────────────────────────────────────────────────────── */

/** What one share on this side at this price ties up, against each invariant. */
export function lotReserveC(g, side, px) {
  if (side === "B") {
    return { a: pos0(px - g.settleMin) * SHARE_C, b: pos0(px - g.settleMax) * SHARE_C };
  }
  return { a: pos0(g.settleMin - px) * SHARE_C, b: pos0(g.settleMax - px) * SHARE_C };
}

/** What this player's resting orders tie up, in cents. Derived, never stored. */
export function reserves(state, pid) {
  const g = grid(state);
  let a = 0;
  let b = 0;
  let bidC = 0;
  let askC = 0;
  for (const o of state.orders) {
    if (o.pid !== pid) continue;
    const r = lotReserveC(g, o.side, o.px);
    a += r.a * o.qty;
    b += r.b * o.qty;
    // What the player is shown: the money each side of their book is holding.
    if (o.side === "B") bidC += (r.a + r.b) * o.qty;
    else askC += (r.a + r.b) * o.qty;
  }
  return { a, b, bidC, askC };
}

/**
 * The two invariants as headroom numbers. `buyC` and `sellC` are how much more
 * reserve each invariant can still absorb.
 */
export function powers(state, p) {
  const g = grid(state);
  const { a, b, bidC, askC } = reserves(state, p.id);
  return {
    bidC,
    askC,
    reserveA: a,
    reserveB: b,
    buyC: p.cash + g.settleMin * SHARE_C * p.pos - a,
    sellC: p.cash + g.settleMax * SHARE_C * p.pos - b,
  };
}

/** Most shares this player could post on one side at this price. */
export function maxSharesAt(state, p, side, px) {
  const g = grid(state);
  const pw = powers(state, p);
  const r = lotReserveC(g, side, px);
  let n = LIMITS.maxSharesPerOrder;
  if (r.a > 0) n = Math.min(n, Math.floor(pw.buyC / r.a));
  if (r.b > 0) n = Math.min(n, Math.floor(pw.sellC / r.b));
  return Math.max(0, n);
}

/** Cash a player may spend outright (information) without breaking A or B. */
export function spendableC(state, p) {
  const pw = powers(state, p);
  return Math.max(0, Math.min(pw.buyC, pw.sellC));
}

/** The price of one simulated flip this round. */
export const simCostC = (state) => state?.simCostC ?? MONEY.simCostC;

/* ── book ─────────────────────────────────────────────────────────────── */

/**
 * Everything this order would do, worked out without touching anything.
 *
 * The returned steps are the exact script the order then follows, so what the
 * balance check judged and what the book actually does cannot drift apart --
 * which is the only thing that makes a post-trade solvency check safe to write.
 *
 * A step is either { kill: id } (self-trade prevention removing one of my own
 * resting orders) or { id, px, qty } (a fill against someone else, at THEIR
 * price, so price improvement goes to the taker).
 */
function planMatch(state, pid, side, px, qty) {
  const steps = [];
  const done = new Set(); // makers exhausted, or my own orders already killed
  const took = new Map(); // orderId -> shares this plan has already taken
  const rest = (o) => o.qty - (took.get(o.id) ?? 0);
  let left = qty;
  let fills = 0;
  // Bounded: every pass either fills a resting order or removes one.
  for (let guard = 0; left > 0 && guard < LIMITS.maxOpenOrders + LIMITS.maxSharesPerOrder; guard++) {
    let best = null;
    for (const o of state.orders) {
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
 * Where both invariants would stand once `plan` has run and `restQty` shares
 * are left sitting on the book.
 *
 * This is the real solvency test. It charges each fill the price it actually
 * prints at rather than the order's limit, moves the position, hands back the
 * reserve of any of my own orders the cross cancels, and only then asks
 * whether I am still good at both ends of the settlement range.
 */
function afterPlan(state, p, side, px, plan, restQty) {
  const g = grid(state);
  const dir = side === "B" ? 1 : -1;
  const { a, b } = reserves(state, p.id);
  let cash = p.cash;
  let pos = p.pos;
  let ra = a;
  let rb = b;
  for (const st of plan.steps) {
    if (st.kill != null) {
      const o = state.orders.find((x) => x.id === st.kill);
      if (!o) continue;
      const r = lotReserveC(g, o.side, o.px);
      ra -= r.a * o.qty;
      rb -= r.b * o.qty;
      continue;
    }
    cash -= dir * st.px * st.qty * SHARE_C;
    pos += dir * st.qty;
  }
  if (restQty > 0) {
    const r = lotReserveC(g, side, px);
    ra += r.a * restQty;
    rb += r.b * restQty;
  }
  return { A: cash + g.settleMin * SHARE_C * pos - ra, B: cash + g.settleMax * SHARE_C * pos - rb };
}

/** Run a plan for real, mirroring planMatch step for step, in the same order. */
function applyPlan(state, pid, side, px, plan, restQty, now) {
  const taker = { pid, side };
  const trades = [];
  for (const st of plan.steps) {
    if (st.kill != null) {
      removeOrder(state, st.kill); // self-trade prevention: cancel, print nothing
      continue;
    }
    const maker = state.orders.find((o) => o.id === st.id);
    trades.push(execute(state, taker, maker, st.qty, st.px, now));
    maker.qty -= st.qty;
    if (maker.qty <= 0) removeOrder(state, maker.id);
  }
  let resting = null;
  if (restQty > 0) {
    resting = { id: state.nextOrderId++, pid, side, px, qty: restQty, ts: now, seq: state.seq++ };
    state.orders.push(resting);
  }
  return { trades, resting };
}

function removeOrder(state, id) {
  const i = state.orders.findIndex((o) => o.id === id);
  if (i >= 0) state.orders.splice(i, 1);
}

/** Aggregated depth per tick, plus this player's own shares at each tick. */
export function bookLevels(state, pid) {
  const bids = new Map();
  const asks = new Map();
  for (const o of state.orders) {
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

export function bestBid(state) {
  let b = null;
  for (const o of state.orders) if (o.side === "B" && (b === null || o.px > b)) b = o.px;
  return b;
}
export function bestAsk(state) {
  let a = null;
  for (const o of state.orders) if (o.side === "A" && (a === null || o.px < a)) a = o.px;
  return a;
}

/**
 * The midpoint of the market: the mid of the touch if there are two sides, then
 * the last trade, then wherever the ladder opened. This is what "jump to the
 * middle" jumps to and what the leaderboard marks against.
 */
export function midPx(state) {
  const b = bestBid(state);
  const a = bestAsk(state);
  if (b != null && a != null) return (b + a) / 2;
  if (state.last != null) return state.last;
  if (b != null) return b;
  if (a != null) return a;
  return grid(state).center;
}

/** The price the leaderboard marks against: last trade, else the mid. */
export function markPx(state) {
  if (state.last != null) return state.last;
  return midPx(state);
}

/* ── trading ──────────────────────────────────────────────────────────── */

function pushFill(p, fill) {
  p.fills.push(fill);
  if (p.fills.length > LIMITS.fillsKept) p.fills.splice(0, p.fills.length - LIMITS.fillsKept);
}

function execute(state, taker, maker, qty, px, now) {
  const buyer = taker.side === "B" ? state.players[taker.pid] : state.players[maker.pid];
  const seller = taker.side === "B" ? state.players[maker.pid] : state.players[taker.pid];
  const cashC = px * qty * SHARE_C;

  buyer.cash -= cashC;
  buyer.pos += qty;
  seller.cash += cashC;
  seller.pos -= qty;

  state.last = px;
  state.volume += qty;
  const s = state.seq++;
  state.tape.unshift({ s, px, qty, ts: now, aggr: taker.side });
  if (state.tape.length > LIMITS.tapeLength) state.tape.length = LIMITS.tapeLength;

  pushFill(buyer, { s, side: "B", px, qty, ts: now, taker: taker.side === "B", cp: seller.name });
  pushFill(seller, { s, side: "A", px, qty, ts: now, taker: taker.side === "A", cp: buyer.name });

  return { s, px, qty, buyer: buyer.id, seller: seller.id };
}

/**
 * Place a limit order. Crosses what it can at the RESTING side's prices
 * (price improvement goes to the taker), then rests the remainder.
 * Self-trade prevention cancels the resting order and keeps going, so a player
 * can never print a trade against themselves and move the mark.
 *
 * If the resting remainder is the only thing that would break solvency, the
 * order becomes immediate-or-cancel: the crossing part trades and the rest is
 * dropped, reported back as `canceled`. This is the true solvency condition
 * and never looser than it -- a fill is judged at the price it printed.
 */
export function placeOrder(state, pid, side, px, qty, now) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  if (state.status !== "live") throw new EngineError("the market is closed", "closed");
  if (!p.teamId) throw new EngineError("join or create a team before you trade", "no-team");
  if (side !== "B" && side !== "A") throw new EngineError("bad side");

  const g = grid(state);
  if (!Number.isInteger(px) || px < g.orderMin || px > g.orderMax) {
    throw new EngineError("that price is off the ladder", "off-range");
  }
  if ((px - g.settleMin) % g.tick !== 0) {
    throw new EngineError(`price must be on the ${g.tick}-tick grid`, "off-tick");
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.maxSharesPerOrder) {
    throw new EngineError(`size must be 1 to ${LIMITS.maxSharesPerOrder} shares`);
  }
  if (state.orders.length >= LIMITS.maxOpenOrders) throw new EngineError("the book is full", "book-full");

  const mine = state.orders.reduce((n, o) => n + (o.pid === pid ? 1 : 0), 0);
  if (mine >= LIMITS.maxOrdersPerPlayer) {
    throw new EngineError(`you already have ${LIMITS.maxOrdersPerPlayer} resting orders — cancel some first`, "too-many");
  }

  // Solvency is judged on the state this order would LEAVE BEHIND, not on the
  // worst case of the whole thing resting at its limit. A cross that fills
  // below its limit is charged what it really paid, and a limit set far
  // through the book to sweep is no longer punished for how far through it is.
  const plan = planMatch(state, pid, side, px, qty);
  const whole = afterPlan(state, p, side, px, plan, plan.left);

  // If the resting remainder is the only thing that breaks it, take what
  // trades right now and drop the rest: immediate-or-cancel. Never silent —
  // the caller is told how much was cut so the player can be told too.
  let ioc = false;
  if (whole.A < 0 || whole.B < 0) {
    const canIOC = plan.fills > 0 && plan.left > 0;
    const crossOnly = canIOC ? afterPlan(state, p, side, px, plan, 0) : whole;
    if (canIOC && crossOnly.A >= 0 && crossOnly.B >= 0) {
      ioc = true;
    } else {
      // One number, drawn from the player's own book, and what to do about it.
      const shortC = -Math.min(whole.A, whole.B);
      throw new EngineError(
        `out of balance — ${qty} share${qty > 1 ? "s" : ""} at ${px} would leave you ${fmt(shortC)} short. ` +
          `cancel some resting orders, or try fewer shares.`,
        "balance"
      );
    }
  }

  const { trades, resting } = applyPlan(state, pid, side, px, plan, ioc ? 0 : plan.left, now);
  return { trades, resting, filled: qty - plan.left, canceled: ioc ? plan.left : 0, ioc };
}

export function cancelOrder(state, pid, orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o) throw new EngineError("that order is already gone", "gone");
  if (o.pid !== pid) throw new EngineError("not your order", "not-yours");
  removeOrder(state, orderId);
  return { canceled: 1, qty: o.qty };
}

/** Cancel everything this player has resting at one price on one side. */
export function cancelLevel(state, pid, side, px) {
  let n = 0;
  let qty = 0;
  for (let i = state.orders.length - 1; i >= 0; i--) {
    const o = state.orders[i];
    if (o.pid === pid && o.side === side && o.px === px) {
      qty += o.qty;
      n++;
      state.orders.splice(i, 1);
    }
  }
  if (!n) throw new EngineError("nothing of yours resting there", "gone");
  return { canceled: n, qty };
}

export function cancelAll(state, pid) {
  const before = state.orders.length;
  const qty = state.orders.reduce((t, o) => t + (o.pid === pid ? o.qty : 0), 0);
  state.orders = state.orders.filter((o) => o.pid !== pid);
  return { canceled: before - state.orders.length, qty };
}

/* ── settlement ───────────────────────────────────────────────────────── */

/**
 * Pull every resting order (they do not fill at the bell), then pay each share
 * the settlement value in cents. Idempotent: a settled market settles once.
 * The caller passes 100·p, or 100/0 for a final flip.
 */
export function settle(state, value, now) {
  if (state.status === "settled") return state;
  const settleC = Math.round(value * SHARE_C);
  state.orders = [];
  for (const p of Object.values(state.players)) {
    p.settledPos = p.pos;
    p.cash += p.pos * settleC;
    p.pos = 0;
  }
  state.status = "settled";
  state.settleC = settleC;
  state.xStar = value;
  state.settledAt = now;
  return state;
}

/* ── views ────────────────────────────────────────────────────────────── */

/** Mark-to-market value in cents. After settlement it is simply the cash. */
export function valueC(state, p, mark = null) {
  if (state.status === "settled") return p.cash;
  const m = mark == null ? markPx(state) : mark;
  return Math.round(p.cash + p.pos * m * SHARE_C);
}

/**
 * The leaderboard is by TEAM, and a team's score is the AVERAGE of its members'
 * portfolios, not the sum. A team of three and a team of four are then playing
 * the same game: adding them up would mean the biggest table wins by turning
 * up, which rewards nothing anyone did.
 *
 * The total is carried along too, because it is the honest answer to "how much
 * money does this team have", but the rank is the average.
 */
export function leaderboard(state, limit = 100) {
  const mark = markPx(state);
  const settled = state.status === "settled";
  const rows = [];
  for (const team of Object.values(state.teams ?? {})) {
    const members = team.members
      .map((pid) => state.players[pid])
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        name: p.name,
        valueC: valueC(state, p, mark),
        cashC: p.cash,
        pos: settled ? p.settledPos ?? 0 : p.pos,
        startC: p.startC,
        spentC: p.spentC,
        sims: p.sims?.n ?? 0,
      }))
      .sort((a, b) => b.valueC - a.valueC);
    if (!members.length) continue;
    const totalC = members.reduce((s, m) => s + m.valueC, 0);
    const startC = members.reduce((s, m) => s + m.startC, 0);
    rows.push({
      id: team.id,
      name: team.name,
      // valueC is the score, and the score is the average.
      valueC: Math.round(totalC / members.length),
      startC: Math.round(startC / members.length),
      totalC,
      totalStartC: startC,
      pos: members.reduce((s, m) => s + m.pos, 0),
      spentC: members.reduce((s, m) => s + m.spentC, 0),
      size: members.length,
      members,
    });
  }
  return rows
    .sort((a, b) => b.valueC - a.valueC || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

/* ── teams ────────────────────────────────────────────────────────────── */

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

export function createTeam(state, pid, name, teamId, code) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  if (p.teamId) throw new EngineError("you are already on a team", "has-team");
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > LIMITS.teamNameMax) {
    throw new EngineError(`team name must be 2–${LIMITS.teamNameMax} characters`);
  }
  if (!teamSlug(clean)) throw new EngineError("team name needs some letters or numbers");
  for (const t of Object.values(state.teams)) {
    if (teamSlug(t.name) === teamSlug(clean)) throw new EngineError("a team already has that name", "name-taken");
  }
  const team = { id: teamId, name: clean, code, members: [pid], createdAt: Date.now(), owner: pid };
  state.teams[teamId] = team;
  state.codes[code] = teamId;
  p.teamId = teamId;
  return team;
}

export function joinTeam(state, pid, code) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  if (p.teamId) throw new EngineError("you are already on a team", "has-team");
  const key = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const teamId = state.codes[key];
  const team = teamId ? state.teams[teamId] : null;
  if (!team) throw new EngineError("no team has that code — check it with whoever made the team", "no-team");
  if (team.members.length >= LIMITS.teamSize) {
    throw new EngineError(`${team.name} is full (${LIMITS.teamSize} players max)`, "team-full");
  }
  team.members.push(pid);
  p.teamId = teamId;
  return team;
}

/** Leaving is only allowed while you are flat and have nothing resting. */
export function leaveTeam(state, pid) {
  const p = state.players[pid];
  if (!p || !p.teamId) throw new EngineError("you are not on a team", "no-team");
  if (p.pos !== 0) throw new EngineError("settle your position before leaving a team", "has-position");
  if (state.orders.some((o) => o.pid === pid)) throw new EngineError("cancel your orders before leaving a team", "has-orders");
  const team = state.teams[p.teamId];
  if (team) {
    team.members = team.members.filter((m) => m !== pid);
    if (!team.members.length) {
      delete state.codes[team.code];
      delete state.teams[team.id];
    } else if (team.owner === pid) {
      team.owner = team.members[0];
    }
  }
  p.teamId = null;
  return { ok: true };
}

export function teamView(state, p) {
  if (!p?.teamId) return null;
  const team = state.teams[p.teamId];
  if (!team) return null;
  const mark = markPx(state);
  const settled = state.status === "settled";
  const members = team.members
    .map((pid) => state.players[pid])
    .filter(Boolean)
    .map((m) => ({
      id: m.id,
      name: m.name,
      valueC: valueC(state, m, mark),
      pos: settled ? m.settledPos ?? 0 : m.pos,
      sims: m.sims?.n ?? 0,
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
  const g = grid(state);
  for (const p of Object.values(state.players)) {
    const { a, b } = reserves(state, p.id);
    if (p.cash + g.settleMin * SHARE_C * p.pos - a < 0) {
      problems.push(`${p.name}: invariant A broken (cash ${p.cash}, pos ${p.pos}, reserve ${a})`);
    }
    if (p.cash + g.settleMax * SHARE_C * p.pos - b < 0) {
      problems.push(`${p.name}: invariant B broken (cash ${p.cash}, pos ${p.pos}, reserve ${b})`);
    }
    if (!Number.isInteger(p.cash)) problems.push(`${p.name}: cash is not an integer number of cents`);
    if (!Number.isInteger(p.pos)) problems.push(`${p.name}: position is not an integer`);
  }
  // The market is zero-sum in shares: they only ever move between players.
  let pos = 0;
  for (const p of Object.values(state.players)) pos += state.status === "settled" ? p.settledPos ?? 0 : p.pos;
  if (pos !== 0) problems.push(`open interest does not net to zero: ${pos}`);

  // Trades only move cash between players, so total cash is always exactly the
  // starting money less what the room burned on information — settled or not.
  let cash = 0;
  let start = 0;
  let spent = 0;
  for (const p of Object.values(state.players)) {
    cash += p.cash;
    start += p.startC;
    spent += p.spentC;
  }
  if (cash !== start - spent) problems.push(`cash does not reconcile: ${cash} vs ${start - spent}`);

  for (const o of state.orders) {
    if (!state.players[o.pid]) problems.push(`order ${o.id} belongs to nobody`);
    if (o.qty <= 0) problems.push(`order ${o.id} has non-positive size`);
    if (!onTick(state, o.px)) problems.push(`order ${o.id} is off the tick grid at ${o.px}`);
  }
  for (const t of Object.values(state.teams ?? {})) {
    if (t.members.length > LIMITS.teamSize) problems.push(`team ${t.name} has ${t.members.length} members`);
    if (state.codes[t.code] !== t.id) problems.push(`team ${t.name} has a dangling code`);
    for (const pid of t.members) {
      if (state.players[pid]?.teamId !== t.id) problems.push(`team ${t.name} lists a player who is not on it`);
    }
  }
  for (const p of Object.values(state.players)) {
    if (p.teamId && !state.teams[p.teamId]?.members.includes(p.id)) {
      problems.push(`${p.name} points at a team that does not list them`);
    }
  }
  // No crossed book may survive a match.
  const b = bestBid(state);
  const a = bestAsk(state);
  if (b != null && a != null && b >= a) problems.push(`book is crossed: ${b} / ${a}`);
  return problems;
}
