/**
 * The matching engine and the balance rules. Pure functions over a plain state
 * object — no I/O, no clock of its own — so the server can run them inside a
 * compare-and-swap transaction and the tests can hammer them directly.
 *
 * ── The contract ─────────────────────────────────────────────────────────
 * One lot settles at S. Long a lot: you paid the price now, you receive S at
 * the end. Short a lot: you received the price now, you pay S at the end.
 *
 * Two ranges matter, and they are deliberately NOT the same range:
 *
 *   settleMin / settleMax   where S can possibly land. In gradient mode this
 *                           is the domain of the curve; in prediction mode it
 *                           is 0 to 100. Players are never told these numbers —
 *                           being blind to them is the game — so nothing in the
 *                           engine's error messages names them.
 *   orderMin / orderMax      how far the ladder lets you price an order. Set
 *                           far outside the settlement range so the book never
 *                           shows a wall and never discloses a bound by the
 *                           simple fact of refusing a click.
 *
 * Either bound may be negative; nothing below assumes otherwise.
 *
 * ── Money ────────────────────────────────────────────────────────────────
 * All money is INTEGER CENTS. Prices are integer dollars on the tick grid, so
 * a lot costs px * 100 cents exactly and nothing ever drifts.
 *
 * ── Why nobody can go bust (the part that must not be wrong) ─────────────
 * Final cash is linear in S, so its worst case over [settleMin, settleMax] is
 * at one of the two endpoints. That gives two invariants, and every resting
 * order contributes to whichever one it can hurt:
 *
 *   (A)  cash + settleMin*position  >=  reserveA
 *   (B)  cash + settleMax*position  >=  reserveB
 *
 *        a resting BID at px, q lots:  reserveA += (px - settleMin)+ * q
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
 * both are preserved by every fill. For a bid at px filling q lots:
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

const LOT_C = 100; // cents per dollar of price, per lot
const pos0 = (v) => (v > 0 ? v : 0);

/* ── state ────────────────────────────────────────────────────────────── */

export function newMarket(round) {
  const mode = round.mode ?? "gradient";
  const m = MODES[mode] ?? MODES.gradient;
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
    orderMin: round.orderMin ?? snapDown(settleMin - pad, settleMin, tick),
    orderMax: round.orderMax ?? snapUp(settleMax + pad, settleMin, tick),
    /** Where the ladder opens. The one number about the range players do see. */
    center: round.center ?? Math.round((settleMin + settleMax) / 2),
    // lobby → live → settled, with an extra "ended" stop in prediction mode
    // where trading is shut but the admin has not said the answer yet.
    status: "lobby",
    startedAt: null,
    endsAt: null,
    startCashC: round.startCashC ?? MONEY.startCashC,
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
    points: [],
    sawAll: false,
    spentC: 0,
    probes: 0,
    descents: 0,
    tickets: 0,
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

/** What one lot on this side at this price ties up, against each invariant. */
export function lotReserveC(g, side, px) {
  if (side === "B") {
    return { a: pos0(px - g.settleMin) * LOT_C, b: pos0(px - g.settleMax) * LOT_C };
  }
  return { a: pos0(g.settleMin - px) * LOT_C, b: pos0(g.settleMax - px) * LOT_C };
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
    buyC: p.cash + g.settleMin * LOT_C * p.pos - a,
    sellC: p.cash + g.settleMax * LOT_C * p.pos - b,
  };
}

/** Most lots this player could post on one side at this price. */
export function maxLotsAt(state, p, side, px) {
  const g = grid(state);
  const pw = powers(state, p);
  const r = lotReserveC(g, side, px);
  let n = LIMITS.maxLotsPerOrder;
  if (r.a > 0) n = Math.min(n, Math.floor(pw.buyC / r.a));
  if (r.b > 0) n = Math.min(n, Math.floor(pw.sellC / r.b));
  return Math.max(0, n);
}

/** Cash a player may spend outright (information) without breaking A or B. */
export function spendableC(state, p) {
  const pw = powers(state, p);
  return Math.max(0, Math.min(pw.buyC, pw.sellC));
}

/** A share of cash, rounded up to the cent, never zero while they have money. */
export function shareOfCashC(p, pct) {
  if (p.cash <= 0) return 0;
  return Math.max(1, Math.ceil(p.cash * pct));
}

export const probeCostC = (p) => shareOfCashC(p, MONEY.probeCostPct);
/** A flat fee, so it does not shrink with a shrinking stack. */
export const descentCostC = () => MONEY.descentCostC;
export const ticketCostC = (p) => shareOfCashC(p, MONEY.ticketCostPct);

/* ── book ─────────────────────────────────────────────────────────────── */

/** Best resting order on the other side that a limit at `px` can trade with. */
function bestMatch(state, takerSide, px) {
  let best = null;
  for (const o of state.orders) {
    if (takerSide === "B") {
      if (o.side !== "A" || o.px > px) continue;
      if (!best || o.px < best.px || (o.px === best.px && o.seq < best.seq)) best = o;
    } else {
      if (o.side !== "B" || o.px < px) continue;
      if (!best || o.px > best.px || (o.px === best.px && o.seq < best.seq)) best = o;
    }
  }
  return best;
}

function removeOrder(state, id) {
  const i = state.orders.findIndex((o) => o.id === id);
  if (i >= 0) state.orders.splice(i, 1);
}

/** Aggregated depth per tick, plus this player's own lots at each tick. */
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
  const cashC = px * qty * LOT_C;

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
  if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.maxLotsPerOrder) {
    throw new EngineError(`size must be 1 to ${LIMITS.maxLotsPerOrder} lots`);
  }
  if (state.orders.length >= LIMITS.maxOpenOrders) throw new EngineError("the book is full", "book-full");

  const mine = state.orders.reduce((n, o) => n + (o.pid === pid ? 1 : 0), 0);
  if (mine >= LIMITS.maxOrdersPerPlayer) {
    throw new EngineError(`you already have ${LIMITS.maxOrdersPerPlayer} resting orders — cancel some first`, "too-many");
  }

  // The balance check: worst case is the whole order filling at its limit.
  // The message names only the player's own numbers — never a range bound.
  const pw = powers(state, p);
  const r = lotReserveC(g, side, px);
  const needA = r.a * qty;
  const needB = r.b * qty;
  if (needA > pw.buyC || needB > pw.sellC) {
    const need = Math.max(needA, needB);
    const have = needA > pw.buyC ? pw.buyC : pw.sellC;
    throw new EngineError(
      `out of balance — ${qty} lot${qty > 1 ? "s" : ""} at ${px} would tie up ${fmt(need)} and you have ${fmt(
        Math.max(0, have)
      )} free`,
      "balance"
    );
  }

  const taker = { pid, side };
  const trades = [];
  let left = qty;
  // Bounded: every pass either fills a resting order or removes one.
  for (let guard = 0; left > 0 && guard < LIMITS.maxOpenOrders + LIMITS.maxLotsPerOrder; guard++) {
    const maker = bestMatch(state, side, px);
    if (!maker) break;
    if (maker.pid === pid) {
      removeOrder(state, maker.id); // self-trade prevention: cancel resting
      continue;
    }
    const t = Math.min(left, maker.qty);
    trades.push(execute(state, taker, maker, t, maker.px, now));
    left -= t;
    maker.qty -= t;
    if (maker.qty <= 0) removeOrder(state, maker.id);
  }

  let resting = null;
  if (left > 0) {
    resting = { id: state.nextOrderId++, pid, side, px, qty: left, ts: now, seq: state.seq++ };
    state.orders.push(resting);
  }
  return { trades, resting, filled: qty - left };
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
 * Pull every resting order (they do not fill at the bell), then pay each lot
 * the settlement value in cents. Idempotent: a settled market settles once.
 * In gradient mode the caller passes x*; in prediction mode, whatever the
 * admin resolved to.
 */
export function settle(state, value, now) {
  if (state.status === "settled") return state;
  const settleC = Math.round(value * LOT_C);
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
  return Math.round(p.cash + p.pos * m * LOT_C);
}

/**
 * The leaderboard is by TEAM: a team's score is its members' values added up.
 * Members are listed inside the row so a player can always find their own
 * number, and so the big screen can open a team out.
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
        points: p.points.length,
        sawAll: p.sawAll,
      }))
      .sort((a, b) => b.valueC - a.valueC);
    if (!members.length) continue;
    rows.push({
      id: team.id,
      name: team.name,
      valueC: members.reduce((s, m) => s + m.valueC, 0),
      startC: members.reduce((s, m) => s + m.startC, 0),
      pos: members.reduce((s, m) => s + m.pos, 0),
      spentC: members.reduce((s, m) => s + m.spentC, 0),
      sawAll: members.some((m) => m.sawAll),
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
      points: m.points.length,
      me: m.id === p.id,
    }))
    .sort((a, b) => b.valueC - a.valueC);
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    size: members.length,
    max: LIMITS.teamSize,
    valueC: members.reduce((s, m) => s + m.valueC, 0),
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
    if (p.cash + g.settleMin * LOT_C * p.pos - a < 0) {
      problems.push(`${p.name}: invariant A broken (cash ${p.cash}, pos ${p.pos}, reserve ${a})`);
    }
    if (p.cash + g.settleMax * LOT_C * p.pos - b < 0) {
      problems.push(`${p.name}: invariant B broken (cash ${p.cash}, pos ${p.pos}, reserve ${b})`);
    }
    if (!Number.isInteger(p.cash)) problems.push(`${p.name}: cash is not an integer number of cents`);
    if (!Number.isInteger(p.pos)) problems.push(`${p.name}: position is not an integer`);
  }
  // The market is zero-sum in lots: they only ever move between players.
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
