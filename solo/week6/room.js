/**
 * Week 6 — The Sum, solo.
 *
 * The room: N−1 bot teams, each with a secret number it picked the way people
 * pick (sevens and threes more than fives), plus you. Every bot knows its own
 * number and nothing else, works out what the sum is worth from that and from
 * the numbers already out, and makes a market around it — leaning on the book
 * the way a student leans on what the room is saying. The meeting's noise
 * desks still fire into whatever rests, as they do live.
 */

// Relative imports only: the headless harness (solo/sim) loads this file in Node.
import { local } from "../shared/local.js";
import { getSeats } from "../shared/api.js";
import { Runner, persona, roomSkills, botNames, teamNames, rng, gauss, auth, joinAs, requote, takeIfCheap, blend, inventorySkew, mood, anchor, fatFinger } from "../shared/bots.js";
import { payoff, sumPmf } from "../../week6/shared/game.js";
import { BOOK_ORDER } from "../../week6/shared/rules.js";

/** How people pick a "random" number 0–10 (more 7s, 3s and the ends, fewer 5s). */
const HUMAN_PICK = [7, 5, 6, 10, 6, 6, 5, 13, 7, 5, 8];
function humanPick(r) {
  const tot = HUMAN_PICK.reduce((a, b) => a + b, 0);
  let x = r() * tot;
  for (let i = 0; i < HUMAN_PICK.length; i++) {
    x -= HUMAN_PICK[i];
    if (x <= 0) return i;
  }
  return 7;
}

/**
 * What a bot believes S is, as a pmf over S, knowing only its own number n0,
 * N, and the numbers out so far. If its own number could already be out (one
 * of the revealed values equals n0) it weighs that exactly: with c copies of
 * n0 among r revealed, P(mine is out) = 11c / (11c + N − r) under a uniform
 * prior on everyone else.
 */
export function beliefPmf(n0, N, revealed) {
  const r = revealed.length;
  const sumR = revealed.reduce((a, b) => a + b, 0);
  const c = revealed.filter((x) => x === n0).length;
  const pOut = c ? (11 * c) / (11 * c + (N - r)) : 0;
  const out = new Map();
  const add = (base, m, w) => {
    if (w <= 0 || m < 0) return;
    const p = sumPmf(m);
    for (let s = 0; s < p.length; s++) if (p[s]) out.set(base + s, (out.get(base + s) ?? 0) + w * p[s]);
  };
  add(sumR, N - r, pOut); // mine is already in sumR: everyone left is a stranger
  add(sumR + n0, N - r - 1, 1 - pOut); // mine is still to come
  return out;
}

function expect(pmf, f) {
  let v = 0;
  for (const [s, p] of pmf) v += p * f(s);
  return v;
}

/* ── the adapter ───────────────────────────────────────────────────────── */

const room = {
  week: 6,
  title: "The Sum",
  blurb:
    "Every team hides a number from 0 to 10. S is the total. Trade the sum, a call and a put on it while the numbers come out one at a time.",
  howTo: [
    "Pick your team's secret number. Only your team knows it.",
    "Open trading. SUM pays $S a share; CALL pays max(S − K, 0); PUT pays max(K − S, 0).",
    "Numbers come out one by one. Nobody is told whose is whose.",
    "When the last one lands, every share pays out. Most money wins.",
  ],
  botTeams: { min: 3, max: 15, def: 7 },
  settings: [
    {
      key: "reveal",
      label: "Numbers come out",
      type: "seg",
      def: 20,
      options: [
        { v: 12, l: "Fast (12 s)" },
        { v: 20, l: "Normal (20 s)" },
        { v: 0, l: "When I click" },
      ],
    },
    {
      key: "books",
      label: "Books",
      type: "seg",
      def: "all",
      options: [
        { v: "all", l: "Sum, call & put" },
        { v: "sum", l: "Just the sum" },
      ],
    },
  ],

  async setup({ admin, cfg, you, botTeams, level, seed }) {
    const all = cfg.books !== "sum";
    await local.post("admin/round", {
      token: admin,
      books: { fut: true, call: all, put: all },
      autoOn: cfg.reveal > 0,
      autoEverySec: cfg.reveal > 0 ? cfg.reveal : 20,
      noise: { on: true, desks: 2, everySec: 14, size: 5, sweep: 3 },
      seed,
    });
    // Your seats. The floor's own gate makes your team and asks for your number.
    const seats = [];
    for (let i = 0; i < you.length; i++) {
      const p = await local.post("join", { name: you[i], deviceId: `solo-w6-you-${i}-${seed}`, fp: "solo0000" });
      seats.push(p);
    }
    // The bot teams: one or two traders each.
    const skills = roomSkills(level, botTeams * 2, seed);
    const tn = teamNames(botTeams, seed);
    const names = botNames(botTeams * 2, seed);
    const r = rng(`pick|${seed}`);
    const bots = [];
    let k = 0;
    for (let t = 0; t < botTeams; t++) {
      const members = r() < 0.35 ? 2 : 1;
      let team = null;
      const number = humanPick(r);
      for (let m = 0; m < members; m++) {
        const name = names[k] ?? `Trader${k}`;
        const p = await joinAs(name, `solo-w6-bot-${k}-${seed}`);
        if (!team) {
          const res = await local.post("team/create", auth(p, { name: tn[t], number }));
          team = res.team;
        } else {
          await local.post("team/join", auth(p, { code: team.code }));
        }
        bots.push({ playerId: p.playerId, token: p.token, name, persona: persona(skills[k], `${seed}|${k}`), lead: m === 0 });
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
    // The friend joins your team as soon as there is one.
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

  controls({ round, admin, meta }) {
    if (!round) return [];
    if (round.status === "lobby") {
      return [
        {
          key: "open",
          label: "Open trading",
          primary: true,
          hint: "Lock every number and open the books",
          run: async () => {
            const seats = getSeats();
            const s0 = await local.get("state", { playerId: seats[0]?.playerId, token: seats[0]?.token }).catch(() => null);
            if (!s0?.team) return { note: "Make your team and pick a number first." };
            if (s0.team.number == null) return { note: "Pick your team's number first." };
            await admin("open");
            if (meta.cfg.reveal > 0) await admin("auto", { on: true, everySec: meta.cfg.reveal });
            return null;
          },
        },
      ];
    }
    if (round.status === "live") {
      const out = [];
      const auto = round.auto?.on;
      out.push({ key: "reveal", label: "Reveal next", primary: !auto, run: () => admin("reveal") });
      out.push({
        key: "auto",
        label: auto ? `Auto: every ${round.auto.everySec}s` : "Auto: off",
        on: auto,
        hint: "Numbers come out on a clock",
        run: () => admin("auto", { on: !auto, everySec: meta.cfg.reveal || 20 }),
      });
      for (const k of ["call", "put"]) {
        if (!round.books?.[k]?.enabled) out.push({ key: `open-${k}`, label: `Open ${k.toUpperCase()}`, run: () => admin("books", { [k]: true }) });
      }
      return out;
    }
    return [
      {
        key: "again",
        label: "Play again",
        primary: true,
        hint: "Same teams, new numbers",
        run: async () => {
          const all = meta.cfg.books !== "sum";
          await admin("round", {
            keepPlayers: true,
            books: { fut: true, call: all, put: all },
            autoOn: meta.cfg.reveal > 0,
            autoEverySec: meta.cfg.reveal > 0 ? meta.cfg.reveal : 20,
            noise: { on: true, desks: 2, everySec: 14, size: 5, sweep: 3 },
          });
          return { remount: true };
        },
      },
    ];
  },

  status({ round }) {
    if (!round) return "";
    if (round.status === "lobby") return `Lobby · ${round.teams} teams · pick your number, then open trading`;
    if (round.status === "live") {
      const next = round.auto?.on && round.auto.nextAt ? Math.max(0, Math.ceil((round.auto.nextAt - round.serverNow) / 1000)) : null;
      return `Live · ${round.revealedCount} of ${round.N} out${next != null ? ` · next in ${next}s` : ""}`;
    }
    return `Settled · S = ${round.settleS}`;
  },
};

export default room;

/* ── one bot's turn ────────────────────────────────────────────────────── */

const memory = new Map(); // per bot: its private misreading of the room, and its first impressions

function mem(bot, roundId) {
  let m = memory.get(bot.playerId);
  if (!m || m.roundId !== roundId) {
    m = { roundId, bias: gauss(rng(`bias|${bot.playerId}|${roundId}`)), first: new Map() };
    memory.set(bot.playerId, m);
  }
  return m;
}

export async function step(bot, meta) {
  const s = await local.get("state", { playerId: bot.playerId, token: bot.token });
  const round = s.round;
  const team = s.team;
  const P = bot.persona;
  const r = rng(`${bot.playerId}|${Date.now()}|${Math.random()}`);

  if (round.status === "lobby") {
    // A new round with keepPlayers clears the numbers: the team lead picks again.
    if (team && team.number == null && bot.lead) {
      await local.post("team/number", auth(bot, { number: humanPick(r) }));
    }
    return;
  }
  if (round.status !== "live" || !team || team.number == null) return;

  const books = BOOK_ORDER.filter((k) => s.market[k]?.open);
  if (!books.length) return;
  const turn = mood(P, r);
  if (turn === "skip") return;

  const order = (o) => local.post("order", auth(bot, o));
  const cancel = (o) => local.post("cancel", auth(bot, { orderId: o.id }));
  const cancelId = (id) => local.post("cancel", auth(bot, { orderId: id }));

  // One book per turn, as a person would.
  const mkt = books[Math.floor(r() * books.length)];
  const m = s.market[mkt];
  const g = round.books[mkt];

  if (turn === "yolo") {
    // A hunch. Market order through the touch, whatever is there.
    const side = r() < 0.5 ? "B" : "A";
    const touch = side === "B" ? m.bestAsk : m.bestBid;
    if (touch == null) return;
    const px = side === "B" ? Math.min(g.orderMax, touch + 2) : Math.max(g.orderMin, touch - 2);
    const res = await order({ mkt, side, px, qty: Math.max(1, Math.round(P.size * (0.4 + r() * 0.8))) }).catch(() => null);
    if (res?.resting?.id != null) await cancelId(res.resting.id).catch(() => {});
    return;
  }

  const N = round.N;
  const K = round.K;
  const pmf = beliefPmf(team.number, N, round.revealed);
  const left = round.left;
  const M = mem(bot, round.roundId);
  const sd = Math.sqrt(Math.max(1, left) * 10); // sd of the sum still to come, ~3.16 a number
  // How far off this bot's sense of the rest of the room is; it shrinks as numbers come out.
  const shift = M.bias * P.noise * sd * 0.45;

  const ownNow = expect(pmf, (S) => payoff(mkt, S + shift, K));
  const own = anchor(M.first, mkt, ownNow, P.stick);
  const mid = m.bestBid != null && m.bestAsk != null ? (m.bestBid + m.bestAsk) / 2 : m.last ?? null;
  const fair = blend(own, mid, P.herd);

  // Option quotes scale with how much the option moves with S.
  const delta = mkt === "fut" ? 1 : mkt === "call" ? expect(pmf, (S) => (S + shift > K ? 1 : 0)) : expect(pmf, (S) => (S + shift < K ? 1 : 0));
  const unc = Math.max(0.6, sd * Math.max(0.15, delta));
  const half = Math.max(1, P.width * unc * 0.45);
  const edge = Math.max(1, P.edge * unc * 0.35);

  const took = await takeIfCheap({ mkt, fair, edge, size: Math.max(1, Math.round(P.size / 2)), bestBid: m.bestBid, bestAsk: m.bestAsk, lo: g.orderMin, hi: g.orderMax, order, cancelId });
  if (took && P.kind !== "alpha") return;

  if (r() < P.maker) {
    const fresh = await local.get("state", { playerId: bot.playerId, token: bot.token });
    await requote({
      bot,
      mkt,
      fair: fair + fatFinger(P, r, half),
      half,
      size: P.size,
      // A bid at 0 on an option buys nothing; the lowest useful quote is 1.
      lo: Math.max(g.orderMin, mkt === "fut" ? round.lo : 1),
      hi: Math.min(g.orderMax, mkt === "fut" ? round.hi : g.orderMax),
      orders: fresh.me.orders,
      order,
      cancel,
      skew: inventorySkew(fresh.me.pos?.[mkt] ?? 0, P.size, Math.max(0.5, unc * 0.15)),
    });
  }
}
