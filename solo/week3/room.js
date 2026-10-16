/**
 * Week 3 — Coin Flips, solo.
 *
 * COIN MARKET. The room is N bot teams plus you. Every bot is an ordinary
 * player: it joins, sits on a team, and in the flip window orders however many
 * $100 flips its kind of student would (some none, a few a lot). When the
 * window closes the server deals everyone their own flips; a bot sees its own
 * heads and tails exactly as you see yours, and nothing else. From those it
 * prices the coin the way that student would:
 *
 *   Bayesian     posterior mean from the round's (public) prior, with an
 *                honest interval, so few flips means wide quotes
 *   frequentist  heads ÷ flips, and an interval that thinks 3 for 3 is a sure
 *                thing — the student bidding 95 a sharp player should sell to
 *
 * then leans on the book (some a lot, some barely), and makes a two-sided
 * market around the result. In the live meeting the students are the market;
 * here the bots have to be.
 *
 * BANDIT LAB. Most bot teams also play the lab, through the same compile, save
 * and run routes a team uses, starting with a weak idea and improving it over
 * the session, so the leaderboard has a field to beat and keeps moving. Their
 * runs only happen while the coin market is not trading: 10,000 games run in
 * this tab and would stall the book for a second.
 */

// Relative imports only: the headless harness (solo/sim) loads this file in Node.
import { local } from "../shared/local.js";
import { getSeats } from "../shared/api.js";
import { Runner, persona, roomSkills, botNames, teamNames, rng, gauss, auth, joinAs, requote, takeIfCheap, blend, inventorySkew, mood, anchor, fatFinger } from "../shared/bots.js";
import { PRIORS } from "../../week3/shared/rules.js";

const ss = typeof sessionStorage !== "undefined" ? sessionStorage : null;
const load = (k, d) => {
  try {
    return JSON.parse(ss?.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    ss?.setItem(k, JSON.stringify(v));
  } catch {}
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/* ── what a student believes about p ───────────────────────────────────── */

/**
 * A bot's estimate of 100·p and how sure it is, from its own flips only.
 * `freq` bots use heads ÷ flips and a naive standard error with a small floor
 * (so 3 for 3 reads as "basically 100"); everyone else uses the posterior from
 * the round's prior, which every player is shown.
 */
export function belief(freq, prior, n, h) {
  if (freq) {
    if (!n) return { mean: 50, sd: 28 };
    const f = h / n;
    return { mean: 100 * f, sd: Math.max(4, 100 * Math.sqrt((f * (1 - f)) / n)) };
  }
  const A = (prior?.a ?? 1) + h;
  const B = (prior?.b ?? 1) + n - h;
  const m = A / (A + B);
  return { mean: 100 * m, sd: 100 * Math.sqrt((m * (1 - m)) / (A + B + 1)) };
}

/** How many flips this kind of student buys. */
function flipsWanted(P, r) {
  if (P.hoard) return 40 + Math.floor(r() * 46); // knows the coin cold, little left to trade with
  switch (P.kind) {
    case "gambler":
      return r() < 0.55 ? 0 : 1 + Math.floor(r() * 3);
    case "anchored":
      return 2 + Math.floor(r() * 5); // a handful, and believes them
    case "stale":
      return 2 + Math.floor(r() * 10);
    case "fatfinger":
      return 4 + Math.floor(r() * 14);
    case "steady":
      return 6 + Math.floor(r() * 20);
    case "alpha":
      return 8 + Math.floor(r() * 18);
    default:
      return 5;
  }
}

/* ── the bandit lab's bot teams ────────────────────────────────────────── */

/** Plain English a team might type, with roughly what it averages (for ordering only). */
const LAB = {
  casual: [
    ["pick a coin at random every time", 5016],
    ["always flip coin C", 5045],
    ["explore 50 flips, then always the best one", 6588],
    ["use ucb", 6601],
    ["flip each coin twice, then whichever has the most heads", 6943],
    ["explore 30 flips then always the highest rate", 7187],
    ["epsilon greedy with 20%", 7227],
  ],
  sharp: [
    ["explore 20 flips, then the best", 7455],
    ["epsilon greedy, 10%", 7465],
    ["ucb with c = 0.5", 7351],
    ["flip each coin 3 times, then the best", 7570],
    ["epsilon greedy, 5%", 7557],
  ],
  shark: [
    ["explore 12 flips, then the best", 7618],
    ["flip each coin once, then the best rate", 7609],
    ["explore 10 flips, then the best", 7652],
    ["ucb with c = 0.3", 7522],
  ],
};

function labPlan(skill, r) {
  if (r() < 0.2) return []; // not every table bothers with the lab
  const pick = (tier, k) => {
    const pool = LAB[tier].slice();
    const out = [];
    for (let i = 0; i < k && pool.length; i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  };
  const steps =
    skill === "casual"
      ? pick("casual", 1 + Math.floor(r() * 2))
      : skill === "sharp"
        ? [...pick("casual", 1), ...pick("sharp", 1 + Math.floor(r() * 2))]
        : [...pick("sharp", 1), ...pick("shark", 1 + Math.floor(r() * 2))];
  // A team gets better as it goes (mostly: sometimes the new idea is worse).
  return steps.sort((a, b) => a[1] - b[1]).map(([prompt]) => prompt);
}

async function labStep(bot, prompt) {
  const c = await local.post("bandit/compile", auth(bot, { prompt }));
  if (c.refused) return null;
  const saved = await local.post(
    "bandit/save",
    auth(bot, { name: c.summary || prompt.slice(0, 24), prompt, code: c.code, sig: c.sig, explain: c.explain, summary: c.summary })
  );
  return local.post("bandit/run", auth(bot, { strategyId: saved.strategy.id }));
}

/* ── the round, from settings ──────────────────────────────────────────── */

function roundBody(cfg, extra = {}) {
  return {
    prior: cfg.prior,
    settlement: cfg.settlement,
    simSeconds: cfg.simSeconds,
    minutes: cfg.minutes,
    ...extra,
  };
}

/* ── the session: coins played, and how you did ────────────────────────── */

let tally = { ns: null, coins: [] };
function loadTally(ns) {
  if (tally.ns !== ns) tally = { ns, coins: load(`${ns}:tally`, []) };
  return tally;
}

async function recordIfSettled(ns) {
  const seat = getSeats()[0];
  if (!seat) return;
  const s = await local.get("state", { playerId: seat.playerId, token: seat.token }).catch(() => null);
  if (!s || s.round.status !== "settled") return;
  const t = loadTally(ns);
  if (t.coins.some((c) => c.roundId === s.round.roundId)) return;
  const row = s.leaderboard.find((r) => r.id === s.me.teamId);
  if (!row) return;
  t.coins.push({ roundId: s.round.roundId, rank: row.rank, of: s.leaderboard.length, pnlC: s.me.valueC - s.me.startC, p: s.round.p });
  save(`${ns}:tally`, t.coins);
}

/* ── the adapter ───────────────────────────────────────────────────────── */

const PRIOR_HINT = {
  uniform: "Every p from 0 to 1 equally likely.",
  beta05: "Beta(½, ½): lopsided coins are common.",
  beta03: "Beta(0.3, 0.3): most coins sit near 0 or near 1.",
};

const room = {
  week: 3,
  title: "Coin Flips",
  blurb:
    "A coin with a hidden chance of heads, p. Buy flips of it at $100 each, then trade a share that pays 100 × p against a room that saw different flips. Then write a strategy for the five-coin bandit.",
  howTo: [
    "Make your team. Then choose how many flips to buy: more flips, sharper estimate, less money to trade with.",
    "Open the flip window. When it closes, everyone's flips are dealt at once and trading opens on a 1–99 ladder.",
    "Click a bid to buy, an offer to sell. Everyone saw different flips, so everyone has a different fair value.",
    "At the bell p is revealed and every share pays out. Most money wins, flips included. Then flip another coin.",
    "Bandit Lab (top of the game): write a five-coin strategy in plain English. There is no AI in solo; an offline quick-compiler reads common phrasings.",
  ],
  botTeams: { min: 3, max: 12, def: 7 },
  settings: [
    {
      key: "prior",
      label: "The coin is drawn from",
      type: "seg",
      def: "uniform",
      options: [
        { v: "uniform", l: "Uniform" },
        { v: "beta05", l: "U-shaped" },
        { v: "beta03", l: "Very U-shaped" },
      ],
      hint: (v) => `${PRIOR_HINT[v]} Everyone is told this; it is the Bayesian's prior.`,
    },
    {
      key: "settlement",
      label: "A share pays",
      type: "seg",
      def: "prob",
      options: [
        { v: "prob", l: "100 × p" },
        { v: "flip", l: "One final flip" },
      ],
      hint: (v) => (v === "flip" ? "The coin is flipped once more at the bell: $100 on heads, $0 on tails. Same average, far more risk." : "If p turns out to be 0.37, every share pays $37."),
    },
    {
      key: "simSeconds",
      label: "Flip window",
      type: "seg",
      def: 30,
      options: [
        { v: 20, l: "20 s" },
        { v: 30, l: "30 s" },
        { v: 60, l: "60 s" },
      ],
    },
    {
      key: "minutes",
      label: "Trading",
      type: "seg",
      def: 3,
      options: [
        { v: 2, l: "2 min" },
        { v: 3, l: "3 min" },
        { v: 5, l: "5 min" },
      ],
    },
  ],

  async setup({ admin, cfg, you, botTeams, level, seed }) {
    await local.post("admin/round", { token: admin, ...roundBody(cfg), seed: `${seed}|coin0` });

    const seats = [];
    for (let i = 0; i < you.length; i++) {
      seats.push(await local.post("join", { name: you[i], deviceId: `solo-w3-you-${i}-${seed}`, fp: "solo0000" }));
    }

    const skills = roomSkills(level, botTeams * 2, seed);
    const tn = teamNames(botTeams, seed);
    const names = botNames(botTeams * 2, seed);
    const r = rng(`setup|${seed}`);
    const bots = [];
    let hoarders = 0;
    let k = 0;
    for (let t = 0; t < botTeams; t++) {
      const members = r() < 0.35 ? 2 : 1;
      let code = null;
      for (let m = 0; m < members; m++) {
        const name = names[k] ?? `Trader${k}`;
        const p = await joinAs(name, `solo-w3-bot-${k}-${seed}`);
        if (!code) code = (await local.post("team/create", auth(p, { name: tn[t] }))).code;
        else await local.post("team/join", auth(p, { code }));
        const P = persona(skills[k], `${seed}|${k}`);
        // How this student reads flips. The weaker the student, the likelier heads ÷ flips.
        P.freq = r() < { stale: 0.8, anchored: 0.9, gambler: 0.85, fatfinger: 0.7, steady: 0.35, alpha: 0 }[P.kind];
        if (!hoarders && P.kind !== "alpha" && r() < 0.18) {
          P.hoard = true;
          hoarders++;
        }
        bots.push({ playerId: p.playerId, token: p.token, name, persona: P, lead: m === 0, team: tn[t], lab: m === 0 ? labPlan(skills[k], r) : [] });
        k++;
      }
    }

    // A few teams have already been in the lab when you walk in.
    const early = bots.filter((b) => b.lab.length).slice(0, 3);
    const progress = {};
    for (const b of early) {
      await labStep(b, b.lab[0]).catch(() => null);
      progress[b.playerId] = 1;
    }
    return { seats, bots, extra: { labProgress: progress } };
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
    const timers = [];
    const browser = typeof window !== "undefined";

    if (browser) {
      // The friend joins your team as soon as there is one; your results are kept per coin.
      timers.push(
        setInterval(() => {
          room.afterSeat(getSeats()).catch(() => {});
          recordIfSettled(ns).catch(() => {});
        }, 1500)
      );
    }

    // The bandit lab, a run at a time, only while the coin market is quiet.
    const progKey = `${ns}:lab`;
    const prog = load(progKey, meta.extra?.labProgress ?? {});
    let lastRun = Date.now();
    let settledSeen = null;
    let labBusy = false;
    const nextAt = new Map(meta.bots.map((b, i) => [b.playerId, Date.now() + 15_000 + i * 9_000 + Math.random() * 30_000]));
    const labTick = async () => {
      if (labBusy) return;
      const c = await local.get("config").catch(() => null);
      const status = c?.round?.status;
      if (status === "settled") settledSeen ??= Date.now();
      else settledSeen = null;
      const quiet = status === "lobby" || (status === "settled" && Date.now() - settledSeen > 12_000);
      if (!quiet || Date.now() - lastRun < 7_000 / Runner.speed) return;
      const now = Date.now();
      const due = meta.bots.filter((b) => b.lab?.length > (prog[b.playerId] ?? 0) && (nextAt.get(b.playerId) ?? 0) <= now);
      if (!due.length) return;
      const b = due[Math.floor(Math.random() * due.length)];
      labBusy = true;
      try {
        await labStep(b, b.lab[prog[b.playerId] ?? 0]);
      } catch {}
      labBusy = false;
      prog[b.playerId] = (prog[b.playerId] ?? 0) + 1;
      save(progKey, prog);
      lastRun = Date.now();
      nextAt.set(b.playerId, Date.now() + (40_000 + Math.random() * 80_000) / Runner.speed);
    };
    timers.push(setInterval(() => labTick().catch(() => {}), 2500 / Runner.speed));

    const stop = runner.stop.bind(runner);
    runner.stop = () => {
      timers.forEach(clearInterval);
      stop();
    };
    return runner;
  },

  controls({ round, admin, meta }) {
    if (!round) return [];
    const cfg = meta.cfg;
    if (round.status === "lobby") {
      const needTeam = async () => {
        const seats = getSeats();
        const s0 = await local.get("state", { playerId: seats[0]?.playerId, token: seats[0]?.token }).catch(() => null);
        return s0?.team ? null : { note: "Make your team first (create one on the left)." };
      };
      return [
        {
          key: "open",
          label: "Open the flip window",
          primary: true,
          hint: `Everyone has ${cfg.simSeconds} s to choose their flips; trading opens when it closes`,
          run: async () => (await needTeam()) ?? (await admin("start"), null),
        },
      ];
    }
    if (round.status === "sims") {
      return [
        { key: "deal", label: "Deal the flips now", primary: true, hint: "Close the window early: everyone gets what they have picked so far", run: () => admin("skip-sims") },
        { key: "more", label: "+30 s", run: () => admin("extend", { seconds: 30 }) },
      ];
    }
    if (round.status === "live") {
      return [
        { key: "ext", label: "+1 min", run: () => admin("extend", { seconds: 60 }) },
        { key: "bell", label: "Ring the bell", hint: "Stop trading now and reveal the coin", run: () => admin("end") },
      ];
    }
    const next = async (extra) => {
      await admin("round", { keepPlayers: true, ...roundBody(cfg, extra) });
      return { remount: true };
    };
    return [
      { key: "again", label: "Next coin", primary: true, hint: "Same teams, fresh $10,000, a new coin", run: () => next({}) },
      {
        key: "surprise",
        label: "Next coin: surprise me",
        hint: "A random prior and settlement (you'll be told which)",
        run: () =>
          next({
            prior: ["uniform", "beta05", "beta03"][Math.floor(Math.random() * 3)],
            settlement: Math.random() < 0.4 ? "flip" : "prob",
          }),
      },
    ];
  },

  status({ round, ns }) {
    if (!round) return "";
    const t = loadTally(ns);
    const n = t.coins.length + (round.status === "settled" && !t.coins.some((c) => c.roundId === round.roundId) ? 1 : 0);
    const coin = `Coin ${round.status === "settled" ? Math.max(1, n) : t.coins.length + 1}`;
    const pays = round.settlement === "flip" ? "one final flip" : "100 × p";
    if (round.status === "lobby") return `${coin} · ${round.teams} teams · ${round.priorName} prior · pays ${pays} · pick your flips, then open the window`;
    if (round.status === "sims") return `${coin} · Flip window · ${mmss(round.msLeft ?? 0)} left · choose how many flips to buy`;
    if (round.status === "live") return `${coin} · Trading · ${mmss(round.msLeft ?? 0)} left · ${round.priorName} prior · pays ${pays}`;
    const mine = t.coins.find((c) => c.roundId === round.roundId);
    const wins = t.coins.filter((c) => c.rank === 1).length;
    const p = round.p != null ? `p was ${(round.p * 100).toFixed(1)}` : "settled";
    return `${coin} · ${p}${mine ? ` · your team ${ord(mine.rank)} of ${mine.of}` : ""}${t.coins.length > 1 ? ` · session: ${wins} win${wins === 1 ? "" : "s"} in ${t.coins.length} coins` : ""}`;
  },
};

export default room;

/* ── one bot's turn ────────────────────────────────────────────────────── */

const memory = new Map();

function mem(bot, roundId) {
  let m = memory.get(bot.playerId);
  if (!m || m.roundId !== roundId) {
    const r = rng(`flips|${bot.playerId}|${roundId}`);
    m = { roundId, want: flipsWanted(bot.persona, r), bias: gauss(r), first: new Map(), lobbyPick: r() < 0.4 };
    memory.set(bot.playerId, m);
  }
  return m;
}

export async function step(bot) {
  const s = await local.get("state", { playerId: bot.playerId, token: bot.token });
  const round = s.round;
  const me = s.me;
  const P = bot.persona;
  const M = mem(bot, round.roundId);
  const r = rng(`${bot.playerId}|${Date.now()}|${Math.random()}`);

  /* the flip window: order once, at some point while it is open */
  if (round.status === "lobby" || round.status === "sims") {
    if (round.status === "lobby" && !M.lobbyPick) return;
    if (round.status === "sims" && r() < 0.3 && round.msLeft > 6000) return; // still thinking
    const most = Math.floor(me.cashC / round.simCostC);
    const n = Math.min(M.want, most);
    if (me.simOrder !== n) await local.post("sims/order", auth(bot, { n }));
    return;
  }
  if (round.status !== "live") return;
  if (!me.sims) {
    await local.post("sims/late", auth(bot, { n: Math.min(M.want, Math.floor(me.spendableC / round.simCostC)) })).catch(() => {});
    return;
  }

  const order = (o) => local.post("order", auth(bot, { side: o.side, px: o.px, qty: o.qty }));
  const cancel = (o) => local.post("cancel", auth(bot, { orderId: o.id }));
  const cancelId = (id) => local.post("cancel", auth(bot, { orderId: id }));
  const m = s.market;
  const lo = round.orderMin;
  const hi = round.orderMax;

  const turn = mood(P, r);
  if (turn === "skip") return;
  if (turn === "yolo") {
    const side = r() < 0.5 ? "B" : "A";
    const touch = side === "B" ? m.bestAsk : m.bestBid;
    if (touch == null) return;
    const px = side === "B" ? Math.min(hi, touch + 2) : Math.max(lo, touch - 2);
    const res = await order({ side, px, qty: clamp(Math.round(P.size * 2 * (0.4 + r() * 0.8)), 3, 40) }).catch(() => null);
    if (res?.resting?.id != null) await cancelId(res.resting.id).catch(() => {});
    return;
  }

  const prior = PRIORS[round.prior] ?? PRIORS.uniform;
  const sims = me.sims;
  const own = belief(P.freq, prior, sims.n, sims.heads);
  const mid = m.bestBid != null && m.bestAsk != null ? (m.bestBid + m.bestAsk) / 2 : m.last ?? null;

  // A good player treats the book as other people's flips and weighs it by how
  // much has traded; everyone else leans on it by temperament.
  let fair;
  if (P.kind === "alpha" && mid != null) {
    const mkt = clamp(6 + (m.volume ?? 0) / 15, 6, 35);
    const mine = sims.n + prior.a + prior.b;
    fair = own.mean + (mid - own.mean) * (mkt / (mkt + mine));
  } else {
    // Heads ÷ flips people trust their own coins: they barely look at the book.
    fair = blend(anchor(M.first, "p", own.mean, P.stick), mid, P.freq ? P.herd * 0.4 : P.herd);
  }
  fair = clamp(fair + M.bias * P.noise * 2, 2, 98);

  // An alpha with almost no flips and a book that disagrees buys one more, dear.
  if (P.kind === "alpha" && sims.n < 6 && mid != null && Math.abs(own.mean - mid) > 12 && r() < 0.05 && me.spendableC > round.liveFlipCostC * 4) {
    await local.post("sims/extra", auth(bot)).catch(() => {});
    return;
  }

  const risk = round.settlement === "flip" ? 1.25 : 1;
  const half = clamp(P.width * own.sd * 0.45 * risk, 1, 9);
  const edge = Math.max(2, P.edge * own.sd * 0.5 * risk);
  // Students here trade in tens of shares; scale the persona up to that.
  const size = clamp(Math.round(P.size * 3 * (round.settlement === "flip" ? 0.7 : 1)), 4, 50);

  const took = await takeIfCheap({ fair, edge, size: P.kind === "alpha" ? size : Math.max(2, Math.round(size / 2)), bestBid: m.bestBid, bestAsk: m.bestAsk, lo, hi, order, cancelId });
  if (took && P.kind !== "alpha") return;

  if (r() < P.maker) {
    const fresh = took ? await local.get("state", { playerId: bot.playerId, token: bot.token }) : s;
    await requote({
      bot,
      fair: fair + fatFinger(P, r, half),
      half,
      size,
      lo,
      hi,
      orders: fresh.me.orders,
      order,
      cancel,
      skew: inventorySkew(fresh.me.pos ?? 0, size, 1.2),
    });
  }
}
