/**
 * The whole Week 2 API in one router, mounted two ways:
 *   - api/week2/router.mjs   (Vercel serverless, production)
 *   - week2/dev-server.js    (plain node http, local dev)
 *   - week2/serve.js         (one process serving app + API, for event day)
 *
 * One game: Gradient Trading. One market document, written only through
 * compare-and-swap transactions (see server/kv.js), so sixty people clicking
 * at the same instant cannot lose a trade or mint money.
 *
 * The secret — the curve spec, and with it x* — never leaves this file except
 * through the two doors that are allowed to open it: a player who bought the
 * 1-in-20 lottery ticket, and everybody once the round is over.
 */

import crypto from "node:crypto";
import * as kv from "./kv.js";
import { STORE_CONFIG } from "./store-config.mjs";
import { makeCurve, sampleCurve, pointAt, d2At, diagnose } from "../shared/curve.js";
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
  descentCostC,
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
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  MODES,
  MODE_ORDER,
  curveConfigFor,
  LIMITS,
  MONEY,
  RULES_TEXT,
  PREDICTION_RULES,
  GAME,
  GRADIENT_TIP,
} from "../shared/rules.js";

/* ── secrets ──────────────────────────────────────────────────────────── */

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * The signing key for player and admin tokens.
 *
 * SESSION_SECRET is the right answer and the only one that is properly secret.
 * Failing that we derive a key from another strong value already in the
 * environment, exactly as week1 does: a derived key is stable across deploys —
 * so sessions and the admin token survive a redeploy mid-round — and is
 * unguessable to anyone who cannot read the environment.
 *
 * The committed store config is the last resort. A key derived from it is only
 * as private as this repository, which is a real weakness; it is here because
 * refusing every request in the middle of a round is a worse one. It is a
 * fallback, not a plan: set SESSION_SECRET.
 */
const DEFAULT_SECRET = "week2-dev-secret";
const IS_PROD = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

function resolveSecret() {
  if (process.env.SESSION_SECRET) return { secret: process.env.SESSION_SECRET, from: "SESSION_SECRET" };
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (apiKey) return { secret: sha(`week2|session|${apiKey}`), from: "an API key in the environment" };
  const store = process.env.UPSTASH_REDIS_REST_TOKEN || STORE_CONFIG.UPSTASH_REDIS_REST_TOKEN;
  if (store) return { secret: sha(`week2|session|${store}`), from: "the committed store config" };
  return { secret: DEFAULT_SECRET, from: "nothing" };
}

const { secret: SECRET, from: SECRET_FROM } = resolveSecret();

if (SECRET === DEFAULT_SECRET) {
  const msg =
    'No SESSION_SECRET and nothing to derive one from — player and admin tokens are forgeable. Set one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';
  if (IS_PROD) throw new Error(`REFUSING TO START: ${msg}`);
  console.warn(`[week2] ⚠ ${msg} (allowed in dev only)`);
} else if (SECRET_FROM !== "SESSION_SECRET") {
  console.warn(
    `[week2] SESSION_SECRET is unset — signing tokens with a key derived from ${SECRET_FROM}. Set SESSION_SECRET to decouple them.`
  );
}
const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const playerToken = (pid) => sha(`${SECRET}|player|${pid}`);
const adminTokenFor = (hash) => sha(`${SECRET}|admin|${hash}`);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

/**
 * A number from a form field, or the fallback.
 *
 * Number("") is 0, which is a genuinely dangerous default in a form full of
 * money: clearing the step-cost box made every step free, and clearing the
 * starting-cash box would have dealt the room a dollar each. An empty field
 * means "I did not set this", so it has to mean the default.
 */
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

const MKT = "w2:mkt";
const MKTV = "w2:mkt:v";
const SPEC = (roundId) => `w2:spec:${roundId}`;
const HISTORY = "w2:history";

/* ── the market transaction ───────────────────────────────────────────── */

/**
 * Every market write funnels through here, and writes are serialized within
 * this process first.
 *
 * Optimistic concurrency alone is not enough: thirty people clicking the same
 * tick in the same second means thirty writers racing one key, and a fair
 * fraction of them lose every retry and get turned away. Chaining local
 * mutations onto a promise removes that contention entirely inside a process —
 * which, when the round is run from serve.js, means ALL of it — and leaves the
 * CAS to arbitrate only between separate serverless instances, where the
 * number of competitors is small and the retry loop wins quickly.
 *
 * Nothing inside `fn` may await, and `tx` must never be called from within
 * another `tx`, or the queue would deadlock behind itself.
 */
let writeQueue = Promise.resolve();

function tx(fn, opts) {
  const run = writeQueue.then(
    () => txInner(fn, opts),
    () => txInner(fn, opts)
  );
  // Keep the chain alive whatever this write does, so one rejection does not
  // poison every write behind it.
  writeQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

/**
 * Read the market, apply `fn`, write it back atomically. If someone else wrote
 * first, the CAS hands us their document and we replay `fn` against it — so a
 * losing race costs a retry, never a lost trade. `fn` must be a pure function
 * of the state it is given (no captured balances from a previous attempt).
 */
async function txInner(fn, { attempts = 24 } = {}) {
  // Start from the cached document when it is fresh: if it turns out to be
  // stale the CAS refuses and hands back the real one, so this is a free shot
  // at skipping a read, never a way to write against old state.
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
    // Randomised backoff so instances that collided do not collide again on
    // the same millisecond, capped so a busy market still feels instant.
    if (i > 0) await sleep(Math.min(60, 4 + Math.floor(Math.random() * 12) * i));
  }
  throw httpError(503, "the market is busy right now — try that again", "busy");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads are the hot path: sixty browsers polling. A very short per-instance
 * cache turns a burst of simultaneous polls into one storage read without ever
 * serving a document older than a blink. Our own writes refresh it immediately,
 * so you always see your own order the moment it lands.
 */
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

/**
 * Install a whole new market document, replacing whatever is there. Goes
 * through the same queue as every other write so it cannot race a trade that
 * is already in flight, and the version keeps climbing so any transaction
 * still holding the old round fails its CAS instead of resurrecting it.
 */
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

/* ── the curve spec (the secret) ──────────────────────────────────────── */

const specCache = new Map(); // roundId → spec (immutable once written)

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

/* ── admin ────────────────────────────────────────────────────────────── */

async function adminHash() {
  let h = await kv.get("w2:admin:hash");
  if (!h) {
    h = sha(process.env.ADMIN_PASSWORD || "123");
    await kv.set("w2:admin:hash", h);
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

/* ── clock ────────────────────────────────────────────────────────────── */

/** The round is over the moment the clock says so, whoever is looking. */
function timeUp(state, now) {
  return state.status === "live" && state.endsAt != null && now >= state.endsAt;
}

/**
 * Close the market when its clock runs out. Idempotent and safe to call from
 * any read: the first caller to win the CAS does it, everyone else sees it done.
 *
 * Gradient mode settles itself — x* was fixed and proved when the round was
 * created, so no human decides it and no human can delay it. Prediction mode
 * stops at "ended": trading is shut, and the round waits for the admin to say
 * what the answer was.
 */
async function settleIfDue(state, version, now) {
  if (!timeUp(state, now)) return { state, version, settled: false };
  const prediction = (state.mode ?? "gradient") === "prediction";
  const spec = prediction ? null : await loadSpec(state.roundId);
  if (!prediction && !spec) return { state, version, settled: false };
  const result = await tx((s, out) => {
    if (s.status !== "live") {
      out.readOnly = true; // somebody else already closed it — do not churn the version
      return false;
    }
    if (prediction) {
      s.orders = []; // nothing rests through the bell in either mode
      // A preloaded answer takes effect HERE and nowhere earlier: setting it
      // during the round changes nothing anyone can see or trade against, it
      // just means the bell does not have to wait for a human.
      if (s.preset != null) {
        settle(s, s.preset, now);
        return true;
      }
      s.status = "ended";
      s.endedAt = now;
      return false;
    }
    settle(s, spec.yStar, now);
    return true;
  });
  const after = await readMarket({ fresh: true });
  if (result) await recordHistory(after.state, now);
  return { state: after.state, version: after.version, settled: !!result };
}

/** One line in the round history the big screen scrolls between rounds. */
async function recordHistory(state, now) {
  await kv.pushCapped(
    HISTORY,
    {
      roundId: state.roundId,
      mode: state.mode ?? "gradient",
      question: state.question ?? null,
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

/**
 * What every client is allowed to know about the round.
 *
 * Deliberately absent: settleMin, settleMax, the domain of f, the range of f,
 * and the distribution x* came from. Players are blind to all of it until the
 * bell, so the only number here that says anything about where to look is
 * `center`, which is simply where the ladder opens. `orderMin`/`orderMax` are
 * withheld too — they are a fixed multiple of the settlement span, so shipping
 * them would hand over the settlement range by arithmetic.
 */
function publicRound(state, now) {
  const mode = state.mode ?? "gradient";
  const g = grid(state);
  return {
    roundId: state.roundId,
    mode,
    modeName: MODES[mode]?.name ?? mode,
    hasCurve: MODES[mode]?.hasCurve !== false,
    question: state.question ?? null,
    status: state.status,
    startedAt: state.startedAt,
    endsAt: state.endsAt,
    msLeft: state.endsAt == null ? null : Math.max(0, state.endsAt - now),
    // NOT sent: which difficulty this is. The presets describe the shape of
    // the function — decoy valleys, how wavy, what it is built from — and that
    // is exactly the sort of thing players are supposed to work out.
    startCashC: state.startCashC,
    descentCostC: descentCostC(state),
    defaultSize: state.defaultSize ?? LIMITS.defaultOrderSize,
    lateJoin: state.lateJoin,
    players: Object.keys(state.players ?? {}).length,
    teams: Object.keys(state.teams ?? {}).length,
    teamSize: LIMITS.teamSize,
    serverNow: now,
    tick: g.tick,
    center: g.center,
    settleC: state.settleC,
    xStar: state.status === "settled" ? state.xStar : null,
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
    descents: p.descents ?? 0,
    descentCostC: descentCostC(state),
    points: p.points,
    // Each order carries what it is actually holding, computed by the engine.
    // The client must never derive this: the formula contains a settlement
    // bound, and the whole point is that players do not have one.
    orders: state.orders
      .filter((o) => o.pid === p.id)
      .map((o) => {
        const r = lotReserveC(g, o.side, o.px);
        return { id: o.id, side: o.side, px: o.px, qty: o.qty, ts: o.ts, holdC: (r.a + r.b) * o.qty };
      })
      .sort((a, b) => a.px - b.px),
  };
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
        round: state ? state.roundId : null,
        status: state ? state.status : "none",
        audit: state ? auditState(state) : ["no market"],
      };
    }

    case "GET rules":
      // Unauthenticated, so everything here is public by definition. The MODES
      // and DIFFICULTIES objects are NOT: they carry settleMin, settleMax, the
      // mean and standard deviation x* is drawn from, and the shape parameters
      // of the curve. Only the labels go out.
      return {
        rules: RULES_TEXT,
        predictionRules: PREDICTION_RULES,
        game: GAME,
        tip: GRADIENT_TIP,
        limits: LIMITS,
        money: { descentCostC: MONEY.descentCostC },
        modes: Object.fromEntries(
          MODE_ORDER.map((k) => [k, { key: k, name: MODES[k].name, icon: MODES[k].icon, blurb: MODES[k].blurb, hasCurve: MODES[k].hasCurve }])
        ),
        modeOrder: MODE_ORDER,
        // No difficulty catalogue: the names and blurbs describe the shape of
        // the curve. The admin panel gets them from admin/inspect instead.
      };

    case "GET config": {
      const r = await readMarket();
      if (!r.state) return { round: null, persistent: kv.KV_PERSISTENT };
      const after = await settleIfDue(r.state, r.version, now);
      return { round: publicRound(after.state, now), persistent: kv.KV_PERSISTENT };
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

      const result = await tx((state, out) => {
        const existingPid = state.devices[deviceId];
        if (existingPid && state.players[existingPid]) {
          // Same device, same round: this is a rejoin, not a second account.
          const p = state.players[existingPid];
          out.readOnly = true;
          return { playerId: p.id, token: playerToken(p.id), name: p.name, rejoined: true };
        }
        if (state.status === "settled") throw httpError(409, "that round is over — wait for the next one", "over");
        if (state.status === "live" && !state.lateJoin) throw httpError(409, "this round is closed to new players", "closed");

        const s = slug(name);
        for (const other of Object.values(state.players)) {
          if (slug(other.name) === s) {
            throw httpError(409, "someone already took that name — pick another", "name-taken");
          }
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

      // A player who joins after the bell still gets their free opening point.
      if (!result.rejoined) await grantOpeningPoint(result.playerId, now);
      return result;
    }

    /* ── the poll ── */
    case "GET state": {
      const r0 = await readMarket();
      if (!r0.state) throw httpError(409, "no round is set up yet — ask the admin to start one", "no-round");
      const { state } = await settleIfDue(r0.state, r0.version, now);
      const p = requirePlayer(state, query);
      const since = Number(query.since ?? 0) || 0;
      return {
        round: publicRound(state, now),
        me: meView(state, p),
        team: teamView(state, p),
        market: marketView(state, p.id),
        leaderboard: leaderboard(state, 60).map((row) => ({ ...row, me: row.id === p.id })),
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

    /* ── trading ── */
    case "POST order": {
      const pid = body.playerId;
      rateLimit(`order:${pid}`, 45, 10_000, "easy — that is a lot of orders in ten seconds");
      return tx((state) => {
        const p = requirePlayer(state, body);
        const side = body.side === "B" || body.side === "A" ? body.side : null;
        const px = Number(body.px);
        const qty = Number(body.qty ?? 1);
        if (!side) throw httpError(400, "bad side");
        const res = placeOrder(state, p.id, side, px, qty, now);
        return {
          filled: res.filled,
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

    /**
     * The only purchase in the game: one iteration of gradient descent from a
     * point you own,
     *     x_next = x - rate * f'(x)
     * at a flat fee. The gradient used is the ROUNDED one the player was shown,
     * so where the client says the step lands is exactly where it lands.
     */
    case "POST descend": {
      rateLimit(`descend:${body.playerId}`, 30, 10_000);
      await requireCurveMode();
      const spec = await currentSpec();
      return tx((state) => {
        const p = requirePlayer(state, body);
        if (state.status !== "live") throw httpError(409, "the round is not running", "closed");
        if (!p.teamId) throw httpError(409, "join or create a team first", "no-team");
        if (p.points.length >= LIMITS.maxPointsPerPlayer) {
          throw httpError(400, `you have taken ${LIMITS.maxPointsPerPlayer} steps — that is the cap`);
        }
        const anchor = Number(body.anchorX);
        const lr = Number(body.lr);
        const [lrMin, lrMax] = LIMITS.learningRate;
        if (!Number.isFinite(anchor) || !Number.isFinite(lr) || lr < lrMin || lr > lrMax) {
          throw httpError(400, `the learning rate must be between ${lrMin} and ${lrMax}`);
        }
        const from = p.points.find((pt) => Math.abs(pt.x - anchor) < 1e-6);
        if (!from) throw httpError(400, "you can only step from a point you already own");

        const step = -lr * from.d;
        if (Math.abs(step) > LIMITS.maxStep) {
          throw httpError(
            400,
            `that rate would move ${Math.abs(step).toFixed(2)}, and one step can move at most ${LIMITS.maxStep} — turn it down`,
            "too-far"
          );
        }
        const x = clampToDomain(spec, anchor + step);
        if (p.points.some((pt) => Math.abs(pt.x - x) < 0.005)) {
          // The step may have moved a long way and still landed on a point
          // already owned — at the largest legal rate the step is always
          // exactly maxStep, which walks a lattice. Nothing is charged, because
          // nothing new would be learned.
          // NO COORDINATE in this message. A step aimed past the end of the
          // domain is clamped to the edge, so naming the landing point here
          // would announce exactly where the domain stops — which players are
          // meant to be blind to. The client already shows its own prediction.
          throw httpError(400, "that step lands somewhere you have already walked — change the rate", "duplicate");
        }
        const costC = descentCostC(state);
        if (costC > spendableC(state, p)) {
          throw httpError(400, "out of balance — your cash is committed to resting orders", "balance");
        }
        p.cash -= costC;
        p.spentC += costC;
        p.descents = (p.descents ?? 0) + 1;
        // Points are kept sorted by x for drawing, so "the newest" is not the
        // last element — it has to be recorded. `n` is that: the step number.
        const pt = { ...pointAt(spec, x), n: p.points.length };
        p.points.push(pt);
        p.points.sort((a, b) => a.x - b.x);
        return { point: pt, from: from.x, step: Math.round(step * 100) / 100, lr, costC, me: meView(state, p) };
      });
    }

    /* ── the reveal ── */
    case "GET reveal": {
      const r = await readMarket();
      if (!r.state) throw httpError(409, "no round yet", "no-round");
      const { state } = await settleIfDue(r.state, r.version, now);
      if ((state.mode ?? "gradient") === "prediction") {
        if (state.status !== "settled") throw httpError(403, "this market has not been resolved yet", "locked");
        return {
          roundId: state.roundId,
          mode: "prediction",
          question: state.question,
          settleC: state.settleC,
          value: state.xStar,
          status: state.status,
        };
      }
      // There is no early door any more: the curve opens at the bell, for
      // everybody, at once.
      if (state.status !== "settled") throw httpError(403, "the curve is not open yet", "locked");
      const spec = await loadSpec(state.roundId);
      if (!spec) throw httpError(404, "that round's curve is gone");
      return {
        roundId: state.roundId,
        mode: "gradient",
        difficulty: state.difficulty,
        curve: sampleCurve(spec, 700),
        // Where the bottom is, and — the thing actually traded — how low it is.
        xStar: spec.xStar,
        yStar: spec.yStar,
        curvature: round4(d2At(spec, spec.xStar)),
        settleC: state.settleC,
        status: state.status,
      };
    }

    case "GET leaderboard": {
      const r = await readMarket();
      if (!r.state) return { leaderboard: [], round: null };
      const { state } = await settleIfDue(r.state, r.version, now);
      return { leaderboard: leaderboard(state, 200), round: publicRound(state, now) };
    }

    case "GET board": {
      const r = await readMarket();
      if (!r.state) return { round: null, persistent: kv.KV_PERSISTENT };
      const { state } = await settleIfDue(r.state, r.version, now);
      return {
        round: publicRound(state, now),
        leaderboard: leaderboard(state, 30),
        market: marketView(state, null),
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
      await kv.set("w2:admin:hash", h);
      return { token: adminTokenFor(h) };
    }

    case "POST admin/round": {
      await requireAdmin(body);
      const mode = MODES[body.mode] ? body.mode : "gradient";
      const dkey = DIFFICULTIES[body.difficulty] ? body.difficulty : "wavy";
      const minutes = Math.min(180, Math.max(0.5, numOr(body.minutes, 12)));
      const startCashC = Math.round(
        Math.min(10_000_000, Math.max(100, numOr(body.startCash, MONEY.startCashC / 100))) * 100
      );
      const keepPlayers = !!body.keepPlayers;
      const lateJoin = body.lateJoin !== false;
      const roundId = rid(5);
      const seed = String(body.seed || "").trim() || `${roundId}-${crypto.randomBytes(4).toString("hex")}`;
      const question = String(body.question ?? "").trim().slice(0, 160);
      // What a step costs this round, and — if the admin wants a rigged
      // demonstration — what the curve's minimum should be instead of a draw.
      const descentCostC = Math.round(
        Math.min(1_000_000, Math.max(0, numOr(body.descentCost, MONEY.descentCostC / 100))) * 100
      );
      const forceY = body.minValue == null || body.minValue === "" ? null : Number(body.minValue);
      if (forceY != null && !Number.isFinite(forceY)) throw httpError(400, "the minimum must be a number");
      const defaultSize = Math.round(
        Math.min(LIMITS.maxSharesPerOrder, Math.max(1, numOr(body.defaultSize, LIMITS.defaultOrderSize)))
      );

      let diagnostics = null;
      let spec = null;
      if (mode === "gradient") {
        const cfg = curveConfigFor("gradient");
        if (forceY != null) {
          if (forceY < cfg.yClamp[0] || forceY > cfg.yClamp[1]) {
            throw httpError(400, `the minimum has to be between ${cfg.yClamp[0]} and ${cfg.yClamp[1]}`);
          }
          cfg.forceY = forceY;
        }
        const built = makeCurve(seed, DIFFICULTIES[dkey], cfg);
        diagnostics = built.diagnostics;
        spec = built.spec;
        if (!diagnostics.ok) {
          // The construction proves this cannot happen; if it ever did, refuse
          // to run a round whose settlement price would be a lie.
          throw httpError(
            500,
            `curve self-check failed (min ${diagnostics.numericMin} vs y* ${diagnostics.yStar}, argmin ${diagnostics.numericArgmin} vs x* ${diagnostics.xStar})`
          );
        }
        await kv.setJSON(SPEC(roundId), built.spec);
        specCache.set(roundId, built.spec);
      } else if (!question) {
        throw httpError(400, "a prediction market needs a question — write what people are trading");
      }

      const prev = (await readMarket({ fresh: true })).state;
      const market = newMarket({
        roundId,
        mode,
        difficulty: mode === "gradient" ? dkey : null,
        question: mode === "prediction" ? question : null,
        startCashC,
        descentCostC,
        defaultSize,
        lateJoin,
      });
      // The settlement range comes from the MODE, not from the curve's x axis:
      // what settles is min f, a height, and the ladder is a ladder of heights.
      // The curve's own [lo, hi] is the x axis and never touches the margin.
      market.minutes = minutes;
      if (keepPlayers && prev) {
        for (const p of Object.values(prev.players)) {
          const np = newPlayer(p.id, p.name, p.device, startCashC, now);
          np.fp = p.fp;
          np.ip = p.ip;
          np.teamId = p.teamId ?? null;
          market.players[p.id] = np;
          market.devices[p.device] = p.id;
        }
        // Teams survive a reroll so a table does not have to re-pair up; only
        // the money, the positions and the points start over.
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
      // Deal everyone their opening point here, in the same document, rather
      // than one transaction per player — sixty round trips would take seconds
      // and leave the room staring at an empty chart.
      if (spec) for (const p of Object.values(market.players)) p.points = [{ ...pointAt(spec, randomX(spec)), n: 0 }];

      await replaceMarket(market);
      return { round: publicRound((await readMarket({ fresh: true })).state, now), diagnostics, seed, mode };
    }

    case "POST admin/start": {
      await requireAdmin(body);
      const minutes = body.minutes == null ? null : Math.min(180, Math.max(0.5, Number(body.minutes)));
      return tx((state) => {
        if (state.status === "settled") throw httpError(409, "that round is finished — set up a new one");
        const mins = minutes ?? state.minutes ?? 12;
        state.minutes = mins;
        state.status = "live";
        state.startedAt = state.startedAt ?? now;
        state.endsAt = now + Math.round(mins * 60_000);
        return { round: publicRound(state, now) };
      });
    }

    case "POST admin/extend": {
      await requireAdmin(body);
      const seconds = Math.round(Number(body.seconds) || 0);
      return tx((state) => {
        if (state.status !== "live") throw httpError(409, "the round is not running");
        state.endsAt = Math.max(now + 1000, (state.endsAt ?? now) + seconds * 1000);
        return { round: publicRound(state, now) };
      });
    }

    case "POST admin/end": {
      await requireAdmin(body);
      const r = await readMarket({ fresh: true });
      if (!r.state) throw httpError(409, "no round");
      if (r.state.status === "settled") return { round: publicRound(r.state, now), already: true };
      if (r.state.status === "ended") return { round: publicRound(r.state, now), already: true };
      await tx((state) => {
        if (state.status !== "live") throw httpError(409, "the round has not started");
        state.endsAt = now;
        return true;
      });
      const after = await readMarket({ fresh: true });
      const done = await settleIfDue(after.state, after.version, now + 1);
      return { round: publicRound(done.state, now) };
    }

    /**
     * Load the answer in advance. It is stored and nothing else: trading is
     * untouched, no player payload carries it, and the market does not settle
     * until the clock runs out. Useful when you already know how a question
     * turned out and want the bell to be clean.
     */
    case "POST admin/preload": {
      await requireAdmin(body);
      const clear = body.value === null || body.value === "";
      const value = clear ? null : Math.round(Number(body.value) * 100) / 100;
      if (!clear && !Number.isFinite(value)) throw httpError(400, "preload a number, or null to clear it");
      return tx((state) => {
        const g = grid(state);
        if ((state.mode ?? "gradient") !== "prediction") {
          throw httpError(409, "a gradient round settles at its own minimum — there is nothing to preload");
        }
        if (state.status === "settled") throw httpError(409, "this market is already resolved");
        if (!clear && (value < g.settleMin || value > g.settleMax)) {
          throw httpError(400, `preload a number between ${g.settleMin} and ${g.settleMax}`);
        }
        state.preset = value;
        return { preset: value, round: publicRound(state, now) };
      });
    }

    /**
     * Resolve a prediction market. This is the ONLY route that lets a human
     * choose a settlement price, and it is deliberately impossible in gradient
     * mode: there, x* was drawn and proved when the round was created, so not
     * even the admin can move it after seeing where the market went.
     */
    case "POST admin/resolve": {
      await requireAdmin(body);
      const value = Math.round(Number(body.value) * 100) / 100;
      if (!Number.isFinite(value)) throw httpError(400, "resolve to a number");
      const out = await tx((state) => {
        const g = grid(state);
        if (value < g.settleMin || value > g.settleMax) {
          throw httpError(400, `resolve to a number between ${g.settleMin} and ${g.settleMax}`);
        }
        if ((state.mode ?? "gradient") !== "prediction") {
          throw httpError(409, "a gradient round settles at x* — that is not the admin's to choose");
        }
        if (state.status === "settled") throw httpError(409, "this market is already resolved");
        if (state.status === "lobby") throw httpError(409, "the market never opened");
        state.preset = null;
        settle(state, value, now);
        return publicRound(state, now);
      });
      await recordHistory((await readMarket({ fresh: true })).state, now);
      return { round: out, value };
    }

    /**
     * Wipe everything: the market, every player, team and device binding, and
     * the round history. The admin password survives, because locking yourself
     * out of the control room is not a reset, it is an outage.
     */
    case "POST admin/reset": {
      await requireAdmin(body);
      if (body.confirm !== "RESET") throw httpError(400, "send confirm:\"RESET\" to wipe the game");
      const prev = (await readMarket({ fresh: true })).state;
      if (prev?.roundId) await kv.del(SPEC(prev.roundId));
      await kv.del(MKT, MKTV, HISTORY);
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
        delete state.players[p.id];
        for (const [dev, pid] of Object.entries(state.devices)) if (pid === p.id) delete state.devices[dev];
        return { ok: true };
      });
    }

    case "POST admin/unbind": {
      // Free a device that lost its browser storage, or was handed to someone
      // else. The player stays; only the device → player binding is dropped.
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
      if (!r.state) {
        return {
          round: null,
          persistent: kv.KV_PERSISTENT,
          kv: kv.KV_MODE,
          difficulties: Object.fromEntries(
            DIFFICULTY_ORDER.map((k) => [k, { key: k, name: DIFFICULTIES[k].name, blurb: DIFFICULTIES[k].blurb }])
          ),
          difficultyOrder: DIFFICULTY_ORDER,
        };
      }
      const state = r.state;
      const spec = await loadSpec(state.roundId);

      // Flag anything that looks like one person with two accounts. Device IDs
      // are a hard block at join; fingerprints are only ever a hint, because
      // two identical phones on the same network legitimately look alike.
      const byFp = new Map();
      for (const p of Object.values(state.players)) {
        const key = `${p.fp}|${p.ip}`;
        if (!p.fp) continue;
        byFp.set(key, [...(byFp.get(key) ?? []), { id: p.id, name: p.name, device: p.device }]);
      }
      const suspicious = [...byFp.values()].filter((g) => g.length > 1);

      return {
        round: publicRound(state, now),
        kv: kv.KV_MODE,
        persistent: kv.KV_PERSISTENT,
        audit: auditState(state),
        diagnostics: spec ? diagnose(spec) : null,
        xStar: spec ? spec.xStar : null,
        yStar: spec ? spec.yStar : null,
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
            points: p.points.length,
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
        grid: grid(state),
        preset: state.preset ?? null,
        difficulty: state.difficulty,
        difficulties: Object.fromEntries(
          DIFFICULTY_ORDER.map((k) => [k, { key: k, name: DIFFICULTIES[k].name, blurb: DIFFICULTIES[k].blurb }])
        ),
        difficultyOrder: DIFFICULTY_ORDER,
        openOrders: state.orders.length,
        volume: state.volume,
      };
    }

    default:
      throw httpError(404, `no route: ${method} ${route}`);
  }
}

/* ── helpers that need both the spec and the market ───────────────────── */

const round4 = (v) => Math.round(v * 10000) / 10000;

/** Refuse curve-only actions when the round is a plain prediction market. */
async function requireCurveMode() {
  const { state } = await readMarket();
  if (!state) throw httpError(409, "no round is set up yet", "no-round");
  if ((state.mode ?? "gradient") === "prediction") {
    throw httpError(409, "this round is a prediction market — there is no curve to measure", "no-curve");
  }
}

async function currentSpec() {
  const { state } = await readMarket();
  if (!state) throw httpError(409, "no round is set up yet", "no-round");
  const spec = await loadSpec(state.roundId);
  if (!spec) throw httpError(500, "this round has no curve — start a new one");
  return spec;
}

/**
 * Everybody's free first point: one uniformly random x on the domain, with its
 * height and its exact gradient. Drawn per player, so the room starts with
 * sixty different slivers of the same secret — which is the whole game.
 */
/** Keep an x inside the curve's domain, to the cent. */
function clampToDomain(spec, x) {
  const v = Math.min(spec.hi, Math.max(spec.lo, x));
  return Math.round(v * 100) / 100;
}

/** A uniformly random x on the curve's domain, to the cent. */
function randomX(spec) {
  const span = spec.hi - spec.lo;
  return Math.round((spec.lo + (crypto.randomInt(0, 1_000_001) / 1_000_000) * span) * 100) / 100;
}

async function grantOpeningPoint(playerId, now) {
  const { state: pre } = await readMarket();
  if (!pre || (pre.mode ?? "gradient") === "prediction") return null; // no curve, no points
  const spec = await currentSpec();
  const x = randomX(spec);
  return tx((state, out) => {
    const p = state.players[playerId];
    if (!p) {
      out.readOnly = true;
      return null;
    }
    if (p.points.length > 0) {
      out.readOnly = true;
      return p.points[0];
    }
    const pt = { ...pointAt(spec, x), n: 0 };
    p.points.push(pt);
    p.openedAt = now;
    return pt;
  });
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
