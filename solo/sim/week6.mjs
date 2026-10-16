/**
 * Headless check of the week 6 room: the real server, the real bots, a whole
 * round, faster than real time. Prints who made money (by bot kind), how much
 * traded, how wide the books were, and how a simple "probe" strategy did:
 *
 *   probe=none    sits on its hands (should finish at $0)
 *   probe=smart   knows its own number, prices like a bot with no bias, and
 *                 picks off anything 2+ away from that; never quotes
 *
 * node solo/sim/week6.mjs [rounds=3] [probe=smart] [level=sharp] [teams=7]
 */
import os from "node:os";
import path from "node:path";

process.env.KV_FORCE_MEMORY = "1";
process.env.SESSION_SECRET = "sim";
process.env.KV_DATA_FILE = path.join(os.tmpdir(), `w6sim-${process.pid}.json`);

const { handle } = await import("../../week6/server/handler.js");
const { installHandler, local } = await import("../shared/local.js");
const { Runner } = await import("../shared/bots.js");
const room = (await import("../week6/room.js")).default;
const { beliefPmf } = await import("../week6/room.js");
const { payoff } = await import("../../week6/shared/game.js");

installHandler(handle);
const [rounds = 3, probe = "smart", level = "sharp", teams = 7] = process.argv.slice(2).map((v, i) => (i === 0 || i === 3 ? Number(v) : v));
const SPEED = 4;
Runner.speed = SPEED;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
for (let n = 0; n < rounds; n++) {
  const { token: admin } = await local.post("admin/auth", { password: "123" });
  await local.post("admin/reset", { token: admin, confirm: "RESET" });
  const seed = `sim${n}${Date.now() % 1e6}`;
  const cfg = { reveal: 5, books: "all" };
  const out = await room.setup({ admin, cfg, you: ["Probe"], botTeams: teams, level, seed });
  const me = out.seats[0];
  const myNumber = 5;
  await local.post("team/create", { ...me, playerId: me.playerId, token: me.token, name: "Probe Team", number: myNumber });
  const meta = { admin, cfg, bots: out.bots };
  const runner = room.bots({ meta });
  runner.start();
  const adminCall = (route, body = {}) => local.post(`admin/${route}`, { ...body, token: admin });
  await sleep(1500);
  await adminCall("open");
  await adminCall("auto", { on: true, everySec: cfg.reveal });

  const spreads = [];
  const track = [];
  let probeTrades = 0;
  while (true) {
    const s = await local.get("state", { playerId: me.playerId, token: me.token });
    if (s.round.status === "settled") break;
    for (const k of ["fut", "call", "put"]) {
      const mk = s.market[k];
      if (mk.bestBid != null && mk.bestAsk != null) spreads.push({ k, w: mk.bestAsk - mk.bestBid });
    }
    track.push({ i: s.round.revealedCount, mid: s.market.fut.bestBid != null && s.market.fut.bestAsk != null ? (s.market.fut.bestBid + s.market.fut.bestAsk) / 2 : null });
    if (probe === "smart") {
      const pmf = beliefPmf(myNumber, s.round.N, s.round.revealed);
      for (const k of ["fut", "call", "put"]) {
        const mk = s.market[k];
        if (!mk.open) continue;
        let fair = 0;
        for (const [S, p] of pmf) fair += p * payoff(k, S, s.round.K);
        const edge = 2;
        if (mk.bestAsk != null && mk.bestAsk <= fair - edge) {
          const r = await local.post("order", { playerId: me.playerId, token: me.token, mkt: k, side: "B", px: Math.floor(fair - edge), qty: 10 }).catch(() => null);
          if (r?.resting) await local.post("cancel", { playerId: me.playerId, token: me.token, orderId: r.resting.id });
          if (r?.filled) probeTrades += r.filled;
        }
        if (mk.bestBid != null && mk.bestBid >= fair + edge) {
          const r = await local.post("order", { playerId: me.playerId, token: me.token, mkt: k, side: "A", px: Math.ceil(fair + edge), qty: 10 }).catch(() => null);
          if (r?.resting) await local.post("cancel", { playerId: me.playerId, token: me.token, orderId: r.resting.id });
          if (r?.filled) probeTrades += r.filled;
        }
      }
    }
    await sleep(700);
  }
  runner.stop();
  const rev = await local.get("reveal");
  const kinds = new Map(out.bots.map((b) => [b.name, `${b.persona.skill}/${b.persona.kind}`]));
  const byKind = {};
  let probePnl = 0;
  const lb = rev.leaderboard;
  // Per-player P&L comes from the inspect view.
  const ins = await local.get("admin/inspect", { token: admin });
  for (const p of ins.players) {
    const pnl = (p.valueC - 1_000_000) / 100;
    if (p.name === "Probe") probePnl = pnl;
    else {
      const k = kinds.get(p.name) ?? "?";
      (byKind[k] ??= []).push(pnl);
    }
  }
  const vol = Object.values(ins.volume).reduce((a, b) => a + b, 0);
  const avgW = (k) => {
    const xs = spreads.filter((x) => x.k === k).map((x) => x.w);
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-";
  };
  const res = {
    S: rev.S,
    K: rev.K,
    N: rev.N,
    volume: ins.volume,
    spreads: { fut: avgW("fut"), call: avgW("call"), put: avgW("put") },
    probePnl,
    probeTrades,
    midPath: [...new Map(track.filter((t) => t.mid != null).map((t) => [t.i, t.mid])).entries()].map(([i, m]) => `${i}:${m}`).join(" "),
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, xs]) => [k, xs.map((x) => Math.round(x)).join(",")])),
    desks: rev.desks.map((d) => `${d.name}:${Math.round(d.pnlC / 100)}`).join(" "),
    top: lb.slice(0, 3).map((r) => r.name).join(" > "),
  };
  results.push(res);
  console.log(JSON.stringify(res, null, 1));
}
const avg = results.reduce((a, r) => a + r.probePnl, 0) / results.length;
console.log(`\nprobe=${probe} level=${level}: average P&L ${avg.toFixed(0)} over ${results.length} rounds`);
process.exit(0);
