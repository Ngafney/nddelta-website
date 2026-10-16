/**
 * Headless check of the week 3 room: the real server, the real bots, whole
 * coins, faster than real time. For each coin it prints how much traded, how
 * wide the book was, where the price went against 100·p, who made money by
 * kind of student, and how a "probe" player did:
 *
 *   probe=none   buys no flips, never trades (finishes at exactly $0)
 *   probe=smart  buys F flips, prices like a careful Bayesian who also reads
 *                the book, and picks off anything 3+ away; never quotes
 *   probe=oracle  knows p (reads the admin view: a ceiling on what information is worth)
 *   probe=mm     the same, and also keeps a two-sided quote around its fair
 *
 * node solo/sim/week3.mjs [coins=4] [probe=smart] [level=sharp] [teams=7] [flips=15] [settlement=prob] [prior=uniform]
 */
import os from "node:os";
import path from "node:path";

process.env.KV_FORCE_MEMORY = "1";
process.env.SESSION_SECRET = "sim";
process.env.KV_DATA_FILE = path.join(os.tmpdir(), `w3sim-${process.pid}.json`);

const { handle } = await import("../../week3/server/handler.js");
const { installHandler, local } = await import("../shared/local.js");
const { Runner } = await import("../shared/bots.js");
const room = (await import("../week3/room.js")).default;
const { belief } = await import("../week3/room.js");
const { PRIORS } = await import("../../week3/shared/rules.js");

installHandler(handle);
const args = process.argv.slice(2);
const coins = Number(args[0] ?? 4);
const probe = args[1] ?? "smart";
const level = args[2] ?? "sharp";
const teams = Number(args[3] ?? 7);
const F = Number(args[4] ?? 15);
const settlement = args[5] ?? "prob";
const priorKey = args[6] ?? "uniform";
const SPEED = 4;
Runner.speed = SPEED;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const origErr = console.error;
console.error = (...a) => {
  errors.push(a.map(String).join(" ").slice(0, 200));
  origErr(...a);
};

const { token: admin } = await local.post("admin/auth", { password: "123" });
await local.post("admin/reset", { token: admin, confirm: "RESET" });
const seed = `sim${Date.now() % 1e7}`;
const cfg = { prior: priorKey, settlement, simSeconds: 10, minutes: 0.75 };
const out = await room.setup({ admin, cfg, you: ["Probe"], botTeams: teams, level, seed });
const me = out.seats[0];
const A = (b = {}) => ({ ...b, playerId: me.playerId, token: me.token });
await local.post("team/create", A({ name: "Probe Team" }));
const meta = { admin, cfg, bots: out.bots, extra: out.extra };
const runner = room.bots({ meta, ns: "sim" });
runner.start();
const adminCall = (route, body = {}) => local.post(`admin/${route}`, { ...body, token: admin });
const kinds = new Map(out.bots.map((b) => [b.name, `${b.persona.skill}/${b.persona.kind}${b.persona.freq ? "/freq" : ""}${b.persona.hoard ? "/HOARD" : ""}`]));

const results = [];
for (let n = 0; n < coins; n++) {
  if (n > 0) {
    await adminCall("round", { keepPlayers: true, prior: priorKey, settlement, simSeconds: 10, minutes: 0.75 });
  }
  await sleep(1500);
  if (probe !== "none") await local.post("sims/order", A({ n: F }));
  await adminCall("start");

  const spreads = [];
  const mids = [];
  let probeFills = 0;
  while (true) {
    const s = await local.get("state", A());
    if (s.round.status === "settled") break;
    if (s.round.status !== "live") {
      await sleep(400);
      continue;
    }
    const mk = s.market;
    if (mk.bestBid != null && mk.bestAsk != null) {
      spreads.push(mk.bestAsk - mk.bestBid);
      mids.push((mk.bestAsk + mk.bestBid) / 2);
    }
    if (probe !== "none" && s.me.sims) {
      const prior = PRIORS[s.round.prior];
      const own = probe === 'oracle' ? { mean: (await local.get('admin/inspect', { token: admin })).secret.p * 100 } : belief(false, prior, s.me.sims.n, s.me.sims.heads);
      const mid = mk.bestBid != null && mk.bestAsk != null ? (mk.bestBid + mk.bestAsk) / 2 : null;
      const w = mid == null || probe === 'oracle' ? 0 : 10 / (10 + s.me.sims.n + prior.a + prior.b);
      const fair = mid == null ? own.mean : own.mean + (mid - own.mean) * w;
      const edge = 3;
      const take = async (side, px) => {
        const r = await local.post("order", A({ side, px, qty: Number(process.env.QTY ?? 10) })).catch(() => null);
        if (r?.resting) await local.post("cancel", A({ orderId: r.resting.id }));
        probeFills += r?.filled ?? 0;
      };
      if (mk.bestAsk != null && mk.bestAsk <= fair - edge) await take("B", Math.floor(fair - edge));
      if (mk.bestBid != null && mk.bestBid >= fair + edge) await take("A", Math.ceil(fair + edge));
      if (probe === "mm") {
        const fresh = await local.get("state", A());
        await local.post("cancel", A({ all: true })).catch(() => {});
        const sk = -Math.max(-4, Math.min(4, fresh.me.pos / 20));
        await local.post("order", A({ side: "B", px: Math.max(1, Math.floor(fair - 3 + sk)), qty: 10 })).catch(() => {});
        await local.post("order", A({ side: "A", px: Math.min(99, Math.ceil(fair + 3 + sk)), qty: 10 })).catch(() => {});
      }
    }
    await sleep(700 / (SPEED / 2));
  }
  const rev = await local.get("reveal");
  const ins = await local.get("admin/inspect", { token: admin });
  const byKind = {};
  let probePnl = 0;
  for (const p of ins.players) {
    const pnl = Math.round((p.valueC - 1_000_000) / 100);
    if (p.name === "Probe") probePnl = pnl;
    else (byKind[kinds.get(p.name) ?? "?"] ??= []).push(`${pnl}/t${pnl + (p.sims ?? 0) * 100}(${p.sims}f)`);
  }
  const lb = (await local.get("state", A())).leaderboard;
  const myRank = lb.find((r) => r.name === "Probe Team")?.rank;
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const P100 = rev.p * 100;
  const q = (f) => mids[Math.min(mids.length - 1, Math.floor(mids.length * f))];
  const res = {
    coin: n + 1,
    p100: +P100.toFixed(1),
    settles: rev.value,
    volume: ins.volume,
    avgSpread: +avg(spreads).toFixed(1),
    quotedPct: mids.length,
    midPath: [0.05, 0.25, 0.5, 0.75, 0.98].map((f) => q(f)).join(" → "),
    endErr: mids.length ? +Math.abs(q(0.98) - P100).toFixed(1) : null,
    probe: { pnl: probePnl, fills: probeFills, rank: `${myRank}/${lb.length}` },
    byKind,
  };
  results.push(res);
  console.log(JSON.stringify(res));
}
runner.stop();
const board = (await local.get("bandit/board")).board;
console.log("\nbandit board:", board.map((r) => `${r.teamName}: ${Math.round(r.avg)} "${r.stratName}" (${r.runs})`).join(" | "));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(
  `\nprobe=${probe} flips=${F} level=${level} ${settlement}/${priorKey}: avg P&L ${mean(results.map((r) => r.probe.pnl)).toFixed(0)}, ` +
    `avg volume ${mean(results.map((r) => r.volume)).toFixed(0)}, avg spread ${mean(results.map((r) => r.avgSpread)).toFixed(1)}, ` +
    `avg |end mid − 100p| ${mean(results.filter((r) => r.endErr != null).map((r) => r.endErr)).toFixed(1)}`
);
console.log(errors.length ? `ERRORS (${errors.length}):\n${errors.slice(0, 10).join("\n")}` : "no server errors");
process.exit(0);
