/**
 * The whole Week 4 API in one router, mounted three ways:
 *   - api/week4/router.mjs   (Vercel serverless, production)
 *   - week4/dev-server.js    (plain node http, local dev)
 *   - week4/serve.js         (one process serving app + API, for event day)
 *
 * An asteroid is coming. Two books — NORTH and SOUTH — and exactly one pays.
 * A round runs lobby → research → live → ended → settled. The market document
 * is written only through compare-and-swap transactions (server/kv.js), so
 * sixty people clicking at once cannot lose a trade or mint money.
 *
 * WHAT IS SECRET
 * --------------
 * The true trajectory lives in its own key and never leaves this file before
 * the bell. What the room gets is `state.released` batches of NOISY rows, and
 * the server will not hand over a row it has not released, no matter who asks.
 * `publicRound` is the only shape that reaches a player, and it is written to
 * be read suspiciously.
 */

import crypto from "node:crypto";
import * as kv from "./kv.js";
import { STORE_CONFIG } from "./store-config.mjs";
import {
  newMarket, newPlayer, placeOrder, cancelOrder, cancelLevel, cancelAll, settle,
  powers, freeC, orderHolds, reservedC, grid, midPx, bookLevels, createTeam, joinTeam,
  leaveTeam, teamView, makeTeamCode, bestBid, bestAsk, markPx, valueC, leaderboard,
  auditState, snapTick, maxSharesAt, isMarket, EngineError,
} from "../shared/engine.js";
import {
  MARKETS, MARKET_META, BOOK, LIMITS, MONEY, SCENARIO, DATA, CONFIDENCE,
  PHASES, TIMERS, BOTS, RULES_TEXT, DATA_NOTE,
} from "../shared/rules.js";
import { buildScenario, verifyScenario, closestApproachToSun, propagate, posOf, latitudeOf, AU_KM, YEAR_DAYS } from "../shared/orbits.js";
import {
  observationEpochs, buildSensitivity, releasePlan, calibrateNoise,
  makeObservations, measuredMasses, toCSV,
} from "../shared/observe.js";

/* ── secrets ──────────────────────────────────────────────────────────── */

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

const DEFAULT_SECRET = "week4-dev-secret";
const IS_PROD = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

function resolveSecret() {
  if (process.env.SESSION_SECRET) return { secret: process.env.SESSION_SECRET, from: "SESSION_SECRET" };
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (apiKey) return { secret: sha(`week4|session|${apiKey}`), from: "an API key in the environment" };
  const store = process.env.UPSTASH_REDIS_REST_TOKEN || STORE_CONFIG.UPSTASH_REDIS_REST_TOKEN;
  if (store) return { secret: sha(`week4|session|${store}`), from: "the committed store config" };
  return { secret: DEFAULT_SECRET, from: "nothing" };
}

const { secret: SECRET, from: SECRET_FROM } = resolveSecret();

if (SECRET === DEFAULT_SECRET) {
  const msg =
    'No SESSION_SECRET and nothing to derive one from — player and admin tokens are forgeable. Set one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
  if (IS_PROD) throw new Error(`REFUSING TO START: ${msg}`);
  console.warn(`[week4] ⚠ ${msg} (allowed in dev only)`);
} else if (SECRET_FROM !== "SESSION_SECRET") {
  console.warn(`[week4] SESSION_SECRET is unset — signing tokens with a key derived from ${SECRET_FROM}.`);
}

const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const playerToken = (pid) => sha(`${SECRET}|player|${pid}`);
const adminTokenFor = (hash) => sha(`${SECRET}|admin|${hash}`);

/** A number from a form field, or the fallback. Empty means "default", never 0. */
function numOr(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function httpError(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

/* ── keys ─────────────────────────────────────────────────────────────── */

const MKT = "w4:mkt";
const MKTV = "w4:mkt:v";
/** The truth. Never served whole before settlement. */
const SPEC = (roundId) => `w4:sky:${roundId}`;
const HISTORY = "w4:history";

/* ── the market transaction ───────────────────────────────────────────── */

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
    if (!cur.value) throw httpError(409, "no round is set up yet — ask the admin to start one", "no-round");
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

/* ── the sky (the secret) ─────────────────────────────────────────────── */

const specCache = new Map();

async function loadSpec(roundId) {
  if (!roundId) return null;
  if (specCache.has(roundId)) return specCache.get(roundId);
  const spec = await kv.getJSON(SPEC(roundId));
  if (spec) {
    specCache.set(roundId, spec);
    if (specCache.size > 8) specCache.delete(specCache.keys().next().value);
  }
  return spec;
}

/* ── admin ────────────────────────────────────────────────────────────── */

async function adminHash() {
  let h = await kv.get("w4:admin:hash");
  if (!h) {
    h = sha(process.env.ADMIN_PASSWORD || "123");
    await kv.set("w4:admin:hash", h);
  }
  return h;
}

async function requireAdmin(body) {
  const expect = adminTokenFor(await adminHash());
  if (body.token !== expect) throw httpError(401, "bad admin token");
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

/* ── the noise desk ───────────────────────────────────────────────────── */

const BOT_PID = "survey-desk";
const BOT_TEAM = "survey-desk-team";

/** Seat the bot at its own hidden table so it can trade like anyone else. */
function seatBot(state) {
  if (state.players[BOT_PID]) return;
  const p = newPlayer(BOT_PID, BOTS.name, "bot-device", state.startCashC * 400, Date.now());
  p.teamId = BOT_TEAM;
  state.players[BOT_PID] = p;
  state.teams[BOT_TEAM] = {
    id: BOT_TEAM,
    name: BOTS.name,
    code: "----",
    members: [BOT_PID],
    createdAt: Date.now(),
    hidden: true,
  };
}

/**
 * Fire any noise orders that have come due.
 *
 * There is no background worker on a serverless host, so the schedule is
 * carried on the document and advanced by whoever happens to poll next. A bot
 * that has fallen several intervals behind fires ONCE and then re-bases, so a
 * quiet minute cannot produce a burst of forty orders the instant someone
 * loads the page.
 */
function runBotsIfDue(state, now) {
  if (state.status !== "live") return 0;
  if (!Array.isArray(state.bots) || !state.bots.length) return 0;
  seatBot(state);
  let fired = 0;
  for (const bot of state.bots) {
    if (!bot.on || !bot.shares || !bot.everySec) continue;
    if (!bot.nextAt) {
      bot.nextAt = now + bot.everySec * 1000;
      continue;
    }
    if (now < bot.nextAt) continue;
    // One order, then re-base to now. Never a catch-up burst.
    bot.nextAt = now + bot.everySec * 1000;
    try {
      // A market order, expressed as a limit that sweeps a bounded distance.
      const g = grid(state);
      const ref = markPx(state, bot.market);
      const px =
        bot.side === "B"
          ? Math.min(g.orderMax, Math.round(ref) + BOTS.maxSweep)
          : Math.max(g.orderMin, Math.round(ref) - BOTS.maxSweep);
      const r = placeOrder(state, bot.market, BOT_PID, bot.side, px, bot.shares, now);
      bot.fills = (bot.fills ?? 0) + r.filled;
      bot.sent = (bot.sent ?? 0) + 1;
      if (r.resting) {
        // The desk does not leave quotes lying around; it wanted immediacy.
        cancelOrder(state, BOT_PID, r.resting.id, bot.market);
      }
      fired++;
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      bot.lastError = e.message;
    }
  }
  return fired;
}

/* ── the clock ────────────────────────────────────────────────────────── */

/**
 * Move the round along if its timer has run out, and fire any due bots.
 * Every read path calls this, so the game advances even with nobody clicking.
 */
async function advanceIfDue(state, version, now) {
  let changed = false;

  if (state.status === "research" && state.endsAt && now >= state.endsAt) {
    openTrading(state, now, state.tradingMinutes ?? TIMERS.defaultTradingMinutes);
    changed = true;
  }
  if (state.status === "live" && state.endsAt && now >= state.endsAt) {
    state.status = "ended";
    state.endedAt = now;
    changed = true;
  }
  if (state.status === "live") {
    if (runBotsIfDue(state, now)) changed = true;
  }
  if (state.status === "ended") {
    const spec = await loadSpec(state.roundId);
    if (spec) {
      settle(state, spec.winner, now);
      await recordHistory(state, spec, now);
      changed = true;
    }
  }
  if (!changed) return { state, version };
  await replaceMarket(state);
  return { state, version };
}

function openTrading(state, now, minutes) {
  state.status = "live";
  state.startedAt = now;
  state.endsAt = now + Math.round(minutes * 60_000);
  for (const bot of state.bots ?? []) bot.nextAt = now + (bot.everySec ?? 30) * 1000;
}

async function recordHistory(state, spec, now) {
  const rows = leaderboard(state, 10).map((t) => ({ name: t.name, valueC: t.valueC, size: t.size }));
  const entry = {
    roundId: state.roundId,
    at: now,
    winner: spec.winner,
    latDeg: spec.impactLatDeg,
    podium: rows,
  };
  const prev = (await kv.getJSON(HISTORY)) ?? [];
  await kv.setJSON(HISTORY, [entry, ...prev].slice(0, 40));
}

/* ── views ────────────────────────────────────────────────────────────── */

function requirePlayer(state, body) {
  const pid = body.playerId ?? body.pid;
  if (!pid || body.token !== playerToken(pid)) throw httpError(401, "bad player credentials", "auth");
  const p = state.players?.[pid];
  if (!p) throw httpError(401, "you are not in this round — join again", "auth");
  return p;
}

/**
 * What every client is allowed to know.
 *
 * Deliberately absent: the impact latitude, which market wins, the true
 * trajectory, the noise scale, and any observation past `released`.
 */
function publicRound(state, now) {
  const releases = state.releases ?? [];
  const shown = releases.slice(0, state.released ?? 0);
  return {
    roundId: state.roundId,
    status: state.status,
    phase: PHASES[state.status]?.name ?? state.status,
    question: state.question,
    startedAt: state.startedAt,
    endsAt: state.endsAt,
    msLeft: state.endsAt ? Math.max(0, state.endsAt - now) : null,
    serverNow: now,
    startCashC: state.startCashC,
    defaultSize: state.defaultSize,
    tick: state.tick,
    center: state.center,
    orderMin: state.orderMin,
    orderMax: state.orderMax,
    lateJoin: state.lateJoin,
    players: Object.values(state.players ?? {}).filter((p) => p.id !== BOT_PID).length,
    teams: Object.values(state.teams ?? {}).filter((t) => !t.hidden).length,
    teamSize: LIMITS.teamSize,
    // Data the room has, and what is still to come.
    released: state.released ?? 0,
    releaseCount: releases.length,
    releaseLog: shown.map((r, i) => ({
      index: i + 1,
      leadDays: r.leadDays,
      rows: r.count,
      at: state.releaseLog?.[i]?.at ?? null,
    })),
    nextLeadDays: releases[state.released ?? 0]?.leadDays ?? null,
    observationCount: shown.reduce((n, r) => n + r.count, 0),
    recordYears: state.recordYears ?? SCENARIO.years,
    impactDay: state.impactDay ?? null,
    // Bots are public. Everyone is told they exist and what they are doing.
    bots: (state.bots ?? [])
      .filter((b) => b.on)
      .map((b) => ({ market: b.market, side: b.side, shares: b.shares, everySec: b.everySec })),
    winner: state.status === "settled" ? state.winner : null,
  };
}

function marketView(state, market, pid) {
  const lv = bookLevels(state, market, pid);
  const b = state.books[market];
  return {
    market,
    bids: lv.bids,
    asks: lv.asks,
    last: b.last,
    bestBid: bestBid(state, market),
    bestAsk: bestAsk(state, market),
    mid: midPx(state, market),
    mark: markPx(state, market),
    volume: b.volume,
    tape: b.tape.slice(0, 24),
  };
}

function meView(state, p) {
  const pw = powers(state, p);
  return {
    id: p.id,
    name: p.name,
    teamId: p.teamId,
    cashC: p.cash,
    pos: { ...p.pos },
    reservedC: reservedC(state, p.id),
    freeC: freeC(state, p),
    powers: pw,
    valueC: valueC(state, p),
    startC: p.startC,
    spentC: p.spentC,
    orders: orderHolds(state, p.id),
    downloads: p.downloads ?? 0,
    settledPos: p.settledPos ?? null,
  };
}

/** What the gate needs to show a team code: the code, and how many seats. */
const teamCard = (team) => ({
  id: team.id,
  name: team.name,
  code: team.code,
  size: team.members.length,
  max: LIMITS.teamSize,
});

/** Rows the room is allowed to have, and not one more. */
function releasedRows(state, spec) {
  const upto = state.released ?? 0;
  if (upto <= 0) return [];
  const cut = (state.releases ?? [])[upto - 1]?.cutDay;
  if (cut == null) return [];
  return spec.observations.filter((r) => r.day <= cut);
}

/* ── the router ───────────────────────────────────────────────────────── */

export async function handle(method, route, body, query) {
  const now = Date.now();

  switch (`${method} ${route}`) {
    case "GET health": {
      return {
        ok: true,
        game: "week4",
        storage: kv.KV_MODE,
        persistent: kv.KV_PERSISTENT,
        secret: SECRET_FROM,
        time: new Date(now).toISOString(),
      };
    }

    case "GET rules": {
      return {
        rules: RULES_TEXT,
        dataNote: DATA_NOTE,
        markets: MARKETS.map((m) => MARKET_META[m]),
        book: BOOK,
        limits: {
          maxSharesPerOrder: LIMITS.maxSharesPerOrder,
          maxOrdersPerPlayer: LIMITS.maxOrdersPerPlayer,
          teamSize: LIMITS.teamSize,
          codeHoldSeconds: LIMITS.codeHoldSeconds,
        },
        money: { startCashC: MONEY.startCashC },
      };
    }

    case "GET config": {
      const r = await readMarket();
      if (!r.state) return { round: null, persistent: kv.KV_PERSISTENT };
      const after = await advanceIfDue(r.state, r.version, now);
      return { round: publicRound(after.state, now), persistent: kv.KV_PERSISTENT };
    }

    case "POST join": {
      rateLimit(`join:${body.deviceId ?? "anon"}`, 12, 60_000);
      const name = String(body.name ?? "").trim().slice(0, LIMITS.nameMax);
      if (name.length < LIMITS.nameMin) throw httpError(400, `names need ${LIMITS.nameMin} characters or more`);
      const deviceId = String(body.deviceId ?? "").trim();
      if (deviceId.length < 8) throw httpError(400, "bad device id");
      return tx((state) => {
        const existing = state.devices[deviceId];
        if (existing && state.players[existing]) {
          const p = state.players[existing];
          p.name = name;
          return { playerId: p.id, token: playerToken(p.id), rejoined: true, me: meView(state, p) };
        }
        if (state.status === "settled") throw httpError(409, "that round is over", "closed");
        if (!state.lateJoin && state.status !== "lobby" && state.status !== "research") {
          throw httpError(409, "this round is closed to new players", "closed");
        }
        const pid = rid(5);
        state.players[pid] = newPlayer(pid, name, deviceId, state.startCashC, now);
        state.devices[deviceId] = pid;
        return { playerId: pid, token: playerToken(pid), rejoined: false, me: meView(state, state.players[pid]) };
      });
    }

    case "GET state": {
      const r = await readMarket();
      if (!r.state) throw httpError(409, "no round yet", "no-round");
      const { state } = await advanceIfDue(r.state, r.version, now);
      const p = requirePlayer(state, query);
      const since = Number(query.since ?? 0);
      return {
        round: publicRound(state, now),
        markets: Object.fromEntries(MARKETS.map((m) => [m, marketView(state, m, p.id)])),
        me: meView(state, p),
        team: teamView(state, p),
        fills: (p.fills ?? []).filter((f) => f.s > since).sort((a, b) => a.s - b.s),
      };
    }

    case "POST team/create": {
      return tx((state) => {
        const p = requirePlayer(state, body);
        const teamId = rid(4);
        const code = makeTeamCode(state, (n) => crypto.randomInt(n));
        const team = createTeam(state, p.id, body.name, teamId, code);
        return { team: teamCard(team), me: meView(state, p) };
      });
    }

    case "POST team/join": {
      return tx((state) => {
        const p = requirePlayer(state, body);
        const team = joinTeam(state, p.id, body.code);
        return { team: teamCard(team), me: meView(state, p) };
      });
    }

    case "POST team/leave": {
      return tx((state) => {
        const p = requirePlayer(state, body);
        const out = leaveTeam(state, p.id);
        return { ...out, me: meView(state, p) };
      });
    }

    /* ── the data ─────────────────────────────────────────────────────── */

    case "GET data": {
      const r = await readMarket();
      if (!r.state) throw httpError(409, "no round yet", "no-round");
      const state = r.state;
      requirePlayer(state, query);
      const spec = await loadSpec(state.roundId);
      if (!spec) throw httpError(409, "the record is not ready yet", "no-data");
      if (!(state.released > 0)) throw httpError(409, "no data has been released yet", "no-data");
      const rows = releasedRows(state, spec);
      return {
        rows,
        masses: spec.masses.map((m) => ({ kg: m.kg, relError: m.relError })),
        note: DATA_NOTE,
        released: state.released ?? 0,
        cutDay: (state.releases ?? [])[(state.released ?? 1) - 1]?.cutDay ?? null,
        impactDay: state.impactDay,
      };
    }

    case "GET data.csv": {
      const r = await readMarket();
      if (!r.state) throw httpError(409, "no round yet", "no-round");
      const state = r.state;
      requirePlayer(state, query);
      const spec = await loadSpec(state.roundId);
      if (!spec) throw httpError(409, "the record is not ready yet", "no-data");
      const rows = releasedRows(state, spec);
      if (!rows.length) throw httpError(409, "no data has been released yet", "no-data");
      // Count the download so the operator can see who is actually working.
      tx((st) => {
        const p = st.players?.[query.playerId];
        if (p) p.downloads = (p.downloads ?? 0) + 1;
      }).catch(() => {});
      return {
        __raw: toCSV(rows, spec.masses, { note: `release ${state.released} of ${state.releases.length}` }),
        __contentType: "text/csv; charset=utf-8",
        __filename: `asteroid-${state.roundId}-release-${state.released}.csv`,
      };
    }

    /* ── trading ──────────────────────────────────────────────────────── */

    case "POST order": {
      const pid = body.playerId;
      rateLimit(`order:${pid}`, 45, 10_000, "easy — that is a lot of orders in ten seconds");
      return tx((state) => {
        const p = requirePlayer(state, body);
        runBotsIfDue(state, now);
        const market = String(body.market ?? "");
        if (!isMarket(market)) throw httpError(400, "no such market");
        const side = body.side === "B" || body.side === "A" ? body.side : null;
        if (!side) throw httpError(400, "bad side");
        const res = placeOrder(state, market, p.id, side, Number(body.px), Number(body.qty ?? 1), now);
        return {
          market,
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
        const market = body.market && isMarket(body.market) ? body.market : null;
        let out;
        if (body.all) out = cancelAll(state, p.id, market);
        else if (body.orderId != null) out = cancelOrder(state, p.id, Number(body.orderId), market);
        else if (market && body.side && body.px != null) out = cancelLevel(state, p.id, market, body.side, Number(body.px));
        else throw httpError(400, "nothing to cancel");
        return { ...out, me: meView(state, p) };
      });
    }

    /* ── the reveal ───────────────────────────────────────────────────── */

    case "GET reveal": {
      const r = await readMarket();
      if (!r.state) throw httpError(409, "no round yet", "no-round");
      const { state } = await advanceIfDue(r.state, r.version, now);
      if (state.status !== "settled") throw httpError(409, "not yet", "not-settled");
      const spec = await loadSpec(state.roundId);
      if (!spec) throw httpError(409, "the record is gone", "no-data");
      return {
        roundId: state.roundId,
        winner: state.winner,
        latDeg: spec.impactLatDeg,
        impactDay: spec.tImpact,
        track: spec.track,
        trackDays: spec.trackDays,
        physics: spec.physics,
        leaderboard: leaderboard(state, 100).filter((t) => t.id !== BOT_TEAM),
      };
    }

    case "GET leaderboard": {
      const r = await readMarket();
      if (!r.state) return { leaderboard: [], round: null };
      const { state } = await advanceIfDue(r.state, r.version, now);
      return {
        leaderboard: leaderboard(state, 100).filter((t) => t.id !== BOT_TEAM),
        round: publicRound(state, now),
      };
    }

    case "GET board": {
      const r = await readMarket();
      if (!r.state) return { round: null, persistent: kv.KV_PERSISTENT };
      const { state } = await advanceIfDue(r.state, r.version, now);
      return {
        round: publicRound(state, now),
        markets: Object.fromEntries(MARKETS.map((m) => [m, marketView(state, m, null)])),
        leaderboard: leaderboard(state, 12).filter((t) => t.id !== BOT_TEAM),
      };
    }

    case "GET history": {
      return { history: (await kv.getJSON(HISTORY)) ?? [] };
    }

    /* ── admin ────────────────────────────────────────────────────────── */

    case "POST admin/auth": {
      rateLimit(`admin:${body.password ? sha(body.password).slice(0, 8) : "x"}`, 12, 60_000, "too many attempts");
      const h = sha(String(body.password ?? ""));
      if (h !== (await adminHash())) throw httpError(401, "wrong password");
      return { token: adminTokenFor(h) };
    }

    case "POST admin/password": {
      await requireAdmin(body);
      const next = String(body.password ?? "");
      if (next.length < 3) throw httpError(400, "pick something longer");
      const h = sha(next);
      await kv.set("w4:admin:hash", h);
      return { token: adminTokenFor(h) };
    }

    case "POST admin/round": {
      await requireAdmin(body);
      return buildRound(body, now);
    }

    case "POST admin/start": {
      await requireAdmin(body);
      const minutes = Math.min(TIMERS.maxMinutes, Math.max(TIMERS.minMinutes, numOr(body.minutes, TIMERS.defaultResearchMinutes)));
      return tx((state) => {
        if (state.status === "settled") throw httpError(409, "that round is over");
        state.status = "research";
        state.startedAt = now;
        state.endsAt = now + Math.round(minutes * 60_000);
        if (!state.released) {
          state.released = 1;
          state.releaseLog = [{ at: now, index: 1 }];
        }
        return { round: publicRound(state, now) };
      });
    }

    case "POST admin/open": {
      await requireAdmin(body);
      const minutes = Math.min(TIMERS.maxMinutes, Math.max(TIMERS.minMinutes, numOr(body.minutes, TIMERS.defaultTradingMinutes)));
      return tx((state) => {
        if (state.status === "settled" || state.status === "ended") throw httpError(409, "that round is over");
        if (!state.released) {
          state.released = 1;
          state.releaseLog = [{ at: now, index: 1 }];
        }
        openTrading(state, now, minutes);
        return { round: publicRound(state, now) };
      });
    }

    case "POST admin/release": {
      await requireAdmin(body);
      return tx((state) => {
        const total = (state.releases ?? []).length;
        if ((state.released ?? 0) >= total) throw httpError(409, "the whole record is already out", "no-more");
        state.released = (state.released ?? 0) + 1;
        state.releaseLog = [...(state.releaseLog ?? []), { at: now, index: state.released }];
        const r = state.releases[state.released - 1];
        return {
          released: state.released,
          leadDays: r.leadDays,
          rows: r.count,
          round: publicRound(state, now),
        };
      });
    }

    case "POST admin/extend": {
      await requireAdmin(body);
      const minutes = numOr(body.minutes, 5);
      return tx((state) => {
        if (!state.endsAt) throw httpError(409, "no clock is running");
        state.endsAt += Math.round(minutes * 60_000);
        return { round: publicRound(state, now) };
      });
    }

    case "POST admin/end": {
      await requireAdmin(body);
      const spec = await loadSpec((await readMarket({ fresh: true })).state?.roundId);
      return tx((state) => {
        if (state.status === "settled") return { round: publicRound(state, now), already: true };
        state.status = "ended";
        state.endedAt = now;
        if (spec) settle(state, spec.winner, now);
        return { round: publicRound(state, now) };
      }).then(async (out) => {
        const fresh = await readMarket({ fresh: true });
        if (fresh.state?.status === "settled" && spec) await recordHistory(fresh.state, spec, now);
        return out;
      });
    }

    case "POST admin/bots": {
      await requireAdmin(body);
      const slots = Array.isArray(body.bots) ? body.bots : [];
      return tx((state) => {
        state.bots = BOTS.slots.map((slot) => {
          const given = slots.find((s) => s.key === slot.key) ?? {};
          const prev = (state.bots ?? []).find((b) => b.key === slot.key) ?? {};
          const shares = Math.min(BOTS.maxShares, Math.max(0, Math.round(numOr(given.shares, 0))));
          const everySec = Math.min(BOTS.maxSeconds, Math.max(BOTS.minSeconds, Math.round(numOr(given.everySec, 30))));
          return {
            key: slot.key,
            market: slot.market,
            side: slot.side,
            on: !!given.on && shares > 0,
            shares,
            everySec,
            nextAt: state.status === "live" ? now + everySec * 1000 : null,
            sent: prev.sent ?? 0,
            fills: prev.fills ?? 0,
          };
        });
        return { bots: state.bots };
      });
    }

    case "POST admin/reset": {
      await requireAdmin(body);
      if (body.confirm !== "RESET") throw httpError(400, 'send confirm:"RESET" to wipe the game');
      const prev = (await readMarket({ fresh: true })).state;
      if (prev?.roundId) await kv.del(SPEC(prev.roundId));
      await kv.del(MKT, MKTV, HISTORY);
      cached = { value: null, version: "", at: 0 };
      specCache.clear();
      return {
        ok: true,
        cleared: {
          round: prev?.roundId ?? null,
          players: Object.keys(prev?.players ?? {}).filter((id) => id !== BOT_PID).length,
        },
      };
    }

    case "POST admin/kick": {
      await requireAdmin(body);
      return tx((state) => {
        const p = state.players[body.playerId];
        if (!p) throw httpError(404, "no such player");
        cancelAll(state, p.id);
        if (MARKETS.some((m) => (p.pos?.[m] ?? 0) !== 0)) {
          throw httpError(409, `${p.name} is holding a position — they cannot be removed mid-trade`);
        }
        delete state.players[p.id];
        for (const [dev, pid] of Object.entries(state.devices)) if (pid === p.id) delete state.devices[dev];
        for (const t of Object.values(state.teams)) t.members = t.members.filter((x) => x !== p.id);
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
      const r = await readMarket({ fresh: true });
      if (!r.state) return { round: null, players: [], spec: null };
      const spec = await loadSpec(r.state.roundId);
      return {
        round: publicRound(r.state, now),
        status: r.state.status,
        players: Object.values(r.state.players)
          .filter((p) => p.id !== BOT_PID)
          .map((p) => ({
            id: p.id,
            name: p.name,
            team: r.state.teams[p.teamId]?.name ?? null,
            device: p.device,
            cashC: p.cash,
            pos: { ...p.pos },
            downloads: p.downloads ?? 0,
          })),
        bots: r.state.bots ?? [],
        // The operator alone sees the answer, before anybody else does.
        truth: spec
          ? {
              winner: spec.winner,
              latDeg: spec.impactLatDeg,
              physics: spec.physics,
              // Without this the release table loses its confidence column the
              // moment the panel repolls, which is about two seconds later.
              calibration: spec.calibration,
              releases: r.state.releases,
            }
          : null,
        audit: auditState(r.state),
      };
    }

    default:
      throw httpError(404, `no route ${method} ${route}`);
  }
}

/* ── building a round ─────────────────────────────────────────────────── */

/**
 * The expensive one. Solving for a launch that lands on a chosen parallel is
 * twenty-odd three-year integrations, and the sensitivity study is twenty
 * more. Call it once, keep the answer.
 */
async function buildRound(body, now) {
  const seed = String(body.seed ?? "").trim() || rid(4);
  const roundId = rid(5);

  // Where the operator wants it. Blank means "surprise me", which also means
  // the operator can be as ignorant as the room if they want to be.
  let latDeg = numOr(body.impactLat, null);
  if (latDeg == null) {
    const r = crypto.randomInt(2) ? 1 : -1;
    const span = SCENARIO.latRange;
    latDeg = r * (span[0] + (crypto.randomInt(1000) / 1000) * (span[1] - span[0]));
    latDeg = Math.round(latDeg * 100) / 100;
  }
  const mag = Math.abs(latDeg);
  if (mag < SCENARIO.latRange[0] || mag > SCENARIO.latRange[1]) {
    throw httpError(400, `aim between ${SCENARIO.latRange[0]}° and ${SCENARIO.latRange[1]}° from the equator`);
  }

  const startConf = clamp(numOr(body.startConfidence, CONFIDENCE.defaultStart), ...CONFIDENCE.range);
  const endConf = clamp(numOr(body.endConfidence, CONFIDENCE.defaultEnd), ...CONFIDENCE.range);
  if (endConf < startConf) throw httpError(400, "the later data cannot be less convincing than the earlier data");
  const stepDays = DATA.stepChoices.includes(Number(body.stepDays)) ? Number(body.stepDays) : DATA.defaultStepDays;
  const startCashC = Math.round(clamp(numOr(body.startCash, MONEY.startCashC / 100), 100, 10_000_000) * 100);
  const defaultSize = Math.round(clamp(numOr(body.defaultSize, LIMITS.defaultOrderSize), 1, LIMITS.maxSharesPerOrder));

  const scenario = buildScenario(`${seed}|${roundId}`, latDeg, {
    years: SCENARIO.years,
    perihelion: SCENARIO.perihelion,
    minPasses: SCENARIO.minPasses,
    astMassKg: SCENARIO.astMassKg,
  });
  const check = verifyScenario(scenario);
  if (!check.ok) throw httpError(500, `the trajectory did not land where it was aimed: ${check.reason ?? check.latDeg}`);

  const epochs = observationEpochs(scenario.tImpact, DATA.cadence);
  const sens = buildSensitivity(scenario, epochs);
  const batches = releasePlan(scenario.tImpact, epochs, { firstCutDays: DATA.firstCutDays, stepDays });
  const cal = calibrateNoise(sens, (latDeg * Math.PI) / 180, batches, {
    startConf,
    endConf,
    gmPriorRel: DATA.massRelError,
  });

  const observations = makeObservations(scenario, epochs, cal.sigmas, `${seed}|${roundId}`);
  const masses = measuredMasses(scenario, `${seed}|${roundId}`, DATA.massRelError);
  const sun = closestApproachToSun(scenario);

  // A sampled true path, for the reveal only.
  const trackDays = [];
  const track = [];
  {
    const opts = { mass: scenario.mass, relativistic: true, rtol: 1e-11, atol: 1e-13 };
    let y = Float64Array.from(scenario.y0);
    let t = 0;
    const N = 520;
    for (let i = 0; i <= N; i++) {
      const tn = (scenario.tImpact * i) / N;
      y = propagate(y, t, tn, opts);
      t = tn;
      trackDays.push(Math.round(tn * 100) / 100);
      track.push([
        ...posOf(y, 0).map(r6),
        ...posOf(y, 1).map(r6),
        ...posOf(y, 2).map(r6),
      ]);
    }
  }

  const winner = latDeg >= 0 ? "north" : "south";
  const spec = {
    roundId,
    seed,
    winner,
    impactLatDeg: check.latDeg,
    tImpact: scenario.tImpact,
    observations,
    masses,
    track,
    trackDays,
    physics: {
      perihelionAu: sun.au,
      perihelionSolarRadii: sun.solarRadii,
      passes: scenario.orbit.passes,
      eccentricity: scenario.orbit.ecc,
      semiMajorAu: scenario.orbit.a,
      relativisticDriftKm: check.relativisticDriftKm,
      newtonianMisses: check.newtonianMisses,
      newtonianLatDeg: check.newtonianLatDeg,
      newtonianMissKm: check.newtonianMissKm ?? 0,
      contactErrorDays: check.contactError,
    },
    calibration: {
      startConf,
      endConf,
      exponent: cal.exponent,
      rangeExponent: cal.rangeExponent,
      surveyImprovement: cal.surveyImprovement,
      cappedExponent: cal.cappedExponent,
      endShortfall: cal.endShortfall,
      releases: cal.releases,
    },
  };
  await kv.setJSON(SPEC(roundId), spec);
  specCache.set(roundId, spec);

  const state = newMarket({
    roundId,
    startCashC,
    defaultSize,
    lateJoin: body.lateJoin !== false,
    question: `Does it land NORTH or SOUTH of the equator?`,
  });
  state.releases = cal.releases.map((r) => ({
    cutDay: r.cutDay,
    leadDays: r.leadDays,
    count: r.count,
  }));
  state.released = 0;
  state.releaseLog = [];
  state.impactDay = scenario.tImpact;
  state.recordYears = SCENARIO.years;
  state.tradingMinutes = clamp(numOr(body.tradingMinutes, TIMERS.defaultTradingMinutes), TIMERS.minMinutes, TIMERS.maxMinutes);
  state.bots = BOTS.slots.map((s) => ({
    key: s.key,
    market: s.market,
    side: s.side,
    on: false,
    shares: 0,
    everySec: 30,
    nextAt: null,
    sent: 0,
    fills: 0,
  }));

  if (body.keepPlayers) {
    const prev = (await readMarket({ fresh: true })).state;
    if (prev) {
      for (const p of Object.values(prev.players)) {
        if (p.id === BOT_PID) continue;
        state.players[p.id] = newPlayer(p.id, p.name, p.device, startCashC, now);
        state.devices[p.device] = p.id;
      }
      for (const t of Object.values(prev.teams)) {
        if (t.hidden) continue;
        const members = t.members.filter((m) => state.players[m]);
        if (!members.length) continue;
        state.teams[t.id] = { ...t, members };
        state.codes[t.code] = t.id;
        for (const m of members) state.players[m].teamId = t.id;
      }
    }
  }

  await replaceMarket(state);
  return {
    round: publicRound(state, now),
    // The operator is told the answer and the quality of the round they built.
    truth: {
      winner,
      latDeg: check.latDeg,
      physics: spec.physics,
      calibration: spec.calibration,
    },
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/* ── the node adapter ─────────────────────────────────────────────────── */

const MAX_BODY = 1_000_000;

/**
 * Wraps `handle` for a plain node request. A result carrying `__raw` is sent
 * verbatim with its own content type — that is how the data download gets to
 * be a real CSV file the browser saves rather than a JSON blob.
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
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (e) {
    const status = e.status ?? (e instanceof EngineError ? 400 : 500);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (status >= 500) console.error("[api]", e);
    res.end(JSON.stringify({ error: e.message ?? "server error", code: e.code ?? null }));
  }
}
