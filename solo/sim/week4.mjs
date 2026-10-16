/**
 * Headless check of the week 4 room: the real server, the real bots, whole
 * rounds, with the Monte Carlo running in a worker thread exactly as it runs
 * in a browser worker. Prints how much traded, how wide and deep the books
 * were, where the HIT price sat after each batch against the house's
 * reference P(hit) and the truth, who made money by method, and how a probe
 * did:
 *
 *   probe=none    sits on its hands (should finish at $0)
 *   probe=smart   reads the same data, runs the full clean Monte Carlo the
 *                 moment a batch lands, and picks off anything 3+ away from
 *                 it in either book; never quotes
 *   probe=phi     the same, but prices with the Φ shortcut
 *
 * node solo/sim/week4.mjs [rounds=2] [probe=smart] [level=sharp] [teams=7] [tradingMin=3]
 */
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (!isMainThread) {
  const { analyse } = await import("../week4/sky.js");
  const { buildSpec } = await import("../week4/build.js");
  parentPort.on("message", (m) => {
    try {
      if (m.kind === "analyse") {
        parentPort.postMessage({ id: m.id, ok: true, partial: true, out: analyse(m.d, { clean: 60, raw: 40, seed: m.opts.seed }) });
        parentPort.postMessage({ id: m.id, ok: true, out: analyse(m.d, { clean: 300, raw: 150, seed: m.opts.seed }) });
      } else parentPort.postMessage({ id: m.id, ok: true, out: buildSpec(m.seed, m.opts) });
    } catch (e) {
      parentPort.postMessage({ id: m.id, ok: false, error: e.message });
    }
  });
} else {
  await main();
}

async function main() {
  process.env.KV_FORCE_MEMORY = "1";
  process.env.SESSION_SECRET = "sim";
  process.env.KV_DATA_FILE = path.join(os.tmpdir(), `w4sim-${process.pid}.json`);

  const { handle } = await import("../../week4/server/handler.js");
  const { installHandler, local } = await import("../shared/local.js");
  const { Runner } = await import("../shared/bots.js");
  const compute = await import("../week4/compute.js");
  const roomMod = await import("../week4/room.js");
  const room = roomMod.default;
  const { pHit, phiShortcut } = await import("../week4/sky.js");

  const pool = () => {
    const w = new Worker(new URL(import.meta.url));
    let seq = 0;
    const jobs = new Map();
    w.on("message", ({ id, ok, partial, out, error }) => {
      const j = jobs.get(id);
      if (!j) return;
      if (!ok) (jobs.delete(id), j.reject(new Error(error)));
      else if (partial) j.onPartial?.(out);
      else (jobs.delete(id), j.resolve(out));
    });

    return (msg, onPartial) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        jobs.set(id, { resolve, reject, onPartial });
        w.postMessage({ ...msg, id });
      });
  };
  const brain = pool();
  const oven = pool();
  compute.setBackend({
    analyse: (d, opts, onPartial) => brain({ kind: "analyse", d, opts }, onPartial),
    build: (seed, opts) => oven({ kind: "build", seed, opts }),
  });

  installHandler(async (m, r, b, q) => roomMod.patchResponse(r, await handle(m, r, b, q)));
  const args = process.argv.slice(2);
  const rounds = Number(args[0] ?? 2);
  const probe = args[1] ?? "smart";
  const level = args[2] ?? "sharp";
  const teams = Number(args[3] ?? 7);
  const tradingMin = Number(args[4] ?? 3);
  Runner.speed = 2.5;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => (errors.push(a.map(String).join(" ")), origErr(...a));

  const results = [];
  for (let n = 0; n < rounds; n++) {
    const { token: admin } = await local.post("admin/auth", { password: "123" });
    const seed = `sim${n}${Date.now() % 1e6}`;
    const cfg = { pace: "quick", batches: "clock" };
    const out = await room.setup({ admin, cfg, you: ["Probe"], botTeams: teams, level, seed, ns: "sim" });
    const me = out.seats[0];
    const who = { playerId: me.playerId, token: me.token };
    await local.post("team/create", { ...who, name: "Probe Team" });
    const meta = { admin, cfg, bots: out.bots };
    const adminCall = (route, body = {}) => local.post(`admin/${route}`, { ...body, token: admin });
    const runner = room.bots({ meta, ns: "sim" });
    runner.start();
    await adminCall("start", { minutes: 0.5 });
    await sleep(15000);
    await adminCall("open", { minutes: tradingMin });

    const spreads = { north: [], south: [] };
    const depth = { north: [], south: [] };
    const sums = [];
    const midByRelease = new Map();
    const lagAfterRelease = [];
    let lastRel = 0;
    let relAt = 0;
    let probeTrades = 0;
    let insLive = null;
    let probeData = new Map();
    while (true) {
      const s = await local.get("state", who);
      if (s.round.status === "settled") break;
      if (s.round.status === "live") {
        for (const k of ["north", "south"]) {
          const mk = s.markets[k];
          if (mk.bestBid != null && mk.bestAsk != null) spreads[k].push(mk.bestAsk - mk.bestBid);
          depth[k].push(mk.bids.reduce((a, l) => a + l.qty, 0) + mk.asks.reduce((a, l) => a + l.qty, 0));
        }
        if (Math.random() < 0.15) insLive = await local.get("admin/inspect", { token: admin });
        const hm = s.markets.north.mid;
        const sm = s.markets.south.mid;
        if (hm != null && sm != null) sums.push(hm + sm);
        if (hm != null) midByRelease.set(s.round.released, hm);
        if (s.round.released !== lastRel) {
          lastRel = s.round.released;
          relAt = Date.now();
        }
        // probe
        if (probe !== "none") {
          if (!probeData.has(s.round.released)) {
            const d = await local.get("data", who);
            probeData.set(d.release, d);
          }
          const d = probeData.get(s.round.released);
          const c = compute.analysisFor(`${s.round.roundId}|${d.release}`, d);
          const a = c.full;
          if (a) {
            const p = probe === "phi" ? phiShortcut(a.clean, a.radiusKm, 30) : pHit(a.clean);
            for (const k of ["north", "south"]) {
              const fair = 100 * (k === "north" ? p : 1 - p);
              const mk = s.markets[k];
              const edge = 3;
              if (mk.bestAsk != null && mk.bestAsk <= fair - edge) {
                const r = await local.post("order", { ...who, market: k, side: "B", px: Math.max(1, Math.floor(fair - edge)), qty: 15 }).catch(() => null);
                if (r?.resting) await local.post("cancel", { ...who, orderId: r.resting.id, market: k });
                if (r?.filled) probeTrades += r.filled;
              }
              if (mk.bestBid != null && mk.bestBid >= fair + edge) {
                const r = await local.post("order", { ...who, market: k, side: "A", px: Math.min(99, Math.ceil(fair + edge)), qty: 15 }).catch(() => null);
                if (r?.resting) await local.post("cancel", { ...who, orderId: r.resting.id, market: k });
                if (r?.filled) probeTrades += r.filled;
              }
            }
          }
        }
      }
      await sleep(700);
    }
    runner.stop();
    const rev = await local.get("reveal");
    const ins = await local.get("admin/inspect", { token: admin });
    const board = await local.get("board");
    const kinds = new Map(out.bots.map((b) => [b.playerId, `${b.persona.kind}/${b.brain.method}`]));
    const byKind = {};
    let probePnl = 0;
    for (const p of ins.players) {
      const pnl = (p.cashC - 1_000_000) / 100;
      if (p.name === "Probe") probePnl = pnl;
      else (byKind[kinds.get(p.id) ?? "?"] ??= []).push(pnl);
    }
    const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-");
    const res = {
      hit: rev.truth.hit,
      missKm: rev.truth.missKm,
      house: rev.releases.map((r) => Math.round(r.pHit * 100)).join(" "),
      hitMidAtEachBatch: [...midByRelease.entries()].map(([i, m]) => `${i}:${m}`).join(" "),
      volume: { hit: board.markets.north.volume, miss: board.markets.south.volume },
      spread: { hit: avg(spreads.north), miss: avg(spreads.south) },
      depthShares: { hit: avg(depth.north), miss: avg(depth.south) },
      hitPlusMiss: avg(sums),
      probePnl,
      probeTrades,
      byKind: Object.fromEntries(Object.entries(byKind).map(([k, xs]) => [k, xs.map((x) => Math.round(x)).join(",")])),
      roomP: [1, 2, 3, 4, 5, 6].map((i) => {
        const c = compute.peekAnalysis(`${rev.roundId}|${i}`);
        const a = c?.full;
        return a ? `${i}:${Math.round(pHit(a.clean) * 100)}/${Math.round(pHit(a.raw) * 100)}/${Math.round(phiShortcut(a.clean, a.radiusKm) * 100)}` : `${i}:-`;
      }).join(" "),
      bots: out.bots.map((b) => {
        const p = (insLive ?? ins).players.find((x) => x.id === b.playerId);
        return `${b.persona.kind[0]}${b.brain.method[0]}:${p.pos.north}/${p.pos.south}`;
      }).join(" "),
      top: rev.leaderboard.slice(0, 3).map((r) => `${r.name} ${Math.round((r.valueC - r.startC) / 100)}`).join(" > "),
      desk: ins.bots.map((b) => `${b.key}:${b.fills}/${b.sent * 8}`).join(" "),
    };
    results.push({ ...res, byKindRaw: byKind });
    console.log(JSON.stringify(res, null, 1));
  }
  // Pool across rounds: P&L by method.
  const pool2 = {};
  for (const r of results) for (const [k, xs] of Object.entries(r.byKindRaw)) (pool2[k] ??= []).push(...xs);
  console.log("\nP&L by kind/method, all rounds:");
  for (const [k, xs] of Object.entries(pool2).sort()) console.log(`  ${k.padEnd(20)} n=${xs.length}  mean ${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)}`);
  const avgP = results.reduce((a, r) => a + r.probePnl, 0) / results.length;
  console.log(`\nprobe=${probe} level=${level}: average P&L ${avgP.toFixed(0)} over ${results.length} rounds`);
  console.log(`server errors: ${errors.length}`);
  process.exit(0);
}
