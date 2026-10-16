/**
 * Week 1 — Games of Strategy, solo.
 *
 * The meeting: every team describes a Prisoner's Dilemma bot in plain English,
 * enters it in a round-robin tournament, watches the standings, reads its
 * replays, and resubmits until the clock runs out. A second puzzle, Sunset
 * Scoops, has teams hedge an ice cream shop against the weather.
 *
 * The room, simulated: N bot teams join the same way a team does (POST team),
 * then over the clock they save and submit strategies (POST strategy, POST
 * submit), look at the public standings (GET leaderboard) and decide whether
 * to try something else, and run Sunset Scoops hedges (POST ice/run). They
 * never see another team's code, only what any team sees.
 *
 * The field is modelled on the real Week 1 meeting: pushovers who always
 * cooperate, a bloc that always defects, coin-flippers, reciprocators of
 * several flavours, and a few strong teams that probe and adapt.
 */

// Relative imports only: the headless harness (solo/sim) loads this file in Node.
import { local } from "../shared/local.js";
import { getSeats } from "../shared/api.js";
import { persona, roomSkills, teamNames, rng } from "../shared/bots.js";
import { handle } from "../../week1/server/handler.js";
import { PD, ICE, ICE_LADDERS } from "./strategies.js";

/* ── bots talk to the same handler, each from its own "device" ─────────── */

const clone = (v) => (v === undefined ? {} : JSON.parse(JSON.stringify(v)));
async function as(bot, method, route, body = {}) {
  const query = { __ip: `bot-${bot.i}` };
  if (method === "GET") {
    const [r, qs] = route.split("?");
    Object.assign(query, Object.fromEntries(new URLSearchParams(qs ?? "")), { teamId: bot.teamId, token: bot.token });
    return clone(await handle("GET", r, {}, query));
  }
  return clone(await handle(method, route, clone({ ...body, teamId: bot.teamId, token: bot.token }), query));
}

/* ── storage for the room's own memory (survives a reload) ─────────────── */

const fallback = new Map(); // Node (the sim) or storage blocked
const mem = {
  get(k) {
    try {
      const raw = globalThis.sessionStorage ? globalThis.sessionStorage.getItem(k) : fallback.get(k);
      return JSON.parse(raw ?? fallback.get(k) ?? "null");
    } catch {
      return JSON.parse(fallback.get(k) ?? "null");
    }
  },
  set(k, v) {
    const s = JSON.stringify(v);
    fallback.set(k, s);
    try {
      globalThis.sessionStorage?.setItem(k, s);
    } catch {}
  },
};
const NS = "solo-w1";
const BRAIN = `${NS}:brain`;
const HISTORY = "solo:w1:history"; // localStorage: your record across games

/* ── the playbooks ─────────────────────────────────────────────────────── */

function resolvePd(key) {
  const [name, ...args] = key.split(":");
  const v = PD[name];
  return typeof v === "function" ? v(...args.map(Number)) : v;
}

/**
 * What one bot team will try, in order, in one game. Picked from its persona,
 * so a room at "Casual" is mostly pushovers, defectors and coin-flippers, and
 * a room of "Sharks" is mostly teams that probe and adapt.
 */
function pdPlaybook(P, r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const k = `${P.skill}/${P.kind}`;
  const pct = (lo, hi) => Math.round((lo + (hi - lo) * r()) * 10) / 10;
  switch (k) {
    case "casual/stale":
      return [pick(["allC", "allC", "allC", `random:${pct(0.6, 0.8)}`, "alternate", "tft"])];
    case "casual/anchored":
      return [pick(["allD", "allD", "allC", "allC", `random:${pct(0.7, 0.9)}`])];
    case "casual/gambler":
      return [pick(["allD", `random:${pct(0.3, 0.6)}`, "bully", "joss"]), pick(["allD", `random:${pct(0.4, 0.7)}`, "joss", "bully"]), pick(["allD", "random:0.5"])];
    case "casual/fatfinger":
      return [pick(["every3", "behind", "alternate", "stft", "majority"]), "tft"];
    case "sharp/steady":
      return [pick(["tft", "gtft:0.1", "tf2t", "pavlov", "majority"]), pick(["tftEnd:2", "gtft:0.1", "grim", "tf2t"]), pick(["tftEnd:1", "gtftEnd:0.1:2"])];
    case "sharp/stale":
      return [pick(["tft", "grim", "tf2t", "allD"])];
    case "sharp/anchored":
      return [pick(["grim", "hardRecip", "stft", "allD", "allD"])];
    case "sharp/alpha":
      return ["tftEnd:2", "probe:4:0", "probe:4:2", "gtftEnd:0.1:2"];
    case "shark/alpha":
      return [pick(["tftEnd:3", "probe:3:2"]), "probeSoft:3:2:0.1", pick(["probe:5:3", "probe:2:2"]), "gtftEnd:0.1:3"];
    case "shark/steady":
      return [pick(["probe:4:2", "gtftEnd:0.1:2", "tftEnd:3"]), pick(["probeSoft:4:2:0.1", "probe:3:3"])];
    default:
      return ["tft"];
  }
}

function icePlaybook(P, r) {
  const doesIce = { casual: 0.65, sharp: 0.9, shark: 1 }[P.skill] ?? 0.8;
  if (r() > doesIce) return [];
  const ladders = ICE_LADDERS[P.skill] ?? ICE_LADDERS.sharp;
  const ladder = ladders[Math.floor(r() * ladders.length)];
  // Stale teams stop after their first try.
  return P.kind === "stale" || P.kind === "anchored" ? ladder.slice(0, 1) : ladder;
}

/**
 * The bot's whole game, decided up front from its seed: what it submits,
 * and when (as fractions of the clock). Adaptive bots still choose WHETHER to
 * move on by looking at the standings when the time comes.
 */
function planFor(bot, game) {
  const P = bot.persona;
  const r = rng(`plan|${bot.seed}|g${game}`);
  const j = (lo, hi) => lo + (hi - lo) * r();
  const first = { shark: j(0.02, 0.1), sharp: j(0.04, 0.22), casual: j(0.08, 0.45) }[P.skill] ?? j(0.05, 0.3);
  const gap = P.kind === "alpha" ? () => j(0.1, 0.2) : () => j(0.16, 0.32);
  const pd = pdPlaybook(P, r);
  const pdTimes = [first + (P.kind === "stale" ? j(0.05, 0.2) : 0)];
  for (let i = 1; i < pd.length; i++) pdTimes.push(pdTimes[i - 1] + gap());
  const ice = icePlaybook(P, r);
  const iceTimes = [];
  let t = j(0.12, 0.5);
  for (let i = 0; i < ice.length; i++) iceTimes.push((t += i ? j(0.12, 0.28) : 0));
  return {
    pd,
    pdTimes: pdTimes.map((x) => Math.min(0.96, x)),
    // Strong teams come back near the end and put their best bot back in.
    finalPush: P.kind === "alpha" || (P.skill === "shark" && P.kind === "steady") ? j(0.88, 0.96) : null,
    ice,
    iceTimes: iceTimes.filter((x) => x < 0.97),
  };
}

/* ── the adapter ───────────────────────────────────────────────────────── */

const clockOf = (cfg) => Math.max(1, Number(cfg?.clock) || 15) * 60;

const room = {
  week: 1,
  title: "Games of Strategy",
  blurb:
    "Describe a Prisoner's Dilemma bot in plain English, enter it in a round-robin against every other team, and keep improving it before the clock runs out. Bonus puzzle: keep an ice cream shop from going bankrupt by hedging the weather.",
  howTo: [
    "Each round both bots secretly COOPERATE or DEFECT. Both cooperate: 3 each. One defects: 5 to the defector, 0 to the other. Both defect: 1 each.",
    "Your bot plays 200 rounds against every other team's bot, 5 times over. It never learns who it is playing, only what they do.",
    "The board ranks average points per match. Read your replays, figure out who's out there, and resubmit.",
    "There is no AI in solo mode: a built-in reader turns your plain English into the bot. Check what it says your bot will do.",
  ],
  botTeams: { min: 5, max: 19, def: 11 },
  settings: [
    {
      key: "clock",
      label: "Clock",
      type: "seg",
      def: 15,
      options: [
        { v: 8, l: "8 min" },
        { v: 15, l: "15 min" },
        { v: 25, l: "25 min" },
      ],
    },
    {
      key: "games",
      label: "Games",
      type: "seg",
      def: "both",
      options: [
        { v: "both", l: "Dilemma + Scoops" },
        { v: "pd", l: "Just the Dilemma" },
      ],
    },
  ],
  configRoute: "config",
  roundOf(c) {
    return { ...c, at: Date.now() };
  },

  async setup({ admin, cfg, you, botTeams, level, seed }) {
    const both = cfg.games !== "pd";
    await local.post("admin/config", { token: admin, games: { pd: true, icecream: both } });
    await local.post("admin/reset", { token: admin, board: "pd" });
    await local.post("admin/reset", { token: admin, board: "icecream" });

    // Your team. With a friend, you're one team with both names on it.
    const teamName = (you.length > 1 ? `${you[0]} & ${you[1]}` : you[0]).slice(0, 24);
    const mine = await local.post("team", { name: teamName });
    rememberTeamName(mine.teamId, mine.name);
    const seats = you.map((name) => ({ playerId: mine.teamId, token: mine.token, name }));

    // The other teams.
    const skills = roomSkills(level, botTeams, seed);
    const names = teamNames(botTeams + 4, seed);
    const taken = new Set([slug(teamName)]);
    const bots = [];
    for (let i = 0; i < botTeams; i++) {
      let name = names.find((n) => !taken.has(slug(n))) ?? `Team ${i + 1}`;
      taken.add(slug(name));
      const t = await handle("POST", "team", { name }, { __ip: `bot-${i}` });
      bots.push({ i, teamId: t.teamId, token: t.token, name, seed: `${seed}|${i}`, persona: persona(skills[i], `${seed}|${i}`) });
    }
    resetBrain(1);
    return { seats, bots, extra: { teamName, teamId: mine.teamId } };
  },

  /** Nothing to do: both seats ARE the team. */
  async afterSeat() {},

  bots({ meta }) {
    return new RoomRunner(meta);
  },

  controls({ round, admin, meta }) {
    if (!round) return [];
    const ph = phaseOf(round);
    const games = enabledGames(round);
    if (ph.phase === "lobby") {
      return [
        {
          key: "start",
          label: "Start the clock",
          primary: true,
          hint: `${clockOf(meta.cfg) / 60} minutes. You can enter and change your bot any time before it runs out.`,
          run: async () => {
            for (const g of games) await admin("timer", { game: g, seconds: clockOf(meta.cfg) });
            return null;
          },
        },
      ];
    }
    if (ph.phase === "live") {
      return [
        {
          key: "more",
          label: "+5 min",
          hint: "Give everyone five more minutes",
          run: async () => {
            const left = Math.max(0, Math.round((ph.endsAt - Date.now()) / 1000));
            for (const g of games) await admin("timer", { game: g, seconds: left + 300 });
            return null;
          },
        },
        {
          key: "end",
          label: "End now",
          hint: "Stop the clock and show the results",
          run: async () => {
            if (typeof window !== "undefined" && !window.confirm("Stop the clock now? The current standings become the final result.")) return null;
            for (const g of games) await admin("timer", { game: g, seconds: 1 });
            return null;
          },
        },
      ];
    }
    return [
      {
        key: "again",
        label: "Play again",
        primary: true,
        hint: "Same teams, fresh boards. Everyone (you too) starts with no bot entered; your saved bots are kept.",
        run: async () => {
          await admin("reset", { board: "pd" });
          await admin("reset", { board: "icecream" });
          for (const g of ["pd", "icecream"]) await admin("timer", { game: g, seconds: 0 });
          const b = loadBrain();
          resetBrain((b?.game ?? 1) + 1);
          live.standings = null;
          live.ice = null;
          live.feed = [];
          return { remount: true };
        },
      },
    ];
  },

  status({ round, meta }) {
    if (!round) return "";
    const ph = phaseOf(round);
    const seat = getSeats()[0];
    const myId = seat?.playerId;
    const teams = (meta.bots?.length ?? 0) + 1;
    if (ph.phase === "lobby") return `Lobby · ${teams - 1} teams here · write a bot, then start the clock`;
    const pd = rankOf(live.standings, myId);
    if (ph.phase === "live") {
      const left = Math.max(0, Math.ceil((ph.endsAt - Date.now()) / 1000));
      const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      const entered = (live.standings ?? []).filter((s) => !s.seed).length;
      const me = pd ? `you're #${pd.rank} of ${pd.of}` : "no bot entered yet";
      return `${clock} left · ${me}${entered < teams ? ` · ${entered}/${teams} in` : ""}`;
    }
    const res = live.final;
    if (!res) return "Time! Tallying…";
    const bits = [res.pdRank ? `you finished #${res.pdRank} of ${res.pdOf}` : "you didn't enter a bot"];
    if (res.iceRank) bits.push(`Scoops #${res.iceRank} (${res.bankruptcies} bankruptcies)`);
    return `Time! ${bits.join(" · ")}`;
  },
};

export default room;

/* ── phase, ranks, names ───────────────────────────────────────────────── */

/**
 * Only the tournament runs on the clock. (When two clocks end together the
 * original app's reveal shows whichever it set last, which is Sunset Scoops;
 * the tournament is the one people want to see on the podium.) Scoops stays
 * open the whole time and its board is shown in the final result.
 */
function enabledGames(round) {
  return ["pd"].filter((g) => round?.games?.[g]);
}

export function phaseOf(round) {
  const timers = enabledGames(round).map((g) => round.timers?.[g]).filter(Boolean);
  if (!timers.length) return { phase: "lobby" };
  const endsAt = Math.max(...timers.map((t) => t.endsAt));
  const startedAt = Math.min(...timers.map((t) => t.startedAt));
  return { phase: Date.now() < endsAt ? "live" : "over", endsAt, startedAt };
}

function rankOf(standings, teamId) {
  if (!standings || !teamId) return null;
  const rows = standings.filter((s) => !s.seed);
  const i = rows.findIndex((s) => s.id === `team:${teamId}`);
  return i < 0 ? null : { rank: i + 1, of: rows.length, avg: rows[i].avg };
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function rememberTeamName(teamId, name) {
  const all = mem.get(`${NS}:names`) ?? {};
  all[teamId] = name;
  mem.set(`${NS}:names`, all);
}

/* ── the room's memory ─────────────────────────────────────────────────── */

function loadBrain() {
  return mem.get(BRAIN);
}
function resetBrain(game) {
  mem.set(BRAIN, { game, bots: {}, recorded: false });
}
function saveBrain(b) {
  mem.set(BRAIN, b);
}

/** What the host's bar and the floor strip read: refreshed from public routes only. */
export const live = { standings: null, ice: null, feed: [], final: null, version: 0 };

export function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY)) ?? [];
  } catch {
    return [];
  }
}

/* ── the runner ────────────────────────────────────────────────────────── */

/**
 * One clock for the whole room. Every second: refresh the public standings,
 * then let any bot whose moment has come take its turn. Times are fractions
 * of the clock, measured from when the host started it, so a reload resumes
 * the same room at the same point.
 */
export class RoomRunner {
  static speed = 1;
  constructor(meta, { now = () => Date.now() } = {}) {
    this.meta = meta;
    this.now = now;
    this.timer = null;
    this.running = false;
    this.busy = false;
  }
  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      await this.tick().catch((e) => console.warn("[room]", e?.message ?? e));
      if (this.running) this.timer = setTimeout(loop, 1000 / RoomRunner.speed);
    };
    loop();
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const c = await local.get("config");
      const ph = phaseOf(c);
      await this.refresh(c);
      if (ph.phase === "live") await this.turns((this.now() - ph.startedAt) / ((ph.endsAt - ph.startedAt) || 1), ph);
      else if (ph.phase === "over") await this.record(c);
      else live.final = null;
    } finally {
      this.busy = false;
    }
  }

  async refresh(c) {
    const myId = getSeats()[0]?.playerId;
    const pd = await local.get("leaderboard?game=pd").catch(() => null);
    if (pd?.standings) {
      const before = new Set((live.standings ?? []).map((s) => s.id));
      const prevRank = rankOf(live.standings, myId)?.rank;
      if (live.standings) {
        for (const s of pd.standings) {
          if (!before.has(s.id) && !s.seed && s.id !== `team:${myId}`) pushFeed(`${s.name} entered the tournament`);
        }
      }
      live.standings = pd.standings;
      const r = rankOf(pd.standings, myId);
      if (r && prevRank && r.rank !== prevRank) pushFeed(r.rank < prevRank ? `You moved up to #${r.rank}` : `You slipped to #${r.rank}`, r.rank < prevRank ? "up" : "down");
    }
    if (c.games?.icecream) {
      const ice = await local.get("leaderboard?game=icecream").catch(() => null);
      if (ice?.bankruptcies) live.ice = ice.bankruptcies;
    }
    live.version++;
  }

  /** Bots whose moment has come take a turn, one at a time. */
  async turns(frac, ph) {
    const brain = loadBrain() ?? { game: 1, bots: {}, recorded: false };
    if (brain.recorded) {
      brain.recorded = false; // the host gave more time
      live.final = null;
    }
    let acted = 0;
    for (const bot of this.meta.bots) {
      if (acted >= 1) break; // spread the work: a tournament re-run blocks the tab for a moment
      const st = (brain.bots[bot.teamId] ??= { pdStep: 0, iceStep: 0, tried: [], pushed: false, cleaned: false });
      const plan = planFor(bot, brain.game);
      if (!st.cleaned) {
        // A new game: clear out last game's saved strategies (their own list).
        st.cleaned = true;
        await cleanOld(bot).catch(() => {});
      }
      if (st.pdStep < plan.pd.length && frac >= plan.pdTimes[st.pdStep]) {
        await pdTurn(bot, st, plan).catch((e) => warn(bot, e));
        acted++;
      } else if (plan.finalPush != null && !st.pushed && frac >= plan.finalPush && st.tried.length > 1) {
        st.pushed = true;
        await finalPush(bot, st).catch((e) => warn(bot, e));
        acted++;
      } else if (st.iceStep < plan.ice.length && frac >= plan.iceTimes[st.iceStep]) {
        if (ph && (await local.get("config")).games?.icecream) await iceTurn(bot, st, plan).catch((e) => warn(bot, e));
        else st.iceStep = plan.ice.length;
        acted++;
      }
      brain.bots[bot.teamId] = st;
    }
    saveBrain(brain);
  }

  /** Time's up: write down how you did, once per game. */
  async record(c) {
    const brain = loadBrain() ?? { game: 1, bots: {}, recorded: false };
    const myId = getSeats()[0]?.playerId;
    const pd = rankOf(live.standings, myId);
    const iceRows = live.ice ?? [];
    const ii = iceRows.findIndex((r) => r.teamId === myId);
    const res = {
      at: Date.now(),
      game: brain.game,
      level: this.meta.level,
      teams: this.meta.bots.length + 1,
      pdRank: pd?.rank ?? null,
      pdOf: pd?.of ?? (live.standings ?? []).filter((s) => !s.seed).length,
      pdAvg: pd?.avg ?? null,
      winner: (live.standings ?? []).find((s) => !s.seed)?.name ?? null,
      iceRank: ii >= 0 ? ii + 1 : null,
      iceOf: iceRows.length,
      bankruptcies: ii >= 0 ? iceRows[ii].score : null,
    };
    live.final = res;
    if (brain.recorded) return;
    brain.recorded = true;
    saveBrain(brain);
    try {
      const h = readHistory();
      h.push(res);
      localStorage.setItem(HISTORY, JSON.stringify(h.slice(-50)));
    } catch {}
  }
}

function warn(bot, e) {
  if (!e?.status || e.status >= 500) console.warn(`[team ${bot.name}]`, e?.message ?? e);
}

function pushFeed(text, tone = "") {
  live.feed.push({ text, tone, at: Date.now() });
  if (live.feed.length > 6) live.feed.shift();
}

/* ── one team's turns ──────────────────────────────────────────────────── */

async function cleanOld(bot) {
  const res = await as(bot, "GET", "strategies");
  for (const s of res.strategies ?? []) await as(bot, "POST", "delete-strategy", { strategyId: s.id });
}

async function saveAndSubmit(bot, key) {
  const s = resolvePd(key);
  const saved = await as(bot, "POST", "strategy", { game: "pd", name: s.name, prompt: s.prompt, code: s.code, explain: s.explain, summary: s.summary });
  const out = await as(bot, "POST", "submit", { game: "pd", strategyId: saved.id });
  const me = out.standings.find((x) => x.id === `team:${bot.teamId}`);
  return { id: saved.id, avg: me?.avg ?? null };
}

async function pdTurn(bot, st, plan) {
  const P = bot.persona;
  const key = plan.pd[st.pdStep];
  if (st.pdStep === 0) {
    const r = await saveAndSubmit(bot, key);
    st.tried.push({ key, id: r.id, avg: r.avg });
    st.pdStep++;
    return;
  }
  // Later visits: look at the public board, then decide.
  const board = await as(bot, "GET", "leaderboard?game=pd");
  const rows = board.standings.filter((s) => !s.seed);
  const i = rows.findIndex((s) => s.id === `team:${bot.teamId}`);
  const cur = st.tried[st.tried.length - 1];
  if (cur && i >= 0) cur.avg = rows[i].avg; // what the current bot is scoring now
  const bottomHalf = i < 0 || i >= rows.length / 2;
  const r = rng(`${bot.seed}|turn|${st.pdStep}|${st.tried.length}`);
  let go;
  if (P.kind === "alpha") go = true; // always testing the next idea
  else if (P.kind === "gambler") go = r() < 0.6;
  else if (P.kind === "fatfinger") go = bottomHalf && r() < 0.7;
  else if (P.kind === "steady") go = bottomHalf || r() < 0.25;
  else go = false;
  st.pdStep++;
  if (!go) return;
  const res = await saveAndSubmit(bot, key);
  // Alphas keep the better of the last two (judged on today's board, as a person would).
  if (P.kind === "alpha" && cur?.avg != null && res.avg != null && res.avg < cur.avg - 2) {
    await as(bot, "POST", "submit", { game: "pd", strategyId: cur.id });
    st.tried.push({ key, id: res.id, avg: res.avg, reverted: true });
    return;
  }
  st.tried.push({ key, id: res.id, avg: res.avg });
}

/** Near the end, a strong team puts back whichever of its bots scored best. */
async function finalPush(bot, st) {
  const board = await as(bot, "GET", "leaderboard?game=pd");
  const me = board.standings.find((s) => s.id === `team:${bot.teamId}`);
  const best = [...st.tried].filter((t) => t.avg != null).sort((a, b) => b.avg - a.avg)[0];
  const sub = await as(bot, "GET", "strategies");
  if (best && sub.submitted?.pd !== best.id && (me?.avg ?? 0) < best.avg) await as(bot, "POST", "submit", { game: "pd", strategyId: best.id });
}

async function iceTurn(bot, st, plan) {
  const key = plan.ice[st.iceStep];
  st.iceStep++;
  const s = ICE[key];
  if (!s) return;
  await as(bot, "POST", "ice/run", { code: s.code, name: s.summary });
}
