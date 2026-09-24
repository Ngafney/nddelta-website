/**
 * Week 4 — two books, one wallet.
 *
 * NORTH and SOUTH are separate order books on the same question, and exactly
 * one of them pays 100. That last fact is not decoration; it is the whole
 * shape of the risk, and the margin model is built on it.
 *
 * THE SOLVENCY RULE
 * -----------------
 * Settlement has exactly TWO outcomes, not a range:
 *
 *      north lands:  NORTH pays 100, SOUTH pays 0
 *      south lands:  NORTH pays 0,   SOUTH pays 100
 *
 * So instead of bounding a continuum, check both outcomes literally. For each
 * outcome o, a player's worth once every resting order of theirs has filled is
 *
 *      W(o) = cash + Σ_m payout(o,m)·position_m  −  Σ_orders hold(o, order)
 *
 * where a resting BID at px needs (px − payout)⁺ per share and a resting OFFER
 * needs (payout − px)⁺. Requiring W(north) ≥ 0 and W(south) ≥ 0 is exact: no
 * sequence of fills can put anyone underwater, and nothing is over-charged.
 *
 * The pleasant consequence is that buying NORTH and SOUTH together costs real
 * margin but carries none of the risk the two legs have apart — the outcomes
 * cancel, because one of them always pays. A model that margined the two books
 * separately would demand collateral for a position that cannot lose, and the
 * cleanest trade in the game would be the one the exchange punished hardest.
 *
 * Money is integer CENTS. Never floats.
 */

import { LIMITS, MONEY, MARKETS, MARKET_META, BOOK } from "./rules.js";

export class EngineError extends Error {
  constructor(message, code = "rejected", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** One share of a market, at a price of 1, in cents. */
export const SHARE_C = 100;

const pos0 = (v) => (v > 0 ? v : 0);

/* ── construction ─────────────────────────────────────────────────────── */

export function newMarket(round) {
  const books = {};
  for (const m of MARKETS) {
    books[m] = { orders: [], nextOrderId: 1, last: null, tape: [], volume: 0 };
  }
  return {
    roundId: round.roundId,
    question: round.question ?? null,
    settleMin: BOOK.settleMin,
    settleMax: BOOK.settleMax,
    tick: BOOK.tick,
    orderMin: BOOK.orderMin,
    orderMax: BOOK.orderMax,
    center: BOOK.center,
    // lobby → research → live → ended → settled.
    // "research" is the window where the data is out but the books are shut.
    status: "lobby",
    startedAt: null,
    endsAt: null,
    phase: null,
    startCashC: round.startCashC ?? MONEY.startCashC,
    defaultSize: round.defaultSize ?? LIMITS.defaultOrderSize,
    lateJoin: round.lateJoin !== false,
    players: {},
    teams: {},
    codes: {},
    devices: {},
    books,
    seq: 1,
    /** Which market pays 100. Null until the asteroid actually lands. */
    winner: null,
    settledAt: null,
    /** Index of the last data release the room has been given. */
    released: 0,
    releaseLog: [],
    bots: [],
    botSeq: 0,
  };
}

export function newPlayer(pid, name, deviceId, cashC, now) {
  const pos = {};
  for (const m of MARKETS) pos[m] = 0;
  return {
    id: pid,
    name,
    device: deviceId,
    teamId: null,
    cash: cashC,
    pos,
    spentC: 0,
    fills: [],
    joinedAt: now,
    settledPos: null,
    startC: cashC,
    downloads: 0,
  };
}

/* ── the price grid ───────────────────────────────────────────────────── */

export function grid(state) {
  return {
    settleMin: state.settleMin ?? BOOK.settleMin,
    settleMax: state.settleMax ?? BOOK.settleMax,
    tick: state.tick ?? BOOK.tick,
    orderMin: state.orderMin ?? BOOK.orderMin,
    orderMax: state.orderMax ?? BOOK.orderMax,
  };
}

export const onTick = (state, px) => Number.isInteger(px) && (px - grid(state).settleMin) % grid(state).tick === 0;

export function snapTick(state, px) {
  const g = grid(state);
  const snapped = g.settleMin + Math.round((px - g.settleMin) / g.tick) * g.tick;
  return Math.min(g.orderMax, Math.max(g.orderMin, snapped));
}

export function bookOf(state, market) {
  const b = state.books?.[market];
  if (!b) throw new EngineError(`no such market: ${market}`, "no-market", 404);
  return b;
}

export const isMarket = (m) => MARKETS.includes(m);

/* ── solvency ─────────────────────────────────────────────────────────── */

/** What one share of `market` pays, in price points, if `outcome` happens. */
export const payout = (outcome, market) => (outcome === market ? BOOK.settleMax : BOOK.settleMin);

/** What one resting share ties up under one outcome, in cents. */
export function holdC(outcome, market, side, px) {
  const pay = payout(outcome, market);
  return side === "B" ? pos0(px - pay) * SHARE_C : pos0(pay - px) * SHARE_C;
}

/**
 * Both solvency numbers for a player, in cents. Each is how much room is left
 * before that outcome would make them insolvent — so an order is admissible
 * exactly when neither number would go negative.
 */
export function powers(state, p) {
  const out = {};
  for (const outcome of MARKETS) {
    let w = p.cash;
    for (const m of MARKETS) w += payout(outcome, m) * (p.pos?.[m] ?? 0) * SHARE_C;
    for (const m of MARKETS) {
      for (const o of bookOf(state, m).orders) {
        if (o.pid !== p.id) continue;
        w -= holdC(outcome, m, o.side, o.px) * o.qty;
      }
    }
    out[outcome] = w;
  }
  return out;
}

/** The worst of the outcomes — the single number "can I do anything at all". */
export function freeC(state, p) {
  const pw = powers(state, p);
  return Math.min(...MARKETS.map((m) => pw[m]));
}

/** Per-order holds, so the client can show what each one is costing. */
export function orderHolds(state, pid) {
  const rows = [];
  for (const m of MARKETS) {
    for (const o of bookOf(state, m).orders) {
      if (o.pid !== pid) continue;
      // Shown as the worst case across outcomes: what it can actually cost you.
      const worst = Math.max(...MARKETS.map((oc) => holdC(oc, m, o.side, o.px)));
      rows.push({ id: o.id, market: m, side: o.side, px: o.px, qty: o.qty, ts: o.ts, holdC: worst * o.qty });
    }
  }
  return rows;
}

export function reservedC(state, pid) {
  return orderHolds(state, pid).reduce((s, o) => s + o.holdC, 0);
}

/** Most shares this player could rest on one side of one book at one price. */
export function maxSharesAt(state, p, market, side, px) {
  const pw = powers(state, p);
  let n = LIMITS.maxSharesPerOrder;
  for (const outcome of MARKETS) {
    const per = holdC(outcome, market, side, px);
    if (per > 0) n = Math.min(n, Math.floor(pw[outcome] / per));
  }
  return Math.max(0, n);
}

/* ── book views ───────────────────────────────────────────────────────── */

export function bookLevels(state, market, pid) {
  const bids = new Map();
  const asks = new Map();
  for (const o of bookOf(state, market).orders) {
    const into = o.side === "B" ? bids : asks;
    const cur = into.get(o.px) ?? { px: o.px, qty: 0, mine: 0 };
    cur.qty += o.qty;
    if (o.pid === pid) cur.mine += o.qty;
    into.set(o.px, cur);
  }
  return {
    bids: [...bids.values()].sort((a, b) => b.px - a.px),
    asks: [...asks.values()].sort((a, b) => a.px - b.px),
  };
}

export function bestBid(state, market) {
  let best = null;
  for (const o of bookOf(state, market).orders) if (o.side === "B" && (best === null || o.px > best)) best = o.px;
  return best;
}

export function bestAsk(state, market) {
  let best = null;
  for (const o of bookOf(state, market).orders) if (o.side === "A" && (best === null || o.px < best)) best = o.px;
  return best;
}

export function midPx(state, market) {
  const b = bestBid(state, market);
  const a = bestAsk(state, market);
  if (b != null && a != null) return (b + a) / 2;
  if (b != null) return b;
  if (a != null) return a;
  return bookOf(state, market).last ?? BOOK.center;
}

/** What a position is marked at: last trade, else the mid, else the centre. */
export function markPx(state, market) {
  const b = bookOf(state, market);
  if (b.last != null) return b.last;
  return midPx(state, market);
}

/* ── matching ─────────────────────────────────────────────────────────── */

function pushFill(p, fill) {
  p.fills.push(fill);
  if (p.fills.length > LIMITS.fillsKept) p.fills.splice(0, p.fills.length - LIMITS.fillsKept);
}

function removeOrder(state, market, id) {
  const b = bookOf(state, market);
  const i = b.orders.findIndex((o) => o.id === id);
  if (i >= 0) b.orders.splice(i, 1);
}

function execute(state, market, taker, maker, qty, px, now) {
  const b = bookOf(state, market);
  const buyer = taker.side === "B" ? state.players[taker.pid] : state.players[maker.pid];
  const seller = taker.side === "B" ? state.players[maker.pid] : state.players[taker.pid];
  const cashC = px * qty * SHARE_C;

  buyer.cash -= cashC;
  buyer.pos[market] += qty;
  seller.cash += cashC;
  seller.pos[market] -= qty;

  b.last = px;
  b.volume += qty;
  const s = state.seq++;
  b.tape.unshift({ s, px, qty, ts: now, aggr: taker.side });
  if (b.tape.length > LIMITS.tapeLength) b.tape.length = LIMITS.tapeLength;

  pushFill(buyer, { s, market, side: "B", px, qty, ts: now, taker: taker.side === "B", cp: seller.name });
  pushFill(seller, { s, market, side: "A", px, qty, ts: now, taker: taker.side === "A", cp: buyer.name });

  return { s, market, px, qty, buyer: buyer.id, seller: seller.id };
}

/**
 * Everything an order would do, worked out without touching anything. The
 * steps become the exact script the order follows, so what the solvency check
 * judged and what the book does cannot drift apart.
 */
function planMatch(state, market, pid, side, px, qty) {
  const orders = bookOf(state, market).orders;
  const steps = [];
  const done = new Set();
  const took = new Map();
  const rest = (o) => o.qty - (took.get(o.id) ?? 0);
  let left = qty;
  let fills = 0;
  for (let guard = 0; left > 0 && guard < LIMITS.maxOpenOrders + LIMITS.maxSharesPerOrder; guard++) {
    let best = null;
    for (const o of orders) {
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

/** Where both solvency numbers land once `plan` runs and `restQty` is resting. */
function afterPlan(state, p, market, side, px, plan, restQty) {
  const orders = bookOf(state, market).orders;
  const dir = side === "B" ? 1 : -1;
  const base = powers(state, p);
  const out = {};
  for (const outcome of MARKETS) {
    let w = base[outcome];
    for (const st of plan.steps) {
      if (st.kill != null) {
        const o = orders.find((x) => x.id === st.kill);
        if (o) w += holdC(outcome, market, o.side, o.px) * o.qty; // reserve handed back
        continue;
      }
      // Cash moves by the printed price; the position moves with it.
      w += (-dir * st.px + dir * payout(outcome, market)) * st.qty * SHARE_C;
    }
    if (restQty > 0) w -= holdC(outcome, market, side, px) * restQty;
    out[outcome] = w;
  }
  return out;
}

const allOk = (w) => MARKETS.every((m) => w[m] >= 0);

function applyPlan(state, market, pid, side, px, plan, restQty, now) {
  const b = bookOf(state, market);
  const taker = { pid, side };
  const trades = [];
  for (const st of plan.steps) {
    if (st.kill != null) {
      removeOrder(state, market, st.kill);
      continue;
    }
    const maker = b.orders.find((o) => o.id === st.id);
    trades.push(execute(state, market, taker, maker, st.qty, st.px, now));
    maker.qty -= st.qty;
    if (maker.qty <= 0) removeOrder(state, market, maker.id);
  }
  let resting = null;
  if (restQty > 0) {
    resting = { id: b.nextOrderId++, pid, side, px, qty: restQty, ts: now, seq: state.seq++ };
    b.orders.push(resting);
  }
  return { trades, resting };
}

/**
 * Place a limit order on one of the two books.
 *
 * Crosses at the resting side's prices, so price improvement goes to the
 * taker; self-trade prevention cancels the resting order rather than printing
 * against yourself. Solvency is judged on the state the order would LEAVE
 * BEHIND, and if only the resting remainder breaks it the order becomes
 * immediate-or-cancel rather than being refused outright.
 */
export function placeOrder(state, market, pid, side, px, qty, now) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  if (state.status !== "live") throw new EngineError("the books are shut", "closed");
  if (!p.teamId) throw new EngineError("join or create a team before you trade", "no-team");
  if (!isMarket(market)) throw new EngineError("no such market", "no-market");
  if (side !== "B" && side !== "A") throw new EngineError("bad side");

  const g = grid(state);
  if (!Number.isInteger(px) || px < g.orderMin || px > g.orderMax) {
    throw new EngineError(`price must be ${g.orderMin} to ${g.orderMax}`, "off-range");
  }
  if (!onTick(state, px)) throw new EngineError(`price must be a whole number`, "off-tick");
  if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.maxSharesPerOrder) {
    throw new EngineError(`size must be 1 to ${LIMITS.maxSharesPerOrder} shares`);
  }
  const b = bookOf(state, market);
  if (b.orders.length >= LIMITS.maxOpenOrders) throw new EngineError("the book is full", "book-full");
  const mine = MARKETS.reduce((n, m) => n + bookOf(state, m).orders.reduce((k, o) => k + (o.pid === pid ? 1 : 0), 0), 0);
  if (mine >= LIMITS.maxOrdersPerPlayer) {
    throw new EngineError(`you already have ${LIMITS.maxOrdersPerPlayer} resting orders — cancel some first`, "too-many");
  }

  const plan = planMatch(state, market, pid, side, px, qty);
  const whole = afterPlan(state, p, market, side, px, plan, plan.left);

  let ioc = false;
  if (!allOk(whole)) {
    const canIOC = plan.fills > 0 && plan.left > 0;
    const crossOnly = canIOC ? afterPlan(state, p, market, side, px, plan, 0) : whole;
    if (canIOC && allOk(crossOnly)) {
      ioc = true;
    } else {
      const short = -Math.min(...MARKETS.map((m) => whole[m]));
      throw new EngineError(
        `out of balance — ${qty} share${qty > 1 ? "s" : ""} at ${px} would leave you ${fmt(short)} short. ` +
          `cancel some resting orders, or try fewer shares.`,
        "balance"
      );
    }
  }

  const { trades, resting } = applyPlan(state, market, pid, side, px, plan, ioc ? 0 : plan.left, now);
  return { trades, resting, filled: qty - plan.left, canceled: ioc ? plan.left : 0, ioc, market };
}

/* ── cancelling ───────────────────────────────────────────────────────── */

export function cancelOrder(state, pid, orderId, market) {
  for (const m of market ? [market] : MARKETS) {
    const o = bookOf(state, m).orders.find((x) => x.id === orderId);
    if (!o) continue;
    if (o.pid !== pid) throw new EngineError("not your order", "not-yours");
    removeOrder(state, m, orderId);
    return { canceled: 1, qty: o.qty, market: m };
  }
  throw new EngineError("that order is already gone", "gone");
}

export function cancelLevel(state, pid, market, side, px) {
  const b = bookOf(state, market);
  let n = 0;
  let qty = 0;
  for (let i = b.orders.length - 1; i >= 0; i--) {
    const o = b.orders[i];
    if (o.pid === pid && o.side === side && o.px === px) {
      qty += o.qty;
      n++;
      b.orders.splice(i, 1);
    }
  }
  if (!n) throw new EngineError("nothing of yours there", "gone");
  return { canceled: n, qty, market };
}

/** Everything, or everything on one book. */
export function cancelAll(state, pid, market = null) {
  let n = 0;
  let qty = 0;
  for (const m of market ? [market] : MARKETS) {
    const b = bookOf(state, m);
    for (let i = b.orders.length - 1; i >= 0; i--) {
      if (b.orders[i].pid !== pid) continue;
      qty += b.orders[i].qty;
      n++;
      b.orders.splice(i, 1);
    }
  }
  return { canceled: n, qty };
}

/* ── settlement ───────────────────────────────────────────────────────── */

/**
 * The asteroid lands. `winner` is the market that pays 100; the other pays 0.
 */
export function settle(state, winner, now) {
  if (state.status === "settled") return state;
  if (!isMarket(winner)) throw new EngineError("the winner has to be one of the two markets", "no-market");
  for (const m of MARKETS) bookOf(state, m).orders = [];
  for (const p of Object.values(state.players)) {
    p.settledPos = { ...p.pos };
    for (const m of MARKETS) {
      p.cash += p.pos[m] * payout(winner, m) * SHARE_C;
      p.pos[m] = 0;
    }
  }
  state.status = "settled";
  state.winner = winner;
  state.settledAt = now;
  return state;
}

/* ── views ────────────────────────────────────────────────────────────── */

export function valueC(state, p, marks = null) {
  if (state.status === "settled") return p.cash;
  let v = p.cash;
  for (const m of MARKETS) {
    const mk = marks?.[m] ?? markPx(state, m);
    v += (p.pos?.[m] ?? 0) * mk * SHARE_C;
  }
  return Math.round(v);
}

/**
 * Teams rank on the AVERAGE of their members' portfolios, not the sum, so a
 * table of four is playing the same game as a table of two.
 */
export function leaderboard(state, limit = 100) {
  const marks = {};
  for (const m of MARKETS) marks[m] = markPx(state, m);
  const settled = state.status === "settled";
  const rows = [];
  for (const team of Object.values(state.teams ?? {})) {
    // The noise desk sits at a hidden table. It trades like anyone else and it
    // shows up in the audit like anyone else, but it is not competing.
    if (team.hidden) continue;
    const members = team.members
      .map((pid) => state.players[pid])
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        name: p.name,
        valueC: valueC(state, p, marks),
        cashC: p.cash,
        pos: settled ? p.settledPos ?? emptyPos() : { ...p.pos },
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

const emptyPos = () => Object.fromEntries(MARKETS.map((m) => [m, 0]));

/* ── teams ────────────────────────────────────────────────────────────── */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeTeamCode(state, randomInt) {
  for (let attempt = 0; attempt < 500; attempt++) {
    let code = "";
    for (let i = 0; i < LIMITS.codeLength; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!state.codes[code]) return code;
  }
  throw new EngineError("could not mint a free team code", "codes-full", 500);
}

export function createTeam(state, pid, name, teamId, code) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  if (p.teamId) throw new EngineError("you are already on a team", "has-team");
  const clean = String(name ?? "").trim().slice(0, LIMITS.teamNameMax);
  if (clean.length < 2) throw new EngineError("give the team a name");
  state.teams[teamId] = { id: teamId, name: clean, code, members: [pid], createdAt: Date.now() };
  state.codes[code] = teamId;
  p.teamId = teamId;
  return state.teams[teamId];
}

export function joinTeam(state, pid, code) {
  const p = state.players[pid];
  if (!p) throw new EngineError("unknown player", "no-player");
  if (p.teamId) throw new EngineError("you are already on a team", "has-team");
  const key = String(code ?? "").trim().toUpperCase();
  const teamId = state.codes[key];
  const team = teamId ? state.teams[teamId] : null;
  if (!team) throw new EngineError("no team with that code", "no-team-code", 404);
  if (team.members.length >= LIMITS.teamSize) throw new EngineError(`${team.name} is full`, "team-full");
  team.members.push(pid);
  p.teamId = teamId;
  return team;
}

export function leaveTeam(state, pid) {
  const p = state.players[pid];
  if (!p?.teamId) throw new EngineError("you are not on a team", "no-team");
  if (MARKETS.some((m) => (p.pos?.[m] ?? 0) !== 0)) {
    throw new EngineError("close your positions before leaving", "has-position");
  }
  cancelAll(state, pid);
  const team = state.teams[p.teamId];
  if (team) {
    team.members = team.members.filter((x) => x !== pid);
    if (!team.members.length) {
      delete state.codes[team.code];
      delete state.teams[team.id];
    }
  }
  p.teamId = null;
  return { ok: true };
}

export function teamView(state, p) {
  if (!p?.teamId) return null;
  const team = state.teams[p.teamId];
  if (!team) return null;
  const marks = {};
  for (const m of MARKETS) marks[m] = markPx(state, m);
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    size: team.members.length,
    max: LIMITS.teamSize,
    valueC: Math.round(
      team.members.map((pid) => state.players[pid]).filter(Boolean).reduce((s, q) => s + valueC(state, q, marks), 0) /
        Math.max(1, team.members.length)
    ),
    members: team.members
      .map((pid) => state.players[pid])
      .filter(Boolean)
      .map((q) => ({
        id: q.id,
        name: q.name,
        valueC: valueC(state, q, marks),
        pos: { ...q.pos },
        me: q.id === p.id,
      })),
  };
}

/* ── formatting ───────────────────────────────────────────────────────── */

export function fmt(cents) {
  const neg = cents < 0;
  const v = Math.abs(cents);
  const s = (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "-" : ""}$${s}`;
}

/* ── the audit ────────────────────────────────────────────────────────── */

/**
 * Everything that must be true after every single action. Run it constantly in
 * tests; it is the thing that catches a matching bug the day it is written.
 */
export function auditState(state) {
  const problems = [];

  for (const p of Object.values(state.players)) {
    const pw = powers(state, p);
    for (const outcome of MARKETS) {
      if (pw[outcome] < 0) {
        problems.push(`${p.name}: insolvent if ${outcome} lands (${pw[outcome]} cents)`);
      }
    }
    if (!Number.isInteger(p.cash)) problems.push(`${p.name}: cash is not a whole number of cents`);
    for (const m of MARKETS) {
      if (!Number.isInteger(p.pos?.[m] ?? 0)) problems.push(`${p.name}: ${m} position is not an integer`);
    }
  }

  // Every share someone is long, someone else is short.
  for (const m of MARKETS) {
    let net = 0;
    for (const p of Object.values(state.players)) net += p.pos?.[m] ?? 0;
    if (net !== 0) problems.push(`${m}: open interest does not net to zero (${net})`);
  }

  // Cash only moves between players, never in or out.
  let cash = 0;
  let start = 0;
  let spent = 0;
  for (const p of Object.values(state.players)) {
    cash += p.cash;
    start += p.startC;
    spent += p.spentC;
  }
  if (state.status !== "settled" && cash !== start - spent) {
    problems.push(`cash does not reconcile: ${cash} vs ${start - spent}`);
  }

  for (const m of MARKETS) {
    const b = state.books?.[m];
    if (!b) {
      problems.push(`${m}: no book`);
      continue;
    }
    for (const o of b.orders) {
      if (!state.players[o.pid]) problems.push(`${m} order ${o.id} belongs to nobody`);
      if (o.qty <= 0) problems.push(`${m} order ${o.id} has non-positive size`);
      if (!onTick(state, o.px)) problems.push(`${m} order ${o.id} is off the grid at ${o.px}`);
      const g = grid(state);
      if (o.px < g.orderMin || o.px > g.orderMax) problems.push(`${m} order ${o.id} is off the ladder at ${o.px}`);
    }
    const bb = bestBid(state, m);
    const ba = bestAsk(state, m);
    if (bb != null && ba != null && bb >= ba) problems.push(`${m} book is crossed: ${bb} / ${ba}`);
  }

  for (const t of Object.values(state.teams ?? {})) {
    if (t.members.length > LIMITS.teamSize) problems.push(`team ${t.name} has ${t.members.length} members`);
    for (const pid of t.members) {
      if (state.players[pid]?.teamId !== t.id) problems.push(`team ${t.name} lists a player who is not on it`);
    }
  }
  for (const p of Object.values(state.players)) {
    if (p.teamId && !state.teams[p.teamId]?.members.includes(p.id)) {
      problems.push(`${p.name} points at a team that does not list them`);
    }
  }

  return problems;
}
