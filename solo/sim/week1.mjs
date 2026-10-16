/**
 * Headless check of the week 1 room: the real server, the real bot teams, a
 * whole clock's worth of submissions in a few seconds of virtual time.
 *
 * For each room it reports the final standings by bot kind, the Sunset Scoops
 * board, and where a "probe" team finished. The probe enters one bot written
 * in plain English (compiled by the solo reader) at the start and leaves it:
 *
 *   probe=none    never enters (to see the room on its own)
 *   probe=allD    "defect every round"
 *   probe=tft     "tit for tat"
 *   probe=smart   a probe-and-sort plan with an endgame
 *   probe=adapt   what a diligent player does: tries three plans over the
 *                 clock (copy+endgame, forgiving copy, probe-and-sort) and
 *                 puts back whichever scored best
 *
 * node solo/sim/week1.mjs [rooms=3] [probe=smart] [level=sharp] [teams=11]
 *
 * SAFETY: week1/server/kv.js falls back to a shared Upstash database baked
 * into the repo. The hook below swaps it for the solo in-memory store (and the
 * OpenAI compiler for the solo reader) before anything is imported.
 */
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const swap = {
  [pathToFileURL(path.join(here, "../../week1/server/kv.js")).href.toLowerCase()]: pathToFileURL(path.join(here, "../shared/kv.js")).href,
  [pathToFileURL(path.join(here, "../../week1/server/llm.js")).href.toLowerCase()]: pathToFileURL(path.join(here, "../week1/llm.js")).href,
};
const hook = `
const swap = ${JSON.stringify(swap)};
export async function resolve(spec, ctx, next) {
  const r = await next(spec, ctx);
  const to = swap[r.url.toLowerCase()];
  return to ? { ...r, url: to } : r;
}`;
register("data:text/javascript," + encodeURIComponent(hook));

process.env.SESSION_SECRET = "sim";

const { handle } = await import("../../week1/server/handler.js");
const kv = await import("../shared/kv.js");
const { installHandler, local } = await import("../shared/local.js");
const { setSeats } = await import("../shared/api.js");
const roomMod = await import("../week1/room.js");
const room = roomMod.default;
const { RoomRunner, live } = roomMod;
const { compilePd } = await import("../week1/llm.js");

const KV_CHECK = kv.KV_MODE;
if (KV_CHECK !== "memory") throw new Error("refusing to run: not on the in-memory store");
installHandler(handle);

const args = process.argv.slice(2);
const rooms = Number(args[0] ?? 3);
const probe = args[1] ?? "smart";
const level = args[2] ?? "sharp";
const teams = Number(args[3] ?? 11);

const PROBES = {
  allD: "defect every round",
  tft: "tit for tat",
  smart: "defect on round 4 as a test. If they don't retaliate, defect for the rest of the match. If they have never cooperated, defect. Otherwise copy their last move. Defect on the last 2 rounds.",
};

const ADAPT = [
  "tit for tat, and defect on the last 2 rounds",
  "copy their last move but forgive 10% of the time, and defect on the last 2 rounds",
  PROBES.smart,
];
async function enter(me, text) {
  const c = compilePd(text);
  const s = await local.post("strategy", { ...me, game: "pd", name: text.slice(0, 30), code: c.code });
  const r = await local.post("submit", { ...me, game: "pd", strategyId: s.id });
  return { id: s.id, avg: r.standings.find((x) => x.id === `team:${me.teamId}`)?.avg ?? 0 };
}

const results = [];
const kindRanks = {};
for (let n = 0; n < rooms; n++) {
  kv.wipe();
  const { token: admin } = await local.post("admin/auth", { password: "123" });
  const seed = `sim${n}|${level}|${teams}`;
  const cfg = { clock: 15, games: "both" };
  const out = await room.setup({ admin, cfg, you: ["Probe"], botTeams: teams, level, seed });
  setSeats(out.seats);
  const me = { teamId: out.seats[0].playerId, token: out.seats[0].token };
  if (PROBES[probe]) await enter(me, PROBES[probe]);
  const tried = [];
  const meta = { admin, cfg, level, bots: out.bots };
  const runner = new RoomRunner(meta);
  await local.post("admin/timer", { token: admin, game: "pd", seconds: 900 });
  await local.post("admin/timer", { token: admin, game: "icecream", seconds: 900 });
  const t0 = Date.now();
  let errors = 0;
  const origWarn = console.warn;
  console.warn = (...a) => {
    errors++;
    origWarn(...a);
  };
  // 900 one-second ticks of virtual clock.
  for (let s = 0; s <= 900; s++) {
    const c = await local.get("config");
    await runner.refresh(c);
    await runner.turns(s / 900, { phase: "live" });
    if (probe === "adapt") {
      const at = [0, 270, 540].indexOf(s);
      if (at >= 0) {
        // judge the one that's in now on today's board, then try the next
        if (tried.length) tried[tried.length - 1].avg = live.standings?.find((x) => x.id === `team:${me.teamId}`)?.avg ?? 0;
        tried.push(await enter(me, ADAPT[at]));
      }
      if (s === 810) {
        tried[tried.length - 1].avg = live.standings?.find((x) => x.id === `team:${me.teamId}`)?.avg ?? 0;
        const best = [...tried].sort((a, b) => b.avg - a.avg)[0];
        await local.post("submit", { ...me, game: "pd", strategyId: best.id });
      }
    }
  }
  console.warn = origWarn;
  const c = await local.get("config");
  await runner.refresh(c);

  const kindOf = new Map(out.bots.map((b) => [`team:${b.teamId}`, `${b.persona.skill}/${b.persona.kind}`]));
  const rows = live.standings.filter((s) => !s.seed);
  const byKind = {};
  rows.forEach((s, i) => {
    const k = kindOf.get(s.id) ?? (s.name === "Probe" ? "PROBE" : "?");
    (byKind[k] ??= []).push(`#${i + 1}:${Math.round(s.avg)}`);
    (kindRanks[k] ??= []).push((i + 1) / rows.length);
  });
  const myRank = rows.findIndex((s) => s.name === "Probe") + 1;
  const ice = (live.ice ?? []).map((r) => `${r.name.split(" ")[0]}:${r.score}`).join(" ");
  const res = {
    room: n,
    secs: ((Date.now() - t0) / 1000).toFixed(1),
    entered: rows.length,
    top3: rows.slice(0, 3).map((s) => `${s.name}(${kindOf.get(s.id) ?? "probe"}) ${Math.round(s.avg)}`).join(" > "),
    probeRank: myRank ? `${myRank}/${rows.length}` : "-",
    byKind,
    ice,
    warnings: errors,
  };
  results.push({ myRank, of: rows.length });
  console.log(JSON.stringify(res, null, 1));
}
console.log("\naverage finishing position by kind (0 = top, 1 = bottom):");
for (const [k, xs] of Object.entries(kindRanks).sort((a, b) => a[1].reduce((x, y) => x + y, 0) / a[1].length - b[1].reduce((x, y) => x + y, 0) / b[1].length))
  console.log(`  ${k.padEnd(18)} ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}  (n=${xs.length})`);
const ranked = results.filter((r) => r.myRank);
if (ranked.length) console.log(`\nprobe=${probe} level=${level}: ranks ${ranked.map((r) => `${r.myRank}/${r.of}`).join(", ")} · wins ${ranked.filter((r) => r.myRank === 1).length}/${ranked.length}`);
process.exit(0);
