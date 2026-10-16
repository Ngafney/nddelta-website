/**
 * The room, simulated. Every bot is an ordinary player: it joins through the
 * same `POST join`, sits on a team, sees only what a player's `GET state`
 * shows it plus its own private information (its team's number, its own coin
 * flips, its own points on the curve…), and trades through `POST order`.
 * Nothing here reads the secret. A bot is as informed as a student would be.
 *
 * In the live meeting the students are the market makers. Here the bots have
 * to be, so most of them quote both sides around what THEY think it is worth,
 * lean on what the book says, and lift anything that looks clearly wrong.
 *
 * Each week supplies the brain (what is it worth, to this bot?); this file
 * supplies the hands: personas, pacing, quoting and taking.
 */

import { local } from "./local.js";

/* ── deterministic-enough randomness per bot ───────────────────────────── */

export function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i++) {
    h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(r) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/* ── names ─────────────────────────────────────────────────────────────── */

const FIRST = [
  "Liam", "Maya", "Owen", "Sofia", "Ethan", "Grace", "Lucas", "Ava", "Henry", "Nora", "Jack", "Clara", "Leo", "Ella", "Sam",
  "Isla", "Ben", "Zoe", "Max", "Lily", "Theo", "Ruby", "Finn", "Mia", "Cole", "Anna", "Will", "Kate", "Ryan", "Tess",
  "Nick", "Jade", "Luke", "Ivy", "Matt", "Rose", "Alex", "June", "Dev", "Priya", "Kenji", "Omar", "Elena", "Diego", "Hana",
];
const TEAMS = [
  "Golden Domers", "Basis Points", "Long Gamma", "The Arbs", "Dome Capital", "Fat Tails", "Bid Wall", "Mean Reverters",
  "Random Walkers", "Sharpe Shooters", "Leprechaun LP", "Market Makers", "The Spread", "Delta Hedgers", "Alpha Irish",
  "Stochastic Kids", "Tick Size", "Order Flow", "The Shorts", "Black Swans",
];

export function botNames(count, seed) {
  const r = rng(`names|${seed}`);
  const pool = FIRST.slice();
  const out = [];
  for (let i = 0; i < count; i++) {
    const j = Math.floor(r() * pool.length);
    out.push(pool.splice(j, 1)[0] ?? `Trader${i + 1}`);
  }
  return out;
}

export function teamNames(count, seed) {
  const r = rng(`teams|${seed}`);
  const pool = TEAMS.slice();
  const out = [];
  for (let i = 0; i < count; i++) {
    const j = Math.floor(r() * pool.length);
    out.push(pool.splice(j, 1)[0] ?? `Team ${i + 1}`);
  }
  return out;
}

/* ── personas ──────────────────────────────────────────────────────────── */

/**
 * skill: "casual" | "sharp" | "shark". A persona is a handful of dials the
 * week's brain and the quoting hands both read:
 *   noise   how wrong its private estimate is (in units of the game's sd)
 *   herd    how much it trusts the book's mid over its own number (0…1)
 *   width   how wide it quotes, as a multiple of its own uncertainty
 *   edge    how far off a price must be before it takes it
 *   size    shares per quote
 *   paceMs  how long it thinks between moves
 *   maker   probability it quotes on a turn (vs only taking)
 */
export function persona(skill, seed) {
  const r = rng(`persona|${seed}`);
  const j = (lo, hi) => lo + (hi - lo) * r();
  const base = {
    casual: { noise: j(0.6, 1.2), herd: j(0.15, 0.45), width: j(0.9, 1.6), edge: j(1.2, 2.5), size: Math.round(j(3, 10)), paceMs: j(3200, 6500), maker: j(0.55, 0.85) },
    sharp: { noise: j(0.25, 0.6), herd: j(0.25, 0.5), width: j(0.55, 1.0), edge: j(0.7, 1.4), size: Math.round(j(5, 15)), paceMs: j(2200, 4500), maker: j(0.65, 0.9) },
    shark: { noise: j(0.05, 0.25), herd: j(0.2, 0.4), width: j(0.35, 0.7), edge: j(0.4, 0.9), size: Math.round(j(8, 20)), paceMs: j(1500, 3200), maker: j(0.7, 0.95) },
  }[skill];
  if (!base) return persona("sharp", seed);
  // The kinds of student that make a room worth trading in. Weak players are
  // where the money is; strong ones punish you for being one.
  const kinds = {
    casual: [
      ["stale", 0.35], // quotes, then forgets about them while the news moves
      ["anchored", 0.25], // made up their mind early and barely updates
      ["gambler", 0.2], // hits and lifts on a hunch
      ["fatfinger", 0.2], // the occasional quote in the wrong place
    ],
    sharp: [
      ["steady", 0.6],
      ["stale", 0.2],
      ["anchored", 0.1],
      ["alpha", 0.1],
    ],
    shark: [
      ["alpha", 0.65],
      ["steady", 0.35],
    ],
  }[skill];
  let x = r();
  let kind = kinds[kinds.length - 1][0];
  for (const [k, w] of kinds) {
    if ((x -= w) <= 0) {
      kind = k;
      break;
    }
  }
  const traits = {
    // lazy: chance a turn is skipped entirely (quotes left where they were)
    // stick: weight on its first-ever estimate (0 = always fresh)
    // yolo: chance a turn is a random market order
    // fat: chance a quote lands several ticks off
    stale: { lazy: j(0.55, 0.8), stick: 0, yolo: 0, fat: 0 },
    anchored: { lazy: j(0.1, 0.3), stick: j(0.6, 0.85), yolo: 0, fat: 0 },
    gambler: { lazy: j(0.1, 0.3), stick: 0, yolo: j(0.25, 0.45), fat: 0, noise: base.noise * 1.5 },
    fatfinger: { lazy: j(0.1, 0.3), stick: 0, yolo: 0.05, fat: j(0.12, 0.25) },
    steady: { lazy: j(0, 0.12), stick: 0, yolo: 0, fat: 0 },
    alpha: { lazy: 0, stick: 0, yolo: 0, fat: 0, noise: base.noise * 0.5, edge: base.edge * 0.7, paceMs: base.paceMs * 0.75 },
  }[kind];
  return { ...base, ...traits, kind, skill, seed: String(seed) };
}

/**
 * What kind of turn this is, from the persona: "skip" (leave everything as it
 * is), "yolo" (a hunch: hit or lift), or "trade" (think, then take or quote).
 */
export function mood(P, r) {
  if (P.lazy && r() < P.lazy) return "skip";
  if (P.yolo && r() < P.yolo) return "yolo";
  return "trade";
}

/**
 * Anchoring: blend what the bot thinks now with what it thought the first time
 * it looked at this book in this round. `memo` is a Map kept per bot.
 */
export function anchor(memo, key, now, stick) {
  if (!memo.has(key)) memo.set(key, now);
  return stick ? memo.get(key) * stick + now * (1 - stick) : now;
}

/** A fat finger: some ticks the wrong way, on one side. */
export function fatFinger(P, r, half) {
  if (!P.fat || r() >= P.fat) return 0;
  return (r() < 0.5 ? -1 : 1) * (half * 2 + 2 + Math.floor(r() * 4));
}

/** Mix the levels: a room is never all one kind of student. */
export function roomSkills(level, n, seed) {
  const r = rng(`mix|${seed}`);
  const mix = {
    casual: [0.7, 0.3, 0],
    sharp: [0.25, 0.55, 0.2],
    shark: [0.05, 0.4, 0.55],
  }[level] ?? [0.25, 0.55, 0.2];
  return Array.from({ length: n }, () => {
    const x = r();
    return x < mix[0] ? "casual" : x < mix[0] + mix[1] ? "sharp" : "shark";
  });
}

/* ── the runner ────────────────────────────────────────────────────────── */

/**
 * Runs every bot's `step` on its own jittered clock. A step that throws is
 * logged and the bot carries on: a rejected order is a normal day.
 */
export class Runner {
  /** The headless harness runs rooms faster than real time. */
  static speed = 1;
  constructor(bots, step) {
    this.bots = bots;
    this.step = step;
    this.timers = new Map();
    this.running = false;
    this.paused = false;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.bots.forEach((b, i) => this.schedule(b, (600 + i * 350 + Math.random() * 900) / Runner.speed));
  }
  stop() {
    this.running = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
  setPaused(p) {
    this.paused = p;
  }
  schedule(b, ms) {
    if (!this.running) return;
    const t = setTimeout(async () => {
      if (!this.running) return;
      if (!this.paused) {
        try {
          await this.step(b);
        } catch (e) {
          if (e?.status >= 500 || !e?.status) console.warn(`[bot ${b.name}]`, e?.message ?? e);
        }
      }
      const pace = b.persona?.paceMs ?? 3000;
      this.schedule(b, (pace * (0.6 + Math.random() * 0.8)) / Runner.speed);
    }, ms);
    this.timers.set(b.playerId, t);
  }
}

/* ── hands ─────────────────────────────────────────────────────────────── */

export const auth = (bot, body = {}) => ({ ...body, playerId: bot.playerId, token: bot.token });

export async function joinAs(name, deviceId) {
  return local.post("join", { name, deviceId, fp: `bot${deviceId.slice(-6)}` });
}

const clampPx = (px, lo, hi) => Math.max(lo, Math.min(hi, px));

/**
 * Keep one bid and one offer resting in `mkt` around `fair`, `half` either
 * side, and pull anything else this bot has in that book. Prices are snapped
 * to the tick and clamped to [lo, hi]. Orders already where they should be are
 * left alone, so the bot keeps its place in the queue.
 *
 * `orders` is me.orders from GET state (each has id, mkt, side, px, qty).
 * `order`/`cancel` are the week's own POST shapes, so this works across weeks
 * whose order bodies differ slightly.
 */
export async function requote({ bot, mkt, fair, half, size, tick = 1, lo, hi, orders, order, cancel, skew = 0, sides = "both" }) {
  const snapDown = (x) => Math.floor(x / tick + 1e-9) * tick;
  const snapUp = (x) => Math.ceil(x / tick - 1e-9) * tick;
  let bid = clampPx(snapDown(fair - half + skew), lo, hi);
  let ask = clampPx(snapUp(fair + half + skew), lo, hi);
  if (ask <= bid) ask = clampPx(bid + tick, lo, hi);
  if (ask <= bid) bid = clampPx(ask - tick, lo, hi);
  const mine = orders.filter((o) => o.mkt === mkt || o.market === mkt || o.book === mkt);
  const want = [];
  if (sides !== "ask" && bid >= lo && bid < hi) want.push({ side: "B", px: bid });
  if (sides !== "bid" && ask <= hi && ask > lo) want.push({ side: "A", px: ask });
  // Pull what is off target.
  for (const o of mine) {
    const keep = want.find((w) => w.side === o.side && w.px === o.px);
    if (!keep) {
      try {
        await cancel(o);
      } catch {}
    }
  }
  for (const w of want) {
    if (mine.some((o) => o.side === w.side && o.px === w.px)) continue;
    let q = size;
    for (let tries = 0; tries < 3 && q >= 1; tries++) {
      try {
        await order({ mkt, side: w.side, px: w.px, qty: q });
        break;
      } catch (e) {
        // Margin or position cap: try smaller, then give up on this side.
        q = Math.floor(q / 2);
      }
    }
  }
}

/**
 * Take what is clearly wrong: buy any offer at least `edge` under fair, sell
 * into any bid at least `edge` over it. One aggressive limit order per side,
 * whatever does not fill is pulled straight away (the engine fills it at the
 * resting prices, best first).
 */
export async function takeIfCheap({ mkt, fair, edge, size, bestBid, bestAsk, tick = 1, lo, hi, order, cancelId }) {
  let did = false;
  if (bestAsk != null && bestAsk <= fair - edge) {
    const px = clampPx(Math.floor((fair - edge) / tick) * tick, lo, hi);
    const r = await order({ mkt, side: "B", px, qty: size }).catch(() => null);
    if (r?.resting?.id != null) await cancelId(r.resting.id).catch(() => {});
    did = !!r;
  }
  if (bestBid != null && bestBid >= fair + edge) {
    const px = clampPx(Math.ceil((fair + edge) / tick) * tick, lo, hi);
    const r = await order({ mkt, side: "A", px, qty: size }).catch(() => null);
    if (r?.resting?.id != null) await cancelId(r.resting.id).catch(() => {});
    did = did || !!r;
  }
  return did;
}

/** Blend a private estimate with what the book is saying, as a student would. */
export function blend(own, mid, herd) {
  if (mid == null || !Number.isFinite(mid)) return own;
  return own * (1 - herd) + mid * herd;
}

/** Lean quotes against inventory so a bot does not keep piling into one side. */
export function inventorySkew(pos, size, perUnit) {
  if (!pos) return 0;
  return -Math.max(-6, Math.min(6, pos / Math.max(1, size * 2))) * perUnit;
}
