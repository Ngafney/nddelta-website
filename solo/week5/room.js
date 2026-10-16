/**
 * Week 5 — The Horizon Market, solo.
 *
 * The room: N bot teams and you, one binary on "Y_T > K", and the meeting's
 * three house desks exactly as they run live (NAIVE DESK quoting the
 * random-walk price, NOISE DESKS A and B firing at random). At the meeting the
 * students make the market; here the bots are the students, so they quote it.
 *
 * Each bot reads the same chart you do (the public series, K, the ticks left)
 * and prices the contract the way some student in the room would: an OLS fit
 * done properly, a plain OLS fit, a fit made at the open and never revisited,
 * "it's a random walk" (the naive desk's mistake), or chasing the last few
 * ticks. Nothing here reads φ, μ, σ, the switch, the seed or a future tick.
 */

// Relative imports only: the headless harness (solo/sim) loads this file in Node.
import { local } from "../shared/local.js";
import { getSeats } from "../shared/api.js";
import { Runner, persona, roomSkills, botNames, teamNames, rng, gauss, auth, joinAs, requote, takeIfCheap, blend, inventorySkew, mood, anchor, fatFinger } from "../shared/bots.js";
import { bayesPrice, windowPrice, windowFit, rwPrice, chasePrice, priceAR, MODEL_OF } from "./models.js";

/* ── the process for each round ────────────────────────────────────────── */

/**
 * What the host would pick. The meeting's own three rounds, in order, or a
 * shuffle of the same three kinds with a little variety in φ, where Y opens
 * and when (if ever) it changes. μ = K as at the meeting, so the lesson's
 * numbers hold: mean-reverting is worth about 50 from a long way out.
 */
export function processFor(cfg, n, seed) {
  const r = rng(`proc|${seed}|${n}`);
  const T = Number(cfg.length) || 60;
  const base = { sigma: 1, mu: 100, K: 100, H: 150, T, secondsPerTick: Number(cfg.tick) || 3, naiveBot: true };
  const meeting = cfg.process === "meeting" && n < 3;
  if (meeting) {
    const preset = ["meanrev", "rw", "switch"][n];
    const p = { meanrev: { phi1: 0.9 }, rw: { phi1: 1 }, switch: { phi1: 0.9, phi2: 1, switchTick: Math.round(T / 2) } }[preset];
    return { ...base, preset, yOpen: 105, ...p };
  }
  const x = r();
  const kind = x < 0.4 ? "meanrev" : x < 0.7 ? "rw" : "switch";
  const gap = (2.5 + 4.5 * r()) * (r() < 0.5 ? -1 : 1);
  const yOpen = Math.round((100 + gap) * 100) / 100;
  if (kind === "rw") return { ...base, preset: "rw", phi1: 1, yOpen };
  const phi1 = [0.8, 0.85, 0.88, 0.9, 0.9, 0.93][Math.floor(r() * 6)];
  if (kind === "meanrev") return { ...base, preset: "meanrev", phi1, yOpen };
  const switchTick = Math.max(5, Math.min(T - 8, Math.round(T * (0.25 + 0.4 * r()))));
  return { ...base, preset: "switch", phi1, phi2: 1, switchTick, yOpen };
}

const RESEARCH_MIN = 1; // a minute of research, skippable from the bar

/* ── the series: several rounds, one evening ───────────────────────────── */

export function loadSeries(ns) {
  try {
    const s = JSON.parse(sessionStorage.getItem(`${ns}:series`));
    if (s && Array.isArray(s.done)) return s;
  } catch {}
  return { n: 0, done: [] };
}
export function saveSeries(ns, s) {
  try {
    sessionStorage.setItem(`${ns}:series`, JSON.stringify(s));
  } catch {}
}

/* ── the adapter ───────────────────────────────────────────────────────── */

const room = {
  week: 5,
  title: "The Horizon Market",
  blurb:
    "A hidden process Y ticks live on the screen. One contract: does Y finish above the line K at the last tick? It pays $100 if it does, nothing if it doesn't.",
  howTo: [
    "Make your team. When you release the data you get the whole history of Y and a minute to study it.",
    "Fit it. The question is how hard Y gets pulled back to its average. Pulled hard, and a gap closes. Not at all, and a gap stays.",
    "The book opens and Y ticks. Buy below what you think the chance is, sell above it. Download the data again and refit as it grows.",
    "At the last tick a share pays $100 if Y is above K. Then the process is revealed. Most money wins.",
  ],
  botTeams: { min: 3, max: 14, def: 7 },
  settings: [
    {
      key: "process",
      label: "The process",
      type: "seg",
      def: "random",
      options: [
        { v: "random", l: "Surprise me" },
        { v: "meeting", l: "The meeting's three" },
      ],
      hint: (v) =>
        v === "meeting"
          ? "The three rounds played at the meeting, in order, then surprises. Hidden until each round ends."
          : "A fresh hidden process every round. It's revealed when the round ends.",
    },
    {
      key: "tick",
      label: "Y ticks every",
      type: "seg",
      def: 3,
      options: [
        { v: 2, l: "2 s" },
        { v: 3, l: "3 s" },
        { v: 4, l: "4 s (meeting)" },
      ],
    },
    {
      key: "length",
      label: "Round length",
      type: "seg",
      def: 60,
      options: [
        { v: 40, l: "40 ticks" },
        { v: 60, l: "60 ticks" },
        { v: 90, l: "90 ticks" },
      ],
    },
  ],

  async setup({ admin, cfg, you, botTeams, level, seed, ns }) {
    if (ns) saveSeries(ns, { n: 0, done: [] });
    const params = processFor(cfg, 0, seed);
    await local.post("admin/round", { token: admin, ...params, researchMinutes: RESEARCH_MIN });

    // Your seats. The floor's own gate makes your team.
    const seats = [];
    for (let i = 0; i < you.length; i++) {
      seats.push(await local.post("join", { name: you[i], deviceId: `solo-w5-you-${i}-${seed}`, fp: "solo0000" }));
    }
    const taken = new Set(you.map((n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "")));

    // The bot teams: one to three traders each, like tables at a meeting.
    const skills = roomSkills(level, botTeams * 3, seed);
    const tn = teamNames(botTeams, seed);
    const names = botNames(Math.min(45, botTeams * 3 + 4), seed).filter((n) => !taken.has(n.toLowerCase()));
    const r = rng(`tables|${seed}`);
    const bots = [];
    let k = 0;
    for (let t = 0; t < botTeams; t++) {
      const x = r();
      const members = x < 0.45 ? 1 : x < 0.85 ? 2 : 3;
      let team = null;
      for (let m = 0; m < members; m++) {
        const name = names[k] ?? `Trader ${k + 1}`;
        let p;
        try {
          p = await joinAs(name, `solo-w5-bot-${k}-${seed}`);
        } catch {
          p = await joinAs(`${name} ${k + 1}`, `solo-w5-bot-${k}-${seed}-b`);
        }
        if (!team) {
          const res = await local.post("team/create", auth(p, { name: tn[t] }));
          team = res.team;
        } else {
          await local.post("team/join", auth(p, { code: team.code }));
        }
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
    const code = s0?.team?.code;
    if (!code) return;
    for (const seat of seats.slice(1)) {
      const s1 = await local.get("state", { playerId: seat.playerId, token: seat.token }).catch(() => null);
      if (s1 && !s1.me?.teamId) await local.post("team/join", auth(seat, { code })).catch(() => {});
    }
  },

  bots({ meta }) {
    const runner = new Runner(meta.bots, (b) => step(b, meta));
    const seatTimer = setInterval(() => {
      room.afterSeat(getSeats()).catch(() => {});
    }, 1500);
    const stop = runner.stop.bind(runner);
    runner.stop = () => {
      clearInterval(seatTimer);
      stop();
    };
    return runner;
  },

  controls({ round, admin, meta, ns }) {
    if (!round) return [];
    if (round.status === "lobby") {
      return [
        {
          key: "start",
          label: "Release the data",
          primary: true,
          hint: "The history comes out and research starts. The book stays shut.",
          run: async () => {
            const seats = getSeats();
            const s0 = await local.get("state", { playerId: seats[0]?.playerId, token: seats[0]?.token }).catch(() => null);
            if (!s0?.me?.teamId) return { note: "Make your team first (or join one)." };
            await admin("start", { minutes: RESEARCH_MIN });
            return null;
          },
        },
      ];
    }
    if (round.status === "research") {
      return [
        { key: "open", label: "Open the book now", primary: true, hint: "End research and start the clock", run: () => admin("open") },
        { key: "more", label: "+30 s", hint: "More research time", run: () => admin("extend", { seconds: 30 }) },
      ];
    }
    if (round.status === "live") {
      return [
        {
          key: "end",
          label: "End now",
          hint: "Every remaining tick prints at once and the round settles",
          run: async () => {
            if (typeof window !== "undefined" && !window.confirm("Print every remaining tick now and settle the round?")) return null;
            await admin("end");
            return null;
          },
        },
      ];
    }
    return [
      {
        key: "again",
        label: "Next round",
        primary: true,
        hint: "Same teams, a new hidden process",
        run: async () => {
          const series = loadSeries(ns);
          series.n = (series.n ?? 0) + 1;
          const params = processFor(meta.cfg, series.n, meta.seed);
          await admin("round", { keepPlayers: true, ...params, researchMinutes: RESEARCH_MIN });
          await admin("start", { minutes: RESEARCH_MIN });
          saveSeries(ns, series);
          return { remount: true };
        },
      },
    ];
  },

  status({ round, ns }) {
    if (!round) return "";
    const series = loadSeries(ns);
    const rn = `Round ${(series.n ?? 0) + 1}`;
    const left = round.endsAt != null ? Math.max(0, Math.ceil((round.endsAt - round.serverNow) / 1000)) : null;
    if (round.status === "lobby") return `${rn} · Lobby · ${round.teams} teams · make your team, then release the data`;
    if (round.status === "research") return `${rn} · Research · book opens in ${left ?? "…"}s`;
    if (round.status === "live") return `${rn} · Live · tick ${round.tickNow} of ${round.T}`;
    const mine = series.done.find((d) => d.roundId === round.roundId);
    const res = mine ? ` · your team ${mine.you >= 0 ? "+" : "−"}$${Math.abs(Math.round(mine.you / 100)).toLocaleString()} (${ordinal(mine.rank)} of ${mine.of})` : "";
    return `${rn} · Settled · paid $${round.xStar}${res}`;
  },
};

export default room;

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ── one bot's turn ────────────────────────────────────────────────────── */

const memory = new Map(); // per bot, per round: its slant, its first impressions, its fit at the open

function mem(bot, roundId) {
  let m = memory.get(bot.playerId);
  if (!m || m.roundId !== roundId) {
    m = { roundId, bias: gauss(rng(`bias|${bot.playerId}|${roundId}`)), first: new Map(), frozen: null };
    memory.set(bot.playerId, m);
  }
  return m;
}

/** What this bot thinks the contract is worth, in points (0–100). Public data only. */
export function botValue(bot, M, ys, round) {
  const K = round.K;
  const h = round.ticksLeft;
  const model = MODEL_OF[bot.persona.kind] ?? "window";
  let p;
  if (model === "bayes") p = bayesPrice(ys, K, h, round.tickNow).p;
  else if (model === "window") p = windowPrice(ys, K, h);
  else if (model === "rw") p = rwPrice(ys, K, h);
  else if (model === "chase") p = chasePrice(ys, K, h);
  else {
    // Fitted once, the first time it looked after the open, and never again.
    M.frozen ??= windowFit(ys, 1000);
    p = M.frozen ? priceAR(ys[ys.length - 1], K, h, M.frozen.phi, M.frozen.mu, M.frozen.sigma) : rwPrice(ys, K, h);
  }
  return 100 * p;
}

export async function step(bot, meta) {
  const s = await local.get("state", { playerId: bot.playerId, token: bot.token });
  const round = s.round;
  if (round.status !== "live" || !s.me?.teamId || !s.series?.ys) return;
  if (round.ticksLeft <= 0) return;
  const P = bot.persona;
  const r = rng(`${bot.playerId}|${Date.now()}|${Math.random()}`);
  const turn = mood(P, r);
  if (turn === "skip") return;

  const order = (o) => local.post("order", auth(bot, { side: o.side, px: o.px, qty: o.qty }));
  const cancel = (o) => local.post("cancel", auth(bot, { orderId: o.id }));
  const cancelId = (id) => local.post("cancel", auth(bot, { orderId: id }));
  const m = s.market;
  const lo = round.orderMin;
  const hi = round.orderMax;
  const pos = s.me.pos ?? 0;
  const cap = P.kind === "alpha" ? 260 : 140;

  if (turn === "yolo") {
    // A hunch. Through the touch, whatever is there.
    const side = r() < 0.5 ? "B" : "A";
    const touch = side === "B" ? m.bestAsk : m.bestBid;
    if (touch == null) return;
    const px = side === "B" ? Math.min(hi, touch + 3) : Math.max(lo, touch - 3);
    const res = await order({ side, px, qty: Math.max(1, Math.round(P.size * (0.5 + r()))) }).catch(() => null);
    if (res?.resting?.id != null) await cancelId(res.resting.id).catch(() => {});
    return;
  }

  const M = mem(bot, round.roundId);
  let own = botValue(bot, M, s.series.ys, round);
  // A persistent slant (how this student misreads the chart) that fades as T nears.
  own += M.bias * P.noise * 5 * Math.min(1, round.ticksLeft / 15);
  own = anchor(M.first, "px", own, P.stick);
  const mid = m.bestBid != null && m.bestAsk != null ? (m.bestBid + m.bestAsk) / 2 : null;
  const herd = P.kind === "alpha" ? P.herd * 0.3 : P.herd;
  const fair = Math.max(0.5, Math.min(99.5, blend(own, mid, herd)));

  // Uncertainty in points: widest at 50, narrow near 0 or 100.
  const q = fair / 100;
  const unc = 3 + 10 * 4 * q * (1 - q);
  const half = Math.max(1, P.width * unc * 0.4);
  const edge = Math.max(1.5, P.edge * unc * 0.35);

  const takeSize = Math.max(1, Math.round(P.kind === "alpha" ? Math.min(40, P.size * 1.6) : P.size / 2));
  const took = await takeIfCheap({
    fair,
    edge,
    size: takeSize,
    bestBid: pos <= -cap ? null : m.bestBid,
    bestAsk: pos >= cap ? null : m.bestAsk,
    lo,
    hi,
    order,
    cancelId,
  });
  if (took && P.kind !== "alpha") return;

  if (r() < P.maker) {
    const me = took ? (await local.get("state", { playerId: bot.playerId, token: bot.token })).me : s.me;
    const p2 = me.pos ?? 0;
    await requote({
      bot,
      mkt: undefined, // one book this week: orders carry no market field
      fair: fair + fatFinger(P, r, half),
      half,
      size: P.size,
      lo,
      hi,
      orders: me.orders,
      order,
      cancel,
      skew: inventorySkew(p2, P.size, Math.max(0.5, unc * 0.08)),
      sides: p2 >= cap ? "ask" : p2 <= -cap ? "bid" : "both",
    });
  }
}
