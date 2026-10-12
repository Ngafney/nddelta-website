/**
 * The whole Week 6 API in one router, mounted three ways:
 *   - api/week6/router.mjs   (Vercel serverless, production)
 *   - week6/dev-server.js    (plain node http, local dev)
 *   - week6/serve.js         (one process serving app + API, for event day)
 *
 * THE POT. Every team drops a secret number 0 … 10 in; S is the sum; three
 * books (the sum, a call, a put at one strike K) trade on it while the host
 * pulls the numbers out one at a time. A round runs lobby → live → settled.
 * The market document is written only through compare-and-swap transactions
 * (server/kv.js), so sixty people clicking at once cannot lose a trade.
 *
 * THE CLOCK
 * ---------
 * Two things run on a clock, both derived lazily by whoever reads next
 * (applyDue), anchored to when they were due rather than when somebody looked:
 *   - the pick clock in the lobby: when it runs out, trading opens
 *   - AUTO reveal: while it is on, one number comes out every `everySec`,
 *     and a quiet minute is caught up one number at a time, each at the
 *     moment it was due
 * The noise desks ride the same schedule.
 *
 * WHAT IS SECRET
 * --------------
 * Every team's number (until it is revealed, and even then WHICH team it was
 * until settlement) and the reveal order. `publicRound`, `marketView`,
 * `meView` and `teamView` are the only shapes that reach a player before
 * settlement; teamView is the one place a number appears, and only the team's
 * own. test/api.test.js checks the bytes.
 */

import crypto from "node:crypto";
import * as kv from "./kv.js";
import {
  newMarket,
  newPlayer,
  placeOrder,
  cancelOrder,
  cancelLevel,
  cancelAll,
  setBookOpen,
  settle,
  powers,
  spendableC,
  holdC,
  myOrders,
  grid,
  bounds,
  teamCount,
  midPx,
  bookLevels,
  createTeam,
  setTeamNumber,
  joinTeam,
  leaveTeam,
  teamView,
  makeTeamCode,
  bestBid,
  bestAsk,
  markPx,
  allMarks,
  valueC,
  leaderboard,
  auditState,
  EngineError,
} from "../shared/engine.js";
import { LIMITS, MONEY, PHASES, BOTS, BOOKS, BOOK_ORDER, DEFAULTS, NUMBER_MAX, RULES_TEXT } from "../shared/rules.js";
import { payoff, fairAll, shuffle, drawNumber, validNumber, normalizeParams, normalizeSharp, resolveStrike } from "../shared/game.js";
import { rngFrom } from "../shared/rng.js";

/* ── secrets ──────────────────────────────────────────────────────────── */

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

const DEFAULT_SECRET = "week6-dev-secret";
const IS_PROD = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

function resolveSecret() {
  if (process.env.SESSION_SECRET) return { secret: process.env.SESSION_SECRET, from: "SESSION_SECRET" };
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (apiKey) return { secret: sha(`week6|session|${apiKey}`), from: "an API key in the environment" };
  const store = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (store) return { secret: sha(`week6|session|${store}`), from: "the Upstash token in the environment" };
  return { secret: DEFAULT_SECRET, from: "nothing" };
}

const { secret: SECRET, from: SECRET_FROM } = resolveSecret();

if (SECRET === DEFAULT_SECRET) {
  const msg =
    'No SESSION_SECRET and nothing in the environment to derive one from — player and admin tokens are forgeable. Set one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
  if (IS_PROD) throw new Error(`REFUSING TO START: ${msg}`);
  console.warn(`[week6] ⚠ ${msg} (allowed in dev only)`);
} else if (SECRET_FROM !== "SESSION_SECRET") {
  console.warn(`[week6] SESSION_SECRET is unset — signing tokens with a key derived from ${SECRET_FROM}.`);
}

const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const playerToken = (pid) => sha(`${SECRET}|player|${pid}`);
const adminTokenFor = (hash) => sha(`${SECRET}|admin|${hash}`);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

function numOr(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function httpError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

/* ── keys ─────────────────────────────────────────────────────────────── */

const MKT = "w6:mkt";
const MKTV = "w6:mkt:v";
const HISTORY = "w6:history";
const ADMIN_HASH = "w6:admin:hash";

/* ── the market transaction (unchanged from weeks 2–5) ────────────────── */

let writeQueue = Promise.resolve();

function tx(fn, opts) {
  const run = writeQueue.then(
    () => txInner(fn, opts),
    () => txInner(fn, opts)
  );
  writeQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function txInner(fn, { attempts = 24 } = {}) {
  let cur =
    cached.value && Date.now() - cached.at < READ_CACHE_MS
      ? { value: cached.value, version: cached.version }
      : await kv.casGet(MKT, MKTV);
  for (let i = 0; i < attempts; i++) {
    if (!cur.value) throw httpError(409, "no round is set up yet — ask the host to start one", "no-round");
    const state = JSON.parse(cur.value);
    const out = {};
    const result = fn(state, out);
    if (out.readOnly) return result;
    const next = String((Number(cur.version) || 0) + 1);
    const res = await kv.casSet(MKT, MKTV, cur.version, JSON.stringify(state), next);
    if (res.ok) {
      cacheStore(res.value, res.version);
      return result;
    }
    cur = { value: res.value, version: res.version };
    if (i > 0) await sleep(Math.min(60, 4 + Math.floor(Math.random() * 12) * i));
  }
  throw httpError(503, "the market is busy right now — try that again", "busy");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const READ_CACHE_MS = 300;
let cached = { value: null, version: "", at: 0 };

function cacheStore(value, version) {
  cached = { value, version, at: Date.now() };
}

async function readMarket({ fresh = false } = {}) {
  if (!fresh && cached.value && Date.now() - cached.at < READ_CACHE_MS) {
    return { state: JSON.parse(cached.value), version: cached.version };
  }
  const cur = await kv.casGet(MKT, MKTV);
  if (cur.value) cacheStore(cur.value, cur.version);
  return { state: cur.value ? JSON.parse(cur.value) : null, version: cur.version };
}

function replaceMarket(state) {
  const run = writeQueue.then(
    () => replaceInner(state),
    () => replaceInner(state)
  );
  writeQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function replaceInner(state) {
  for (let i = 0; i < 10; i++) {
    const cur = await kv.casGet(MKT, MKTV);
    const next = String((Number(cur.version) || 0) + 1);
    const res = await kv.casSet(MKT, MKTV, cur.version, JSON.stringify(state), next);
    if (res.ok) {
      cacheStore(res.value, res.version);
      return true;
    }
    await sleep(15 + i * 15);
  }
  throw httpError(503, "could not install the new round — try that again");
}

/* ── the pot ──────────────────────────────────────────────────────────── */

const liveTeams = (state) => Object.values(state.teams).filter((t) => !t.hidden);

/**
 * Seal the pot and open the books. From here N, K, every number and the order
 * they come out are fixed. A team that never picked gets a number drawn for
 * it from the round's seed, and is told so.
 */
function lock(state, at) {
  const teams = liveTeams(state).sort((a, b) => a.id.localeCompare(b.id));
  if (!teams.length) throw httpError(409, "no team has a number in the pot yet — nothing to trade on", "no-teams");
  for (const t of teams) {
    if (!validNumber(t.number)) {
      t.number = drawNumber(`${state.seed}|draw|${t.id}`);
      t.drawn = true;
      t.pickedBy = null;
      t.pickedAt = at;
    }
  }
  state.N = teams.length;
  state.Smax = NUMBER_MAX * state.N;
  const k = resolveStrike(state.Kreq, state.N);
  state.K = k.K;
  state.Kauto = k.auto;
  state.revealOrder = shuffle(
    teams.map((t) => t.id),
    `${state.seed}|order`
  );
  state.revealed = [];
  state.mids = [];
  state.locked = true;
  state.status = "live";
  state.liveStartedAt = at;
  state.pickEndsAt = null;
  if (state.auto.on) state.auto.nextAt = at + Math.round(state.auto.everySec * 1000);
  if (state.bots) {
    state.bots.desks.forEach((d, i) => (d.nextAt = at + 3_000 + 2_500 * i));
    if (state.bots.sharp?.loop) state.bots.sharp.nextAt = at + Math.round(state.bots.sharp.cfg.everySec * 1000);
  }
  recordMids(state, at);
}

/** Write down every book's price as it stands with `revealed.length` numbers out. */
function recordMids(state, at) {
  const i = state.revealed.length;
  if (state.mids.some((m) => m.i === i)) return;
  const row = { i, at };
  for (const k of BOOK_ORDER) {
    const b = bestBid(state, k);
    const a = bestAsk(state, k);
    row[k] = { bid: b, ask: a, last: state.books[k].last, mid: b != null && a != null ? (b + a) / 2 : null };
  }
  state.mids.push(row);
}

/**
 * One number out of the pot, at `at`. The last one settles the round. The
 * value is appended to the public list; the team it belonged to stays in
 * `revealOrder`, which nobody sees until settlement.
 */
function revealNext(state, at) {
  if (state.status !== "live") return false;
  const i = state.revealed.length;
  if (i >= state.N) return false;
  recordMids(state, at); // the price with i numbers known, just before the i+1th lands
  const tid = state.revealOrder[i];
  const team = state.teams[tid];
  state.revealed.push({ n: team.number, at });
  if (state.revealed.length >= state.N) {
    const S = state.revealed.reduce((s, r) => s + r.n, 0);
    recordMids(state, at);
    settle(state, S, at);
  }
  return true;
}

function openTrading(state, at) {
  lock(state, at);
}

/**
 * Everything that is due at `now`, done once. Pure in (state, now), so a
 * losing CAS can replay it. Returns true if it changed anything.
 */
function applyDue(state, now) {
  let changed = false;
  if (state.status === "lobby" && state.pickEndsAt != null && now >= state.pickEndsAt) {
    if (liveTeams(state).length) {
      openTrading(state, state.pickEndsAt);
      changed = true;
    } else {
      // Nothing to open on. Drop the clock rather than open an empty round.
      state.pickEndsAt = null;
      changed = true;
    }
  }
  if (state.status !== "live") return changed;

  // AUTO: one number per interval, each at the moment it was due.
  const au = state.auto;
  let guard = 0;
  while (state.status === "live" && au.on && au.nextAt != null && now >= au.nextAt && guard++ < LIMITS.maxTeams + 1) {
    const at = au.nextAt;
    au.nextAt = at + Math.round(au.everySec * 1000);
    if (revealNext(state, at)) changed = true;
  }
  if (state.status !== "live") return changed;

  if (runBotsIfDue(state, now)) changed = true;
  const sh = state.bots?.sharp;
  if (sh?.loop && sh.nextAt != null && now >= sh.nextAt) {
    sh.nextAt = now + Math.round(sh.cfg.everySec * 1000);
    runSharp(state, now);
    changed = true;
  }
  return changed;
}

/** Is anything due? Cheap, read-only, so a quiet poll costs no write. */
function isDue(state, now) {
  if (state.status === "lobby") return state.pickEndsAt != null && now >= state.pickEndsAt;
  if (state.status !== "live") return false;
  if (state.auto.on && state.auto.nextAt != null && now >= state.auto.nextAt) return true;
  const sh = state.bots?.sharp;
  if (sh?.loop && sh.nextAt != null && now >= sh.nextAt) return true;
  const b = state.bots;
  if (!b || !b.cfg.on) return false;
  return b.desks.some((d, i) => i < b.cfg.desks && d.nextAt != null && now >= d.nextAt);
}

/**
 * Read the market, bring it up to `now`, and hand back the result. Every read
 * path goes through here, so the round moves on even with nobody clicking.
 */
async function readAdvanced(now) {
  const r = await readMarket();
  if (!r.state || !isDue(r.state, now)) return r.state;
  const before = r.state.status;
  let settledNow = false;
  const state = await tx((st, out) => {
    if (st.roundId !== r.state.roundId || !applyDue(st, now)) out.readOnly = true;
    settledNow = before !== "settled" && st.status === "settled" && !out.readOnly;
    return st;
  });
  if (settledNow) await recordHistory(state, now);
  return state;
}

async function recordHistory(state, now) {
  await kv.pushCapped(
    HISTORY,
    {
      roundId: state.roundId,
      at: now,
      N: state.N,
      K: state.K,
      S: state.settleS,
      payouts: state.payouts,
      numbers: state.revealed.map((r) => r.n),
      podium: leaderboard(state, 3).map((r) => ({ name: r.name, valueC: r.valueC })),
    },
    12
  );
}

/* ── the house desks ──────────────────────────────────────────────────── */

const BOT_PIDS = new Set([BOTS.sharp.pid, ...BOTS.desks.map((d) => d.pid)]);
const isBot = (pid) => BOT_PIDS.has(pid);

/** Seat every possible desk under its own id at one hidden table. */
function seatBots(state, noise, now) {
  const team = { id: BOTS.team.id, name: BOTS.team.name, code: BOTS.team.code, members: [], createdAt: now, owner: null, hidden: true, number: null };
  for (const d of [BOTS.sharp, ...BOTS.desks]) {
    const p = newPlayer(d.pid, d.name, `bot-${d.pid}`, state.startCashC * BOTS.cashMultiple, now);
    p.teamId = team.id;
    p.bot = true;
    state.players[d.pid] = p;
    team.members.push(d.pid);
  }
  state.teams[team.id] = team;
  state.bots = {
    cfg: { ...noise },
    desks: BOTS.desks.map((d) => ({ key: d.key, pid: d.pid, name: d.name, nextAt: null, sent: 0, fills: 0 })),
    sharp: { cfg: { ...DEFAULTS.sharp }, loop: false, nextAt: null, strikes: 0, fills: 0, lastAt: null, lastReport: null },
  };
}

/**
 * THE INSIDER. It knows S, so it knows exactly what every share will pay. On a
 * strike it sweeps, book by book, every resting offer priced at least `edgeC`
 * below the payoff (buying) and every resting bid at least `edgeC` above it
 * (selling), up to `size` shares in all. It never leaves anything resting.
 * Returns what it did: shares bought (+) or sold (-) per book.
 */
function runSharp(state, now) {
  const sh = state.bots?.sharp;
  if (!sh || state.status !== "live" || !state.locked) return null;
  const S = liveTeams(state).reduce((s, t) => s + t.number, 0);
  let left = sh.cfg.size;
  const report = { fut: 0, call: 0, put: 0, shares: 0 };
  for (const k of BOOK_ORDER) {
    if (!state.books[k].open) continue;
    const payC = payoff(k, S, state.K) * 100;
    const g = grid(state, k);
    // One limit order at the worst price still worth taking sweeps everything better than it.
    const buyPx = Math.floor((payC - sh.cfg.edgeC) / 100);
    const sellPx = Math.ceil((payC + sh.cfg.edgeC) / 100);
    for (const [side, px] of [["B", buyPx], ["A", sellPx]]) {
      if (side === "B" && px < g.orderMin) continue;
      if (side === "A" && px > g.orderMax) continue;
      const p = Math.min(g.orderMax, Math.max(g.orderMin, px));
      let guard = 0;
      while (left > 0 && guard++ < 60) {
        const touch = side === "B" ? bestAsk(state, k) : bestBid(state, k);
        if (touch == null || (side === "B" ? touch > p : touch < p)) break;
        let r;
        try {
          r = placeOrder(state, BOTS.sharp.pid, k, side, p, Math.min(LIMITS.maxSharesPerOrder, left), now);
        } catch (e) {
          if (!(e instanceof EngineError)) throw e;
          sh.lastError = e.message;
          break;
        }
        if (r.resting) cancelOrder(state, BOTS.sharp.pid, r.resting.id);
        if (!r.filled) break;
        left -= r.filled;
        report[k] += side === "B" ? r.filled : -r.filled;
        report.shares += r.filled;
      }
    }
  }
  sh.strikes++;
  sh.fills += report.shares;
  sh.lastAt = now;
  sh.lastReport = report;
  return report;
}

/**
 * Fire whatever desk is due — once, then re-base to now, so a quiet minute can
 * never turn into a burst of orders the instant somebody loads the page. A
 * desk picks an OPEN book at random, a side at random, and sends a market
 * order `sweep` through the mark; whatever does not fill is pulled.
 */
function runBotsIfDue(state, now) {
  const b = state.bots;
  if (!b || !b.cfg.on) return false;
  const openBooks = BOOK_ORDER.filter((k) => state.books[k].open);
  let fired = false;
  b.desks.forEach((d, i) => {
    if (i >= b.cfg.desks || d.nextAt == null || now < d.nextAt) return;
    const def = BOTS.desks[i];
    d.nextAt = now + Math.round(b.cfg.everySec * def.stagger * 1000);
    const rand = rngFrom(`${state.roundId}|${d.key}|${d.sent}`);
    d.sent++;
    fired = true;
    if (!openBooks.length) return;
    const mkt = openBooks[Math.floor(rand() * openBooks.length)];
    const side = rand() < 0.5 ? "B" : "A";
    const g = grid(state, mkt);
    const ref = Math.round(markPx(state, mkt));
    const px = side === "B" ? Math.min(g.orderMax, ref + b.cfg.sweep) : Math.max(g.orderMin, ref - b.cfg.sweep);
    try {
      const r = placeOrder(state, d.pid, mkt, side, px, b.cfg.size, now);
      d.fills += r.filled;
      if (r.resting) cancelOrder(state, d.pid, r.resting.id);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      d.lastError = e.message;
    }
  });
  return fired;
}

/** Apply a new desk configuration, live or not. New desks start a few seconds out. */
function configureBots(state, noise, now) {
  if (!state.bots) return;
  const was = state.bots.cfg;
  state.bots.cfg = { ...noise };
  if (state.status === "live") {
    state.bots.desks.forEach((d, i) => {
      if (i < noise.desks && (i >= was.desks || !was.on || d.nextAt == null)) d.nextAt = now + 2_000 + 2_000 * i;
    });
  }
}

/* ── admin ────────────────────────────────────────────────────────────── */

async function adminHash() {
  let h = await kv.get(ADMIN_HASH);
  if (!h) {
    h = sha(process.env.ADMIN_PASSWORD || "123");
    await kv.set(ADMIN_HASH, h);
  }
  return h;
}

async function requireAdmin(body) {
  const expect = adminTokenFor(await adminHash());
  if (!body || body.token !== expect) throw httpError(401, "bad admin token", "auth");
}

/* ── rate limiting ────────────────────────────────────────────────────── */

const buckets = new Map();
function rateLimit(key, max, windowMs, message = "slow down a moment") {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) throw httpError(429, message, "rate");
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 8000) buckets.clear();
}

/* ── views ────────────────────────────────────────────────────────────── */

function requirePlayer(state, body) {
  const pid = body.playerId ?? body.pid;
  if (!pid || isBot(pid) || body.token !== playerToken(pid)) throw httpError(401, "bad player credentials", "auth");
  const p = state.players?.[pid];
  if (!p) throw httpError(401, "you are not in this round — join again", "auth");
  return p;
}

/**
 * What every client may know about the round. Read it suspiciously: the only
 * numbers here are the ones already out of the pot, in the order they came
 * out, with nothing to say whose they were.
 */
function publicRound(state, now) {
  const settled = state.status === "settled";
  const live = state.status === "live";
  const bd = bounds(state);
  const N = state.locked ? state.N : teamCount(state);
  const books = {};
  for (const k of BOOK_ORDER) {
    const g = grid(state, k);
    books[k] = {
      key: k,
      name: BOOKS[k].name,
      short: BOOKS[k].short,
      pays: BOOKS[k].pays,
      open: live && state.books[k].open,
      enabled: state.books[k].open,
      orderMin: g.orderMin,
      orderMax: g.orderMax,
      settleMin: g.settleMin,
      settleMax: g.settleMax,
      center: g.center,
      tick: 1,
    };
  }
  const fair = state.locked ? fairAll(state.N, state.revealed.map((r) => r.n), state.K) : null;
  return {
    roundId: state.roundId,
    status: state.status,
    phase: PHASES[state.status]?.name ?? state.status,
    locked: !!state.locked,
    N,
    K: state.locked ? state.K : grid(state, "fut").K,
    Kauto: state.locked ? !!state.Kauto : state.Kreq == null,
    Smax: NUMBER_MAX * Math.max(N, state.locked ? 0 : 1),
    numberMax: NUMBER_MAX,
    revealed: state.revealed.map((r) => r.n),
    revealedAt: state.revealed.map((r) => r.at),
    revealedCount: state.revealed.length,
    sum: bd.sum,
    left: state.locked ? bd.left : N,
    lo: bd.lo,
    hi: state.locked ? bd.hi : NUMBER_MAX * N,
    /** The uniform-prior fair value of each book, public: it is arithmetic anyone could do. */
    fair: fair ? Object.fromEntries(BOOK_ORDER.map((k) => [k, Math.round(fair[k] * 100) / 100])) : null,
    auto: { on: !!state.auto.on, everySec: state.auto.everySec, nextAt: live && state.auto.on ? state.auto.nextAt : null },
    pickEndsAt: state.status === "lobby" ? state.pickEndsAt ?? null : null,
    msLeft: state.status === "lobby" && state.pickEndsAt != null ? Math.max(0, state.pickEndsAt - now) : null,
    liveStartedAt: state.liveStartedAt ?? null,
    serverNow: now,
    startCashC: state.startCashC,
    defaultSize: state.defaultSize ?? LIMITS.defaultOrderSize,
    lateJoin: state.lateJoin,
    players: Object.values(state.players ?? {}).filter((p) => !p.bot).length,
    teams: liveTeams(state).length,
    teamSize: LIMITS.teamSize,
    books,
    noise: state.bots ? { on: !!state.bots.cfg.on, desks: state.bots.cfg.on ? state.bots.cfg.desks : 0, everySec: state.bots.cfg.everySec, size: state.bots.cfg.size, sweep: state.bots.cfg.sweep } : null,
    // Only once it cannot help anybody.
    settleS: settled ? state.settleS : null,
    payouts: settled ? state.payouts : null,
    settledAt: settled ? state.settledAt : null,
  };
}

function marketView(state, pid) {
  const out = {};
  for (const k of BOOK_ORDER) {
    const book = state.books[k];
    out[k] = {
      ...bookLevels(state, k, pid),
      last: book.last,
      bestBid: bestBid(state, k),
      bestAsk: bestAsk(state, k),
      mark: markPx(state, k),
      mid: midPx(state, k),
      volume: book.volume,
      open: book.open && state.status === "live",
      tape: book.tape.slice(0, 16).map((t) => ({ s: t.s, px: t.px, qty: t.qty, ts: t.ts, aggr: t.aggr })),
    };
  }
  return out;
}

function meView(state, p) {
  const pw = powers(state, p);
  const settled = state.status === "settled";
  return {
    id: p.id,
    name: p.name,
    teamId: p.teamId ?? null,
    cashC: p.cash,
    pos: settled ? { ...(p.settledPos ?? {}) } : { ...p.pos },
    bidResC: pw.bidC,
    askResC: pw.askC,
    freeC: pw.freeC,
    spendableC: spendableC(state, p),
    valueC: valueC(state, p),
    spentC: p.spentC,
    startC: p.startC,
    orders: myOrders(state, p.id)
      .map((o) => ({ id: o.id, mkt: o.mkt, side: o.side, px: o.px, qty: o.qty, ts: o.ts, holdC: holdC(state, o) }))
      .sort((a, b) => BOOK_ORDER.indexOf(a.mkt) - BOOK_ORDER.indexOf(b.mkt) || a.px - b.px),
  };
}

const boardRows = (state, n) => leaderboard(state, n);

/* ── the router ───────────────────────────────────────────────────────── */

export async function handle(method, route, body, query, nowArg) {
  const now = nowArg ?? Date.now();

  switch (`${method} ${route}`) {
    /* ── meta ── */
    case "GET health": {
      const { state } = await readMarket();
      return {
        ok: true,
        game: "week6",
        kv: kv.KV_MODE,
        persistent: kv.KV_PERSISTENT,
        secret: SECRET_FROM,
        round: state ? state.roundId : null,
        status: state ? state.status : "none",
        audit: state ? auditState(state) : ["no market"],
      };
    }

    case "GET rules":
      return {
        rules: RULES_TEXT,
        books: BOOK_ORDER.map((k) => BOOKS[k]),
        numberMax: NUMBER_MAX,
        limits: {
          maxSharesPerOrder: LIMITS.maxSharesPerOrder,
          maxOrdersPerPlayer: LIMITS.maxOrdersPerPlayer,
          teamSize: LIMITS.teamSize,
        },
        money: { startCashC: MONEY.startCashC },
      };

    case "GET config": {
      const state = await readAdvanced(now);
      return { round: state ? publicRound(state, now) : null, persistent: kv.KV_PERSISTENT };
    }

    /* ── joining ── */
    case "POST join": {
      const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
      const deviceId = String(body.deviceId ?? "").slice(0, 64);
      const fp = String(body.fp ?? "").slice(0, 64);
      if (!deviceId || deviceId.length < 8) throw httpError(400, "this browser could not be identified — enable storage and reload");
      if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) {
        throw httpError(400, `your name must be ${LIMITS.nameMin}–${LIMITS.nameMax} characters`);
      }
      if (!slug(name)) throw httpError(400, "your name needs some letters or numbers in it");
      rateLimit(`join:${query.__ip}`, 120, 60_000);
      rateLimit(`join:dev:${deviceId}`, 10, 60_000);

      return tx((state, out) => {
        const existingPid = state.devices[deviceId];
        if (existingPid && state.players[existingPid]) {
          const p = state.players[existingPid];
          out.readOnly = true;
          return { playerId: p.id, token: playerToken(p.id), name: p.name, rejoined: true };
        }
        if (state.status === "settled") throw httpError(409, "that round is over — wait for the next one", "over");
        if (state.status === "live" && !state.lateJoin) throw httpError(409, "this round is closed to new players", "closed");

        const s = slug(name);
        for (const other of Object.values(state.players)) {
          if (slug(other.name) === s) throw httpError(409, "someone already took that name — pick another", "name-taken");
        }
        if (Object.keys(state.players).length >= 400) throw httpError(409, "this round is full", "full");

        const pid = rid(6);
        const p = newPlayer(pid, name, deviceId, state.startCashC, now);
        p.fp = fp;
        p.ip = query.__ip;
        state.players[pid] = p;
        state.devices[deviceId] = pid;
        return { playerId: pid, token: playerToken(pid), name, rejoined: false };
      });
    }

    /* ── the poll ── */
    case "GET state": {
      const state = await readAdvanced(now);
      if (!state) throw httpError(409, "no round is set up yet — ask the host to start one", "no-round");
      const p = requirePlayer(state, query);
      const since = Number(query.since ?? 0) || 0;
      return {
        round: publicRound(state, now),
        me: meView(state, p),
        team: teamView(state, p),
        market: marketView(state, p.id),
        leaderboard: boardRows(state, 60),
        fills: p.fills.filter((f) => f.s > since),
        seq: state.seq,
      };
    }

    /* ── teams ── */
    case "POST team/create": {
      rateLimit(`team:${body.playerId}`, 12, 60_000);
      const teamId = rid(5);
      const number = body.number == null || body.number === "" ? NaN : Number(body.number);
      return tx((state) => {
        const p = requirePlayer(state, body);
        if (state.status === "settled") throw httpError(409, "that round is over", "over");
        const code = makeTeamCode(state, (n) => crypto.randomInt(0, n));
        const team = createTeam(state, p.id, body.name, teamId, code, number, now);
        return { team: { ...teamView(state, p), max: LIMITS.teamSize }, created: true, code: team.code };
      });
    }

    case "POST team/join": {
      rateLimit(`team:${body.playerId}`, 20, 60_000);
      return tx((state) => {
        const p = requirePlayer(state, body);
        if (state.status === "settled") throw httpError(409, "that round is over", "over");
        joinTeam(state, p.id, body.code);
        return { team: teamView(state, p), created: false };
      });
    }

    case "POST team/leave": {
      return tx((state) => {
        const p = requirePlayer(state, body);
        leaveTeam(state, p.id);
        return { ok: true };
      });
    }

    /** Pick (or change) the team's number while the pot is open. */
    case "POST team/number": {
      rateLimit(`number:${body.playerId}`, 30, 60_000);
      const n = Number(body.number);
      return tx((state) => {
        const p = requirePlayer(state, body);
        if (state.status === "settled") throw httpError(409, "that round is over", "over");
        setTeamNumber(state, p.id, n, now);
        return { team: teamView(state, p) };
      });
    }

    /* ── trading ── */
    case "POST order": {
      rateLimit(`order:${body.playerId}`, 45, 10_000, "easy — that is a lot of orders in ten seconds");
      await readAdvanced(now); // a reveal may have settled the round a moment ago
      return tx((state) => {
        const p = requirePlayer(state, body);
        const side = body.side === "B" || body.side === "A" ? body.side : null;
        if (!side) throw httpError(400, "bad side");
        const mkt = BOOK_ORDER.includes(body.mkt) ? body.mkt : null;
        if (!mkt) throw httpError(400, "bad book");
        if (state.status === "lobby") throw httpError(409, "the books open when the host opens trading", "closed");
        const res = placeOrder(state, p.id, mkt, side, Number(body.px), Number(body.qty ?? 1), now);
        return {
          filled: res.filled,
          canceled: res.canceled ?? 0,
          ioc: !!res.ioc,
          resting: res.resting ? { id: res.resting.id, mkt, px: res.resting.px, qty: res.resting.qty, side } : null,
          trades: res.trades.map((t) => ({ px: t.px, qty: t.qty })),
          me: meView(state, p),
        };
      });
    }

    case "POST cancel": {
      rateLimit(`cancel:${body.playerId}`, 60, 10_000);
      return tx((state) => {
        const p = requirePlayer(state, body);
        let out;
        if (body.all) out = cancelAll(state, p.id, BOOK_ORDER.includes(body.mkt) ? body.mkt : null);
        else if (body.orderId != null) out = cancelOrder(state, p.id, Number(body.orderId));
        else if (body.mkt && body.side && body.px != null) out = cancelLevel(state, p.id, body.mkt, body.side, Number(body.px));
        else throw httpError(400, "nothing to cancel");
        return { ...out, me: meView(state, p) };
      });
    }

    /* ── the reveal ── */
    case "GET reveal": {
      const state = await readAdvanced(now);
      if (!state) throw httpError(409, "no round yet", "no-round");
      if (state.status !== "settled") throw httpError(403, "the pot is not empty yet", "locked");
      const nums = state.revealed.map((r) => r.n);
      // Fair value with i numbers known, i = 0 … N, under the uniform prior.
      const fair = [];
      for (let i = 0; i <= state.N; i++) {
        const f = fairAll(state.N, nums.slice(0, i), state.K);
        fair.push(Object.fromEntries(BOOK_ORDER.map((k) => [k, Math.round(f[k] * 100) / 100])));
      }
      const desks = (state.bots?.desks ?? []).slice(0, state.bots?.cfg.desks ?? 0).map((d) => {
        const p = state.players[d.pid];
        return { name: d.name, pnlC: p ? p.cash - p.startC : 0, sent: d.sent, fills: d.fills };
      });
      const sharp = state.bots?.sharp?.strikes
        ? { name: BOTS.sharp.name, pnlC: state.players[BOTS.sharp.pid].cash - state.players[BOTS.sharp.pid].startC, strikes: state.bots.sharp.strikes, fills: state.bots.sharp.fills }
        : null;
      return {
        roundId: state.roundId,
        N: state.N,
        K: state.K,
        S: state.settleS,
        payouts: state.payouts,
        numbers: nums,
        revealedAt: state.revealed.map((r) => r.at),
        // Whose was whose — the one thing kept until now.
        teams: state.revealOrder.map((tid, i) => {
          const t = state.teams[tid];
          return { i, id: tid, name: t?.name ?? "?", number: t?.number ?? null, drawn: !!t?.drawn };
        }),
        fair,
        mids: state.mids ?? [],
        desks,
        sharp,
        leaderboard: boardRows(state, 100),
      };
    }

    case "GET leaderboard": {
      const state = await readAdvanced(now);
      if (!state) return { leaderboard: [], round: null };
      return { leaderboard: boardRows(state, 200), round: publicRound(state, now) };
    }

    case "GET board": {
      const state = await readAdvanced(now);
      if (!state) return { round: null, persistent: kv.KV_PERSISTENT, history: await kv.listAll(HISTORY) };
      return {
        round: publicRound(state, now),
        market: marketView(state, null),
        leaderboard: boardRows(state, 30),
        history: await kv.listAll(HISTORY),
      };
    }

    case "GET history":
      return { history: await kv.listAll(HISTORY) };

    /* ── admin ── */
    case "POST admin/auth": {
      rateLimit(`admin:${query.__ip}`, 12, 60_000, "too many attempts — wait a minute");
      const h = await adminHash();
      if (sha(String(body.password ?? "")) !== h) throw httpError(401, "wrong password");
      return { token: adminTokenFor(h) };
    }

    case "POST admin/password": {
      await requireAdmin(body);
      if (!body.password || String(body.password).length < 3) throw httpError(400, "password too short");
      const h = sha(String(body.password));
      await kv.set(ADMIN_HASH, h);
      return { token: adminTokenFor(h) };
    }

    /**
     * Build a fresh round. Players and teams can be carried over; every
     * team's number is cleared so the room picks again.
     */
    case "POST admin/round": {
      await requireAdmin(body);
      const params = readParams(body);
      const roundId = rid(5);
      const prev = (await readMarket({ fresh: true })).state;
      const startCashC = Math.round(clamp(numOr(body.startCash, MONEY.startCashC / 100), 100, 10_000_000) * 100);
      const defaultSize = Math.round(clamp(numOr(body.defaultSize, LIMITS.defaultOrderSize), 1, LIMITS.maxSharesPerOrder));
      const market = newMarket({ roundId, startCashC, defaultSize, lateJoin: body.lateJoin !== false, books: params.books, K: params.K });
      market.seed = String(body.seed ?? "").trim().slice(0, 64) || `${roundId}-${rid(6)}`;
      market.pickSeconds = params.pickSeconds;
      market.auto = { on: params.autoOn, everySec: params.autoEverySec, nextAt: null };
      seatBots(market, params.noise, now);
      if (body.keepPlayers && prev) carryPlayers(prev, market, startCashC, now);
      await replaceMarket(market);
      return { round: publicRound(market, now), peek: peekOf(market, now) };
    }

    /**
     * Change the settings of a round in the lobby. Players, teams and their
     * numbers stay. Once trading opens only the live knobs (books, bots, auto)
     * can move, through their own routes.
     */
    case "POST admin/settings": {
      await requireAdmin(body);
      const params = readParams(body);
      const state = await tx((st) => {
        if (st.status !== "lobby") throw httpError(409, "the round has opened — use the live controls, or build a new round", "locked");
        st.Kreq = params.K;
        st.pickSeconds = params.pickSeconds;
        st.auto = { on: params.autoOn, everySec: params.autoEverySec, nextAt: null };
        for (const k of BOOK_ORDER) setBookOpen(st, k, params.books[k]);
        configureBots(st, params.noise, now);
        if (body.seed != null && String(body.seed).trim()) st.seed = String(body.seed).trim().slice(0, 64);
        return st;
      });
      return { round: publicRound(state, now), peek: peekOf(state, now) };
    }

    /** Start the pick clock: trading opens by itself when it runs out. */
    case "POST admin/pick": {
      await requireAdmin(body);
      const seconds = body.seconds == null || body.seconds === "" ? null : clamp(Number(body.seconds) || 0, 5, 600);
      const state = await tx((st) => {
        if (st.status !== "lobby") throw httpError(409, "the round has already opened");
        if (!liveTeams(st).length) throw httpError(409, "no teams yet — the clock would open an empty round", "no-teams");
        const s = seconds ?? st.pickSeconds ?? DEFAULTS.pickSeconds;
        st.pickEndsAt = now + Math.round(s * 1000);
        return st;
      });
      return { round: publicRound(state, now) };
    }

    /** More pick time. */
    case "POST admin/extend": {
      await requireAdmin(body);
      const seconds = Math.round(numOr(body.seconds, 30));
      const state = await tx((st) => {
        if (st.status !== "lobby") throw httpError(409, "the pot is sealed — there is no pick clock to extend");
        if (st.pickEndsAt == null) throw httpError(409, "there is no pick clock running");
        st.pickEndsAt = Math.max(now + 1000, st.pickEndsAt + seconds * 1000);
        return st;
      });
      return { round: publicRound(state, now) };
    }

    /** Stop the pick clock without opening. */
    case "POST admin/hold": {
      await requireAdmin(body);
      const state = await tx((st) => {
        if (st.status !== "lobby") throw httpError(409, "the round has already opened");
        st.pickEndsAt = null;
        return st;
      });
      return { round: publicRound(state, now) };
    }

    /** Seal the pot and open the books now. */
    case "POST admin/open": {
      await requireAdmin(body);
      const state = await tx((st) => {
        if (st.status !== "lobby") throw httpError(409, "trading has already opened");
        openTrading(st, now);
        return st;
      });
      return { round: publicRound(state, now), peek: peekOf(state, now) };
    }

    /** One number out of the pot, by hand. The last one settles. */
    case "POST admin/reveal": {
      await requireAdmin(body);
      let settledNow = false;
      const state = await tx((st) => {
        if (st.status !== "live") throw httpError(409, st.status === "lobby" ? "open trading first" : "the pot is already empty");
        applyDue(st, now);
        if (st.status !== "live") return st;
        revealNext(st, now);
        // A manual pull re-bases the auto clock so two never land together.
        if (st.auto.on && st.auto.nextAt != null) st.auto.nextAt = now + Math.round(st.auto.everySec * 1000);
        settledNow = st.status === "settled";
        return st;
      });
      if (settledNow) await recordHistory(state, now);
      return { round: publicRound(state, now), peek: peekOf(state, now) };
    }

    /** AUTO on or off, and how fast. Live or not. */
    case "POST admin/auto": {
      await requireAdmin(body);
      const state = await tx((st) => {
        if (st.status === "settled") throw httpError(409, "the round is over");
        const on = body.on === true || body.on === "true" || body.on === 1;
        const every = body.everySec == null || body.everySec === "" ? st.auto.everySec : clamp(Number(body.everySec) || st.auto.everySec, 1, 120);
        st.auto.everySec = every;
        if (on && !st.auto.on) st.auto.nextAt = st.status === "live" ? now + Math.round(every * 1000) : null;
        if (on && st.auto.on && st.status === "live") st.auto.nextAt = Math.min(st.auto.nextAt ?? Infinity, now + Math.round(every * 1000));
        if (!on) st.auto.nextAt = null;
        st.auto.on = on;
        return st;
      });
      return { round: publicRound(state, now) };
    }

    /** Which books are tradable. Shutting one pulls everything resting in it. */
    case "POST admin/books": {
      await requireAdmin(body);
      const state = await tx((st) => {
        if (st.status === "settled") throw httpError(409, "the round is over");
        for (const k of BOOK_ORDER) {
          if (body[k] == null) continue;
          setBookOpen(st, k, body[k] === true || body[k] === "true" || body[k] === 1);
        }
        return st;
      });
      return { round: publicRound(state, now) };
    }

    /** The noise desks, live or not. */
    case "POST admin/bots": {
      await requireAdmin(body);
      const noise = readParams({ noise: body.noise ?? body }).noise;
      const state = await tx((st) => {
        if (st.status === "settled") throw httpError(409, "the round is over");
        configureBots(st, noise, now);
        return st;
      });
      return { round: publicRound(state, now), desks: state.bots };
    }

    /**
     * The insider. `strike: true` fires it once, now. `loop` switches the
     * timer on or off. Any of edge / size / everySec changes its settings.
     */
    case "POST admin/sharp": {
      await requireAdmin(body);
      let report = null;
      const state = await tx((st) => {
        if (!st.bots?.sharp) throw httpError(409, "no round");
        const sh = st.bots.sharp;
        try {
          sh.cfg = normalizeSharp(body, sh.cfg);
        } catch (e) {
          throw httpError(400, e.message, "bad-settings");
        }
        if (body.loop != null) {
          const on = body.loop === true || body.loop === "true" || body.loop === 1;
          if (on && !sh.loop) sh.nextAt = st.status === "live" ? now + Math.round(sh.cfg.everySec * 1000) : null;
          if (!on) sh.nextAt = null;
          sh.loop = on;
        }
        if (sh.loop && st.status === "live" && sh.nextAt == null) sh.nextAt = now + Math.round(sh.cfg.everySec * 1000);
        if (body.strike) {
          if (st.status !== "live") throw httpError(409, st.status === "lobby" ? "open trading first - the insider needs a sealed pot" : "the round is over");
          applyDue(st, now);
          if (st.status === "live") report = runSharp(st, now);
          if (sh.loop && sh.nextAt != null) sh.nextAt = now + Math.round(sh.cfg.everySec * 1000);
        }
        return st;
      });
      return { round: publicRound(state, now), sharp: sharpView(state), report };
    }

    /** End now: every remaining number comes out at once and the round settles. */
    case "POST admin/end": {
      await requireAdmin(body);
      const cur = (await readMarket({ fresh: true })).state;
      if (!cur) throw httpError(409, "no round");
      if (cur.status === "settled") return { round: publicRound(cur, now), already: true };
      let settledNow = false;
      const state = await tx((st) => {
        if (st.status === "settled") return st;
        if (st.status === "lobby") openTrading(st, now);
        let guard = 0;
        while (st.status === "live" && guard++ <= LIMITS.maxTeams) revealNext(st, now);
        st.endedEarly = true;
        settledNow = st.status === "settled";
        return st;
      });
      if (settledNow) await recordHistory(state, now);
      return { round: publicRound(state, now) };
    }

    case "POST admin/reset": {
      await requireAdmin(body);
      if (body.confirm !== "RESET") throw httpError(400, 'send confirm:"RESET" to wipe the game');
      const prev = (await readMarket({ fresh: true })).state;
      await kv.del(MKT, MKTV, HISTORY);
      cached = { value: null, version: "", at: 0 };
      return { ok: true, cleared: { round: prev?.roundId ?? null, players: Object.values(prev?.players ?? {}).filter((p) => !p.bot).length } };
    }

    case "POST admin/kick": {
      await requireAdmin(body);
      return tx((state) => {
        const p = state.players[body.playerId];
        if (!p || p.bot) throw httpError(404, "no such player");
        cancelAll(state, p.id);
        if (BOOK_ORDER.some((k) => p.pos[k] !== 0)) throw httpError(409, `${p.name} is holding a position — they cannot be removed mid-round`);
        if (p.teamId) leaveTeam(state, p.id, { force: true });
        delete state.players[p.id];
        for (const [dev, pid] of Object.entries(state.devices)) if (pid === p.id) delete state.devices[dev];
        return { ok: true };
      });
    }

    case "POST admin/unbind": {
      await requireAdmin(body);
      return tx((state) => {
        const dev = String(body.deviceId ?? "");
        if (!state.devices[dev]) throw httpError(404, "no such device");
        delete state.devices[dev];
        return { ok: true };
      });
    }

    case "GET admin/inspect": {
      await requireAdmin(query);
      const base = { persistent: kv.KV_PERSISTENT, kv: kv.KV_MODE, secret: SECRET_FROM };
      const state = await readAdvanced(now);
      if (!state) return { round: null, ...base, players: [], teams: [] };
      return {
        ...base,
        round: publicRound(state, now),
        market: marketView(state, null),
        peek: peekOf(state, now),
        audit: auditState(state),
        desks: state.bots ? { cfg: state.bots.cfg, desks: state.bots.desks.slice(0, state.bots.cfg.desks) } : null,
        sharp: sharpView(state),
        players: Object.values(state.players)
          .filter((p) => !p.bot)
          .map((p) => ({
            id: p.id,
            name: p.name,
            device: p.device,
            team: p.teamId ? state.teams[p.teamId]?.name ?? null : null,
            cashC: p.cash,
            pos: state.status === "settled" ? p.settledPos ?? {} : p.pos,
            valueC: valueC(state, p),
            orders: myOrders(state, p.id).length,
          }))
          .sort((a, b) => b.valueC - a.valueC),
        teams: liveTeams(state).map((t) => ({
          id: t.id,
          name: t.name,
          code: t.code,
          number: validNumber(t.number) ? t.number : null,
          drawn: !!t.drawn,
          pickedBy: t.pickedBy ? state.players[t.pickedBy]?.name ?? null : null,
          members: t.members.map((pid) => state.players[pid]?.name).filter(Boolean),
        })),
        openOrders: BOOK_ORDER.reduce((n, k) => n + state.books[k].orders.length, 0),
        volume: Object.fromEntries(BOOK_ORDER.map((k) => [k, state.books[k].volume])),
      };
    }

    default:
      throw httpError(404, `no route: ${method} ${route}`);
  }
}

/** The insider as the host sees it. */
function sharpView(state) {
  const sh = state.bots?.sharp;
  if (!sh) return null;
  const p = state.players[BOTS.sharp.pid];
  return {
    cfg: sh.cfg,
    loop: !!sh.loop,
    nextAt: sh.nextAt,
    strikes: sh.strikes,
    fills: sh.fills,
    lastAt: sh.lastAt,
    lastReport: sh.lastReport,
    lastError: sh.lastError ?? null,
    pos: p ? { ...(state.status === "settled" ? p.settledPos ?? p.pos : p.pos) } : null,
    pnlC: p ? valueC(state, p) - p.startC : 0,
  };
}

/* ── building rounds ──────────────────────────────────────────────────── */

/** The admin form, checked. A bad field is a 400 with the reason. */
function readParams(body) {
  try {
    return normalizeParams(body, DEFAULTS);
  } catch (e) {
    throw httpError(400, e.message, "bad-settings");
  }
}

/**
 * The host's peek: every number with its team, S, what each book pays, the
 * uniform-prior fair values, and what comes out next.
 */
function peekOf(state, now) {
  const teams = liveTeams(state);
  const nums = state.revealed.map((r) => r.n);
  const K = state.locked ? state.K : grid(state, "fut").K;
  const S = state.locked ? teams.reduce((s, t) => s + t.number, 0) : teams.reduce((s, t) => s + (validNumber(t.number) ? t.number : 0), 0);
  const unpicked = teams.filter((t) => !validNumber(t.number)).length;
  const N = state.locked ? state.N : teams.length;
  const order = state.revealOrder ?? [];
  return {
    N,
    K,
    Kauto: state.locked ? !!state.Kauto : state.Kreq == null,
    Kreq: state.Kreq,
    S,
    unpicked,
    seed: state.seed,
    payouts: state.locked ? Object.fromEntries(BOOK_ORDER.map((k) => [k, payoff(k, S, K)])) : null,
    fair: N ? Object.fromEntries(Object.entries(fairAll(N, nums, K)).map(([k, v]) => [k, Math.round(v * 100) / 100])) : null,
    marks: allMarks(state),
    revealed: nums,
    next: state.locked && state.status === "live" && order[nums.length] ? { name: state.teams[order[nums.length]]?.name ?? "?", number: state.teams[order[nums.length]]?.number } : null,
    teams: teams
      .map((t) => ({ id: t.id, name: t.name, number: validNumber(t.number) ? t.number : null, drawn: !!t.drawn, members: t.members.length, revealed: state.locked ? order.indexOf(t.id) < nums.length : false }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    pickSeconds: state.pickSeconds,
    auto: state.auto,
    books: Object.fromEntries(BOOK_ORDER.map((k) => [k, state.books[k].open])),
    noise: state.bots?.cfg ?? null,
  };
}

/** Teams survive into the next round, with fresh money and NO number. */
function carryPlayers(prev, market, startCashC, now) {
  for (const p of Object.values(prev.players)) {
    if (p.bot) continue;
    const np = newPlayer(p.id, p.name, p.device, startCashC, now);
    np.fp = p.fp;
    np.ip = p.ip;
    np.teamId = p.teamId ?? null;
    market.players[p.id] = np;
    market.devices[p.device] = p.id;
  }
  for (const t of Object.values(prev.teams ?? {})) {
    if (t.hidden) continue;
    const members = t.members.filter((pid) => market.players[pid]);
    if (!members.length) continue;
    market.teams[t.id] = { ...t, members, owner: members.includes(t.owner) ? t.owner : members[0], number: null, pickedBy: null, pickedAt: null, drawn: false };
    market.codes[t.code] = t.id;
  }
  for (const p of Object.values(market.players)) {
    if (p.teamId && !market.teams[p.teamId]) p.teamId = null;
  }
}

/* ── node plumbing ────────────────────────────────────────────────────── */

const MAX_BODY = 64 * 1024;

export async function nodeHandler(req, res, route) {
  try {
    let body = {};
    if (req.method === "POST") {
      if (req.body !== undefined && req.body !== null) {
        body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
      } else {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > MAX_BODY) throw httpError(413, "request too large");
          chunks.push(c);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        body = raw ? JSON.parse(raw) : {};
      }
    }
    const url = new URL(req.url, "http://x");
    const query = Object.fromEntries(url.searchParams);
    query.__ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
    if (req.method === "POST") body.__ip = query.__ip;
    const result = await handle(req.method, route, body, query);
    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    if (result && result.__raw != null) {
      res.setHeader("Content-Type", result.__contentType ?? "text/plain; charset=utf-8");
      if (result.__filename) res.setHeader("Content-Disposition", `attachment; filename="${result.__filename}"`);
      res.end(result.__raw);
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(result));
  } catch (e) {
    const status = e.status ?? (e instanceof EngineError ? 400 : 500);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (status >= 500) console.error("[api]", e);
    res.end(JSON.stringify({ error: e.message ?? "server error", code: e.code ?? null }));
  }
}
