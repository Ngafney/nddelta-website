/**
 * The whole Week 1 API in one router, mounted two ways:
 *   - api/week1/[...route].mjs  (Vercel serverless, production)
 *   - week1/dev-server.js       (plain node http, local dev)
 *
 * Every mutation checks the team token; every game action checks the
 * admin config, so a disabled game is actually closed — not just hidden.
 */

import crypto from "node:crypto";
import * as kv from "./kv.js";
import { compile, llmAvailable } from "./llm.js";
import { validateSpec } from "../shared/dsl.js";
import { readback } from "../shared/readback.js";
import { makeWorld, payoffAt, oracle, applySpin, makeManualState, oraclePctFor, round2 } from "../shared/bandit.js";
import { prepareBanditCode, runManyCode, simulateCode } from "../shared/banditCode.js";
import { roundRobin, playMatch } from "../shared/matrix.js";
import { SEED_BOTS } from "../shared/seedBots.js";
import { BANDIT, GAMES, RULES_TEXT, PAYOFFS, MATCH } from "../shared/rules.js";

/**
 * SESSION_SECRET signs every team token AND the admin token. Team IDs are
 * PUBLIC (they appear on the leaderboard), so if the secret is the known
 * default, anyone can recompute any team's token — and the admin token —
 * from public data. That's account takeover and admin seizure with no
 * password. So: in production the server REFUSES to boot on the default;
 * locally it warns loudly but runs, so dev needs no setup.
 */
const DEFAULT_SECRET = "week1-dev-secret";
const SECRET = process.env.SESSION_SECRET || DEFAULT_SECRET;
const IS_PROD = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
if (SECRET === DEFAULT_SECRET) {
  const msg =
    "SESSION_SECRET is unset — team and admin tokens are forgeable from public data. Set a strong SESSION_SECRET (node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\").";
  if (IS_PROD) throw new Error(`REFUSING TO START: ${msg}`);
  console.warn(`[week1] ⚠ ${msg} (allowed in dev only)`);
}

const BASE_SEED = process.env.WORLD_SEED || "delta-week1-v2"; // bump to reroll the shared worlds (v2: 8 machines, 100 pulls)
const MAX_STRATS = 60; // per team per nothing — a soft cap against unbounded growth

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const id = (n = 8) => crypto.randomBytes(n).toString("hex");
const teamToken = (teamId) => sha(`${SECRET}|team|${teamId}`);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ── admin ────────────────────────────────────────────────────────────── */

async function adminHash() {
  let h = await kv.get("w1:admin:hash");
  if (!h) {
    // ADMIN_PASSWORD seeds the first hash if set; otherwise 123. Either way
    // it's changeable from the panel without a deploy, and the real
    // protection is SESSION_SECRET (the token can't be forged).
    h = sha(process.env.ADMIN_PASSWORD || "123");
    await kv.set("w1:admin:hash", h);
  }
  return h;
}

const adminToken = (hash) => sha(`${SECRET}|admin|${hash}`);

async function checkAdmin(token) {
  return token === adminToken(await adminHash());
}

async function getConfig() {
  const cfg = await kv.getJSON("w1:config");
  // Split-or-Steal is hidden by default (same shape as Chicken, less cool) —
  // flip it on from /week1/admin when you want it.
  return cfg ?? { bandit: true, chicken: true, pd: false };
}

/* ── teams ────────────────────────────────────────────────────────────── */

async function requireTeam(body) {
  const { teamId, token } = body;
  if (!teamId || token !== teamToken(teamId)) throw httpError(401, "bad team credentials");
  const team = await kv.getJSON(`w1:team:${teamId}`);
  if (!team) throw httpError(401, "unknown team");
  return { teamId, team };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Per-team sliding-window rate limit, in process memory. On serverless
 * this is per-instance so it's a soft cap, not a hard one — but the calls
 * it guards (LLM compiles, 10k-sim runs) only need "no runaway loop"
 * protection, not billing-grade enforcement.
 */
const rateBuckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) throw httpError(429, "slow down — try again in a few seconds");
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 5000) rateBuckets.clear(); // cheap leak valve
}

async function teamNames() {
  const all = await kv.hgetall("w1:names");
  return all; // { teamId: name }
}

/* ── tournament ───────────────────────────────────────────────────────── */

async function loadBots(game) {
  const bots = [...SEED_BOTS[game]];
  const submits = await kv.hgetall(`w1:submit:${game}`);
  const names = await teamNames();
  for (const [teamId, sid] of Object.entries(submits)) {
    const strat = await kv.getJSON(`w1:strat:${teamId}:${sid}`);
    if (strat?.spec) {
      bots.push({ id: `team:${teamId}`, name: names[teamId] ?? "???", spec: strat.spec, stratName: strat.name });
    }
  }
  return bots;
}

async function recompute(game) {
  const bots = await loadBots(game);
  const { standings, pairs } = roundRobin(game, bots);
  const result = { standings, pairs, updatedAt: Date.now() };
  await kv.setJSON(`w1:tourney:${game}`, result);
  return result;
}

async function getTourney(game) {
  let t = await kv.getJSON(`w1:tourney:${game}`);
  if (!t) t = await recompute(game); // first load seeds the board with the seed bots
  return t;
}

/** The top-two match logs — the big screen's replay. */
function topReplay(tourney) {
  const [one, two] = tourney.standings;
  if (!one || !two) return null;
  const [lo, hi] = [one.id, two.id].sort();
  const pair = tourney.pairs[`${lo}|${hi}`];
  if (!pair) return null;
  return { a: { id: lo, name: lo === one.id ? one.name : two.name }, b: { id: hi, name: hi === one.id ? one.name : two.name }, matches: pair.matches };
}

/* ── bandit leaderboards ──────────────────────────────────────────────── */

async function banditBoard(kind, n = 50) {
  const rows = await kv.ztop(`w1:board:bandit:${kind}`, n);
  const names = await teamNames();
  return Promise.all(
    rows.map(async (r, i) => {
      const detail = await kv.getJSON(`w1:bandit:${kind}:detail:${r.member}`);
      return { rank: i + 1, teamId: r.member, name: names[r.member] ?? "???", score: r.score, ...detail };
    })
  );
}

/* ── the router ───────────────────────────────────────────────────────── */

export async function handle(method, route, body, query) {
  const config = await getConfig();
  const requireGame = (g) => {
    if (!config[g]) throw httpError(403, "this game is currently disabled");
  };

  switch (`${method} ${route}`) {
    /* ── meta ── */
    case "GET health":
      return { ok: true, kv: kv.KV_MODE, persistent: kv.KV_PERSISTENT, llm: llmAvailable() };

    case "GET config":
      return { games: config, llm: llmAvailable(), persistent: kv.KV_PERSISTENT };

    case "GET rules":
      return { rules: RULES_TEXT, payoffs: PAYOFFS, bandit: BANDIT, match: MATCH };

    /* ── admin ── */
    case "POST admin/auth": {
      const h = await adminHash();
      if (sha(String(body.password ?? "")) !== h) throw httpError(401, "wrong password");
      return { token: adminToken(h) };
    }
    case "POST admin/config": {
      if (!(await checkAdmin(body.token))) throw httpError(401, "bad admin token");
      const games = {};
      for (const g of GAMES) games[g] = !!body.games?.[g];
      await kv.setJSON("w1:config", games);
      return { games };
    }
    case "POST admin/password": {
      if (!(await checkAdmin(body.token))) throw httpError(401, "bad admin token");
      if (!body.password || String(body.password).length < 3) throw httpError(400, "password too short");
      const h = sha(String(body.password));
      await kv.set("w1:admin:hash", h);
      return { token: adminToken(h) };
    }
    case "POST admin/reset": {
      if (!(await checkAdmin(body.token))) throw httpError(401, "bad admin token");
      const target = body.board;
      if (target === "bandit-manual") await kv.del("w1:board:bandit:manual");
      else if (target === "bandit-algo") await kv.del("w1:board:bandit:algo");
      else if (target === "chicken" || target === "pd") {
        await kv.del(`w1:submit:${target}`);
        await kv.del(`w1:tourney:${target}`);
        await recompute(target);
      } else throw httpError(400, "unknown board");
      return { ok: true };
    }
    case "POST admin/remove-entry": {
      if (!(await checkAdmin(body.token))) throw httpError(401, "bad admin token");
      const { board, teamId } = body;
      if (board === "bandit-manual") await kv.zrem("w1:board:bandit:manual", teamId);
      else if (board === "bandit-algo") await kv.zrem("w1:board:bandit:algo", teamId);
      else if (board === "chicken" || board === "pd") {
        await kv.hdel(`w1:submit:${board}`, teamId);
        await recompute(board);
      } else throw httpError(400, "unknown board");
      return { ok: true };
    }
    case "POST admin/recompute": {
      if (!(await checkAdmin(body.token))) throw httpError(401, "bad admin token");
      const out = {};
      for (const g of ["chicken", "pd"]) out[g] = (await recompute(g)).standings;
      return out;
    }

    /* ── teams ── */
    case "POST team": {
      // Unauthenticated and it creates records + gates the expensive
      // per-team limiter, so cap it per source to blunt team-flood DoS.
      rateLimit(`team:${query.__ip ?? "anon"}`, 20, 60_000);
      const name = String(body.name ?? "").trim();
      if (name.length < 2 || name.length > 24) throw httpError(400, "team name must be 2–24 characters");
      const s = slug(name);
      if (!s) throw httpError(400, "team name needs some letters or numbers");
      const existing = await kv.get(`w1:teamname:${s}`);
      if (existing) {
        // Rejoining: the stored token (from this browser) must match.
        if (body.token === teamToken(existing)) {
          return { teamId: existing, token: body.token, name };
        }
        throw httpError(409, "that name is taken — pick another, or rejoin from the browser that created it");
      }
      const teamId = id(6);
      await kv.setJSON(`w1:team:${teamId}`, { name, createdAt: Date.now() });
      await kv.set(`w1:teamname:${s}`, teamId);
      await kv.hset("w1:names", teamId, name);
      return { teamId, token: teamToken(teamId), name };
    }

    /* ── strategies ── */
    case "POST compile": {
      // Team-authenticated and rate-limited: once a real API key is set,
      // this endpoint spends money.
      const { teamId } = await requireTeam(body);
      const { game, prompt } = body;
      if (!GAMES.includes(game)) throw httpError(400, "unknown game");
      requireGame(game);
      if (!prompt || String(prompt).trim().length < 3) throw httpError(400, "describe your strategy first");
      rateLimit(`compile:${teamId}`, 8, 60_000);
      const result = await compile(game, String(prompt));
      if (result.refused) return { refused: true, reason: result.reason };
      // Bandit compiles to JS code; matrix games to a rule spec. Both carry
      // the AI-written "explain" (Step 3 text) and a short "summary".
      return {
        game,
        spec: result.spec ?? null,
        code: result.code ?? null,
        explain: result.explain ?? (result.spec ? readback(result.spec).join(" ") : null),
        summary: result.summary ?? null,
        note: result.note ?? null,
        source: result.source,
      };
    }

    case "POST strategy": {
      const { teamId } = await requireTeam(body);
      const game = body.game;
      if (!GAMES.includes(game)) throw httpError(400, "unknown game");
      const sid = id(5);
      const strat = {
        id: sid,
        game,
        name: String(body.name ?? "untitled").trim().slice(0, 32) || "untitled",
        prompt: String(body.prompt ?? "").slice(0, 2000),
        explain: body.explain ? String(body.explain).slice(0, 400) : null,
        summary: body.summary ? String(body.summary).slice(0, 60) : null,
        createdAt: Date.now(),
      };
      if (game === "bandit") {
        const prep = prepareBanditCode(body.code);
        if (!prep.ok) throw httpError(400, `invalid strategy: ${prep.error}`);
        strat.code = String(body.code);
      } else {
        const v = validateSpec(body.spec);
        if (!v.ok || v.spec.game !== game) throw httpError(400, `invalid strategy: ${(v.errors ?? ["wrong game"]).join("; ")}`);
        strat.spec = v.spec;
      }
      const list = (await kv.getJSON(`w1:strats:${teamId}`)) ?? [];
      if (list.length >= MAX_STRATS) throw httpError(400, `you've saved the maximum of ${MAX_STRATS} strategies — delete some first`);
      // Two strategies with one name is a trap — "Alpha" that swerves and
      // "Alpha" that stays look identical in the list and in "your bot
      // Alpha is LIVE". Auto-suffix instead of erroring at a freshman.
      const taken = new Set();
      for (const other of list) {
        const s = await kv.getJSON(`w1:strat:${teamId}:${other}`);
        if (s?.game === strat.game) taken.add(s.name);
      }
      const base = strat.name;
      for (let n = 2; taken.has(strat.name); n++) strat.name = `${base} ${n}`;
      await kv.setJSON(`w1:strat:${teamId}:${sid}`, strat);
      list.push(sid);
      await kv.setJSON(`w1:strats:${teamId}`, list);
      return { id: sid };
    }

    case "GET strategies": {
      const { teamId } = await requireTeam(query);
      const list = (await kv.getJSON(`w1:strats:${teamId}`)) ?? [];
      const strats = [];
      for (const sid of list) {
        const s = await kv.getJSON(`w1:strat:${teamId}:${sid}`);
        if (s && (!query.game || s.game === query.game)) strats.push(s);
      }
      const submitted = {};
      for (const g of ["chicken", "pd"]) submitted[g] = (await kv.hgetall(`w1:submit:${g}`))[teamId] ?? null;
      return { strategies: strats.reverse(), submitted };
    }

    /* ── bandit: algorithm runs (real JS strategies) ── */
    case "POST bandit/run": {
      requireGame("bandit");
      const { teamId } = await requireTeam(body);
      const prep = prepareBanditCode(body.code);
      if (!prep.ok) throw httpError(400, `invalid strategy: ${prep.error}`);
      rateLimit(`run:${teamId}`, 10, 60_000);
      const stats = runManyCode(prep.run, BASE_SEED, BANDIT.simulations);
      const prevBest = (await kv.getJSON(`w1:bandit:algo:detail:${teamId}`))?.score ?? -Infinity;
      const improved = await kv.zaddGT("w1:board:bandit:algo", stats.avg, teamId);
      if (improved || stats.avg > prevBest) {
        await kv.setJSON(`w1:bandit:algo:detail:${teamId}`, {
          score: stats.avg,
          oraclePct: stats.oraclePct,
          stratName: String(body.name ?? "").slice(0, 32) || null,
          at: Date.now(),
        });
      }
      // A sample game for the "watch one play out" panel.
      const sample = simulateCode(prep.run, `${BASE_SEED}|w0`, { withHistory: true });
      return { stats, newBest: !!improved, sample: { history: sample.history, total: sample.total } };
    }

    /* ── bandit: manual play ── */
    case "POST bandit/manual/start": {
      requireGame("bandit");
      const { teamId } = await requireTeam(body);
      rateLimit(`start:${teamId}`, 30, 60_000); // caps free luck-farming of the best-run board
      const attemptId = id(8);
      // Fresh machines per attempt; the seed stays server-side so the world
      // can't be precomputed in the console.
      const worldSeed = `${BASE_SEED}|manual|${teamId}|${attemptId}`;
      await kv.setJSON(`w1:manual:${attemptId}`, { teamId, worldSeed, choices: [], done: false, at: Date.now() });
      await kv.expire(`w1:manual:${attemptId}`, 24 * 3600); // attempts are ephemeral; boards are what persists
      return { attemptId, spins: BANDIT.spins, machines: BANDIT.machines };
    }

    case "POST bandit/manual/spin": {
      // No requireGame here — a run legitimately started must be finishable
      // even if an admin disables bandit mid-run. Starting new runs is
      // gated (on /start); completing one in progress is not.
      const attempt = await kv.getJSON(`w1:manual:${body.attemptId}`);
      if (!attempt || attempt.done) throw httpError(400, "no such attempt in progress");
      const m = body.machine;
      if (!Number.isInteger(m) || m < 0 || m >= BANDIT.machines) throw httpError(400, "bad machine");
      if (attempt.choices.length >= BANDIT.spins) throw httpError(400, "out of spins");
      const world = makeWorld(attempt.worldSeed);
      const t = attempt.choices.length;
      const pay = round2(payoffAt(attempt.worldSeed, world, t, m));
      attempt.choices.push(m);
      await kv.setJSON(`w1:manual:${body.attemptId}`, attempt);
      await kv.expire(`w1:manual:${body.attemptId}`, 24 * 3600);
      return { payoff: pay, spinsUsed: attempt.choices.length, spinsLeft: BANDIT.spins - attempt.choices.length };
    }

    case "POST bandit/manual/finish": {
      // Also ungated — see spin. A finished 50-pull run must always score.
      const attempt = await kv.getJSON(`w1:manual:${body.attemptId}`);
      if (!attempt) throw httpError(400, "no such attempt");
      if (attempt.choices.length < BANDIT.spins) throw httpError(400, `finish after all ${BANDIT.spins} spins`);
      // Score is re-derived server-side from the seed and the choices —
      // the client never reports a number we take on faith. Each payoff is
      // rounded exactly as /spin displayed it, so the final score always
      // equals the running total the player watched.
      const world = makeWorld(attempt.worldSeed);
      const state = makeManualState();
      attempt.choices.forEach((m, t) => applySpin(state, m, round2(payoffAt(attempt.worldSeed, world, t, m))));
      const total = round2(state.total);
      const oraclePct = oraclePctFor(state.total, world);
      const teamId = attempt.teamId;
      if (!attempt.done) {
        attempt.done = true;
        await kv.setJSON(`w1:manual:${body.attemptId}`, attempt);
        // Rank by % of oracle (skill), not raw points (luck of the machine
        // draw). Fall back to raw points only on the rare all-negative world
        // where oracle % is undefined, floored below any real % so it can't
        // outrank a real skill score.
        const metric = oraclePct == null ? -1000 + total / 1000 : oraclePct;
        const improved = await kv.zaddGT("w1:board:bandit:manual", metric, teamId);
        if (improved) {
          await kv.setJSON(`w1:bandit:manual:detail:${teamId}`, { oraclePct, points: total, at: Date.now() });
        }
        // Round the oracle to the SAME precision the revealed μ are shown
        // at, so a suspicious player's 50×max(μ) arithmetic matches exactly.
        const shownMu = world.mu.map(round2);
        return { total, oraclePct, newBest: !!improved, truth: { mu: shownMu, sigma: world.sigma.map(round2), oracle: round2(BANDIT.spins * Math.max(...shownMu)) } };
      }
      return { total, oraclePct, newBest: false };
    }

    /* ── tournaments ── */
    case "POST submit": {
      const game = body.game;
      if (game !== "chicken" && game !== "pd") throw httpError(400, "unknown game");
      requireGame(game);
      const { teamId } = await requireTeam(body);
      rateLimit(`submit:${teamId}`, 12, 60_000); // each submit forces an O(N²) recompute
      const strat = await kv.getJSON(`w1:strat:${teamId}:${body.strategyId}`);
      if (!strat || strat.game !== game) throw httpError(400, "no such strategy for this game");
      await kv.hset(`w1:submit:${game}`, teamId, strat.id);
      const tourney = await recompute(game);
      return { standings: tourney.standings, updatedAt: tourney.updatedAt };
    }

    case "POST exhibition": {
      // A friendly against the current #1 — no submission required. This
      // is the "watch your bot fight the champion" panel after a compile.
      const { teamId, team } = await requireTeam(body);
      const game = body.game;
      if (game !== "chicken" && game !== "pd") throw httpError(400, "unknown game");
      requireGame(game);
      rateLimit(`exh:${teamId}`, 20, 60_000);
      const v = validateSpec(body.spec);
      if (!v.ok || v.spec.game !== game) throw httpError(400, `invalid strategy: ${(v.errors ?? ["wrong game"]).join("; ")}`);
      const tourney = await getTourney(game);
      const names = await teamNames();
      const top = tourney.standings[0];
      const bots = await loadBots(game);
      const champ = bots.find((b) => b.id === top.id) ?? SEED_BOTS[game][0];
      const you = { id: `x:${sha(JSON.stringify(v.spec)).slice(0, 8)}`, name: team.name, spec: v.spec };
      const match = playMatch(game, you, champ, 0);
      return { opponent: { id: champ.id, name: champ.name }, rounds: match.rounds, yourScore: match.scoreA, theirScore: match.scoreB };
    }

    /* ── reads ── */
    case "GET leaderboard": {
      const game = query.game;
      if (game === "bandit") {
        return { manual: await banditBoard("manual"), algo: await banditBoard("algo") };
      }
      if (game === "chicken" || game === "pd") {
        const t = await getTourney(game);
        return { standings: t.standings, updatedAt: t.updatedAt };
      }
      throw httpError(400, "unknown game");
    }

    case "GET replay": {
      const game = query.game === "pd" ? "pd" : "chicken";
      const t = await getTourney(game);
      return { replay: topReplay(t), updatedAt: t.updatedAt };
    }

    case "GET board": {
      // Everything the projector page needs, in one request.
      const [chicken, pd] = [await getTourney("chicken"), await getTourney("pd")];
      return {
        games: config,
        bandit: { manual: await banditBoard("manual", 10), algo: await banditBoard("algo", 10) },
        chicken: { standings: chicken.standings.slice(0, 10), replay: topReplay(chicken) },
        pd: { standings: pd.standings.slice(0, 10), replay: topReplay(pd) },
      };
    }

    default:
      throw httpError(404, `no route: ${method} ${route}`);
  }
}

/**
 * Adapt to a (req, res) node/Vercel handler. Body may already be parsed
 * (Vercel does this); otherwise we read the stream ourselves.
 */
const MAX_BODY = 64 * 1024; // nothing this API accepts is remotely this big

export async function nodeHandler(req, res, route) {
  try {
    let body = {};
    if (req.method === "POST") {
      if (req.body !== undefined && req.body !== null) {
        body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
      } else {
        // Cap the body BEFORE buffering the whole thing into memory and
        // parsing it — an unauthenticated 100MB POST shouldn't be able to
        // spike memory or block the event loop on JSON.parse.
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
    // Rough client identity for unauthenticated rate-limiting (team creation).
    query.__ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "anon";
    const result = await handle(req.method, route, body, query);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(result));
  } catch (e) {
    res.statusCode = e.status ?? 500;
    res.setHeader("Content-Type", "application/json");
    if (!e.status) console.error("[api]", e);
    res.end(JSON.stringify({ error: e.message ?? "server error" }));
  }
}
