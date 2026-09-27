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
  MARKETS, MARKET_META, BOOK, LIMITS, MONEY, SCENARIO, CONFIDENCE,
  PHASES, TIMERS, BOTS, RULES_TEXT, DATA_NOTE, MODEL_NOTE, aiPrompt,
} from "../shared/rules.js";
import { EVENTS, EVENT_KEYS, eventByKey, OTHER_IMPACTS } from "../shared/events.js";
import {
  corridorOf, covariance, chol2, walk, latAt, northProbability, confidenceOf,
  placeLine, R_EARTH_KM,
} from "../shared/corridor.js";

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
      // Not a simulation: where the rock actually landed, relative to the line.
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
    event: spec.truth?.name ?? null,
    lineDeg: spec.lineDeg,
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
      sigmaKm: Math.round(r.sigmaKm),
      at: state.releaseLog?.[i]?.at ?? null,
    })),
    nextSigmaKm: releases[state.released ?? 0] ? Math.round(releases[state.released].sigmaKm) : null,
    eventName: state.eventName ?? null,
    lineDeg: state.lineDeg ?? null,
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

/**
 * The solution the room is allowed to have: the latest released one, and not
 * one step further. Everything the students need to price the round, and
 * nothing that would tell them the answer.
 */
function publishedSolution(state, spec) {
  const upto = state.released ?? 0;
  if (upto <= 0) return null;
  const r = spec.releases[upto - 1];
  if (!r) return null;
  return {
    release: upto,
    of: spec.releases.length,
    eventName: spec.truth.name,
    nominalLat: r.nominalLat,
    nominalLon: r.nominalLon,
    azimuthDeg: spec.corridor.azimuthDeg,
    groundSpeedKms: spec.corridor.groundSpeedKms,
    covarianceKm2: r.covarianceKm2,
    sigmaAlongKm: Math.sqrt(r.covarianceKm2[0][0]),
    sigmaCrossKm: Math.sqrt(r.covarianceKm2[1][1]),
    lineDeg: spec.lineDeg,
    geometry: spec.corridor.geometry,
  };
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
        modelNote: MODEL_NOTE,
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
      if (!spec) throw httpError(409, "the solution is not ready yet", "no-data");
      if (!(state.released > 0)) throw httpError(409, "no solution has been released yet", "no-data");
      const sol = publishedSolution(state, spec);
      return {
        ...sol,
        note: DATA_NOTE,
        modelNote: MODEL_NOTE,
        // The block a team pastes into an AI. Built here so there is exactly
        // one copy of it and it can never drift from the numbers above.
        prompt: aiPrompt(sol),
      };
    }

    case "GET data.csv": {
      const r = await readMarket();
      if (!r.state) throw httpError(409, "no round yet", "no-round");
      const state = r.state;
      requirePlayer(state, query);
      const spec = await loadSpec(state.roundId);
      if (!spec) throw httpError(409, "the solution is not ready yet", "no-data");
      if (!(state.released > 0)) throw httpError(409, "no solution has been released yet", "no-data");
      const sol = publishedSolution(state, spec);
      tx((st) => {
        const p = st.players?.[query.playerId];
        if (p) p.downloads = (p.downloads ?? 0) + 1;
      }).catch(() => {});
      const C = sol.covarianceKm2;
      const lines = [
        "# impact solution " + sol.release + " of " + sol.of,
        "# distances in km; along = corridor direction, cross = 90 deg clockwise",
        "# the covariance is NOT diagonal - draw the two components together",
        "key,value",
        "nominal_lat_deg," + sol.nominalLat.toFixed(6),
        "nominal_lon_deg," + sol.nominalLon.toFixed(6),
        "corridor_azimuth_deg," + sol.azimuthDeg.toFixed(3),
        "ground_speed_km_s," + sol.groundSpeedKms.toFixed(3),
        "cov_along_along_km2," + C[0][0].toFixed(3),
        "cov_along_cross_km2," + C[0][1].toFixed(3),
        "cov_cross_along_km2," + C[1][0].toFixed(3),
        "cov_cross_cross_km2," + C[1][1].toFixed(3),
        "sigma_along_km," + sol.sigmaAlongKm.toFixed(3),
        "sigma_cross_km," + sol.sigmaCrossKm.toFixed(3),
        "line_latitude_deg," + sol.lineDeg.toFixed(3),
        "earth_radius_km,6371.0088",
      ];
      return {
        __raw: lines.join("\n") + "\n",
        __contentType: "text/csv; charset=utf-8",
        __filename: `impact-solution-${state.roundId}-${sol.release}.csv`,
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
        lineDeg: spec.lineDeg,
        truth: spec.truth,
        corridor: spec.corridor,
        // Every solution the room saw, so the reveal can show the ellipse
        // walking in toward the place it actually landed.
        releases: spec.releases.map((x) => ({
          index: x.index,
          sigmaKm: x.sigmaKm,
          nominalLat: x.nominalLat,
          nominalLon: x.nominalLon,
          pNorth: x.pNorth,
        })),
        shown: state.released ?? 0,
        others: spec.others,
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
              lineDeg: spec.lineDeg,
              event: spec.truth,
              corridor: spec.corridor,
              releases: spec.releases.map((x) => ({
                index: x.index,
                sigmaKm: x.sigmaKm,
                pNorth: x.pNorth,
                confidence: x.confidence,
              })),
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

/** Deterministic little PRNG, so a seed reproduces a round exactly. */
function rng(seedStr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalPair(rand) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

/**
 * Lay out a round on a real event.
 *
 * THE ONE CONSTRUCTION THAT MATTERS
 * ---------------------------------
 * The nominal point a team is shown is NOT where the thing actually landed. It
 * is the truth displaced by a draw from the very covariance they are handed —
 * which is what a published solution IS. Get that wrong and the round becomes
 * a formality: publish the true point as "nominal" and the favoured side is
 * always the winning side, so the correct play is to buy it at any price and
 * nobody has to think.
 *
 * The same standard normal pair is reused for every release and pushed through
 * each release's shrinking Cholesky factor, so successive solutions walk in
 * toward the truth the way real ones do, rather than jumping about.
 */
async function buildRound(body, now) {
  const seed = String(body.seed ?? "").trim() || rid(4);
  const roundId = rid(5);
  const rand = rng(`${seed}|${roundId}`);

  const key = EVENT_KEYS.includes(body.event) ? body.event : EVENT_KEYS[Math.floor(rand() * EVENT_KEYS.length)];
  const event = eventByKey(key);
  const corridor = corridorOf(event);

  const startConf = clamp(numOr(body.startConfidence, CONFIDENCE.defaultStart), ...CONFIDENCE.range);
  const startCashC = Math.round(clamp(numOr(body.startCash, MONEY.startCashC / 100), 100, 10_000_000) * 100);
  const defaultSize = Math.round(clamp(numOr(body.defaultSize, LIMITS.defaultOrderSize), 1, LIMITS.maxSharesPerOrder));
  const sigma0 = clamp(numOr(body.sigmaKm, SCENARIO.sigma0Km), 40, 4000);

  // One error draw for the whole round; each release sees it through a
  // tighter factor, so the published solution converges on the truth.
  const z = normalPair(rand);

  const releases = SCENARIO.shrink.map((f, i) => {
    const sigmaKm = sigma0 * f;
    const C = covariance(sigmaKm, SCENARIO.ratio, SCENARIO.tiltDeg);
    const L = chol2(C);
    const along = L[0][0] * z[0];
    const crossKm = L[1][0] * z[0] + L[1][1] * z[1];
    const nominal = walk(event.lat, event.lon, corridor.azimuthDeg, along, crossKm);
    return { index: i + 1, sigmaKm, covarianceKm2: C, nominalLat: nominal.lat, nominalLon: nominal.lon };
  });

  // Place the line against BOTH ends of the round.
  //
  // Scoring only the first release is not enough. The published solution walks
  // in toward the truth as it tightens, so if the rock happens to land almost
  // exactly on the line, the LAST and sharpest solution is the least certain
  // of all — a tighter ellipse straddling the line is a coin toss. That is
  // honest statistics and it makes a miserable round: the room works harder
  // and ends up knowing less.
  //
  // So the line has to be hard at the start AND settled by the end. Search the
  // lines a person could actually say, score the opening confidence against
  // the operator's target, and refuse any line the final solution cannot call.
  const first = releases[0];
  const last = releases[releases.length - 1];
  const explicit = numOr(body.lineDeg, null);
  let lineDeg;
  if (explicit != null) {
    lineDeg = explicit;
  } else {
    const openView = { lat: first.nominalLat, lon: first.nominalLon };
    const endView = { lat: last.nominalLat, lon: last.nominalLon };
    const C1 = first.covarianceKm2;
    const Cn = last.covarianceKm2;
    // Every published solution lies on the path from the first nominal to the
    // truth — they are the same error draw through a shrinking factor. So a
    // line BETWEEN them gets crossed mid-round: the market is confident, then
    // the solution walks onto the line and it collapses to a coin toss, then
    // it recovers on the other side. Measured on a live round that produced
    // 63 → 59 → 55 → 51 → 59 → 71%, which is a worse game after every release.
    //
    // Keeping the line off that segment makes the ladder monotone by
    // construction: all six solutions sit on one side, each tighter than the
    // last, so each is more certain than the last.
    const lo = Math.min(first.nominalLat, event.lat);
    const hi = Math.max(first.nominalLat, event.lat);
    const base = Math.round(first.nominalLat * 10);
    let best = null;
    for (let step = -90; step <= 90; step++) {
      const line = (base + step) / 10;
      if (line > lo - 0.05 && line < hi + 0.05) continue; // would be crossed
      const p1 = northProbability(openView, corridor, C1, line, 2500, rand);
      const open = Math.max(p1, 1 - p1);
      const pn = northProbability(endView, corridor, Cn, line, 2500, rand);
      const end = Math.max(pn, 1 - pn);
      const score = Math.abs(open - startConf) + (end < 0.85 ? 3 * (0.85 - end) : 0);
      if (!best || score < best.score) best = { line, score, open, end };
    }
    // If the truth sits so near the first solution that nothing is excluded,
    // fall back to scoring every line rather than shipping no round at all.
    if (!best) {
      for (let step = -90; step <= 90; step++) {
        const line = (base + step) / 10;
        const p1 = northProbability(openView, corridor, C1, line, 2500, rand);
        const open = Math.max(p1, 1 - p1);
        if (!best || Math.abs(open - startConf) < best.score) best = { line, score: Math.abs(open - startConf) };
      }
    }
    lineDeg = best.line;
  }

  // What a good team should be able to see at each release, priced the same
  // way the room is being asked to price it.
  for (const r of releases) {
    const view = { lat: r.nominalLat, lon: r.nominalLon };
    const p = northProbability(view, corridor, r.covarianceKm2, lineDeg, SCENARIO.draws, rand);
    r.pNorth = p;
    r.confidence = Math.max(p, 1 - p);
  }

  // The settlement is not a simulation. It is where the rock actually landed.
  const winner = event.lat > lineDeg ? "north" : "south";

  const spec = {
    roundId,
    seed,
    eventKey: key,
    lineDeg,
    winner,
    truth: {
      name: event.name,
      nick: event.nick ?? null,
      when: event.when,
      lat: event.lat,
      lon: event.lon,
      where: event.where,
      story: event.story,
      leadHours: event.leadHours,
      diameterM: event.diameterM,
      impactKt: event.impactKt,
      speedKms: event.speedKms,
      geometry: event.geometry,
    },
    corridor,
    releases,
    others: OTHER_IMPACTS,
  };
  await kv.setJSON(SPEC(roundId), spec);
  specCache.set(roundId, spec);

  const state = newMarket({
    roundId,
    startCashC,
    defaultSize,
    lateJoin: body.lateJoin !== false,
    question: `Does it land NORTH or SOUTH of ${fmtLine(lineDeg)}?`,
  });
  state.releases = releases.map((r) => ({ index: r.index, sigmaKm: r.sigmaKm }));
  state.released = 0;
  state.releaseLog = [];
  state.lineDeg = lineDeg;
  state.eventName = event.name;
  state.tradingMinutes = clamp(numOr(body.tradingMinutes, TIMERS.defaultTradingMinutes), TIMERS.minMinutes, TIMERS.maxMinutes);
  state.bots = BOTS.slots.map((sl) => ({
    key: sl.key, market: sl.market, side: sl.side,
    on: false, shares: 0, everySec: 30, nextAt: null, sent: 0, fills: 0,
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
    truth: {
      event: event.name,
      where: event.where,
      trueLat: event.lat,
      trueLon: event.lon,
      lineDeg,
      winner,
      geometry: event.geometry,
      releases: releases.map((r) => ({
        index: r.index,
        sigmaKm: r.sigmaKm,
        pNorth: r.pNorth,
        confidence: r.confidence,
        offsetKm: Math.round(
          haversineKm(r.nominalLat, r.nominalLon, event.lat, event.lon)
        ),
      })),
    },
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** "20.0°N" — a line of latitude the way a person says it. */
export function fmtLine(deg) {
  const a = Math.abs(deg).toFixed(1);
  return `${a}°${deg >= 0 ? "N" : "S"}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const D = Math.PI / 180;
  const dLat = (lat2 - lat1) * D;
  const dLon = (lon2 - lon1) * D;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
