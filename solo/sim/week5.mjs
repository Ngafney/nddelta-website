/**
 * Headless check of the week 5 room: the real server, the real bots, whole
 * rounds, faster than real time (the clock is sped up for everyone: the
 * server, the desks, the rate limits and the bots' pacing, so the room
 * behaves as it would live, only sooner).
 *
 * Per round it prints what the process was (from the reveal, after the bell),
 * how much traded, how wide the book was, how far the room's mid sat from the
 * true value, who made money by bot kind, the house desks' P&L, and how a
 * probe player did:
 *
 *   probe=none    sits on its hands (should finish at $0)
 *   probe=ols     the lesson done properly (models.js bayesPrice: OLS,
 *                 bias-corrected, unit-root aware, watches for a change),
 *                 picks off anything 4+ points from that; never quotes
 *   probe=rw      the same, but believes a random walk (the naive mistake)
 *
 * node solo/sim/week5.mjs [rounds=4] [probe=ols] [level=sharp] [teams=7] [speed=3]
 */
import os from "node:os";
import path from "node:path";

process.env.KV_FORCE_MEMORY = "1";
process.env.SESSION_SECRET = "sim";
process.env.KV_DATA_FILE = path.join(os.tmpdir(), `w5sim-${process.pid}.json`);

const args = process.argv.slice(2);
const rounds = Number(args[0] ?? 4);
const probe = args[1] ?? "ols";
const level = args[2] ?? "sharp";
const teams = Number(args[3] ?? 7);
const SPEED = Number(args[4] ?? 3);

// One sped-up clock for everything that reads Date.now().
const realNow = Date.now.bind(Date);
const t0 = realNow();
Date.now = () => t0 + (realNow() - t0) * SPEED;

const { handle } = await import("../../week5/server/handler.js");
const { installHandler, local } = await import("../shared/local.js");
const { Runner } = await import("../shared/bots.js");
const room = (await import("../week5/room.js")).default;
const { processFor } = await import("../week5/room.js");
const { bayesPrice, rwPrice } = await import("../week5/models.js");

let serverErrors = 0;
const origErr = console.error;
console.error = (...a) => {
  serverErrors++;
  origErr(...a);
};
installHandler(handle);
Runner.speed = SPEED;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / SPEED)); // ms of game time

const results = [];
const { token: admin } = await local.post("admin/auth", { password: "123" });
const cfg = { process: "random", tick: 3, length: 60 };
const seed = `sim${t0 % 1e6}`;
let out = null;
let me = null;
let runner = null;
const adminCall = (route, body = {}) => local.post(`admin/${route}`, { ...body, token: admin });

for (let n = 0; n < rounds; n++) {
  if (n === 0) {
    out = await room.setup({ admin, cfg, you: ["Probe"], botTeams: teams, level, seed });
    me = out.seats[0];
    await local.post("team/create", { playerId: me.playerId, token: me.token, name: "Probe Team" });
    runner = room.bots({ meta: { admin, cfg, bots: out.bots, seed } });
    runner.start();
  } else {
    await adminCall("round", { keepPlayers: true, ...processFor(cfg, n, seed), researchMinutes: 1 });
  }
  await adminCall("start", { minutes: 0.25 });
  await sleep(1000);
  await adminCall("open");

  const spreads = [];
  const fills = new Map(); // name → [{side, px, qty, ts, cp}]
  const since = new Map();
  let live0 = null;
  const pullFills = async () => {
    for (const p of [me, ...out.bots]) {
      const st = await local.get("state", { playerId: p.playerId, token: p.token, since: since.get(p.playerId) ?? 0 }).catch(() => null);
      if (!st) continue;
      live0 ??= st.round.liveStartedAt != null ? { at: st.round.liveStartedAt, ms: st.round.tickMs } : null;
      for (const f of st.fills) {
        since.set(p.playerId, Math.max(since.get(p.playerId) ?? 0, f.s));
        const name = p === me ? "Probe" : p.name;
        (fills.get(name) ?? fills.set(name, []).get(name)).push(f);
      }
    }
  };
  let probeTrades = 0;
  while (true) {
    const s = await local.get("state", { playerId: me.playerId, token: me.token });
    if (s.round.status === "settled") break;
    const mk = s.market;
    if (mk.bestBid != null && mk.bestAsk != null) spreads.push(mk.bestAsk - mk.bestBid);
    else spreads.push(null);
    if (probe !== "none" && s.series?.ys && s.round.ticksLeft > 0) {
      const ys = s.series.ys;
      const fair = 100 * (probe === "rw" ? rwPrice(ys, s.round.K, s.round.ticksLeft) : bayesPrice(ys, s.round.K, s.round.ticksLeft, s.round.tickNow).p);
      const edge = 4;
      const pos = s.me.pos;
      if (mk.bestAsk != null && mk.bestAsk <= fair - edge && pos < 300) {
        const r = await local.post("order", { playerId: me.playerId, token: me.token, side: "B", px: Math.floor(fair - edge), qty: 20 }).catch(() => null);
        if (r?.resting) await local.post("cancel", { playerId: me.playerId, token: me.token, orderId: r.resting.id });
        if (r?.filled) probeTrades += r.filled;
      }
      if (mk.bestBid != null && mk.bestBid >= fair + edge && pos > -300) {
        const r = await local.post("order", { playerId: me.playerId, token: me.token, side: "A", px: Math.ceil(fair + edge), qty: 20 }).catch(() => null);
        if (r?.resting) await local.post("cancel", { playerId: me.playerId, token: me.token, orderId: r.resting.id });
        if (r?.filled) probeTrades += r.filled;
      }
    }
    await pullFills();
    await sleep(900);
  }
  await pullFills();
  const rev = await local.get("reveal");
  const ins = await local.get("admin/inspect", { token: admin });
  const kinds = new Map(out.bots.map((b) => [b.name, `${b.persona.skill}/${b.persona.kind}`]));
  const byKind = {};
  let probePnl = 0;
  for (const p of ins.players) {
    const pnl = (p.valueC - 1_000_000) / 100;
    if (p.name === "Probe") probePnl = pnl;
    else (byKind[kinds.get(p.name) ?? "?"] ??= []).push(pnl);
  }
  // Mid vs the true value, tick by tick (the reveal's own "room was off by").
  let errSum = 0;
  let errN = 0;
  let naiveErr = 0;
  for (const m of rev.mids) {
    const px = m.mid ?? m.last;
    if (px == null || m.t >= rev.T) continue;
    errSum += Math.abs(px - rev.fair[m.t]);
    naiveErr += Math.abs(rev.naive[m.t] - rev.fair[m.t]);
    errN++;
  }
  // Edge at the moment of each trade, against the TRUE value then: what the
  // trade was worth before the dice were rolled. Outcome luck washes out.
  const fairAtTs = (ts) => rev.fair[Math.max(0, Math.min(rev.T - 1, Math.floor((ts - live0.at) / live0.ms)))];
  const edgeOf = new Map();
  const deskEdge = {};
  for (const [name, fs] of fills) {
    let e = 0;
    for (const f of fs) {
      const x = (f.side === "B" ? fairAtTs(f.ts) - f.px : f.px - fairAtTs(f.ts)) * f.qty;
      e += x;
      if (/DESK/.test(f.cp)) deskEdge[f.cp] = (deskEdge[f.cp] ?? 0) - x;
    }
    edgeOf.set(name, Math.round(e));
  }
  const edgeByKind = {};
  for (const b of out.bots) (edgeByKind[`${b.persona.skill}/${b.persona.kind}`] ??= []).push(edgeOf.get(b.name) ?? 0);
  const two = spreads.filter((x) => x != null);
  const res = {
    process: `${rev.truth.preset} φ=${rev.truth.phi1}${rev.truth.switchTick != null ? `→${rev.truth.phi2}@${rev.truth.switchTick}` : ""}`,
    yOpen: rev.history.at(-1),
    yT: rev.yT,
    paid: rev.value,
    fairOpen: rev.fair[0],
    naiveOpen: rev.naive[0],
    volume: ins.volume,
    twoSided: `${Math.round((100 * two.length) / Math.max(1, spreads.length))}%`,
    avgSpread: two.length ? +(two.reduce((a, b) => a + b, 0) / two.length).toFixed(1) : null,
    roomErr: errN ? +(errSum / errN).toFixed(1) : null,
    naiveErr: errN ? +(naiveErr / errN).toFixed(1) : null,
    probePnl,
    probeEdge: edgeOf.get("Probe") ?? 0,
    deskEdge: Object.fromEntries(Object.entries(deskEdge).map(([k, v]) => [k, Math.round(v)])),
    edgeByKind: Object.fromEntries(Object.entries(edgeByKind).sort().map(([k, xs]) => [k, xs.join(",")])),
    probeTrades,
    desks: rev.desks.map((d) => `${d.name}:${Math.round(d.pnlC / 100)}`).join(" "),
    byKind: Object.fromEntries(Object.entries(byKind).sort().map(([k, xs]) => [k, xs.map((x) => Math.round(x)).join(",")])),
  };
  results.push(res);
  console.log(JSON.stringify(res, null, 1));
}
runner.stop();
const avg = (f) => results.reduce((a, r) => a + f(r), 0) / results.length;
console.log(`\nprobe=${probe} level=${level} teams=${teams}: avg probe P&L ${avg((r) => r.probePnl).toFixed(0)}, avg room error ${avg((r) => r.roomErr ?? 0).toFixed(1)} pts (naive ${avg((r) => r.naiveErr ?? 0).toFixed(1)}), avg spread ${avg((r) => r.avgSpread ?? 0).toFixed(1)}, server errors ${serverErrors}`);
// P&L by kind over every round.
const epool = {};
for (const r of results) for (const [k, v] of Object.entries(r.edgeByKind)) (epool[k] ??= []).push(...v.split(",").map(Number));
console.log("avg EDGE at trade (vs true value) by kind, $:", Object.fromEntries(Object.entries(epool).map(([k, xs]) => [k, Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)])));
console.log(`probe edge avg $${avg((r) => r.probeEdge).toFixed(0)}; by process:`, results.map((r) => `${r.process}: edge ${r.probeEdge} pnl ${r.probePnl}`).join(" | "));
const dpool = {};
for (const r of results) for (const [k, v] of Object.entries(r.deskEdge)) (dpool[k] ??= []).push(v);
console.log("desk edge avg $:", Object.fromEntries(Object.entries(dpool).map(([k, xs]) => [k, Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)])));
const pool = {};
for (const r of results) for (const [k, v] of Object.entries(r.byKind)) (pool[k] ??= []).push(...v.split(",").map(Number));
console.log("avg P&L by kind:", Object.fromEntries(Object.entries(pool).map(([k, xs]) => [k, `${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)} (n=${xs.length})`])));
process.exit(0);
