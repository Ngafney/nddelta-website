/**
 * The whole Week 3 API in one router, mounted three ways:
 *   - api/week3/router.mjs   (Vercel serverless, production)
 *   - week3/dev-server.js    (plain node http, local dev)
 *   - week3/serve.js         (one process serving app + API, for event day)
 *
 * Two games, one set of players and teams:
 *
 *   COIN MARKET — the Week 2 order book, rebuilt around a hidden coin. A round
 *   goes lobby → sims → live → settled. In "sims" each player chooses how many
 *   flips of the coin to buy; when that clock runs out the flips happen, the
 *   money is taken, and trading opens on its own. The market document is still
 *   written only through compare-and-swap transactions (server/kv.js), so sixty
 *   people clicking at once cannot lose a trade or mint money.
 *
 *   BANDIT LAB — five coins, 100 flips. Teams compile English into code with
 *   the AI (server/llm.js), save it, and run it over 10,000 shared games.
 *
 * The secret — p, and the final flip — lives in its own key and never leaves
 * this file before the bell.
 */

import crypto from "node:crypto";
import * as kv from "./kv.js";
import { STORE_CONFIG } from "./store-config.mjs";
import { compile, llmAvailable } from "./llm.js";
import { makeCoin, flipMany } from "../shared/coin.js";
import { prepareCode, runMany, simulate, COIN_NAMES } from "../shared/bandit.js";
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
  simCostC,
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
import {
  MODES,
  PRIORS,
  PRIOR_ORDER,
  SETTLEMENTS,
  SETTLEMENT_ORDER,
  LIMITS,
  MONEY,
  SIMS,
  BANDIT,
  MARKET_RULES,
  BANDIT_RULES,
} from "../shared/rules.js";

/* ── secrets ──────────────────────────────────────────────────────────── */

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * The signing key for player and admin tokens, and for compiled strategy code.
 * Same fallback ladder as week 2: SESSION_SECRET, else a key derived from
 * another strong value already in the environment, else the committed store
 * config. Set SESSION_SECRET.
 */
const DEFAULT_SECRET = "week3-dev-secret";
const IS_PROD = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

function resolveSecret() {
  if (process.env.SESSION_SECRET) return { secret: process.env.SESSION_SECRET, from: "SESSION_SECRET" };
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (apiKey) return { secret: sha(`week3|session|${apiKey}`), from: "an API key in the environment" };
  const store = process.env.UPSTASH_REDIS_REST_TOKEN || STORE_CONFIG.UPSTASH_REDIS_REST_TOKEN;
  if (store) return { secret: sha(`week3|session|${store}`), from: "the committed store config" };
  return { secret: DEFAULT_SECRET, from: "nothing" };
}

const { secret: SECRET, from: SECRET_FROM } = resolveSecret();

if (SECRET === DEFAULT_SECRET) {
  const msg =
    'No SESSION_SECRET and nothing to derive one from — player and admin tokens are forgeable. Set one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
  if (IS_PROD) throw new Error(`REFUSING TO START: ${msg}`);
  console.warn(`[week3] ⚠ ${msg} (allowed in dev only)`);
} else if (SECRET_FROM !== "SESSION_SECRET") {
  console.warn(`[week3] SESSION_SECRET is unset — signing tokens with a key derived from ${SECRET_FROM}.`);
}
const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const playerToken = (pid) => sha(`${SECRET}|player|${pid}`);
const adminTokenFor = (hash) => sha(`${SECRET}|admin|${hash}`);
/** Only code this server compiled carries a valid signature. */
const codeSig = (code) => sha(`${SECRET}|code|${code}`);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

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

const MKT = "w3:mkt";
const MKTV = "w3:mkt:v";
const SPEC = (roundId) => `w3:coin:${roundId}`;
const HISTORY = "w3:history";
const CFG = "w3:config";
const STRATS = (teamId) => `w3:strats:${teamId}`;
const BOARD = "w3:bandit:board";
const BOARDV = "w3:bandit:board:v";
/** Every team faces the same worlds. Bump to reroll them (and clear the board). */
const BANDIT_SEED = process.env.BANDIT_SEED || "delta-week3-bandit-v1";

/* ── the market transaction (unchanged from week 2) ───────────────────── */

/**
 * Every market write funnels through here, serialized within this process
 * first so thirty clicks on one tick do not race each other, then arbitrated
 * between processes by the CAS. `fn` must not await and must be a pure function
 * of the state it is handed — a losing CAS replays it on the fresh document.
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

/* ── the coin (the secret) ────────────────────────────────────────────── */

const specCache = new Map(); // roundId → coin (immutable once written)

async function loadSpec(roundId) {
  if (!roundId) return null;
  if (specCache.has(roundId)) return specCache.get(roundId);
  const spec = await kv.getJSON(SPEC(roundId));
  if (spec) {
    specCache.set(roundId, spec);
    if (specCache.size > 20) specCache.delete(specCache.keys().next().value);
  }
  return spec;
}

/* ── small shared documents ───────────────────────────────────────────── */

const DEFAULT_CFG = { banditOpen: true, board: "market" };

async function getCfg() {
  return { ...DEFAULT_CFG, ...((await kv.getJSON(CFG)) ?? {}) };
}

/**
 * Read-modify-write a small JSON document through the same CAS the market
 * uses, so two teams finishing a run in the same instant cannot overwrite each
 * other's leaderboard entry.
 */
async function casUpdate(key, verKey, fn) {
  for (let i = 0; i < 20; i++) {
    const cur = await kv.casGet(key, verKey);
    const doc = cur.value ? JSON.parse(cur.value) : {};
    const result = fn(doc);
    const next = String((Number(cur.version) || 0) + 1);
    const res = await kv.casSet(key, verKey, cur.version, JSON.stringify(doc), next);
    if (res.ok) return result;
    await sleep(5 + Math.floor(Math.random() * 20));
  }
  throw httpError(503, "the leaderboard is busy — try that again", "busy");
}

/* ── admin ────────────────────────────────────────────────────────────── */

async function adminHash() {
  let h = await kv.get("w3:admin:hash");
  if (!h) {
    h = sha(process.env.ADMIN_PASSWORD || "123");
    await kv.set("w3:admin:hash", h);
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

/* ── the clock ────────────────────────────────────────────────────────── */

/**
 * Deal every player the flips they ordered and take the money. Pure, so it can
 * run inside a transaction. A player can never buy more than they can pay for:
 * an order bigger than the stack is trimmed to what the stack covers.
 */
function runSims(state, spec, now) {
  const cost = simCostC(state);
  for (const p of Object.values(state.players)) {
    if (p.sims) continue; // already dealt (a late buyer, or a replayed transaction)
    const affordable = cost > 0 ? Math.floor(spendableC(state, p) / cost) : SIMS.max;
    const n = Math.max(0, Math.min(SIMS.max, p.simOrder ?? 0, affordable));
    dealSims(state, p, spec, n, now);
  }
}

function dealSims(state, p, spec, n, now) {
  const costC = n * simCostC(state);
  const flips = flipMany(spec.p, n, `${state.roundId}|sims|${p.id}`);
  p.cash -= costC;
  p.spentC += costC;
  p.sims = { n, heads: [...flips].filter((f) => f === "H").length, flips, at: now };
}

/**
 * Move the round along its clock: sims → live when the simulation window
 * closes, live → settled when trading does. Idempotent and safe to call from
 * any read — the first caller to win the CAS does it, everyone else sees it
 * done. Trading's clock starts when the sim window was DUE to end, not when
 * somebody happened to poll, so the timeline never depends on traffic.
 */
async function advanceIfDue(state, version, now) {
  let s = state;
  let v = version;
  let changed = false;
  if (s.status === "sims" && s.simsEndsAt != null && now >= s.simsEndsAt) {
    const spec = await loadSpec(s.roundId);
    if (!spec) return { state: s, version: v };
    await tx((st, out) => {
      if (st.status !== "sims") {
        out.readOnly = true;
        return false;
      }
      runSims(st, spec, now);
      st.status = "live";
      st.tradingStartedAt = st.simsEndsAt;
      st.endsAt = st.simsEndsAt + Math.round((st.minutes ?? 10) * 60_000);
      return true;
    });
    const after = await readMarket({ fresh: true });
    s = after.state;
    v = after.version;
    changed = true;
  }
  if (s.status === "live" && s.endsAt != null && now >= s.endsAt) {
    const spec = await loadSpec(s.roundId);
    if (!spec) return { state: s, version: v };
    const done = await tx((st, out) => {
      if (st.status !== "live") {
        out.readOnly = true;
        return false;
      }
      settle(st, spec.settleValue, now);
      return true;
    });
    const after = await readMarket({ fresh: true });
    s = after.state;
    v = after.version;
    if (done) await recordHistory(s, spec, now);
    changed = true;
  }
  return { state: s, version: v, changed };
}

/** One line in the round history the big screen shows between rounds. */
async function recordHistory(state, spec, now) {
  await kv.pushCapped(
    HISTORY,
    {
      roundId: state.roundId,
      p: spec.p,
      settlement: spec.settlement,
      prior: spec.prior,
      settles: state.xStar,
      at: now,
      podium: leaderboard(state, 5).map((r) => ({ name: r.name, valueC: r.valueC })),
    },
    12
  );
}

/* ── player views ─────────────────────────────────────────────────────── */

function requirePlayer(state, body) {
  const pid = body.playerId ?? body.pid;
  if (!pid || body.token !== playerToken(pid)) throw httpError(401, "bad player credentials", "auth");
  const p = state.players?.[pid];
  if (!p) throw httpError(401, "you are not in this round — join again", "auth");
  return p;
}

/** What every client may know about the round. p is here only after the bell. */
function publicRound(state, now, spec = null) {
  const g = grid(state);
  const phaseEnd = state.status === "sims" ? state.simsEndsAt : state.endsAt;
  const settled = state.status === "settled";
  return {
    roundId: state.roundId,
    mode: "coin",
    modeName: MODES.coin.name,
    status: state.status,
    startedAt: state.startedAt,
    simsEndsAt: state.simsEndsAt ?? null,
    endsAt: phaseEnd ?? null,
    msLeft: phaseEnd == null ? null : Math.max(0, phaseEnd - now),
    minutes: state.minutes,
    simSeconds: state.simSeconds,
    prior: state.prior,
    priorName: PRIORS[state.prior]?.name ?? state.prior,
    priorBlurb: PRIORS[state.prior]?.blurb ?? null,
    settlement: state.settlement,
    settlementName: SETTLEMENTS[state.settlement]?.name ?? state.settlement,
    settlementBlurb: SETTLEMENTS[state.settlement]?.blurb ?? null,
    startCashC: state.startCashC,
    simCostC: simCostC(state),
    maxSims: SIMS.max,
    defaultSize: state.defaultSize ?? LIMITS.defaultOrderSize,
    lateJoin: state.lateJoin,
    players: Object.keys(state.players ?? {}).length,
    teams: Object.keys(state.teams ?? {}).length,
    teamSize: LIMITS.teamSize,
    serverNow: now,
    tick: g.tick,
    center: g.center,
    orderMin: g.orderMin,
    orderMax: g.orderMax,
    settleC: state.settleC,
    xStar: settled ? state.xStar : null,
    p: settled && spec ? spec.p : null,
    finalHeads: settled && spec && spec.settlement === "flip" ? spec.finalHeads : null,
  };
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
    simOrder: p.simOrder ?? 0,
    sims: p.sims ?? null,
    // A player who joined after the window closed has never had a chance to
    // buy, so they get one purchase of their own.
    canBuyLate: state.status === "live" && !p.sims,
    orders: state.orders
      .filter((o) => o.pid === p.id)
      .map((o) => {
        const r = lotReserveC(g, o.side, o.px);
        return { id: o.id, side: o.side, px: o.px, qty: o.qty, ts: o.ts, holdC: (r.a + r.b) * o.qty };
      })
      .sort((a, b) => a.px - b.px),
  };
}

/** Everyone's flips and results, for the post-bell "was it worth it" chart. */
function simsScatter(state) {
  return Object.values(state.players).map((p) => ({
    name: p.name,
    n: p.sims?.n ?? 0,
    heads: p.sims?.heads ?? 0,
    valueC: valueC(state, p),
    startC: p.startC,
  }));
}

/* ── bandit helpers ───────────────────────────────────────────────────── */

async function requireTeamPlayer(body) {
  const { state } = await readMarket();
  if (!state) throw httpError(409, "no round is set up yet — ask the admin to start one", "no-round");
  const p = requirePlayer(state, body);
  if (!p.teamId) throw httpError(409, "join or create a team first", "no-team");
  return { state, p, teamId: p.teamId, teamName: state.teams[p.teamId]?.name ?? "?" };
}

async function requireBanditOpen() {
  if (!(await getCfg()).banditOpen) throw httpError(409, "the bandit lab is closed right now", "closed");
}

async function banditBoard() {
  const cur = await kv.casGet(BOARD, BOARDV);
  const doc = cur.value ? JSON.parse(cur.value) : {};
  return Object.entries(doc)
    .map(([teamId, e]) => ({ teamId, ...e }))
    .sort((a, b) => b.avg - a.avg || a.at - b.at)
    .map((e, i) => ({ rank: i + 1, ...e }));
}

/* ── the router ───────────────────────────────────────────────────────── */

export async function handle(method, route, body, query) {
  const now = Date.now();

  switch (`${method} ${route}`) {
    /* ── meta ── */
    case "GET health": {
      const { state } = await readMarket();
      return {
        ok: true,
        kv: kv.KV_MODE,
        persistent: kv.KV_PERSISTENT,
        secret: SECRET_FROM,
        llm: llmAvailable(),
        round: state ? state.roundId : null,
        status: state ? state.status : "none",
        audit: state ? auditState(state) : ["no market"],
      };
    }

    case "GET rules":
      return {
        marketRules: MARKET_RULES,
        banditRules: BANDIT_RULES,
        limits: LIMITS,
        sims: SIMS,
        bandit: { coins: BANDIT.coins, flips: BANDIT.flips, payout: BANDIT.payout, simulations: BANDIT.simulations, names: COIN_NAMES },
        // Public on purpose: which distribution p came from is the prior a
        // Bayesian starts from, and the lecture is about using it.
        priors: Object.fromEntries(
          PRIOR_ORDER.map((k) => [k, { key: k, name: PRIORS[k].name, blurb: PRIORS[k].blurb, a: PRIORS[k].a, b: PRIORS[k].b }])
        ),
        priorOrder: PRIOR_ORDER,
        settlements: SETTLEMENTS,
        settlementOrder: SETTLEMENT_ORDER,
      };

    case "GET config": {
      const r = await readMarket();
      const cfg = await getCfg();
      const extra = { persistent: kv.KV_PERSISTENT, banditOpen: cfg.banditOpen, llm: llmAvailable() };
      if (!r.state) return { round: null, ...extra };
      const after = await advanceIfDue(r.state, r.version, now);
      return { round: publicRound(after.state, now, await specIfSettled(after.state)), ...extra };
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
      const r0 = await readMarket();
      if (!r0.state) throw httpError(409, "no round is set up yet — ask the admin to start one", "no-round");
      const { state } = await advanceIfDue(r0.state, r0.version, now);
      const p = requirePlayer(state, query);
      const since = Number(query.since ?? 0) || 0;
      const spec = await specIfSettled(state);
      return {
        round: publicRound(state, now, spec),
        me: meView(state, p),
        team: teamView(state, p),
        market: marketView(state, p.id),
        leaderboard: leaderboard(state, 60).map((row) => ({ ...row, me: row.id === p.id })),
        fills: p.fills.filter((f) => f.s > since),
        scatter: state.status === "settled" ? simsScatter(state) : null,
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
        return { team: teamView(state, p), created: true, code: team.code };
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

    /* ── simulations ── */

    /**
     * Set how many flips you want. During the window this is only an ORDER —
     * nothing is charged and nothing is flipped until the clock runs out, so a
     * player can change their mind freely and nobody can peek at a few flips
     * and then decide to buy more.
     */
    case "POST sims/order": {
      rateLimit(`sims:${body.playerId}`, 40, 10_000);
      const n = Math.round(Number(body.n));
      if (!Number.isInteger(n) || n < 0 || n > SIMS.max) throw httpError(400, `choose between 0 and ${SIMS.max} flips`);
      return tx((state) => {
        const p = requirePlayer(state, body);
        if (state.status !== "sims" && state.status !== "lobby") {
          throw httpError(409, "the simulation window is closed", "closed");
        }
        const maxN = Math.floor(p.cash / simCostC(state));
        if (n > maxN) throw httpError(400, `you can afford at most ${maxN} flips`);
        p.simOrder = n;
        return { simOrder: n, me: meView(state, p) };
      });
    }

    /** One purchase, for someone who joined after the window closed. */
    case "POST sims/late": {
      rateLimit(`sims:${body.playerId}`, 10, 10_000);
      const n = Math.round(Number(body.n));
      if (!Number.isInteger(n) || n < 0 || n > SIMS.max) throw httpError(400, `choose between 0 and ${SIMS.max} flips`);
      const { state: pre } = await readMarket();
      const spec = pre ? await loadSpec(pre.roundId) : null;
      if (!spec) throw httpError(409, "no round is running", "no-round");
      return tx((state) => {
        const p = requirePlayer(state, body);
        if (state.status !== "live") throw httpError(409, "the market is not trading", "closed");
        if (p.sims) throw httpError(409, "you have already had your flips this round", "done");
        if (n * simCostC(state) > spendableC(state, p)) throw httpError(400, "you cannot afford that many flips");
        dealSims(state, p, spec, n, now);
        return { sims: p.sims, me: meView(state, p) };
      });
    }

    /* ── trading ── */
    case "POST order": {
      rateLimit(`order:${body.playerId}`, 45, 10_000, "easy — that is a lot of orders in ten seconds");
      return tx((state) => {
        const p = requirePlayer(state, body);
        const side = body.side === "B" || body.side === "A" ? body.side : null;
        const px = Number(body.px);
        const qty = Number(body.qty ?? 1);
        if (!side) throw httpError(400, "bad side");
        if (state.status === "sims") throw httpError(409, "trading opens when the simulation clock runs out", "closed");
        // A late joiner decides on their flips (zero is fine) before they quote,
        // exactly like everyone else did.
        if (state.status === "live" && !p.sims) throw httpError(409, "choose your flips first — zero is allowed", "no-sims");
        const res = placeOrder(state, p.id, side, px, qty, now);
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
      const r = await readMarket();
      if (!r.state) throw httpError(409, "no round yet", "no-round");
      const { state } = await advanceIfDue(r.state, r.version, now);
      if (state.status !== "settled") throw httpError(403, "the coin is not revealed yet", "locked");
      const spec = await loadSpec(state.roundId);
      if (!spec) throw httpError(404, "that round's coin is gone");
      return {
        roundId: state.roundId,
        mode: "coin",
        p: spec.p,
        prior: spec.prior,
        priorName: PRIORS[spec.prior]?.name ?? spec.prior,
        settlement: spec.settlement,
        finalHeads: spec.settlement === "flip" ? spec.finalHeads : null,
        value: state.xStar,
        settleC: state.settleC,
        scatter: simsScatter(state),
        status: state.status,
      };
    }

    case "GET leaderboard": {
      const r = await readMarket();
      if (!r.state) return { leaderboard: [], round: null };
      const { state } = await advanceIfDue(r.state, r.version, now);
      return { leaderboard: leaderboard(state, 200), round: publicRound(state, now, await specIfSettled(state)) };
    }

    case "GET board": {
      const r = await readMarket();
      const cfg = await getCfg();
      const bandit = await banditBoard();
      if (!r.state) return { round: null, persistent: kv.KV_PERSISTENT, cfg, bandit };
      const { state } = await advanceIfDue(r.state, r.version, now);
      const settled = state.status === "settled";
      return {
        round: publicRound(state, now, await specIfSettled(state)),
        leaderboard: leaderboard(state, 30),
        market: marketView(state, null),
        history: await kv.listAll(HISTORY),
        // How many flips the room has ordered so far — a number, never whose.
        simsOrdered: Object.values(state.players).reduce((s, p) => s + (p.sims?.n ?? p.simOrder ?? 0), 0),
        scatter: settled ? simsScatter(state) : null,
        cfg,
        bandit,
      };
    }

    case "GET history":
      return { history: await kv.listAll(HISTORY) };

    /* ── bandit lab ── */
    case "POST bandit/compile": {
      await requireBanditOpen();
      const { teamId } = await requireTeamPlayer(body);
      const prompt = String(body.prompt ?? "").trim();
      if (prompt.length < 3) throw httpError(400, "describe your strategy first");
      rateLimit(`compile:${teamId}`, 12, 60_000, "that's a lot of compiling — give it a minute");
      const result = await compile(prompt);
      if (result.refused) return { refused: true, reason: result.reason };
      return { ...result, sig: codeSig(result.code) };
    }

    case "POST bandit/save": {
      const { teamId, p } = await requireTeamPlayer(body);
      const code = String(body.code ?? "");
      if (!code || body.sig !== codeSig(code)) throw httpError(400, "that code wasn't compiled here — compile it again");
      const name = String(body.name ?? "").trim().slice(0, 32) || "untitled";
      const list = (await kv.getJSON(STRATS(teamId))) ?? [];
      if (list.length >= BANDIT.maxStrategies) throw httpError(400, `your team has saved ${BANDIT.maxStrategies} — delete some first`);
      let finalName = name;
      for (let n = 2; list.some((s) => s.name === finalName); n++) finalName = `${name} ${n}`;
      const strat = {
        id: rid(5),
        name: finalName,
        prompt: String(body.prompt ?? "").slice(0, 2000),
        explain: body.explain ? String(body.explain).slice(0, 400) : null,
        summary: body.summary ? String(body.summary).slice(0, 60) : null,
        code,
        by: p.name,
        createdAt: now,
        best: null,
      };
      list.push(strat);
      await kv.setJSON(STRATS(teamId), list);
      return { strategy: strat };
    }

    case "GET bandit/strategies": {
      const { teamId } = await requireTeamPlayer(query);
      const list = (await kv.getJSON(STRATS(teamId))) ?? [];
      return { strategies: [...list].reverse() };
    }

    case "POST bandit/delete": {
      const { teamId } = await requireTeamPlayer(body);
      const list = (await kv.getJSON(STRATS(teamId))) ?? [];
      if (!list.some((s) => s.id === body.strategyId)) throw httpError(404, "no such strategy");
      await kv.setJSON(
        STRATS(teamId),
        list.filter((s) => s.id !== body.strategyId)
      );
      return { ok: true };
    }

    /**
     * Run a strategy over the 10,000 shared games. Either a saved strategy by
     * id, or freshly compiled code with its signature. The team's best average
     * goes on the board; a worse run never lowers it.
     */
    case "POST bandit/run": {
      await requireBanditOpen();
      const { teamId, teamName, p } = await requireTeamPlayer(body);
      rateLimit(`run:${teamId}`, 12, 60_000, "that's a lot of runs — give it a minute");
      let code;
      let stratName;
      let saved = null;
      if (body.strategyId) {
        const list = (await kv.getJSON(STRATS(teamId))) ?? [];
        saved = list.find((s) => s.id === body.strategyId);
        if (!saved) throw httpError(404, "no such strategy");
        code = saved.code;
        stratName = saved.name;
      } else {
        code = String(body.code ?? "");
        if (!code || body.sig !== codeSig(code)) throw httpError(400, "that code wasn't compiled here — compile it again");
        stratName = String(body.name ?? "").trim().slice(0, 32) || "unsaved";
      }
      const prep = prepareCode(code);
      if (!prep.ok) throw httpError(400, `invalid strategy: ${prep.error}`);
      const stats = runMany(prep.run, BANDIT_SEED, BANDIT.simulations);
      // One game, played out in full, so the team can watch what their code did.
      const sample = simulate(prep.run, `${BANDIT_SEED}|w${Math.floor(Math.random() * BANDIT.simulations)}`, { withHistory: true });

      const improved = await casUpdate(BOARD, BOARDV, (doc) => {
        const prev = doc[teamId];
        if (prev && prev.avg >= stats.avg) {
          prev.teamName = teamName;
          prev.runs = (prev.runs ?? 1) + 1;
          return false;
        }
        doc[teamId] = { teamName, avg: stats.avg, oraclePct: stats.oraclePct, sd: stats.sd, stratName, by: p.name, at: now, runs: (prev?.runs ?? 0) + 1 };
        return true;
      });
      if (saved && (saved.best == null || stats.avg > saved.best)) {
        const list = (await kv.getJSON(STRATS(teamId))) ?? [];
        const s = list.find((x) => x.id === saved.id);
        if (s) {
          s.best = stats.avg;
          await kv.setJSON(STRATS(teamId), list);
        }
      }
      return { stats, newBest: improved, sample: { ps: sample.ps, log: sample.log, total: sample.total }, stratName };
    }

    case "GET bandit/board":
      return { board: await banditBoard(), cfg: await getCfg() };

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
      await kv.set("w3:admin:hash", h);
      return { token: adminTokenFor(h) };
    }

    case "POST admin/config": {
      await requireAdmin(body);
      const cfg = await getCfg();
      if (typeof body.banditOpen === "boolean") cfg.banditOpen = body.banditOpen;
      if (body.board === "market" || body.board === "bandit") cfg.board = body.board;
      await kv.setJSON(CFG, cfg);
      return { cfg };
    }

    case "POST admin/bandit/clear": {
      await requireAdmin(body);
      if (body.confirm !== "CLEAR") throw httpError(400, 'send confirm:"CLEAR" to wipe the bandit leaderboard');
      await kv.del(BOARD, BOARDV);
      return { ok: true };
    }

    case "POST admin/round": {
      await requireAdmin(body);
      const prior = PRIORS[body.prior] ? body.prior : "uniform";
      const settlement = SETTLEMENTS[body.settlement] ? body.settlement : "prob";
      const minutes = Math.min(180, Math.max(0.5, numOr(body.minutes, 10)));
      const simSeconds = Math.round(Math.min(900, Math.max(10, numOr(body.simSeconds, SIMS.seconds))));
      const startCashC = Math.round(Math.min(10_000_000, Math.max(100, numOr(body.startCash, MONEY.startCashC / 100))) * 100);
      const simCostCents = Math.round(Math.min(100_000, Math.max(0, numOr(body.simCost, MONEY.simCostC / 100))) * 100);
      const defaultSize = Math.round(Math.min(LIMITS.maxSharesPerOrder, Math.max(1, numOr(body.defaultSize, LIMITS.defaultOrderSize))));
      const keepPlayers = !!body.keepPlayers;
      const lateJoin = body.lateJoin !== false;
      const roundId = rid(5);
      const seed = String(body.seed || "").trim() || `${roundId}-${crypto.randomBytes(4).toString("hex")}`;

      const spec = makeCoin(seed, PRIORS[prior], settlement);
      // A pinned p, for a worked example where the admin already knows the answer.
      const forceP = body.forceP == null || body.forceP === "" ? null : Number(body.forceP);
      if (forceP != null) {
        if (!Number.isFinite(forceP) || forceP < 0 || forceP > 100) throw httpError(400, "pin p as a number from 0 to 100");
        spec.p = forceP / 100;
        spec.finalHeads = crypto.randomInt(0, 1_000_000) / 1_000_000 < spec.p;
        spec.settleValue = settlement === "flip" ? (spec.finalHeads ? 100 : 0) : Math.round(forceP * 100) / 100;
        spec.pinned = true;
      }
      await kv.setJSON(SPEC(roundId), spec);
      specCache.set(roundId, spec);

      const prev = (await readMarket({ fresh: true })).state;
      const market = newMarket({ roundId, mode: "coin", startCashC, simCostC: simCostCents, defaultSize, lateJoin });
      market.prior = prior;
      market.settlement = settlement;
      market.minutes = minutes;
      market.simSeconds = simSeconds;
      market.simsEndsAt = null;
      if (keepPlayers && prev) {
        for (const p of Object.values(prev.players)) {
          const np = newPlayer(p.id, p.name, p.device, startCashC, now);
          np.fp = p.fp;
          np.ip = p.ip;
          np.teamId = p.teamId ?? null;
          market.players[p.id] = np;
          market.devices[p.device] = p.id;
        }
        // Teams survive so a table does not have to re-pair — and so the bandit
        // lab's saved strategies, which are filed by team, stay theirs.
        for (const t of Object.values(prev.teams ?? {})) {
          const members = t.members.filter((pid) => market.players[pid]);
          if (!members.length) continue;
          market.teams[t.id] = { ...t, members };
          market.codes[t.code] = t.id;
        }
        for (const p of Object.values(market.players)) {
          if (p.teamId && !market.teams[p.teamId]) p.teamId = null;
        }
      }
      await replaceMarket(market);
      return { round: publicRound((await readMarket({ fresh: true })).state, now), seed };
    }

    /** Open the simulation window. Trading follows automatically when it closes. */
    case "POST admin/start": {
      await requireAdmin(body);
      const secs = body.simSeconds == null || body.simSeconds === "" ? null : Math.min(900, Math.max(10, Number(body.simSeconds)));
      const minutes = body.minutes == null || body.minutes === "" ? null : Math.min(180, Math.max(0.5, Number(body.minutes)));
      return tx((state) => {
        if (state.status !== "lobby") throw httpError(409, "the round has already started");
        if (secs != null) state.simSeconds = secs;
        if (minutes != null) state.minutes = minutes;
        state.status = "sims";
        state.startedAt = now;
        state.simsEndsAt = now + Math.round((state.simSeconds ?? SIMS.seconds) * 1000);
        return { round: publicRound(state, now) };
      });
    }

    /** Close the simulation window now and open trading. */
    case "POST admin/skip-sims": {
      await requireAdmin(body);
      await tx((state) => {
        if (state.status !== "sims") throw httpError(409, "the simulation window is not open");
        state.simsEndsAt = now;
        return true;
      });
      const r = await readMarket({ fresh: true });
      const after = await advanceIfDue(r.state, r.version, now + 1);
      return { round: publicRound(after.state, now) };
    }

    case "POST admin/extend": {
      await requireAdmin(body);
      const seconds = Math.round(Number(body.seconds) || 0);
      return tx((state) => {
        if (state.status === "sims") {
          state.simsEndsAt = Math.max(now + 1000, state.simsEndsAt + seconds * 1000);
        } else if (state.status === "live") {
          state.endsAt = Math.max(now + 1000, (state.endsAt ?? now) + seconds * 1000);
        } else {
          throw httpError(409, "there is no clock running");
        }
        return { round: publicRound(state, now) };
      });
    }

    /** Stop trading now; the coin settles itself. */
    case "POST admin/end": {
      await requireAdmin(body);
      const r = await readMarket({ fresh: true });
      if (!r.state) throw httpError(409, "no round");
      if (r.state.status === "settled") return { round: publicRound(r.state, now), already: true };
      await tx((state) => {
        if (state.status !== "live") throw httpError(409, "trading has not started");
        state.endsAt = now;
        return true;
      });
      const after = await readMarket({ fresh: true });
      const done = await advanceIfDue(after.state, after.version, now + 1);
      return { round: publicRound(done.state, now, await specIfSettled(done.state)) };
    }

    /**
     * Wipe everything: the market, every player, team and device binding, the
     * round history, every saved strategy and the bandit board. The admin
     * password survives — locking yourself out is not a reset, it is an outage.
     */
    case "POST admin/reset": {
      await requireAdmin(body);
      if (body.confirm !== "RESET") throw httpError(400, 'send confirm:"RESET" to wipe the game');
      const prev = (await readMarket({ fresh: true })).state;
      if (prev?.roundId) await kv.del(SPEC(prev.roundId));
      for (const teamId of Object.keys(prev?.teams ?? {})) await kv.del(STRATS(teamId));
      await kv.del(MKT, MKTV, HISTORY, BOARD, BOARDV);
      cached = { value: null, version: "", at: 0 };
      specCache.clear();
      return { ok: true, cleared: { round: prev?.roundId ?? null, players: Object.keys(prev?.players ?? {}).length } };
    }

    case "POST admin/kick": {
      await requireAdmin(body);
      return tx((state) => {
        const p = state.players[body.playerId];
        if (!p) throw httpError(404, "no such player");
        cancelAll(state, p.id);
        if (p.pos !== 0) throw httpError(409, `${p.name} is holding ${p.pos} shares — they cannot be removed mid-position`);
        if (p.teamId) leaveTeam(state, p.id);
        // Their spend on flips leaves with them, so the room's cash still reconciles.
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
      const cfg = await getCfg();
      const bandit = await banditBoard();
      const r = await readMarket({ fresh: true });
      const base = { persistent: kv.KV_PERSISTENT, kv: kv.KV_MODE, llm: llmAvailable(), cfg, bandit };
      if (!r.state) return { round: null, ...base };
      const { state } = await advanceIfDue(r.state, r.version, now);
      const spec = await loadSpec(state.roundId);

      const byFp = new Map();
      for (const p of Object.values(state.players)) {
        if (!p.fp) continue;
        const key = `${p.fp}|${p.ip}`;
        byFp.set(key, [...(byFp.get(key) ?? []), { id: p.id, name: p.name, device: p.device }]);
      }
      const suspicious = [...byFp.values()].filter((g) => g.length > 1);

      return {
        ...base,
        round: publicRound(state, now, spec),
        audit: auditState(state),
        secret: spec ? { p: spec.p, settleValue: spec.settleValue, finalHeads: spec.finalHeads, settlement: spec.settlement, pinned: !!spec.pinned } : null,
        suspicious,
        players: Object.values(state.players)
          .map((p) => ({
            id: p.id,
            name: p.name,
            device: p.device,
            team: p.teamId ? state.teams[p.teamId]?.name ?? null : null,
            cashC: p.cash,
            pos: state.status === "settled" ? p.settledPos ?? 0 : p.pos,
            valueC: valueC(state, p),
            simOrder: p.simOrder ?? 0,
            sims: p.sims ? p.sims.n : null,
            heads: p.sims ? p.sims.heads : null,
            spentC: p.spentC,
            orders: state.orders.filter((o) => o.pid === p.id).length,
          }))
          .sort((a, b) => b.valueC - a.valueC),
        teams: Object.values(state.teams ?? {}).map((t) => ({
          id: t.id,
          name: t.name,
          code: t.code,
          members: t.members.map((pid) => state.players[pid]?.name).filter(Boolean),
        })),
        openOrders: state.orders.length,
        volume: state.volume,
      };
    }

    default:
      throw httpError(404, `no route: ${method} ${route}`);
  }
}

/** The coin, but only once it may be shown. */
async function specIfSettled(state) {
  return state?.status === "settled" ? loadSpec(state.roundId) : null;
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
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
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
