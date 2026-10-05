/**
 * The whole Week 5 API in one router, mounted three ways:
 *   - api/week5/router.mjs   (Vercel serverless, production)
 *   - week5/dev-server.js    (plain node http, local dev)
 *   - week5/serve.js         (one process serving app + API, for event day)
 *
 * THE HORIZON MARKET. A hidden process Y ticks live; one contract pays 100 if
 * Y_T > K. A round runs lobby → research → live → settled. The market document
 * is written only through compare-and-swap transactions (server/kv.js), so
 * sixty people clicking at once cannot lose a trade or mint money.
 *
 * THE CLOCK IS THE ONLY CLOCK
 * ---------------------------
 * The current tick is never stored. It is derived on every read:
 *
 *     tick = min(T, floor((now − liveStartedAt) / tickMs))
 *
 * so a tick prints at the same instant whether sixty people are polling or
 * nobody is. Anything that has to HAPPEN at a tick — the house desks quoting,
 * the mid being written down for the reveal, settlement at tick T — is done
 * lazily by whoever reads next (applyDue), anchored to when it was due rather
 * than when somebody happened to look.
 *
 * WHAT IS SECRET
 * --------------
 * φ1, φ2, the switch tick, μ, σ, the seed, and every live tick past the current
 * one live in `w5:spec:<roundId>` and nowhere else. `publicRound`, `publicData`
 * and `marketView` are the only shapes that reach a player before settlement,
 * and none of them reads a secret field. test/api.test.js checks the bytes.
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
  settle,
  powers,
  spendableC,
  lotReserveC,
  grid,
  midPx,
  bookLevels,
  createTeam,
  joinTeam,
  leaveTeam,
  teamView,
  makeTeamCode,
  bestBid,
  bestAsk,
  markPx,
  valueC,
  leaderboard,
  auditState,
  EngineError,
} from "../shared/engine.js";
import { LIMITS, MONEY, PHASES, BOTS, DEFAULTS, PRESETS, RULES_TEXT, DATA_NOTE, aiPrompt, csvText } from "../shared/rules.js";
import { makePath, fairValue, fairSeries, naivePrice, fitAR1, normalizeParams } from "../shared/process.js";
import { rngFrom } from "../shared/rng.js";

/* ── secrets ──────────────────────────────────────────────────────────── */

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * The signing key for player and admin tokens. Unlike weeks 1–4 there is no
 * fallback to a committed store config: SESSION_SECRET, or (dev only) a fixed
 * key with a loud warning. Production refuses to boot without it.
 */
const DEFAULT_SECRET = "week5-dev-secret";
const IS_PROD = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
const SECRET = process.env.SESSION_SECRET || DEFAULT_SECRET;
const SECRET_FROM = process.env.SESSION_SECRET ? "SESSION_SECRET" : "nothing";

if (SECRET === DEFAULT_SECRET) {
  const msg =
    'No SESSION_SECRET — player and admin tokens are forgeable. Set one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
  if (IS_PROD) throw new Error(`REFUSING TO START: ${msg}`);
  console.warn(`[week5] ⚠ ${msg} (allowed in dev only)`);
}

const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const playerToken = (pid) => sha(`${SECRET}|player|${pid}`);
const adminTokenFor = (hash) => sha(`${SECRET}|admin|${hash}`);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

/** A number from a form field, or the fallback. Empty means "default", never 0. */
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

const MKT = "w5:mkt";
const MKTV = "w5:mkt:v";
/** The process and its whole path. Never served before settlement. */
const SPEC = (roundId) => `w5:spec:${roundId}`;
const HISTORY = "w5:history";
const ADMIN_HASH = "w5:admin:hash";

/* ── the market transaction (unchanged from weeks 2–4) ────────────────── */

/**
 * Every market write funnels through here, serialized within this process
 * first, then arbitrated between processes by the CAS. `fn` must not await
 * and must be a pure function of the state it is handed — a losing CAS replays
 * it on the fresh document.
 */
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

/** A very short per-instance read cache: sixty polls become one read. */
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

/* ── the process (the secret) ─────────────────────────────────────────── */

const specCache = new Map(); // roundId → spec (immutable once written)

async function loadSpec(roundId) {
  if (!roundId) return null;
  if (specCache.has(roundId)) return specCache.get(roundId);
  const spec = await kv.getJSON(SPEC(roundId));
  if (spec) {
    specCache.set(roundId, spec);
    if (specCache.size > 12) specCache.delete(specCache.keys().next().value);
  }
  return spec;
}

/**
 * Draw a fresh round's process. A NEW seed every time unless the host pins
 * one, so no two rounds ever share a path — and the path is drawn now, in full,
 * so nothing about it can depend on when anybody trades or looks.
 */
async function makeSpec(roundId, params, { seed, preset }) {
  const pinned = !!seed;
  const s = pinned ? String(seed).slice(0, 64) : `${roundId}-${crypto.randomBytes(6).toString("hex")}`;
  const { history, path } = makePath({ ...params, seed: s });
  const spec = { roundId, ...params, seed: s, pinned, preset: preset ?? "custom", history, path };
  await kv.setJSON(SPEC(roundId), spec);
  specCache.set(roundId, spec);
  return spec;
}

/* ── the clock ────────────────────────────────────────────────────────── */

/** The live tick, from the clock. Never stored. */
export function currentTick(state, now) {
  if (!state) return 0;
  if (state.status === "settled") return state.T;
  if (state.status !== "live" || state.liveStartedAt == null) return 0;
  if (state.endedEarly) return state.T;
  return clamp(Math.floor((now - state.liveStartedAt) / state.tickMs), 0, state.T);
}

/** When tick T prints (or printed). */
const bellAt = (state) => (state.liveStartedAt == null ? null : state.liveStartedAt + state.T * state.tickMs);

/** The public series at a tick: history, then live ticks 1 … tick. */
function publicYs(spec, tick) {
  return spec.history.concat(spec.path.slice(1, tick + 1));
}

function openTrading(state, at) {
  state.status = "live";
  state.liveStartedAt = at;
  state.researchEndsAt = state.researchEndsAt ?? null;
  state.mids = [];
  state.midsTo = -1;
  // The naive desk quotes the moment the book opens; the noise desks a few
  // seconds in, staggered so they never fire on the same poll.
  if (state.bots) {
    state.bots.naive.nextAt = at;
    state.bots.noise.forEach((b, i) => (b.nextAt = at + 5_000 + 4_000 * i));
  }
}

/** Write down the book at every tick that has printed since the last write. */
function recordMids(state, upTo) {
  const mid = midPx(state);
  const bid = bestBid(state);
  const ask = bestAsk(state);
  while ((state.midsTo ?? -1) < upTo) {
    state.midsTo = (state.midsTo ?? -1) + 1;
    state.mids.push({ t: state.midsTo, mid: bid != null && ask != null ? mid : null, bid, ask, last: state.last });
    if (state.mids.length > LIMITS.midsKept) state.mids.shift();
  }
}

/**
 * Everything that is due at `now`, done once. Pure in (state, spec, now), so a
 * losing CAS can replay it. Returns true if it changed anything.
 *
 *   research → live    when the research clock runs out, anchored to when it
 *                      ran out (not to whoever noticed)
 *   house desks        any that are due, once each, then re-based to now
 *   mids               one entry per printed tick, for the reveal
 *   settlement         at tick T: 100 if Y_T > K, else 0
 */
function applyDue(state, spec, now) {
  let changed = false;
  if (state.status === "research" && state.researchEndsAt != null && now >= state.researchEndsAt) {
    openTrading(state, state.researchEndsAt);
    changed = true;
  }
  if (state.status !== "live") return changed;

  const tick = currentTick(state, now);
  if (tick < state.T) {
    if (runBotsIfDue(state, spec, now, tick)) changed = true;
  }
  if ((state.midsTo ?? -1) < tick) {
    recordMids(state, tick);
    changed = true;
  }
  if (tick >= state.T) {
    const yT = spec.path[state.T];
    settle(state, yT > state.K ? 100 : 0, state.endedEarly ? now : bellAt(state));
    state.yT = yT;
    changed = true;
  }
  return changed;
}

/** Is anything due? Cheap, read-only, so a quiet poll costs no write. */
function isDue(state, now) {
  if (state.status === "research") return state.researchEndsAt != null && now >= state.researchEndsAt;
  if (state.status !== "live") return false;
  const tick = currentTick(state, now);
  if (tick >= state.T || (state.midsTo ?? -1) < tick) return true;
  const b = state.bots;
  if (!b) return false;
  if (b.naive.on && b.naive.nextAt != null && now >= b.naive.nextAt) return true;
  return b.noise.some((n) => n.on && n.nextAt != null && now >= n.nextAt);
}

/**
 * Read the market, bring it up to `now`, and hand back the result. Every read
 * path goes through here, so the round moves on even with nobody clicking.
 */
async function readAdvanced(now) {
  const r = await readMarket();
  if (!r.state || !isDue(r.state, now)) return r.state;
  const spec = await loadSpec(r.state.roundId);
  if (!spec) return r.state;
  const before = r.state.status;
  let settledNow = false;
  const state = await tx((st, out) => {
    if (st.roundId !== spec.roundId || !applyDue(st, spec, now)) out.readOnly = true;
    settledNow = before !== "settled" && st.status === "settled" && !out.readOnly;
    return st;
  });
  if (settledNow) await recordHistory(state, spec, now);
  return state;
}

async function recordHistory(state, spec, now) {
  await kv.pushCapped(
    HISTORY,
    {
      roundId: state.roundId,
      at: now,
      preset: spec.preset,
      presetName: PRESETS[spec.preset]?.name ?? "Custom",
      phi1: spec.phi1,
      phi2: spec.phi2,
      switchTick: spec.switchTick,
      K: spec.K,
      T: spec.T,
      yT: spec.path[spec.T],
      settles: state.xStar,
      podium: leaderboard(state, 3).map((r) => ({ name: r.name, valueC: r.valueC })),
    },
    12
  );
}

/* ── the house desks ──────────────────────────────────────────────────── */

const BOT_PIDS = new Set([BOTS.naive.pid, ...BOTS.noise.map((b) => b.pid)]);
const isBot = (pid) => BOT_PIDS.has(pid);

/** Seat every desk under its own id at one hidden table. */
function seatBots(state, now) {
  const team = { id: BOTS.team.id, name: BOTS.team.name, code: BOTS.team.code, members: [], createdAt: now, owner: null, hidden: true };
  for (const d of [BOTS.naive, ...BOTS.noise]) {
    const p = newPlayer(d.pid, d.name, `bot-${d.pid}`, state.startCashC * BOTS.cashMultiple, now);
    p.teamId = team.id;
    p.bot = true;
    state.players[d.pid] = p;
    team.members.push(d.pid);
  }
  state.teams[team.id] = team;
  state.bots = {
    naive: { on: !!state.naiveBot, nextAt: null, sent: 0, bid: null, ask: null, fair: null },
    noise: BOTS.noise.map((d) => ({ key: d.key, pid: d.pid, on: true, nextAt: null, sent: 0, fills: 0 })),
  };
}

/**
 * Fire whatever desk is due — once, then re-base to now, so a quiet minute can
 * never turn into a burst of orders the instant somebody loads the page. There
 * is no background worker on a serverless host; the schedule rides on the
 * document and is advanced by whoever polls next.
 */
function runBotsIfDue(state, spec, now, tick) {
  const b = state.bots;
  if (!b) return false;
  let fired = false;

  const nb = b.naive;
  if (nb.on && nb.nextAt != null && now >= nb.nextAt) {
    nb.nextAt = now + BOTS.naive.everySec * 1000;
    nb.sent++;
    fired = true;
    // A random-walk price from the public data, and nothing else.
    const fair = naivePrice(publicYs(spec, tick), state.K, state.T - tick);
    const c = Math.round(fair * 100);
    const g = grid(state);
    const bid = clamp(c - BOTS.naive.halfSpread, g.orderMin, g.orderMax - 1);
    const ask = clamp(Math.max(bid + 1, c + BOTS.naive.halfSpread), g.orderMin + 1, g.orderMax);
    cancelAll(state, BOTS.naive.pid);
    nb.fair = Math.round(fair * 10000) / 100;
    nb.bid = null;
    nb.ask = null;
    for (const [side, px] of [["B", bid], ["A", ask]]) {
      try {
        placeOrder(state, BOTS.naive.pid, side, px, BOTS.naive.size, now);
        if (side === "B") nb.bid = px;
        else nb.ask = px;
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        nb.lastError = e.message;
      }
    }
  }

  for (const nz of b.noise) {
    if (!nz.on || nz.nextAt == null || now < nz.nextAt) continue;
    const def = BOTS.noise.find((d) => d.key === nz.key);
    nz.nextAt = now + def.everySec * 1000;
    // Deterministic in (round, desk, count), so a replayed CAS makes the same call.
    const side = rngFrom(`${state.roundId}|${nz.key}|${nz.sent}`)() < 0.5 ? "B" : "A";
    nz.sent++;
    fired = true;
    const g = grid(state);
    const ref = Math.round(markPx(state));
    const px = side === "B" ? Math.min(g.orderMax, ref + BOTS.maxSweep) : Math.max(g.orderMin, ref - BOTS.maxSweep);
    try {
      const r = placeOrder(state, nz.pid, side, px, def.size, now);
      nz.fills += r.filled;
      // A noise desk wants immediacy; it never leaves a quote lying around.
      if (r.resting) cancelOrder(state, nz.pid, r.resting.id);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      nz.lastError = e.message;
    }
  }
  return fired;
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
 * What every client may know about the round. Read it suspiciously: there is
 * no φ, μ, σ, switch or seed here, and no value of Y at all — the series
 * travels separately, cut at the current tick.
 */
function publicRound(state, now) {
  const g = grid(state);
  const tick = currentTick(state, now);
  const settled = state.status === "settled";
  const live = state.status === "live";
  const phaseEnd = state.status === "research" ? state.researchEndsAt : live ? bellAt(state) : null;
  return {
    roundId: state.roundId,
    status: state.status,
    phase: PHASES[state.status]?.name ?? state.status,
    K: state.K,
    T: state.T,
    H: state.H,
    tickNow: tick,
    ticksLeft: state.T - tick,
    tickMs: state.tickMs,
    secondsPerTick: state.tickMs / 1000,
    liveStartedAt: state.liveStartedAt ?? null,
    nextTickAt: live && tick < state.T ? state.liveStartedAt + (tick + 1) * state.tickMs : null,
    researchMinutes: state.researchMinutes,
    researchEndsAt: state.researchEndsAt ?? null,
    endsAt: phaseEnd ?? null,
    msLeft: phaseEnd == null ? null : Math.max(0, phaseEnd - now),
    serverNow: now,
    startCashC: state.startCashC,
    defaultSize: state.defaultSize ?? LIMITS.defaultOrderSize,
    lateJoin: state.lateJoin,
    players: Object.values(state.players ?? {}).filter((p) => !p.bot).length,
    teams: Object.values(state.teams ?? {}).filter((t) => !t.hidden).length,
    teamSize: LIMITS.teamSize,
    priceTick: g.tick,
    center: g.center,
    orderMin: g.orderMin,
    orderMax: g.orderMax,
    // The desks are public: everyone is told they exist and what they do.
    naiveDesk: !!state.bots?.naive?.on,
    noiseDesks: (state.bots?.noise ?? []).filter((n) => n.on).length,
    // Only once it cannot help anybody.
    settleC: settled ? state.settleC : null,
    xStar: settled ? state.xStar : null,
    yT: settled ? state.yT ?? null : null,
  };
}

/** History and the live ticks revealed so far — nothing past the current tick. */
function publicSeries(state, spec, now) {
  if (!spec || state.status === "lobby") return null;
  const tick = currentTick(state, now);
  return { t0: 1 - spec.history.length, ys: publicYs(spec, tick), tick };
}

function marketView(state, pid) {
  const levels = bookLevels(state, pid);
  return {
    ...levels,
    last: state.last,
    bestBid: bestBid(state),
    bestAsk: bestAsk(state),
    mark: markPx(state),
    mid: midPx(state),
    volume: state.volume,
    tape: state.tape.slice(0, 24).map((t) => ({ s: t.s, px: t.px, qty: t.qty, ts: t.ts, aggr: t.aggr })),
  };
}

function meView(state, p) {
  const pw = powers(state, p);
  const g = grid(state);
  return {
    id: p.id,
    name: p.name,
    teamId: p.teamId ?? null,
    cashC: p.cash,
    pos: state.status === "settled" ? p.settledPos ?? 0 : p.pos,
    bidResC: pw.bidC,
    askResC: pw.askC,
    buyC: pw.buyC,
    sellC: pw.sellC,
    spendableC: spendableC(state, p),
    valueC: valueC(state, p),
    spentC: p.spentC,
    startC: p.startC,
    orders: state.orders
      .filter((o) => o.pid === p.id)
      .map((o) => {
        const r = lotReserveC(g, o.side, o.px);
        return { id: o.id, side: o.side, px: o.px, qty: o.qty, ts: o.ts, holdC: (r.a + r.b) * o.qty };
      })
      .sort((a, b) => a.px - b.px),
  };
}

/** The data a player may download, as of `now`. */
function publicData(state, spec, now) {
  const tick = currentTick(state, now);
  return {
    roundId: state.roundId,
    K: state.K,
    T: state.T,
    secondsPerTick: state.tickMs / 1000,
    tick,
    history: spec.history,
    live: spec.path.slice(1, tick + 1),
  };
}

const boardRows = (state, n) => leaderboard(state, n);

/* ── the router ───────────────────────────────────────────────────────── */

/**
 * `nowArg` lets the tests step the clock: every time-dependent thing in a
 * request reads this one number.
 */
export async function handle(method, route, body, query, nowArg) {
  const now = nowArg ?? Date.now();

  switch (`${method} ${route}`) {
    /* ── meta ── */
    case "GET health": {
      const { state } = await readMarket();
      return {
        ok: true,
        game: "week5",
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
        dataNote: DATA_NOTE,
        limits: {
          maxSharesPerOrder: LIMITS.maxSharesPerOrder,
          maxOrdersPerPlayer: LIMITS.maxOrdersPerPlayer,
          teamSize: LIMITS.teamSize,
        },
        money: { startCashC: MONEY.startCashC },
        desks: {
          naive: { name: BOTS.naive.name, everySec: BOTS.naive.everySec, halfSpread: BOTS.naive.halfSpread, size: BOTS.naive.size },
          noise: BOTS.noise.map((d) => ({ name: d.name, everySec: d.everySec, size: d.size })),
        },
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
      const spec = await loadSpec(state.roundId);
      return {
        round: publicRound(state, now),
        series: publicSeries(state, spec, now),
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
      return tx((state) => {
        const p = requirePlayer(state, body);
        if (state.status === "settled") throw httpError(409, "that round is over", "over");
        const code = makeTeamCode(state, (n) => crypto.randomInt(0, n));
        const team = createTeam(state, p.id, body.name, teamId, code);
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

    /* ── the data ── */
    case "GET data": {
      const state = await readAdvanced(now);
      if (!state) throw httpError(409, "no round yet", "no-round");
      requirePlayer(state, query);
      if (state.status === "lobby") throw httpError(409, "the data comes out when research opens", "no-data");
      const spec = await loadSpec(state.roundId);
      if (!spec) throw httpError(409, "the data is not ready yet", "no-data");
      const d = publicData(state, spec, now);
      return {
        ...d,
        h: d.T - d.tick,
        rows: d.history.length + d.tick,
        t0: 1 - d.history.length,
        note: DATA_NOTE,
        // The block a team pastes into an AI. Built here so there is exactly one
        // copy of it and it can never drift from the numbers above.
        prompt: aiPrompt(d),
      };
    }

    case "GET data.csv": {
      const state = await readAdvanced(now);
      if (!state) throw httpError(409, "no round yet", "no-round");
      requirePlayer(state, query);
      if (state.status === "lobby") throw httpError(409, "the data comes out when research opens", "no-data");
      const spec = await loadSpec(state.roundId);
      if (!spec) throw httpError(409, "the data is not ready yet", "no-data");
      const d = publicData(state, spec, now);
      return {
        __raw: csvText(d),
        __contentType: "text/csv; charset=utf-8",
        __filename: `horizon-${state.roundId}-tick-${d.tick}.csv`,
      };
    }

    /* ── trading ── */
    case "POST order": {
      rateLimit(`order:${body.playerId}`, 45, 10_000, "easy — that is a lot of orders in ten seconds");
      await readAdvanced(now); // a tick may have settled the round a moment ago
      return tx((state) => {
        const p = requirePlayer(state, body);
        const side = body.side === "B" || body.side === "A" ? body.side : null;
        if (!side) throw httpError(400, "bad side");
        if (state.status === "research") throw httpError(409, "the book opens when research ends", "closed");
        if (state.status === "live" && currentTick(state, now) >= state.T) throw httpError(409, "tick T has printed — the round is settling", "closed");
        const res = placeOrder(state, p.id, side, Number(body.px), Number(body.qty ?? 1), now);
        return {
          filled: res.filled,
          canceled: res.canceled ?? 0,
          ioc: !!res.ioc,
          resting: res.resting ? { id: res.resting.id, px: res.resting.px, qty: res.resting.qty, side } : null,
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
        if (body.all) out = cancelAll(state, p.id);
        else if (body.orderId != null) out = cancelOrder(state, p.id, Number(body.orderId));
        else if (body.side && body.px != null) out = cancelLevel(state, p.id, body.side, Number(body.px));
        else throw httpError(400, "nothing to cancel");
        return { ...out, me: meView(state, p) };
      });
    }

    /* ── the reveal ── */
    case "GET reveal": {
      const state = await readAdvanced(now);
      if (!state) throw httpError(409, "no round yet", "no-round");
      if (state.status !== "settled") throw httpError(403, "the process is not revealed yet", "locked");
      const spec = await loadSpec(state.roundId);
      if (!spec) throw httpError(404, "that round's process is gone");
      const fair = fairSeries(spec, spec.path).map((p) => Math.round(p * 10000) / 100);
      const naive = [];
      for (let t = 0; t <= spec.T; t++) {
        naive.push(Math.round(naivePrice(publicYs(spec, t), spec.K, spec.T - t) * 10000) / 100);
      }
      const fit = fitAR1(spec.history);
      const desks = [BOTS.naive, ...BOTS.noise].map((d) => {
        const p = state.players[d.pid];
        return { name: d.name, pnlC: p ? p.cash - p.startC : 0 };
      });
      return {
        roundId: state.roundId,
        K: spec.K,
        T: spec.T,
        secondsPerTick: spec.secondsPerTick,
        t0: 1 - spec.history.length,
        history: spec.history,
        path: spec.path,
        yT: spec.path[spec.T],
        value: state.xStar,
        settleC: state.settleC,
        fair,
        naive,
        mids: state.mids ?? [],
        truth: {
          preset: spec.preset,
          presetName: PRESETS[spec.preset]?.name ?? "Custom",
          phi1: spec.phi1,
          phi2: spec.phi2,
          switchTick: spec.switchTick,
          mu: spec.mu,
          sigma: spec.sigma,
          seed: spec.seed,
        },
        fitAtOpen: fit ? { phi: fit.phi, sePhi: fit.sePhi, mu: fit.mu, sigma: fit.sigma, n: fit.n } : null,
        desks,
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
      const spec = await loadSpec(state.roundId);
      return {
        round: publicRound(state, now),
        series: publicSeries(state, spec, now),
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

    /** Build a fresh round: a new process, a new path, a new seed. */
    case "POST admin/round": {
      await requireAdmin(body);
      const params = readParams(body);
      const roundId = rid(5);
      const spec = await makeSpec(roundId, params, { seed: String(body.seed ?? "").trim(), preset: presetKey(body.preset) });
      const prev = (await readMarket({ fresh: true })).state;
      const startCashC = Math.round(clamp(numOr(body.startCash, MONEY.startCashC / 100), 100, 10_000_000) * 100);
      const defaultSize = Math.round(clamp(numOr(body.defaultSize, LIMITS.defaultOrderSize), 1, LIMITS.maxSharesPerOrder));
      const market = newMarket({ roundId, mode: "horizon", startCashC, defaultSize, lateJoin: body.lateJoin !== false });
      Object.assign(market, roundFields(params));
      market.liveStartedAt = null;
      market.researchEndsAt = null;
      seatBots(market, now);
      if (body.keepPlayers && prev) carryPlayers(prev, market, startCashC, now);
      await replaceMarket(market);
      return { round: publicRound(market, now), peek: peekOf(market, spec, now) };
    }

    /**
     * Change the settings of a round that has not opened yet. The process is
     * redrawn — new path, new seed unless pinned — and players and teams stay.
     * Locked the moment trading opens: from then on the path is a promise.
     */
    case "POST admin/settings": {
      await requireAdmin(body);
      const params = readParams(body);
      const cur = (await readMarket({ fresh: true })).state;
      if (!cur) throw httpError(409, "build a round first", "no-round");
      if (cur.status !== "lobby" && cur.status !== "research") {
        throw httpError(409, "settings are locked once trading opens — build a new round instead", "locked");
      }
      const roundId = rid(5);
      const spec = await makeSpec(roundId, params, { seed: String(body.seed ?? "").trim(), preset: presetKey(body.preset) });
      const state = await tx((st) => {
        if (st.status !== "lobby" && st.status !== "research") {
          throw httpError(409, "settings are locked once trading opens — build a new round instead", "locked");
        }
        st.roundId = roundId;
        Object.assign(st, roundFields(params));
        st.bots.naive.on = !!params.naiveBot;
        if (st.status === "research") st.researchEndsAt = Math.max(st.researchEndsAt ?? now, now);
        return st;
      });
      return { round: publicRound(state, now), peek: peekOf(state, spec, now) };
    }

    /** Open research: the history is out, the book stays shut. */
    case "POST admin/start": {
      await requireAdmin(body);
      const minutes = body.minutes == null || body.minutes === "" ? null : clamp(Number(body.minutes) || 0, 0.25, 60);
      const state = await tx((st) => {
        if (st.status !== "lobby") throw httpError(409, "research has already started");
        if (minutes != null) st.researchMinutes = minutes;
        st.status = "research";
        st.researchEndsAt = now + Math.round((st.researchMinutes ?? DEFAULTS.researchMinutes) * 60_000);
        return st;
      });
      return { round: publicRound(state, now) };
    }

    /** Open the book now. Tick 1 prints one tick-length from this instant. */
    case "POST admin/open": {
      await requireAdmin(body);
      const state = await tx((st) => {
        if (st.status !== "lobby" && st.status !== "research") throw httpError(409, "trading has already opened");
        if (st.status === "lobby") st.researchEndsAt = now;
        openTrading(st, now);
        return st;
      });
      return { round: publicRound(state, now) };
    }

    /**
     * More research time. The live clock IS the process — tick s prints at
     * open + s × tickMs, and that is the promise the path was drawn against —
     * so trading cannot be extended, only the window before it.
     */
    case "POST admin/extend": {
      await requireAdmin(body);
      const seconds = Math.round(numOr(body.seconds, numOr(body.minutes, 1) * 60));
      const state = await tx((st) => {
        if (st.status === "live") throw httpError(409, "the live clock is the process — it cannot be extended. End early instead, or let it run to T.");
        if (st.status !== "research") throw httpError(409, "there is no research clock running");
        st.researchEndsAt = Math.max(now + 1000, st.researchEndsAt + seconds * 1000);
        return st;
      });
      return { round: publicRound(state, now) };
    }

    /**
     * End now: the clock jumps to tick T, every remaining tick prints at once,
     * and the contract settles on the real Y_T. Nothing is re-drawn.
     */
    case "POST admin/end": {
      await requireAdmin(body);
      const cur = (await readMarket({ fresh: true })).state;
      if (!cur) throw httpError(409, "no round");
      if (cur.status === "settled") return { round: publicRound(cur, now), already: true };
      const spec = await loadSpec(cur.roundId);
      if (!spec) throw httpError(409, "that round's process is gone");
      let settledNow = false;
      const state = await tx((st) => {
        if (st.status === "settled") return st;
        if (st.status !== "live") openTrading(st, now);
        st.endedEarly = true;
        applyDue(st, spec, now);
        settledNow = st.status === "settled";
        return st;
      });
      if (settledNow) await recordHistory(state, spec, now);
      return { round: publicRound(state, now) };
    }

    /**
     * Wipe everything: the market, every player, team and device binding, and
     * the round history. The admin password survives.
     */
    case "POST admin/reset": {
      await requireAdmin(body);
      if (body.confirm !== "RESET") throw httpError(400, 'send confirm:"RESET" to wipe the game');
      const prev = (await readMarket({ fresh: true })).state;
      if (prev?.roundId) await kv.del(SPEC(prev.roundId));
      await kv.del(MKT, MKTV, HISTORY);
      cached = { value: null, version: "", at: 0 };
      specCache.clear();
      return { ok: true, cleared: { round: prev?.roundId ?? null, players: Object.values(prev?.players ?? {}).filter((p) => !p.bot).length } };
    }

    case "POST admin/kick": {
      await requireAdmin(body);
      return tx((state) => {
        const p = state.players[body.playerId];
        if (!p || p.bot) throw httpError(404, "no such player");
        cancelAll(state, p.id);
        if (p.pos !== 0) throw httpError(409, `${p.name} is holding ${p.pos} shares — they cannot be removed mid-position`);
        if (p.teamId) leaveTeam(state, p.id);
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
      const spec = await loadSpec(state.roundId);
      return {
        ...base,
        round: publicRound(state, now),
        market: marketView(state, null),
        peek: spec ? peekOf(state, spec, now) : null,
        audit: auditState(state),
        desks: state.bots ?? null,
        players: Object.values(state.players)
          .filter((p) => !p.bot)
          .map((p) => ({
            id: p.id,
            name: p.name,
            device: p.device,
            team: p.teamId ? state.teams[p.teamId]?.name ?? null : null,
            cashC: p.cash,
            pos: state.status === "settled" ? p.settledPos ?? 0 : p.pos,
            valueC: valueC(state, p),
            orders: state.orders.filter((o) => o.pid === p.id).length,
          }))
          .sort((a, b) => b.valueC - a.valueC),
        teams: Object.values(state.teams ?? {})
          .filter((t) => !t.hidden)
          .map((t) => ({ id: t.id, name: t.name, code: t.code, members: t.members.map((pid) => state.players[pid]?.name).filter(Boolean) })),
        openOrders: state.orders.length,
        volume: state.volume,
      };
    }

    default:
      throw httpError(404, `no route: ${method} ${route}`);
  }
}

/* ── building rounds ──────────────────────────────────────────────────── */

const presetKey = (k) => (PRESETS[k] ? k : "custom");

/** The admin form, checked. A bad field is a 400 with the reason. */
function readParams(body) {
  try {
    return normalizeParams(body, DEFAULTS);
  } catch (e) {
    throw httpError(400, e.message, "bad-settings");
  }
}

/** The round fields the market document carries. Public by construction. */
function roundFields(params) {
  return {
    K: params.K,
    T: params.T,
    H: params.H,
    tickMs: Math.round(params.secondsPerTick * 1000),
    researchMinutes: params.researchMinutes,
    naiveBot: !!params.naiveBot,
  };
}

/** The host's peek: the truth, and what the contract is worth right now. */
function peekOf(state, spec, now) {
  const tick = currentTick(state, now);
  return {
    preset: spec.preset,
    presetName: PRESETS[spec.preset]?.name ?? "Custom",
    phi1: spec.phi1,
    phi2: spec.phi2,
    switchTick: spec.switchTick,
    mu: spec.mu,
    sigma: spec.sigma,
    K: spec.K,
    yOpen: spec.yOpen,
    H: spec.H,
    T: spec.T,
    secondsPerTick: spec.secondsPerTick,
    seed: spec.seed,
    pinned: spec.pinned,
    tick,
    yNow: spec.path[tick],
    fairNow: Math.round(fairValue(spec, spec.path, tick) * 10000) / 100,
    naiveNow: Math.round(naivePrice(publicYs(spec, tick), spec.K, spec.T - tick) * 10000) / 100,
    fitAtOpen: (() => {
      const f = fitAR1(spec.history);
      return f ? { phi: f.phi, sePhi: f.sePhi } : null;
    })(),
  };
}

/** Teams survive into the next round so a table does not have to re-pair. */
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
    market.teams[t.id] = { ...t, members };
    market.codes[t.code] = t.id;
  }
  for (const p of Object.values(market.players)) {
    if (p.teamId && !market.teams[p.teamId]) p.teamId = null;
  }
}

/* ── node plumbing ────────────────────────────────────────────────────── */

const MAX_BODY = 64 * 1024;

/**
 * Wraps `handle` for a plain node request. A result carrying `__raw` is sent
 * verbatim with its own content type — that is how the CSV download gets to be
 * a real file the browser saves rather than a JSON blob.
 */
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
