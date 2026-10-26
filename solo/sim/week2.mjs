/**
 * Headless check of the week 2 room: the real server, the real bots, whole
 * rounds. Prints who made money (by bot kind), how much traded, how wide the
 * book was, how the mid walked toward min f as the room bought steps, and how
 * a "probe" player did:
 *
 *   probe=none    sits on its hands (should finish at $0)
 *   probe=smart   takes a few steps (Newton, a jump if its valley is flat), then mostly
 *                 sells: every bid above its own ceiling or well above its estimate;
 *                 it only buys back (to cover) once its valley is flat and offers are cheap.
 *                 20 shares a click, about one click a second.
 *
 * node solo/sim/week2.mjs [rounds=3] [probe=smart] [level=sharp] [teams=7] [curve=bumpy] [minutes=1.5] [stepCost=500] [probeSteps=4]
 */
import { register } from "node:module";

// The handler's own kv.js would write week2/.data; swap in the solo store.
const SOLO_KV = new URL("../shared/kv.js", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  const r = await next(spec, ctx);
  if (/week2[\\/]server[\\/]kv\.js$/.test(r.url)) return { ...r, url: ${JSON.stringify(SOLO_KV)} };
  return r;
}`)
);

process.env.KV_FORCE_MEMORY = "1";
process.env.SESSION_SECRET = "sim";

const { handle } = await import("../../week2/server/handler.js");
const { installHandler, local } = await import("../shared/local.js");
const { Runner } = await import("../shared/bots.js");
const room = (await import("../week2/room.js")).default;
const { belief, planStep, localView, stats } = await import("../week2/room.js");

let errors = 0;
for (const k of ["error", "warn"]) {
  const orig = console[k];
  console[k] = (...a) => {
    errors++;
    if (errors < 8) orig(...a);
  };
}

installHandler(handle);
const args = process.argv.slice(2);
const rounds = Number(args[0] ?? 3);
const probe = args[1] ?? "smart";
const level = args[2] ?? "sharp";
const teams = Number(args[3] ?? 7);
const curve = args[4] ?? "bumpy";
const minutes = Number(args[5] ?? 1.5);
const stepCost = Number(args[6] ?? 500);
const probeMaxSteps = Number(args[7] ?? 4);
const SPEED = 2.5;
Runner.speed = SPEED;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
for (let n = 0; n < rounds; n++) {
  const { token: admin } = await local.post("admin/auth", { password: "123" });
  await local.post("admin/reset", { token: admin, confirm: "RESET" }).catch(() => {});
  const seed = `sim${n}${Date.now() % 1e6}`;
  const cfg = { curve, minutes, stepCost };
  const out = await room.setup({ admin, cfg, you: ["Probe"], botTeams: teams, level, seed });
  const me = out.seats[0];
  const P = { playerId: me.playerId, token: me.token };
  await local.post("team/create", { ...P, name: "Probe Team" });
  const meta = { admin, cfg, bots: out.bots };
  const runner = room.bots({ meta });
  runner.start();
  await local.post("admin/start", { token: admin, minutes });
  const t0 = Date.now();

  const spreads = [];
  const twoSided = [];
  const track = [];
  let probeTrades = 0;
  let probeSteps = 0;
  let jumps = 0;
  while (true) {
    const s = await local.get("state", P);
    if (s.round.status === "settled") break;
    const mk = s.market;
    twoSided.push(mk.bestBid != null && mk.bestAsk != null ? 1 : 0);
    if (mk.bestBid != null && mk.bestAsk != null) spreads.push(mk.bestAsk - mk.bestBid);
    track.push({ t: (Date.now() - t0) / 1000, mid: mk.bestBid != null && mk.bestAsk != null ? (mk.bestBid + mk.bestAsk) / 2 : null, last: mk.last });
    if (probe === "smart") {
      const msLeft = s.round.endsAt - s.round.serverNow;
      if (probeSteps < probeMaxSteps && msLeft > 10_000) {
        const v = localView(s.me.points);
        const pl = planStep(s.me.points, { explore: jumps < 3 });
        if (pl) {
          const r = await local.post("descend", { ...P, anchorX: pl.anchorX, lr: pl.lr }).catch(() => null);
          if (r) {
            probeSteps++;
            if (Math.abs(v.b.d) < 0.05) jumps++;
          }
        }
      }
      const s2 = await local.get("state", P);
      const b = belief(s2.me.points, {});
      const edge = Math.max(10, b.sd * 0.6);
      const m2 = s2.market;
      // A sure thing: anything bid above the lowest height I have seen.
      if (m2.bestBid != null && (m2.bestBid > b.lb || m2.bestBid >= b.fair + edge) && s2.me.pos > -150) {
        const r = await local.post("order", { ...P, side: "A", px: m2.bestBid, qty: 20 }).catch(() => null);
        if (r?.resting) await local.post("cancel", { ...P, orderId: r.resting.id });
        if (r?.filled) probeTrades += r.filled;
      } else if (b.converged && m2.bestAsk != null && m2.bestAsk <= b.fair - 2 * edge && s2.me.pos < 0) {
        const r = await local.post("order", { ...P, side: "B", px: m2.bestAsk, qty: 20 }).catch(() => null);
        if (r?.resting) await local.post("cancel", { ...P, orderId: r.resting.id });
        if (r?.filled) probeTrades += r.filled;
      }
    }
    await sleep(1000);
  }
  runner.stop();
  const rev = await local.get("reveal");
  const kinds = new Map(out.bots.map((b) => [b.name, `${b.persona.skill}/${b.persona.kind}`]));
  const byKind = {};
  const ins = await local.get("admin/inspect", { token: admin });
  let probePnl = 0;
  let stepsByKind = {};
  for (const p of ins.players) {
    const pnl = (p.valueC - 10_000_000) / 100;
    if (p.name === "Probe") probePnl = pnl;
    else {
      const k = kinds.get(p.name) ?? "?";
      (byKind[k] ??= []).push(pnl);
      (stepsByKind[k] ??= []).push(p.points - 1);
    }
  }
  const lb = (await local.get("leaderboard")).leaderboard;
  const probeRank = lb.find((r) => r.name === "Probe Team")?.rank;
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const quarter = (q) => {
    const t = track.filter((x, i) => i >= Math.floor(((q - 1) * track.length) / 4) && i < Math.floor((q * track.length) / 4)).map((x) => x.mid ?? x.last).filter((x) => x != null);
    return t.length ? Math.round(avg(t)) : "-";
  };
  const res = {
    difficulty: rev.difficulty,
    yStar: rev.yStar,
    volume: ins.volume,
    avgSpread: avg(spreads).toFixed(1),
    twoSided: `${Math.round(avg(twoSided) * 100)}%`,
    midByQuarter: [1, 2, 3, 4].map(quarter).join(" → "),
    lastTrade: track.at(-1)?.last,
    probePnl,
    probeRank: `${probeRank}/${lb.length}`,
    probeTrades,
    probeSteps,
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, xs]) => [k, xs.map((x) => Math.round(x)).join(",")])),
    stepsByKind: Object.fromEntries(Object.entries(stepsByKind).map(([k, xs]) => [k, xs.join(",")])),
    audit: ins.audit,
    botStats: JSON.stringify(stats),
  };
  results.push(res);
  console.log(JSON.stringify(res, null, 1));
}
const agg = {};
for (const r of results) for (const [k, v] of Object.entries(r.byKind)) for (const x of String(v).split(",")) (agg[k.split("/")[1]] ??= []).push(Number(x));
const stepsAgg = {};
for (const r of results) for (const [k, v] of Object.entries(r.stepsByKind)) for (const x of String(v).split(",")) (stepsAgg[k.split("/")[1]] ??= []).push(Number(x));
console.log("\nby kind (avg P&L, avg steps, n):");
for (const k of Object.keys(agg).sort()) console.log(`  ${k.padEnd(10)} ${Math.round(agg[k].reduce((a, b) => a + b, 0) / agg[k].length).toString().padStart(7)}  ${(stepsAgg[k].reduce((a, b) => a + b, 0) / stepsAgg[k].length).toFixed(1).padStart(5)}  ${agg[k].length}`);
console.log("probe ranks:", results.map((r) => r.probeRank).join(" "), " probe P&L:", results.map((r) => Math.round(r.probePnl)).join(" "));
const avgP = results.reduce((a, r) => a + r.probePnl, 0) / results.length;
console.log(`\nprobe=${probe} level=${level} curve=${curve}: average P&L ${avgP.toFixed(0)} over ${results.length} rounds; errors logged: ${errors}`);
process.exit(0);
