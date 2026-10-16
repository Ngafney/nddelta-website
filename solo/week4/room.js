/**
 * Week 4 — Monte Carlo (HIT or MISS), solo.
 *
 * The room: a rock, a handful of sightings, two books, and N bot teams who
 * are each doing what a team at the meeting does with the same data. Every bot
 * is an ordinary player: it joins, sits on a team, reads the sightings
 * through its own `GET data`, works out P(hit) its own way, and trades through
 * `POST order`. Nobody reads the truth.
 *
 * What makes the room worth trading in is that the teams do NOT all do the
 * same thing with the data, and each way of getting it wrong is one a real
 * room shows:
 *
 *   clean    fit, check the residuals, drop the blunders, sample hundreds of
 *            orbits from the fit, count hits. The right answer. (alpha bots,
 *            on the full sample; steady ones on forty of it, so noisier)
 *   raw      the same, but trusts every sighting. About one in twenty-five is
 *            a blunder, and on a short arc one of them moves P(hit) from 30%
 *            to nothing. Right when the data is honest, badly wrong when not.
 *   phi      took twenty-odd refits, a mean and a spread of the miss distance,
 *            and read P(miss < R) off a normal curve. A miss distance is not a
 *            normal variable, so this is reliably, confidently off.
 *   anchored worked it out properly on the first batch and barely moves after.
 *   nominal  one best fit, no Monte Carlo: "it misses by 8,000 km, so no".
 *
 * And they are slow in different ways: when a batch lands, the alpha teams
 * reprice in seconds, the rest take a while, and the stale ones leave their
 * old quotes sitting in the book. That gap is where a fast player eats.
 */

// Relative imports only: the headless harness (solo/sim) loads this file in Node.
import { local } from "../shared/local.js";
import { getSeats } from "../shared/api.js";
import { Runner, persona, roomSkills, botNames, teamNames, rng, gauss, auth, joinAs, requote, takeIfCheap, blend, inventorySkew, mood, anchor, fatFinger } from "../shared/bots.js";
import * as kv from "../../week4/server/kv.js";
import { newMarket, newPlayer } from "../../week4/shared/engine.js";
import { BOTS, MONEY, LIMITS } from "../../week4/shared/rules.js";
import { RELEASE_COUNTS, RELEASE_ARCS, T_ENCOUNTER } from "../../week4/shared/round.js";
import { pHit, phiShortcut } from "./sky.js";
import { analysisFor, takeSpec } from "./compute.js";

const MARKETS = ["north", "south"]; // north is HIT, south is MISS (week4/shared/rules.js)

/* ── pace ──────────────────────────────────────────────────────────────── */

export const PACES = {
  quick: { research: 1, trading: 6 },
  normal: { research: 2, trading: 10 },
  long: { research: 4, trading: 16 },
};
const paceOf = (cfg) => PACES[cfg?.pace] ?? PACES.normal;

/* ── installing a round (what POST admin/round does, minus the slow half) ── */

const MKT = "w4:mkt";
const MKTV = "w4:mkt:v";
const SPEC = (roundId) => `w4:sky:${roundId}`;
const BOT_PID = "survey-desk";

const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

/** Minor-planet style names, so each rock in a session has its own. */
const LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXY";
export function designation(i) {
  if (i === 0) return "2027 QX"; // the meeting's rock
  const r = rng(`desig|${i}|${Date.now()}`);
  const a = LETTERS[Math.floor(r() * LETTERS.length)];
  const b = LETTERS[Math.floor(r() * LETTERS.length)];
  const n = r() < 0.6 ? String(1 + Math.floor(r() * 120)) : "";
  return `2027 ${a}${b}${n}`;
}

/**
 * Put a built rock in the store exactly the way week4's buildRound does: the
 * spec under its own key (the secret), and a fresh market document, carrying
 * the players and teams across when `keepPlayers` is set.
 */
export async function installRound(spec, { keepPlayers = false, tradingMinutes = 10, eventName = "2027 QX" } = {}) {
  const roundId = hex(10);
  const prevRaw = (await kv.casGet(MKT, MKTV)).value;
  const prev = prevRaw ? JSON.parse(prevRaw) : null;
  await kv.setJSON(SPEC(roundId), spec);
  const now = Date.now();
  const state = newMarket({
    roundId,
    startCashC: MONEY.startCashC,
    defaultSize: LIMITS.defaultOrderSize,
    lateJoin: true,
    question: "Does it HIT the Earth, or MISS?",
  });
  state.releases = spec.releases.map((r) => ({ index: r.index, sightings: r.sightings }));
  state.released = 0;
  state.releaseLog = [];
  state.eventName = eventName;
  state.tradingMinutes = tradingMinutes;
  // The meeting's survey desk: four takers, eight shares every 45 s. It never quotes.
  state.bots = BOTS.slots.map((sl) => ({ key: sl.key, market: sl.market, side: sl.side, on: true, shares: 8, everySec: 45, nextAt: null, sent: 0, fills: 0 }));
  if (keepPlayers && prev) {
    for (const p of Object.values(prev.players)) {
      if (p.id === BOT_PID) continue;
      state.players[p.id] = newPlayer(p.id, p.name, p.device, state.startCashC, now);
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
  for (let i = 0; i < 20; i++) {
    const cur = await kv.casGet(MKT, MKTV);
    const res = await kv.casSet(MKT, MKTV, cur.version, JSON.stringify(state), String((Number(cur.version) || 0) + 1));
    if (res.ok) break;
  }
  if (prev?.roundId && prev.roundId !== roundId) await kv.del(SPEC(prev.roundId));
  return roundId;
}

/* ── the session: one rock after another ───────────────────────────────── */

const TALLY = (ns) => `${ns}:tally`;
export function readTally(ns) {
  try {
    return JSON.parse(sessionStorage.getItem(TALLY(ns))) ?? [];
  } catch {
    return [];
  }
}
function writeTally(ns, list) {
  try {
    sessionStorage.setItem(TALLY(ns), JSON.stringify(list));
  } catch {}
}
const AUTO = (ns) => `${ns}:auto`;
function autoOn(ns, cfg) {
  try {
    const v = sessionStorage.getItem(AUTO(ns));
    if (v != null) return v === "1";
  } catch {}
  return cfg?.batches !== "click";
}
function setAuto(ns, on) {
  try {
    sessionStorage.setItem(AUTO(ns), on ? "1" : "0");
  } catch {}
}

const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const dollars = (c) => `${c < 0 ? "−" : "+"}$${Math.abs(Math.round(c / 100)).toLocaleString("en-US")}`;
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/* ── the adapter ───────────────────────────────────────────────────────── */

const room = {
  week: 4,
  title: "Hit or Miss",
  blurb:
    "A telescope has caught an asteroid a few times. Does it hit the Earth on its next pass? Two books, HIT and MISS, and exactly one pays $100 a share. More sightings arrive as you trade.",
  howTo: [
    "Make your team, then hand out the sightings. The DATA tab has every number the room has.",
    "Fit an orbit, jitter it inside the error bars, fly each copy past the Earth and count the hits. That fraction is what HIT is worth. There is no formula.",
    "The books open empty. Post prices, take the ones that are wrong. HIT plus MISS should be about 100.",
    "New batches of sightings land during trading. Some sightings are blunders, and not every team in the room notices.",
  ],
  botTeams: { min: 3, max: 14, def: 7 },
  settings: [
    {
      key: "pace",
      label: "Round length",
      type: "seg",
      def: "normal",
      options: [
        { v: "quick", l: "Quick (7 min)" },
        { v: "normal", l: "Normal (12 min)" },
        { v: "long", l: "Long (20 min)" },
      ],
      hint: (v) => {
        const p = PACES[v] ?? PACES.normal;
        return `${p.research} min with the first sightings before the books open, then ${p.trading} min of trading.`;
      },
    },
    {
      key: "batches",
      label: "New sightings arrive",
      type: "seg",
      def: "clock",
      options: [
        { v: "clock", l: "On a clock" },
        { v: "click", l: "When I click" },
      ],
      hint: "Six batches in all. On a clock, the last lands with a sixth of the round to go.",
    },
  ],

  async setup({ admin, cfg, you, botTeams, level, seed, ns }) {
    await local.post("admin/reset", { token: admin, confirm: "RESET" });
    const spec = await takeSpec();
    await installRound(spec, { tradingMinutes: paceOf(cfg).trading, eventName: designation(0) });
    try {
      sessionStorage.removeItem(TALLY(ns));
      sessionStorage.removeItem(AUTO(ns));
    } catch {}
    // Your seats. The floor's own gate makes your team.
    const seats = [];
    for (let i = 0; i < you.length; i++) {
      const j = await local.post("join", { name: you[i], deviceId: `solo-w4-you-${i}-${seed}`, fp: "solo0000" });
      seats.push({ ...j, name: you[i] });
    }
    // The bot teams: one or two traders each, each with a way of working.
    const skills = roomSkills(level, botTeams * 2, seed);
    const tn = teamNames(botTeams, seed);
    const names = botNames(botTeams * 2, seed);
    const r = rng(`teams|${seed}`);
    const bots = [];
    let k = 0;
    for (let t = 0; t < botTeams; t++) {
      const members = r() < 0.35 ? 2 : 1;
      let team = null;
      for (let m = 0; m < members; m++) {
        const name = names[k] ?? `Trader${k}`;
        const p = await joinAs(name, `solo-w4-bot-${k}-${seed}`);
        if (!team) team = (await local.post("team/create", auth(p, { name: tn[t] }))).team;
        else await local.post("team/join", auth(p, { code: team.code }));
        const P = persona(skills[k], `${seed}|${k}`);
        bots.push({ playerId: p.playerId, token: p.token, name, persona: P, brain: brainFor(P, `${seed}|${k}`) });
        k++;
      }
    }
    return { seats, bots };
  },

  /** The friend, once you have a team: put them on it. */
  async afterSeat(seats) {
    if (seats.length < 2) return;
    const s0 = await local.get("state", { playerId: seats[0].playerId, token: seats[0].token }).catch(() => null);
    const s1 = await local.get("state", { playerId: seats[1].playerId, token: seats[1].token }).catch(() => null);
    if (s0?.team?.code && s1 && !s1.team) await local.post("team/join", auth(seats[1], { code: s0.team.code })).catch(() => {});
  },

  bots({ meta, ns }) {
    const runner = new Runner(meta.bots, (b) => step(b, meta));
    const admin = (route, body = {}) => local.post(`admin/${route}`, { ...body, token: meta.admin });
    // The host's own clockwork: the friend's seat, the batches on a timer, and the session's scores.
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await room.afterSeat(getSeats());
        const c = await local.get("config");
        const round = c.round;
        if (round?.status === "live" && autoOn(ns, meta.cfg) && round.released < round.releaseCount) {
          const every = (round.endsAt - round.startedAt) / round.releaseCount;
          const due = Math.min(round.releaseCount, 1 + Math.floor((round.serverNow - round.startedAt) / every));
          if (round.released < due) await admin("release").catch(() => {});
        }
        if (round?.status === "settled") await recordRound(ns, round);
      } catch {}
      busy = false;
    };
    const timer = setInterval(tick, 1000);
    const stop = runner.stop.bind(runner);
    runner.stop = () => {
      clearInterval(timer);
      stop();
    };
    return runner;
  },

  controls({ round, admin, meta, ns }) {
    if (!round) return [];
    const pace = paceOf(meta.cfg);
    if (round.status === "lobby") {
      return [
        {
          key: "start",
          label: "Hand out the sightings",
          primary: true,
          hint: `Batch 1 goes out; the books open in ${pace.research} min`,
          run: async () => {
            const seats = getSeats();
            const s0 = await local.get("state", { playerId: seats[0]?.playerId, token: seats[0]?.token }).catch(() => null);
            if (!s0?.team) return { note: "Make your team first: CREATE TEAM on the screen below." };
            await admin("start", { minutes: pace.research });
            return null;
          },
        },
      ];
    }
    if (round.status === "research") {
      return [{ key: "open", label: "Open trading now", primary: true, hint: "Skip the rest of the research window", run: () => admin("open", { minutes: pace.trading }) }];
    }
    if (round.status === "live") {
      const auto = autoOn(ns, meta.cfg);
      const more = round.released < round.releaseCount;
      return [
        { key: "next", label: more ? `Release batch ${round.released + 1}` : "All batches out", primary: !auto && more, disabled: !more, run: () => admin("release") },
        {
          key: "auto",
          label: auto ? "Batches: on a clock" : "Batches: when I click",
          on: auto,
          hint: "Switch between timed batches and releasing them yourself",
          run: async () => {
            setAuto(ns, !auto);
            return null;
          },
        },
        { key: "end", label: "End round now", hint: "Shut the books and watch it arrive", run: () => admin("end") },
      ];
    }
    if (round.status === "ended") return [];
    return [
      {
        key: "again",
        label: "Another rock",
        primary: true,
        hint: "Same teams, a new asteroid",
        run: async () => {
          const spec = await takeSpec();
          await installRound(spec, { keepPlayers: true, tradingMinutes: pace.trading, eventName: designation(readTally(ns).length) });
          // The server keeps the last round cached for 300 ms; let it lapse.
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 400));
            const ok = await admin("start", { minutes: pace.research }).then(() => true, () => false);
            if (ok) break;
          }
          return { remount: true };
        },
      },
      {
        key: "session",
        label: "Session",
        hint: "How you have done across rocks",
        run: async () => ({ note: sessionLine(readTally(ns)) }),
      },
    ];
  },

  status({ round, ns, meta }) {
    if (!round) return "";
    const now = round.serverNow ?? Date.now();
    if (round.status === "lobby") return `Lobby · ${round.teams} teams · make yours`;
    if (round.status === "research") return `Research · books open in ${mmss(round.endsAt - now)}`;
    if (round.status === "live") {
      if (round.released >= round.releaseCount) return `All ${round.releaseCount} batches out`;
      const every = (round.endsAt - round.startedAt) / round.releaseCount;
      const nextAt = round.startedAt + round.released * every;
      return autoOn(ns, meta?.cfg) ? `Batch ${round.released} of ${round.releaseCount} · next ${mmss(nextAt - now)}` : `Batch ${round.released} of ${round.releaseCount}`;
    }
    if (round.status === "ended") return "Books shut · it is arriving";
    const t = readTally(ns).find((x) => x.roundId === round.roundId);
    const verdict = round.winner === "north" ? "IT HIT" : "IT MISSED";
    return t ? `${verdict} · you came ${ord(t.rank)} of ${t.of}` : verdict;
  },
};

export default room;

function sessionLine(list) {
  if (!list.length) return "No rocks finished yet this session.";
  const tot = list.reduce((a, x) => a + x.pnlC, 0);
  const wins = list.filter((x) => x.rank === 1).length;
  const best = list.reduce((a, x) => (x.pnlC > a.pnlC ? x : a), list[0]);
  const ranks = list.map((x) => ord(x.rank)).join(", ");
  return `${list.length} rock${list.length > 1 ? "s" : ""} · finishes ${ranks} · ${wins} win${wins === 1 ? "" : "s"} · total ${dollars(tot)} · best ${dollars(best.pnlC)} on ${best.rock}`;
}

let recording = null;
async function recordRound(ns, round) {
  const list = readTally(ns);
  if (list.some((x) => x.roundId === round.roundId) || recording === round.roundId) return;
  recording = round.roundId;
  try {
    const seat = getSeats()[0];
    const s = await local.get("state", { playerId: seat.playerId, token: seat.token });
    const lb = (await local.get("leaderboard")).leaderboard ?? [];
    const i = lb.findIndex((r) => r.id === s.team?.id);
    if (i < 0) return;
    list.push({ roundId: round.roundId, rock: round.eventName, hit: round.winner === "north", rank: i + 1, of: lb.length, pnlC: lb[i].valueC - lb[i].startC, top: lb[0]?.name });
    writeTally(ns, list);
  } finally {
    recording = null;
  }
}

/* ── the bots' brains ──────────────────────────────────────────────────── */

/**
 * How a persona uses the data, and how long it takes to get to it after a
 * batch lands. Fixed per bot, so the room keeps its character all session.
 */
export function brainFor(P, seed) {
  const r = rng(`brain|${seed}`);
  const pick = (opts) => {
    let x = r();
    for (const [v, w] of opts) if ((x -= w) <= 0) return v;
    return opts[opts.length - 1][0];
  };
  const lag = (lo, hi) => Math.round((lo + (hi - lo) * r()) * 1000);
  switch (P.kind) {
    case "alpha":
      return { method: "clean", samples: 0, lagMs: lag(0, 4), both: true };
    case "steady":
      return { method: pick([["clean", 0.65], ["raw", 0.35]]), samples: 40, lagMs: lag(8, 25), both: r() < 0.5 };
    case "anchored":
      return { method: "clean", samples: 40, lagMs: lag(10, 30), both: false };
    case "stale":
      return { method: pick([["phi", 0.7], ["raw", 0.3]]), samples: 30, lagMs: lag(25, 60), both: false };
    case "fatfinger":
      return { method: pick([["raw", 0.6], ["phi", 0.4]]), samples: 60, lagMs: lag(10, 30), both: false };
    case "gambler":
    default:
      return { method: pick([["nominal", 0.6], ["phi", 0.4]]), samples: 30, lagMs: lag(15, 40), both: false };
  }
}

const clampP = (p) => Math.max(0.01, Math.min(0.99, p));
const logit = (p) => Math.log(p / (1 - p));
const unlogit = (x) => 1 / (1 + Math.exp(-x));

/** A bot's own random subset of the room's samples: its own, smaller, Monte Carlo. */
function subset(xs, n, seed) {
  if (!xs?.length) return null;
  if (!n || n >= xs.length) return xs;
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.floor(r() * xs.length)]);
  return out;
}

/** What this bot's method makes of one release's analysis. */
export function methodP(brain, a, seed) {
  if (!a) return null;
  const R = a.radiusKm;
  switch (brain.method) {
    case "clean":
      return pHit(subset(a.clean, brain.samples, seed));
    case "raw":
      return pHit(subset(a.raw, brain.samples, seed));
    case "phi":
      return a.clean ? phiShortcut(subset(a.clean, brain.samples, seed), R, brain.samples || 30) : null;
    case "nominal":
      // "It misses by 9,000 km": one orbit, a confident answer.
      return a.nominalKm == null ? null : unlogit(-(a.nominalKm - R) / 1500);
    default:
      return null;
  }
}

const memory = new Map(); // per bot: this round's private misreading, first impressions, last data seen

function mem(bot, roundId) {
  let m = memory.get(bot.playerId);
  if (!m || m.roundId !== roundId) {
    m = { roundId, bias: gauss(rng(`bias|${bot.playerId}|${roundId}`)), first: new Map(), seen: 0, data: new Map() };
    memory.set(bot.playerId, m);
  }
  return m;
}

/**
 * This bot's P(hit) right now: the newest batch it has had time to work
 * through, by its own method, with its own slant.
 */
export function belief(bot, M, round) {
  const P = bot.persona;
  const B = bot.brain;
  const now = Date.now();
  for (let r = round.released; r >= 1; r--) {
    const d = M.data.get(r);
    if (!d) continue;
    const c = analysisFor(`${round.roundId}|${r}`, d);
    const a = P.kind === "alpha" ? c.full ?? c.partial : c.full;
    const at = P.kind === "alpha" ? (c.full ? c.fullAt : c.partialAt) : c.fullAt;
    if (!a || now - at < B.lagMs) continue;
    const p0 = methodP(B, a, `${bot.playerId}|${round.roundId}|${r}`);
    if (p0 == null) continue;
    // Its own misreading, shrinking as the arc lengthens.
    const slant = M.bias * P.noise * 0.6 * Math.max(0.3, 1 - 0.12 * (r - 1));
    let p = unlogit(logit(clampP(p0)) + slant);
    p = anchor(M.first, "p", p, P.stick);
    return { p: clampP(p), release: r };
  }
  return null;
}

/* ── one bot's turn ────────────────────────────────────────────────────── */

export async function step(bot, meta) {
  const who = { playerId: bot.playerId, token: bot.token };
  const s = await local.get("state", who);
  const round = s.round;
  if (round.status !== "research" && round.status !== "live") return;
  const M = mem(bot, round.roundId);

  // Read any new batch, the way a player does, and get to work on it.
  if (round.released > 0 && !M.data.has(round.released)) {
    const d = await local.get("data", who).catch(() => null);
    if (d?.release) {
      M.data.set(d.release, d);
      analysisFor(`${round.roundId}|${d.release}`, d);
    }
  }
  if (round.status !== "live" || !s.me.teamId) return;

  const P = bot.persona;
  const r = rng(`${bot.playerId}|${Date.now()}|${Math.random()}`);
  const turn = mood(P, r);
  if (turn === "skip") return;

  const order = (o) => local.post("order", auth(bot, { market: o.mkt, side: o.side, px: o.px, qty: o.qty }));
  const cancel = (o) => local.post("cancel", auth(bot, { orderId: o.id, market: o.market }));
  // Order ids are per book, so a cancel by id has to say which book.
  const cancelIn = (market, id) => local.post("cancel", auth(bot, { orderId: id, market }));

  if (turn === "yolo") {
    const mkt = MARKETS[Math.floor(r() * 2)];
    const m = s.markets[mkt];
    const side = r() < 0.5 ? "B" : "A";
    const touch = side === "B" ? m.bestAsk : m.bestBid;
    if (touch == null) return;
    const px = side === "B" ? Math.min(round.orderMax, touch + 2) : Math.max(round.orderMin, touch - 2);
    const res = await order({ mkt, side, px, qty: Math.max(1, Math.round(P.size * (0.4 + r() * 0.8))) }).catch(() => null);
    if (res?.resting?.id != null) await cancelIn(mkt, res.resting.id).catch(() => {});
    return;
  }

  const b = belief(bot, M, round);
  if (!b) return; // still working on it
  const lo = round.orderMin;
  const hi = round.orderMax;
  const unc = 3 + 10 * Math.sqrt(b.p * (1 - b.p));
  const half = Math.max(1, P.width * unc * 0.55);
  const edge = Math.max(2, P.edge * unc * 0.5);

  const fairOf = (mkt) => {
    const own = mkt === "north" ? 100 * b.p : 100 * (1 - b.p);
    const m = s.markets[mkt];
    const mid = m.bestBid != null && m.bestAsk != null ? (m.bestBid + m.bestAsk) / 2 : null;
    return Math.max(lo, Math.min(hi, blend(own, mid, P.kind === "alpha" ? P.herd * 0.3 : P.herd)));
  };

  // How much it has riding on HIT, net: a HIT share and a MISS share cancel.
  // Nobody at the meeting bets the whole $10,000 on one rock; past its limit a
  // bot only trades the way that brings it back.
  const exposure = (pos) => (pos?.north ?? 0) - (pos?.south ?? 0);
  const cap = Math.round(P.size * (P.kind === "alpha" ? 12 : 7));
  // Which way each book may still go: buying HIT or selling MISS adds exposure.
  const allowed = (mkt, e) => {
    const up = e < cap; // may add HIT exposure
    const down = e > -cap;
    return mkt === "north" ? { buy: up, sell: down } : { buy: down, sell: up };
  };

  // Take what is clearly wrong, in either book.
  let took = false;
  const e0 = exposure(s.me.pos);
  for (const mkt of MARKETS) {
    const m = s.markets[mkt];
    const ok = allowed(mkt, e0);
    const t = await takeIfCheap({
      mkt,
      fair: fairOf(mkt),
      edge,
      size: Math.max(1, Math.round(P.size / 2)),
      bestBid: ok.sell ? m.bestBid : null,
      bestAsk: ok.buy ? m.bestAsk : null,
      lo,
      hi,
      order,
      cancelId: (id) => cancelIn(mkt, id),
    });
    took = took || t;
  }
  if (took && P.kind !== "alpha") return;
  if (r() >= P.maker) return;

  // Then make a market: both books for the diligent, one for everyone else.
  const fresh = await local.get("state", who);
  const e = exposure(fresh.me.pos);
  const books = bot.brain.both ? MARKETS : [MARKETS[Math.floor(r() * 2)]];
  for (const mkt of books) {
    const ok = allowed(mkt, e);
    await requote({
      bot,
      mkt,
      fair: fairOf(mkt) + fatFinger(P, r, half),
      half,
      size: P.size,
      lo,
      hi,
      orders: fresh.me.orders,
      order,
      cancel,
      sides: ok.buy && ok.sell ? "both" : ok.buy ? "bid" : "ask",
      skew: inventorySkew(mkt === "north" ? e : -e, P.size, 1),
    });
  }
}

/* ── small fixes to what the original floor is shown ───────────────────── */

/**
 * The live floor's new-batch toast reads `rows` and `leadDays` off the
 * release log, which the server stopped sending when the round changed from a
 * corridor to an orbit, so at the meeting it says "undefined more
 * observations". Solo fills them in from public numbers (how many sightings a
 * batch adds, how far before the encounter the arc now ends). Also, the
 * leaderboard's team breakdown prints each member's position, which is an
 * object of two books; solo hands it a readable string.
 */
export function patchResponse(route, out) {
  const fixRound = (round) => {
    if (!round?.releaseLog) return;
    round.releaseLog = round.releaseLog.map((x, i) => ({
      ...x,
      rows: i === 0 ? RELEASE_COUNTS[0] : RELEASE_COUNTS[i] - RELEASE_COUNTS[i - 1],
      leadDays: T_ENCOUNTER - RELEASE_ARCS[i],
    }));
  };
  if (out && typeof out === "object") {
    fixRound(out.round);
    if (route === "leaderboard" && Array.isArray(out.leaderboard)) {
      for (const row of out.leaderboard) {
        for (const m of row.members ?? []) {
          if (m.pos && typeof m.pos === "object") {
            const h = m.pos.north ?? 0;
            const s = m.pos.south ?? 0;
            m.pos = `HIT ${h > 0 ? "+" : ""}${h} / MISS ${s > 0 ? "+" : ""}${s}`;
          }
        }
      }
    }
  }
  return out;
}
