/**
 * Week 2 — Gradient Trading, solo.
 *
 * The room: a handful of bot teams and you, all trading one contract that
 * settles at min f, the lowest height a hidden curve reaches. Every bot gets
 * what every student gets: one free private point (x, f(x), f'(x)) and the
 * right to buy more gradient-descent steps at the round's price. Nothing else.
 *
 * Each bot turns its own points into a belief about min f the way a student
 * would: the lowest height it has seen is a hard ceiling; the slope there says
 * how much further down the local valley goes; a valley it has not walked out
 * of may not be the deepest one; and the ladder opening at 500 is the only
 * hint about scale anyone has. Then it makes a market around that belief,
 * leaning on what the book says, and buys more steps when it thinks they are
 * worth $1,000.
 *
 * Good bots walk carefully (Newton steps from curvature they measured), jump
 * out of valleys to look for deeper ones, never bid above their own floor and
 * size up when they are sure. Weak ones never buy a step, trust their one
 * point too much, forget their quotes, or fling orders on a hunch. A player who
 * walks to a low point can sell to every bot still bidding above it.
 */

// Relative imports only: the headless harness (solo/sim) loads this file in Node.
import { local } from "../shared/local.js";
import { getSeats } from "../shared/api.js";
import { Runner, persona, roomSkills, botNames, teamNames, rng, gauss, auth, joinAs, requote, takeIfCheap, inventorySkew, mood, fatFinger } from "../shared/bots.js";

const TICK = 5;
const MAX_STEP = 25; // LIMITS.maxStep: what the step slider itself shows as "max step"
const LR = [0.0001, 1000];
const PX_LO = TICK;
const PX_HI = 3000;

/* ── curve difficulty, by plain name ───────────────────────────────────── */

export const CURVES = {
  smooth: "tilted",
  bumpy: "wavy",
  rugged: "rugged",
  brutal: "diabolical",
};
const SURPRISE = ["tilted", "wavy", "wavy", "rugged", "rugged", "diabolical"];

function pickCurve(cfg) {
  if (cfg.curve === "surprise") return SURPRISE[Math.floor(Math.random() * SURPRISE.length)];
  return CURVES[cfg.curve] ?? "wavy";
}

/* ── what a bot believes ───────────────────────────────────────────────── */

/** The point a bot would walk from (its lowest), and what its neighbours say. */
export function localView(points) {
  const pts = [...points].sort((a, b) => a.x - b.x);
  let i = 0;
  for (let j = 1; j < pts.length; j++) if (pts[j].y < pts[i].y) i = j;
  const b = pts[i];
  const downhill = -Math.sign(b.d); // +1: the floor is to the right
  let k = null;
  let bracket = false;
  let width = null;
  for (const j of [i - 1, i + 1]) {
    const n = pts[j];
    if (!n || n.x === b.x) continue;
    const kk = (n.d - b.d) / (n.x - b.x);
    const side = Math.sign(n.x - b.x);
    if (side === downhill && Math.sign(n.d) !== Math.sign(b.d) && kk > 0) {
      k = kk;
      bracket = true;
      width = Math.abs(n.x - b.x);
      break;
    }
    if (kk > 0 && k == null) k = kk;
  }
  const span = pts.length > 1 ? pts[pts.length - 1].x - pts[0].x : 0;
  return { pts, b, lb: b.y, k, bracket, width, span, downhill };
}

/**
 * A bot's belief about min f, from its own points.
 *
 *   ceiling  the lowest height it has seen. min f cannot be above it.
 *   local    ceiling minus how far the slope there says the valley still
 *            drops (a quadratic through the slope, curvature measured from a
 *            neighbouring point when it has one, guessed when it has not).
 *   elsewhere  a valley you have not walked out of may not be the deepest:
 *            `wary` bots knock a little off for the ground they have not seen.
 *   prior    the ladder opens at 500, so that is where everybody starts.
 *
 * Returns the mean and sd of the belief, truncated at the ceiling.
 */
export function belief(points, o = {}) {
  const { prior = 500, priorSd = 180, k0 = 0.08, wary = 20, extrap = 1 } = o;
  if (!points?.length) return { fair: prior, sd: priorSd, lb: Infinity, converged: false };
  const v = localView(points);
  const g = Math.abs(v.b.d);
  const converged = g < 0.05;
  // Real valleys are not parabolas: they flatten out, so a quadratic through
  // the slope overshoots, more so when the curvature is a guess.
  let drop = (g * g) / (2 * (v.k ?? k0));
  drop *= v.k == null ? 0.5 : 0.75;
  if (v.bracket) drop = Math.min(drop, (g * v.width) / 2);
  drop = Math.min(drop, 300) * extrap;
  const sLocal = converged ? 2 : v.bracket ? 0.3 * drop + 3 : 0.7 * drop + 12 + (v.k == null ? 25 : 0);
  // Ground not yet walked: the deepest valley may be somewhere else.
  const unseen = Math.max(0, 1 - v.span / 50);
  const reach = wary * (0.25 + 0.75 * unseen);
  const m = v.lb - drop - reach * 0.35;
  const s = Math.sqrt(sLocal * sLocal + reach * reach) + 2;
  const wP = 1 / (priorSd * priorSd);
  const wL = 1 / (s * s);
  const mu = (prior * wP + m * wL) / (wP + wL);
  const sd = 1 / Math.sqrt(wP + wL);
  // The ceiling is a fact, not an opinion.
  const fair = Math.min(v.lb, mu);
  return { fair, sd: Math.max(2, sd), lb: v.lb, converged, bracket: v.bracket, view: v };
}

/**
 * Where to walk next: a Newton step from the lowest point (curvature measured
 * from a neighbour when there is one), or, once that valley is flat, a full
 * stride from the steepest point to look over the next ridge.
 */
export function planStep(points, st = {}) {
  const { k0 = 0.08, style = "newton", explore = false, r = Math.random } = st;
  const v = localView(points);
  const owned = (x) => v.pts.some((p) => Math.abs(p.x - x) < 0.05);
  const make = (from, s) => {
    if (!from.d) return null;
    let lr = Math.abs(s) / Math.abs(from.d);
    lr = Math.min(LR[1], Math.max(LR[0], lr));
    if (Math.abs(lr * from.d) > MAX_STEP) lr = (MAX_STEP / Math.abs(from.d)) * 0.999;
    for (let t = 0; t < 6; t++) {
      const x = Math.round((from.x - lr * from.d) * 100) / 100;
      if (!owned(x)) return { anchorX: from.x, lr, to: x };
      lr *= 0.83;
    }
    return null;
  };
  if (Math.abs(v.b.d) < 0.05) {
    if (!explore) return null;
    // Look over the ridge: the steepest point whose longest stride lands on new ground.
    const cands = v.pts
      .filter((p) => Math.abs(p.d) > 0.3)
      .map((p) => ({ p, to: p.x - Math.sign(p.d) * MAX_STEP * 0.999 }))
      .filter((c) => !v.pts.some((q) => Math.abs(q.x - c.to) < 4))
      .sort((a, b) => Math.abs(b.p.d) - Math.abs(a.p.d));
    const c = cands[0];
    return c ? make(c.p, MAX_STEP * 0.999) : null;
  }
  const dir = -Math.sign(v.b.d);
  let s;
  if (style === "wild") s = dir * (8 + r() * 17);
  else {
    const k = v.k != null && v.k > 0 ? v.k : k0;
    s = dir * Math.min(MAX_STEP, Math.abs(v.b.d) / k);
    if (style === "timid") s *= 0.4 + r() * 0.3;
  }
  if (Math.abs(s) < 0.03) s = dir * 0.03;
  return make(v.b, s);
}

/* ── per-kind habits (on top of the shared persona dials) ──────────────── */

function habits(P, r) {
  const j = (lo, hi) => lo + (hi - lo) * r();
  const base = {
    // steps: how many it will buy in a round; pStep: chance a turn buys one
    // steps: how many it buys in a round. pace: how front-loaded (smaller = sooner).
    // extrap: how far it believes a slope keeps going (most people stop at the
    // lowest point they have seen and call it the floor; good traders don't).
    // wary: how much it allows for a deeper valley somewhere it has not walked.
    alpha: { steps: Math.round(j(4, 7)), pace: 0.55, style: "newton", explore: true, wary: j(16, 26), extrap: 1, priorSd: 200, cap: true, maxPos: 150 },
    steady: { steps: Math.round(j(2, 4)), pace: 1, style: "newton", explore: r() < 0.3, wary: j(0, 10), extrap: j(0.45, 0.8), priorSd: 170, cap: true, maxPos: 90 },
    stale: { steps: Math.round(j(1, 3)), pace: 1.3, style: "timid", explore: false, wary: 0, extrap: j(0.2, 0.5), priorSd: 150, cap: true, maxPos: 60 },
    // Made up their mind on their first point, leans on 500, barely walks.
    anchored: { steps: r() < 0.5 ? 0 : 1, pace: 1.5, style: "timid", explore: false, wary: 0, extrap: j(0, 0.2), priorSd: j(70, 110), cap: false, maxPos: 60 },
    gambler: { steps: Math.round(j(1, 3)), pace: 0.8, style: "wild", explore: false, wary: 0, extrap: j(0.2, 0.6), priorSd: 150, cap: false, maxPos: 70 },
    fatfinger: { steps: Math.round(j(2, 3)), pace: 1, style: "newton", explore: false, wary: j(0, 8), extrap: j(0.3, 0.7), priorSd: 170, cap: true, maxPos: 70 },
  }[P.kind] ?? { steps: 4, pStep: 0.3, style: "newton", explore: false, wary: 15, extrap: 1, priorSd: 180, cap: true, maxPos: 80 };
  return { ...base, k0: j(0.04, 0.14) };
}

/* ── the adapter ───────────────────────────────────────────────────────── */

const RECORD_KEY = "solo-w2:record";
const track = { roundId: null, rank: null, teams: null, pnlC: null, steps: 0, recorded: new Set() };

function readRecord() {
  try {
    const r = JSON.parse(localStorage.getItem(RECORD_KEY));
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}
function writeRecord(list) {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(list.slice(-50)));
  } catch {}
}
const fmtUsd = (c) => `${c < 0 ? "−" : "+"}$${Math.abs(Math.round(c / 100)).toLocaleString("en-US")}`;
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

async function newRound(admin, cfg, keepPlayers, seed) {
  return local.post("admin/round", {
    token: admin,
    mode: "gradient",
    difficulty: pickCurve(cfg),
    minutes: cfg.minutes,
    keepPlayers,
    lateJoin: true,
    ...(seed ? { seed } : {}),
  });
}

const room = {
  week: 2,
  title: "Gradient Trading",
  blurb:
    "A hidden curve. One share pays its lowest height in dollars. Everyone holds a different point on it and can buy steps of gradient descent to walk downhill. Trade what you know against what the room thinks.",
  howTo: [
    "Make your team. You get $100,000 and one private point on the curve: its x, its height and its slope.",
    "The lowest height you have seen is a ceiling: the answer is at or below it.",
    "Buy steps downhill for $1,000 each to learn more. Too big a step overshoots the valley.",
    "Quote, lift and hit on the ladder. At the bell every share pays min f. Most money wins.",
  ],
  botTeams: { min: 3, max: 12, def: 7 },
  settings: [
    {
      key: "curve",
      label: "The curve",
      type: "seg",
      def: "bumpy",
      options: [
        { v: "smooth", l: "Smooth" },
        { v: "bumpy", l: "Bumpy" },
        { v: "rugged", l: "Rugged" },
        { v: "brutal", l: "Brutal" },
        { v: "surprise", l: "Surprise me" },
      ],
      hint: (v) =>
        ({
          smooth: "One valley, a gentle lean. Walk downhill and you are there.",
          bumpy: "Waves on a bowl. Your slope can lie to you locally.",
          rugged: "Decoy valleys. The first bottom you find is often not the bottom.",
          brutal: "False bottoms everywhere. Good luck.",
          surprise: "A different curve each round, and you are not told which.",
        })[v],
    },
    {
      key: "minutes",
      label: "Round length",
      type: "seg",
      def: 5,
      options: [
        { v: 3, l: "3 min" },
        { v: 5, l: "5 min" },
        { v: 8, l: "8 min" },
      ],
    },
  ],

  async setup({ admin, cfg, you, botTeams, level, seed }) {
    await newRound(admin, cfg, false, seed);
    const seats = [];
    for (let i = 0; i < you.length; i++) {
      seats.push(await local.post("join", { name: you[i], deviceId: `solo-w2-you-${i}-${seed}`, fp: "solo0000" }));
    }
    // Bot teams of one to three. Names never collide with yours.
    const r = rng(`teams|${seed}`);
    const sizes = Array.from({ length: botTeams }, () => (r() < 0.45 ? 1 : r() < 0.75 ? 2 : 3));
    const total = sizes.reduce((a, b) => a + b, 0);
    const taken = new Set(you.map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "")));
    const names = botNames(Math.min(45, total + you.length + 2), seed).filter((n) => !taken.has(n.toLowerCase()));
    const skills = roomSkills(level, total, seed);
    const tn = teamNames(botTeams, seed);
    const bots = [];
    let k = 0;
    for (let t = 0; t < botTeams; t++) {
      let code = null;
      for (let m = 0; m < sizes[t]; m++) {
        const name = names[k] ?? `Trader ${k + 1}`;
        const p = await joinAs(name, `solo-w2-bot-${k}-${seed}`);
        if (!code) code = (await local.post("team/create", auth(p, { name: tn[t] }))).code;
        else await local.post("team/join", auth(p, { code }));
        bots.push({ playerId: p.playerId, token: p.token, name, persona: persona(skills[k], `${seed}|${k}`) });
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

  bots({ meta }) {
    const runner = new Runner(meta.bots, (b) => step(b, meta));
    const seatTimer = setInterval(() => {
      room.afterSeat(getSeats()).catch(() => {});
      watchYou().catch(() => {});
    }, 1500);
    const stop = runner.stop.bind(runner);
    runner.stop = () => {
      clearInterval(seatTimer);
      stop();
    };
    return runner;
  },

  controls({ round, admin, meta }) {
    if (!round) return [];
    const record = {
      key: "record",
      label: "Your record",
      hint: "Every round you have played here",
      run: async () => ({ note: recordNote() }),
    };
    if (round.status === "lobby") {
      return [
        {
          key: "open",
          label: "Open trading",
          primary: true,
          hint: `Start the ${meta.cfg.minutes}-minute clock`,
          run: async () => {
            const seats = getSeats();
            const s0 = await local.get("state", { playerId: seats[0]?.playerId, token: seats[0]?.token }).catch(() => null);
            if (!s0?.team) return { note: "Make your team first." };
            await room.afterSeat(seats).catch(() => {});
            await admin("start", { minutes: meta.cfg.minutes });
            return null;
          },
        },
        record,
      ];
    }
    if (round.status === "live") {
      return [
        { key: "extend", label: "+1 min", hint: "Put a minute on the clock", run: () => admin("extend", { seconds: 60 }) },
        {
          key: "end",
          label: "Ring the bell",
          hint: "End the round now and settle",
          run: async () => {
            if (typeof window !== "undefined" && !window.confirm("End the round now? Every share settles at min f.")) return null;
            await admin("end");
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
        hint: "Same teams, fresh money, a new curve",
        run: async () => {
          await newRound(meta.admin, meta.cfg, true);
          return { remount: true };
        },
      },
      record,
    ];
  },

  status({ round }) {
    if (!round) return "";
    if (round.status === "lobby") return `Lobby · ${round.teams} teams · make your team, then open trading`;
    if (round.status === "live") {
      const ms = Math.max(0, (round.endsAt ?? 0) - (round.serverNow ?? Date.now()));
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return `Live · ${m}:${String(s).padStart(2, "0")} left · ${round.teams} teams`;
    }
    const at = round.xStar != null ? `Settled at ${Number(round.xStar).toFixed(2)}` : "Settled";
    if (track.roundId === round.roundId && track.rank != null) {
      return `${at} · your team ${ordinal(track.rank)} of ${track.teams} · you ${fmtUsd(track.pnlC)}`;
    }
    return at;
  },
};

export default room;

/** Keep an eye on seat 0, and write each finished round into the record. */
async function watchYou() {
  const seat = getSeats()[0];
  if (!seat) return;
  const s = await local.get("state", { playerId: seat.playerId, token: seat.token });
  const row = s.leaderboard.find((t) => t.id === s.me.teamId);
  track.roundId = s.round.roundId;
  track.rank = row?.rank ?? null;
  track.teams = s.leaderboard.length;
  track.pnlC = s.me.valueC - s.me.startC;
  track.steps = s.me.descents;
  if (s.round.status === "settled" && row && !track.recorded.has(s.round.roundId)) {
    track.recorded.add(s.round.roundId);
    const list = readRecord();
    if (!list.some((x) => x.roundId === s.round.roundId)) {
      list.push({
        roundId: s.round.roundId,
        at: Date.now(),
        settle: s.round.xStar,
        rank: row.rank,
        teams: s.leaderboard.length,
        pnlC: s.me.valueC - s.me.startC,
        teamPnlC: row.valueC - row.startC,
        steps: s.me.descents,
      });
      writeRecord(list);
    }
  }
}

function recordNote() {
  const list = readRecord();
  if (!list.length) return "No finished rounds yet. Your results land here after each bell.";
  const wins = list.filter((x) => x.rank === 1).length;
  const podium = list.filter((x) => x.rank <= 3).length;
  const best = list.reduce((a, b) => (b.pnlC > a.pnlC ? b : a));
  const total = list.reduce((a, b) => a + b.pnlC, 0);
  const last = list
    .slice(-5)
    .reverse()
    .map((x) => `${ordinal(x.rank)}/${x.teams} ${fmtUsd(x.pnlC)}`)
    .join(" · ");
  return `${list.length} round${list.length === 1 ? "" : "s"} · ${wins} win${wins === 1 ? "" : "s"} · ${podium} on the podium · best ${fmtUsd(best.pnlC)} · total ${fmtUsd(total)}. Last: ${last}`;
}

/* ── one bot's turn ────────────────────────────────────────────────────── */

const memory = new Map();
/** Counters the headless harness reads. */
export const stats = { turns: 0, steps: 0, stepFail: {}, noPlan: 0 };

function mem(bot, roundId) {
  let m = memory.get(bot.playerId);
  if (!m || m.roundId !== roundId) {
    const r = rng(`w2|${bot.playerId}|${roundId}`);
    m = { roundId, bias: gauss(r), habits: habits(bot.persona, r), first: null, steps: 0, jumps: 0, lastStepAt: 0 };
    memory.set(bot.playerId, m);
  }
  return m;
}

/** What this bot thinks min f is worth right now, before it looks at the book. */
function opinion(points, H, M, P) {
  const b = belief(points, { priorSd: H.priorSd, k0: H.k0, wary: H.wary, extrap: H.extrap });
  // Its own way of misjudging things, which shrinks as it learns.
  let fair = b.fair + M.bias * P.noise * Math.min(45, b.sd) * 0.8;
  if (M.first == null) M.first = fair;
  if (P.stick) fair = M.first * P.stick + fair * (1 - P.stick);
  if (H.cap) fair = Math.min(fair, b.lb);
  return { ...b, fair };
}

export async function step(bot, meta) {
  const s = await local.get("state", { playerId: bot.playerId, token: bot.token });
  const round = s.round;
  if (round.status !== "live" || !s.me.teamId || !s.me.points.length) return;
  const P = bot.persona;
  const M = mem(bot, round.roundId);
  const H = M.habits;
  const r = rng(`${bot.playerId}|${Date.now()}|${Math.random()}`);
  const order = (o) => local.post("order", auth(bot, { side: o.side, px: o.px, qty: o.qty }));
  const cancel = (o) => local.post("cancel", auth(bot, { orderId: o.id }));
  const cancelId = (id) => local.post("cancel", auth(bot, { orderId: id }));
  const m = s.market;
  let me = s.me;

  // A share here is worth hundreds of dollars and a step costs a thousand, so
  // the room trades in lots big enough that being right pays for the walking.
  const lot = Math.round(Math.min(32, P.size * 2));
  const turn = mood(P, r);
  stats.turns++;
  if (turn === "skip") return;

  if (turn === "yolo") {
    // A hunch: through the touch, whatever is there.
    const side = r() < 0.5 ? "B" : "A";
    const touch = side === "B" ? m.bestAsk : m.bestBid;
    if (touch == null) return;
    const px = side === "B" ? touch + TICK * 2 : Math.max(PX_LO, touch - TICK * 2);
    const res = await order({ side, px, qty: Math.max(1, Math.round(lot * (0.4 + r() * 0.8))) }).catch(() => null);
    if (res?.resting?.id != null) await cancelId(res.resting.id).catch(() => {});
    return;
  }

  // Walk? A step is worth it while the valley still slopes, or (for the
  // curious) while there is ground nobody has looked at.
  const msLeft = (round.endsAt ?? 0) - round.serverNow;
  // Steps are spread over the round, as people actually take them: a few early,
  // more as the clock runs, the keen ones sooner.
  const now = round.serverNow;
  if (M.nextStepAt == null) {
    const dur = Math.max(30_000, (round.endsAt ?? now + 300_000) - (round.startedAt ?? now));
    M.spacing = ((dur * 0.8) / (H.steps + 1)) * H.pace;
    M.nextStepAt = (round.startedAt ?? now) + M.spacing * (0.25 + 0.75 * r());
  }
  if (M.steps < H.steps && now >= M.nextStepAt && msLeft > 12_000 && me.spendableC >= round.descentCostC) {
    M.nextStepAt = now + M.spacing * (0.6 + 0.8 * r());
    const plan = planStep(me.points, { k0: H.k0, style: H.style, explore: H.explore && M.jumps < 3, r });
    if (!plan) stats.noPlan++;
    if (plan) {
      const isJump = Math.abs(localView(me.points).b.d) < 0.05;
      const res = await local.post("descend", auth(bot, { anchorX: plan.anchorX, lr: plan.lr })).catch((e) => {
        stats.stepFail[e.message.slice(0, 40)] = (stats.stepFail[e.message.slice(0, 40)] ?? 0) + 1;
        return null;
      });
      if (res) stats.steps++;
      if (res?.me) {
        me = res.me;
        M.steps++;
        if (isJump) M.jumps++;
      }
      // Walking takes a moment; most students look at what they found before trading on it.
      if (r() < 0.5) return;
    }
  }

  const b = opinion(me.points, H, M, P);
  const mid = m.bestBid != null && m.bestAsk != null ? (m.bestBid + m.bestAsk) / 2 : m.last ?? null;
  // How much the book moves it: less when it is sure of itself.
  const herd = mid == null ? 0 : P.herd * Math.min(1, b.sd / 40);
  let fair = mid == null ? b.fair : b.fair * (1 - herd) + mid * herd;
  if (H.cap) fair = Math.min(fair, b.lb);

  const unc = Math.max(8, b.sd);
  const half = Math.max(TICK, P.width * unc * 0.5);
  const edge = Math.max(TICK, P.edge * unc * 0.5);
  const pos = me.pos ?? 0;
  const conf = Math.max(0.5, Math.min(2.5, 30 / unc));
  const takeSize = Math.max(1, Math.min(50, Math.round(lot * 0.7 * (P.kind === "alpha" ? conf : 1))));

  // Take what is clearly wrong, within its position limit.
  const canBuy = pos < H.maxPos;
  const canSell = pos > -H.maxPos;
  const took = await takeIfCheap({
    mkt: "w2",
    fair,
    edge,
    size: takeSize,
    bestBid: canSell ? m.bestBid : null,
    bestAsk: canBuy && (!H.cap || m.bestAsk == null || m.bestAsk < b.lb) ? m.bestAsk : null,
    tick: TICK,
    lo: PX_LO,
    hi: PX_HI,
    order,
    cancelId,
  });
  if (took && P.kind !== "alpha") return;

  if (r() < P.maker) {
    const fresh = took ? (await local.get("state", { playerId: bot.playerId, token: bot.token })).me : me;
    const p2 = fresh.pos ?? 0;
    let skew = inventorySkew(p2, lot, Math.max(1, unc * 0.12));
    const ff = fatFinger(P, r, Math.round(half / TICK)) * TICK;
    let center = fair + ff;
    // Never bid at or above your own floor (unless you are the kind who forgets it).
    if (H.cap && center - half + skew > b.lb - TICK) skew = b.lb - TICK - (center - half);
    const size = Math.max(1, Math.min(50, Math.round(lot * (P.kind === "alpha" ? Math.min(1.6, conf) : 1))));
    await requote({
      bot,
      mkt: "w2",
      fair: center,
      half,
      size,
      tick: TICK,
      lo: PX_LO,
      hi: PX_HI,
      orders: fresh.orders.map((o) => ({ ...o, mkt: "w2" })),
      order,
      cancel,
      skew,
      sides: p2 >= H.maxPos ? "ask" : p2 <= -H.maxPos ? "bid" : "both",
    });
  }
}
