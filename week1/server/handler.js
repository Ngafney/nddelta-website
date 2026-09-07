/**
 * The whole Week 1 API in one router, mounted two ways:
 *   - api/week1/router.mjs   (Vercel serverless, production)
 *   - week1/dev-server.js    (plain node http, local dev)
 *
 * Two live games: the Iterated Prisoner's Dilemma (pd) and the Sunset Scoops
 * weather-hedging puzzle (icecream). Both compile English → sandboxed JS. The
 * retired Bandit/Chicken endpoints remain but are gated off by the admin config
 * (not in GAMES), so they're closed, not just hidden.
 */

import crypto from "node:crypto";
import * as kv from "./kv.js";
import { compile, llmAvailable } from "./llm.js";
import { makeWorld, payoffAt, oracle, applySpin, makeManualState, oraclePctFor, round2 } from "../shared/bandit.js";
import { prepareBanditCode, runManyCode, simulateCode } from "../shared/banditCode.js";
import { preparePdCode, roundRobinCode, playMatchCode, opponentBreakdown } from "../shared/pdCode.js";
import { prepareIceCode, simulateIce, trainingCsv, ICE_INFO } from "../shared/iceCode.js";
import { SEED_BOTS } from "../shared/seedBots.js";
import { BANDIT, GAMES, RULES_TEXT, PAYOFFS, MATCH } from "../shared/rules.js";

const DEFAULT_SECRET = "week1-dev-secret";
const API_KEY_FOR_SECRET = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
const DERIVED_SECRET = API_KEY_FOR_SECRET
  ? crypto.createHash("sha256").update("week1|session|" + API_KEY_FOR_SECRET).digest("hex")
  : null;
const SECRET = process.env.SESSION_SECRET || DERIVED_SECRET || DEFAULT_SECRET;
const IS_PROD = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
if (SECRET === DEFAULT_SECRET) {
  const msg =
    "No SESSION_SECRET and no OPENAI_API_KEY to derive one from — team and admin tokens are forgeable from public data. Set a strong SESSION_SECRET (node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\").";
  if (IS_PROD) throw new Error(`REFUSING TO START: ${msg}`);
  console.warn(`[week1] ⚠ ${msg} (allowed in dev only)`);
} else if (!process.env.SESSION_SECRET && DERIVED_SECRET) {
  console.warn("[week1] SESSION_SECRET unset — using a secret derived from OPENAI_API_KEY (set an explicit SESSION_SECRET to decouple them).");
}

const BASE_SEED = process.env.WORLD_SEED || "delta-week1-v2";
const MAX_STRATS = 60;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const id = (n = 8) => crypto.randomBytes(n).toString("hex");
const teamToken = (teamId) => sha(`${SECRET}|team|${teamId}`);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ── admin ────────────────────────────────────────────────────────────── */

async function adminHash() {
  let h = await kv.get("w1:admin:hash");
  if (!h) {
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
  return cfg ?? { pd: true, icecream: true };
}

async function getTimers() {
  const timers = {};
  for (const g of GAMES) timers[g] = (await kv.getJSON(`w1:timer:${g}`)) ?? null;
  return timers;
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

const rateBuckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) throw httpError(429, "slow down — try again in a few seconds");
  hits.push(now);
  rateBuckets.set(key, hits);
  if (rateBuckets.size > 5000) rateBuckets.clear();
}

async function teamNames() {
  return kv.hgetall("w1:names"); // { teamId: name }
}

/* ── IPD tournament (executable JS) ───────────────────────────────────── */

/** Display name for any bot id (team:xxx, seed:xxx, or a raw teamId). */
function nameFor(names, botId) {
  if (names[botId]) return names[botId];
  const raw = botId.replace(/^team:/, "");
  if (names[raw]) return names[raw];
  const sb = SEED_BOTS.pd.find((b) => b.id === botId);
  return sb ? sb.name : botId;
}

async function loadPdBots() {
  const bots = [];
  for (const sb of SEED_BOTS.pd) {
    const prep = preparePdCode(sb.code);
    if (prep.ok) bots.push({ id: sb.id, name: sb.name, fn: prep.run, seedBot: true });
  }
  const submits = await kv.hgetall("w1:submit:pd");
  const names = await teamNames();
  for (const [teamId, sid] of Object.entries(submits)) {
    const strat = await kv.getJSON(`w1:strat:${teamId}:${sid}`);
    if (strat?.code) {
      const prep = preparePdCode(strat.code);
      if (prep.ok) bots.push({ id: `team:${teamId}`, name: names[teamId] ?? "???", fn: prep.run, stratName: strat.name });
    }
  }
  return bots;
}

async function recomputePd() {
  const bots = await loadPdBots();
  const { standings, pairSummaries } = roundRobinCode(bots);
  const result = { standings, pairSummaries, updatedAt: Date.now() };
  await kv.setJSON("w1:tourney:pd", result);
  return result;
}

async function getPdTourney() {
  let t = await kv.getJSON("w1:tourney:pd");
  if (!t) t = await recomputePd();
  return t;
}

/**
 * One team's opponent list + per-opponent summary (the CSV source).
 * At 200 rounds the round logs are far too big to store or ship, so the list
 * carries scores only; a single match's rounds are recomputed on demand by
 * GET pd/replay (the match is seeded, so a replay is the real thing).
 */
function mineView(tourney, botId, names) {
  const breakdown = opponentBreakdown(tourney.pairSummaries, botId, (oid) => nameFor(names, oid));
  const opponents = [];
  for (const key of Object.keys(tourney.pairSummaries)) {
    const p = tourney.pairSummaries[key];
    if (p.a !== botId && p.b !== botId) continue;
    const meIsA = p.a === botId;
    const oppId = meIsA ? p.b : p.a;
    opponents.push({
      opponentId: oppId,
      opponent: nameFor(names, oppId),
      seed: oppId.startsWith("seed:"),
      matches: p.perMatch.map((pm) => ({ you: meIsA ? pm.a : pm.b, them: meIsA ? pm.b : pm.a })),
    });
  }
  opponents.sort((x, y) => x.opponent.localeCompare(y.opponent));
  const me = tourney.standings.find((s) => s.id === botId) ?? null;
  return { breakdown, opponents, me };
}

/** Recompute one pairing's match round-by-round (deterministic from the seed). */
async function replayMatch(idA, idB, matchIndex) {
  const bots = await loadPdBots();
  const A = bots.find((b) => b.id === idA);
  const B = bots.find((b) => b.id === idB);
  if (!A || !B) return null;
  const m = Math.max(0, Math.min(MATCH.matchesPerPairing - 1, Number(matchIndex) || 0));
  const res = playMatchCode(A, B, m);
  return { a: { id: A.id, name: A.name }, b: { id: B.id, name: B.name }, matchIndex: m, matches: MATCH.matchesPerPairing, ...res };
}

/** The current #1 vs #2 match — the big screen's replay, recomputed live. */
async function topReplay(tourney, matchIndex = 0) {
  const [one, two] = tourney.standings;
  if (!one || !two) return null;
  const r = await replayMatch(one.id, two.id, matchIndex);
  if (!r) return null;
  return { a: r.a, b: r.b, matchIndex: r.matchIndex, matches: r.matches, rounds: r.rounds, scoreA: r.scoreA, scoreB: r.scoreB };
}

/* ── ice cream leaderboards ───────────────────────────────────────────── */

async function iceBoard(kind, n = 50) {
  const rows = await kv.ztop(`w1:board:ice:${kind}`, n);
  const names = await teamNames();
  return Promise.all(rows.map(async (r, i) => {
    const detail = await kv.getJSON(`w1:ice:${kind}:detail:${r.member}`);
    const score = kind === "bank" ? -r.score : r.score; // bankruptcies stored negated (fewer = better)
    return { rank: i + 1, teamId: r.member, name: names[r.member] ?? "???", score, ...detail };
  }));
}

/* ── bandit leaderboards (retired game, kept) ─────────────────────────── */

async function banditBoard(kind, n = 50) {
  const rows = await kv.ztop(`w1:board:bandit:${kind}`, n);
  const names = await teamNames();
  return Promise.all(rows.map(async (r, i) => {
    const detail = await kv.getJSON(`w1:bandit:${kind}:detail:${r.member}`);
    return { rank: i + 1, teamId: r.member, name: names[r.member] ?? "???", score: r.score, ...detail };
  }));
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
      return { games: config, timers: await getTimers(), llm: llmAvailable(), persistent: kv.KV_PERSISTENT };

    case "GET rules":
      return { rules: RULES_TEXT, payoffs: PAYOFFS, match: MATCH, ice: ICE_INFO };

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
    case "POST admin/timer": {
      if (!(await checkAdmin(body.token))) throw httpError(401, "bad admin token");
      const game = body.game;
      if (!GAMES.includes(game)) throw httpError(400, "unknown game");
      const seconds = Number(body.seconds);
      if (!seconds || seconds <= 0) { await kv.del(`w1:timer:${game}`); return { timer: null }; }
      const dur = Math.min(seconds, 7 * 24 * 3600);
      const timer = { endsAt: Date.now() + dur * 1000, duration: dur, startedAt: Date.now() };
      await kv.setJSON(`w1:timer:${game}`, timer);
      return { timer };
    }
    case "POST admin/reset": {
      if (!(await checkAdmin(body.token))) throw httpError(401, "bad admin token");
      const target = body.board;
      if (target === "pd") {
        await kv.del("w1:submit:pd");
        await kv.del("w1:tourney:pd");
        await recomputePd();
      } else if (target === "icecream") {
        await kv.del("w1:board:ice:sharpe");
        await kv.del("w1:board:ice:bank");
      } else if (target === "bandit-manual") await kv.del("w1:board:bandit:manual");
      else if (target === "bandit-algo") await kv.del("w1:board:bandit:algo");
      else throw httpError(400, "unknown board");
      return { ok: true };
    }
    case "POST admin/remove-entry": {
      if (!(await checkAdmin(body.token))) throw httpError(401, "bad admin token");
      const { board, teamId } = body;
      if (board === "pd") { await kv.hdel("w1:submit:pd", teamId); await recomputePd(); }
      else if (board === "ice-sharpe") await kv.zrem("w1:board:ice:sharpe", teamId);
      else if (board === "ice-bank") await kv.zrem("w1:board:ice:bank", teamId);
      else throw httpError(400, "unknown board");
      return { ok: true };
    }
    case "POST admin/recompute": {
      if (!(await checkAdmin(body.token))) throw httpError(401, "bad admin token");
      return { pd: (await recomputePd()).standings };
    }

    /* ── teams ── */
    case "POST team": {
      rateLimit(`team:${query.__ip ?? "anon"}`, 20, 60_000);
      const name = String(body.name ?? "").trim();
      if (name.length < 2 || name.length > 24) throw httpError(400, "team name must be 2–24 characters");
      const s = slug(name);
      if (!s) throw httpError(400, "team name needs some letters or numbers");
      const existing = await kv.get(`w1:teamname:${s}`);
      if (existing) {
        if (body.token === teamToken(existing)) return { teamId: existing, token: body.token, name };
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
      const { teamId } = await requireTeam(body);
      const { game, prompt } = body;
      if (!GAMES.includes(game)) throw httpError(400, "unknown game");
      requireGame(game);
      if (!prompt || String(prompt).trim().length < 3) throw httpError(400, "describe your strategy first");
      rateLimit(`compile:${teamId}`, 10, 60_000);
      const result = await compile(game, String(prompt));
      if (result.refused) return { refused: true, reason: result.reason };
      return { game, code: result.code ?? null, explain: result.explain ?? null, summary: result.summary ?? null, source: result.source };
    }

    case "POST strategy": {
      const { teamId } = await requireTeam(body);
      const game = body.game;
      if (!GAMES.includes(game)) throw httpError(400, "unknown game");
      const prep = game === "pd" ? preparePdCode(body.code)
        : game === "icecream" ? prepareIceCode(body.code)
          : prepareBanditCode(body.code);
      if (!prep.ok) throw httpError(400, `invalid strategy: ${prep.error}`);
      const sid = id(5);
      const strat = {
        id: sid, game,
        name: String(body.name ?? "untitled").trim().slice(0, 32) || "untitled",
        prompt: String(body.prompt ?? "").slice(0, 2000),
        explain: body.explain ? String(body.explain).slice(0, 400) : null,
        summary: body.summary ? String(body.summary).slice(0, 60) : null,
        code: String(body.code),
        createdAt: Date.now(),
      };
      const list = (await kv.getJSON(`w1:strats:${teamId}`)) ?? [];
      if (list.length >= MAX_STRATS) throw httpError(400, `you've saved the maximum of ${MAX_STRATS} strategies — delete some first`);
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
      return { id: sid, name: strat.name };
    }

    case "GET strategies": {
      const { teamId } = await requireTeam(query);
      const list = (await kv.getJSON(`w1:strats:${teamId}`)) ?? [];
      const strats = [];
      for (const sid of list) {
        const s = await kv.getJSON(`w1:strat:${teamId}:${sid}`);
        if (s && (!query.game || s.game === query.game)) strats.push(s);
      }
      const submitted = { pd: (await kv.hgetall("w1:submit:pd"))[teamId] ?? null };
      return { strategies: strats.reverse(), submitted };
    }

    case "POST delete-strategy": {
      const { teamId } = await requireTeam(body);
      const sid = body.strategyId;
      const list = (await kv.getJSON(`w1:strats:${teamId}`)) ?? [];
      if (!list.includes(sid)) throw httpError(404, "no such strategy");
      await kv.del(`w1:strat:${teamId}:${sid}`);
      await kv.setJSON(`w1:strats:${teamId}`, list.filter((x) => x !== sid));
      // if it was the submitted PD bot, pull it from the tournament
      const submitted = (await kv.hgetall("w1:submit:pd"))[teamId];
      if (submitted === sid) { await kv.hdel("w1:submit:pd", teamId); await recomputePd(); }
      return { ok: true };
    }

    /* ── IPD: tournament ── */
    case "POST submit": {
      if (body.game !== "pd") throw httpError(400, "unknown game");
      requireGame("pd");
      const { teamId } = await requireTeam(body);
      rateLimit(`submit:${teamId}`, 15, 60_000);
      const strat = await kv.getJSON(`w1:strat:${teamId}:${body.strategyId}`);
      if (!strat || strat.game !== "pd") throw httpError(400, "no such strategy for this game");
      await kv.hset("w1:submit:pd", teamId, strat.id);
      const tourney = await recomputePd();
      const names = await teamNames();
      return { standings: tourney.standings, updatedAt: tourney.updatedAt, mine: mineView(tourney, `team:${teamId}`, names) };
    }

    case "GET pd/mine": {
      const { teamId } = await requireTeam(query);
      const tourney = await getPdTourney();
      const names = await teamNames();
      return { standings: tourney.standings, updatedAt: tourney.updatedAt, mine: mineView(tourney, `team:${teamId}`, names) };
    }

    case "POST exhibition": {
      // A friendly against the current #1 — watch your bot fight the champion.
      const { teamId, team } = await requireTeam(body);
      if (body.game !== "pd") throw httpError(400, "unknown game");
      requireGame("pd");
      rateLimit(`exh:${teamId}`, 20, 60_000);
      const prep = preparePdCode(body.code);
      if (!prep.ok) throw httpError(400, `invalid strategy: ${prep.error}`);
      const tourney = await getPdTourney();
      const bots = await loadPdBots();
      const top = tourney.standings[0];
      const champ = bots.find((b) => b.id === top?.id) ?? { id: SEED_BOTS.pd[0].id, name: SEED_BOTS.pd[0].name, fn: preparePdCode(SEED_BOTS.pd[0].code).run };
      const you = { id: `x:${sha(body.code).slice(0, 8)}`, name: team.name, fn: prep.run };
      const match = playMatchCode(you, champ, 0);
      return { opponent: { id: champ.id, name: champ.name }, rounds: match.rounds, yourScore: match.scoreA, theirScore: match.scoreB };
    }

    /* ── Ice Cream: simulate ── */
    case "POST ice/run": {
      requireGame("icecream");
      const { teamId } = await requireTeam(body);
      const prep = prepareIceCode(body.code);
      if (!prep.ok) throw httpError(400, `invalid strategy: ${prep.error}`);
      rateLimit(`icerun:${teamId}`, 15, 60_000);
      const r = simulateIce(prep.run);
      const stratName = String(body.name ?? "").slice(0, 32) || null;
      const improvedS = await kv.zaddGT("w1:board:ice:sharpe", r.sharpe, teamId);
      if (improvedS) await kv.setJSON(`w1:ice:sharpe:detail:${teamId}`, { sharpe: r.sharpe, bankruptcies: r.bankruptcies, stratName, at: Date.now() });
      const improvedB = await kv.zaddGT("w1:board:ice:bank", -r.bankruptcies, teamId);
      if (improvedB) await kv.setJSON(`w1:ice:bank:detail:${teamId}`, { bankruptcies: r.bankruptcies, sharpe: r.sharpe, stratName, at: Date.now() });
      return { run: r, newBestSharpe: !!improvedS, newBestBankruptcies: !!improvedB };
    }

    case "GET ice/training":
      return { csv: trainingCsv(), info: ICE_INFO };

    /* ── bandit (retired; gated off by config) ── */
    case "POST bandit/run": {
      requireGame("bandit");
      const { teamId } = await requireTeam(body);
      const prep = prepareBanditCode(body.code);
      if (!prep.ok) throw httpError(400, `invalid strategy: ${prep.error}`);
      rateLimit(`run:${teamId}`, 10, 60_000);
      const stats = runManyCode(prep.run, BASE_SEED, BANDIT.simulations);
      const improved = await kv.zaddGT("w1:board:bandit:algo", stats.avg, teamId);
      if (improved) await kv.setJSON(`w1:bandit:algo:detail:${teamId}`, { score: stats.avg, oraclePct: stats.oraclePct, stratName: String(body.name ?? "").slice(0, 32) || null, at: Date.now() });
      const sample = simulateCode(prep.run, `${BASE_SEED}|w0`, { withHistory: true });
      return { stats, newBest: !!improved, sample: { history: sample.history, total: sample.total } };
    }
    case "POST bandit/manual/start": {
      requireGame("bandit");
      const { teamId } = await requireTeam(body);
      rateLimit(`start:${teamId}`, 30, 60_000);
      const attemptId = id(8);
      const worldSeed = `${BASE_SEED}|manual|${teamId}|${attemptId}`;
      await kv.setJSON(`w1:manual:${attemptId}`, { teamId, worldSeed, choices: [], done: false, at: Date.now() });
      await kv.expire(`w1:manual:${attemptId}`, 24 * 3600);
      return { attemptId, spins: BANDIT.spins, machines: BANDIT.machines };
    }
    case "POST bandit/manual/spin": {
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
      const attempt = await kv.getJSON(`w1:manual:${body.attemptId}`);
      if (!attempt) throw httpError(400, "no such attempt");
      if (attempt.choices.length < BANDIT.spins) throw httpError(400, `finish after all ${BANDIT.spins} spins`);
      const world = makeWorld(attempt.worldSeed);
      const state = makeManualState();
      attempt.choices.forEach((m, t) => applySpin(state, m, round2(payoffAt(attempt.worldSeed, world, t, m))));
      const total = round2(state.total);
      const oraclePct = oraclePctFor(state.total, world);
      const teamId = attempt.teamId;
      if (!attempt.done) {
        attempt.done = true;
        await kv.setJSON(`w1:manual:${body.attemptId}`, attempt);
        const metric = oraclePct == null ? -1000 + total / 1000 : oraclePct;
        const improved = await kv.zaddGT("w1:board:bandit:manual", metric, teamId);
        if (improved) await kv.setJSON(`w1:bandit:manual:detail:${teamId}`, { oraclePct, points: total, at: Date.now() });
        const shownMu = world.mu.map(round2);
        return { total, oraclePct, newBest: !!improved, truth: { mu: shownMu, sigma: world.sigma.map(round2), oracle: round2(BANDIT.spins * Math.max(...shownMu)) } };
      }
      return { total, oraclePct, newBest: false };
    }

    /* ── reads ── */
    case "GET leaderboard": {
      const game = query.game;
      if (game === "pd") {
        const t = await getPdTourney();
        return { standings: t.standings, updatedAt: t.updatedAt };
      }
      if (game === "icecream") {
        return { sharpe: await iceBoard("sharpe"), bankruptcies: await iceBoard("bank") };
      }
      if (game === "bandit") return { manual: await banditBoard("manual"), algo: await banditBoard("algo") };
      throw httpError(400, "unknown game");
    }

    case "GET replay": {
      const t = await getPdTourney();
      return { replay: await topReplay(t, query.match), updatedAt: t.updatedAt };
    }

    case "GET pd/replay": {
      // One team's match vs one opponent, recomputed round-by-round.
      const { teamId } = await requireTeam(query);
      const opp = String(query.opponentId ?? "");
      if (!opp) throw httpError(400, "opponentId required");
      const r = await replayMatch(`team:${teamId}`, opp, query.match);
      if (!r) throw httpError(404, "no such matchup");
      const meIsA = r.a.id === `team:${teamId}`;
      return {
        opponent: meIsA ? r.b : r.a,
        matchIndex: r.matchIndex,
        matches: r.matches,
        yourScore: meIsA ? r.scoreA : r.scoreB,
        theirScore: meIsA ? r.scoreB : r.scoreA,
        rounds: r.rounds.map((x) => (meIsA
          ? { you: x.a, them: x.b, youPts: x.pa, themPts: x.pb }
          : { you: x.b, them: x.a, youPts: x.pb, themPts: x.pa })),
      };
    }

    case "GET board": {
      const pd = await getPdTourney();
      return {
        games: config,
        timers: await getTimers(),
        pd: { standings: pd.standings.slice(0, 12), replay: await topReplay(pd, query.match) },
        icecream: { sharpe: await iceBoard("sharpe", 12), bankruptcies: await iceBoard("bank", 12) },
      };
    }

    default:
      throw httpError(404, `no route: ${method} ${route}`);
  }
}

const MAX_BODY = 256 * 1024; // ice-run responses aside, requests stay tiny

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
