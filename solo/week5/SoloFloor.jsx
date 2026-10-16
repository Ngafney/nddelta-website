import React, { useEffect, useState } from "react";
import { Floor } from "@week/src/App.jsx";
import { money } from "@week/src/components/PixelBits.jsx";
import { local } from "@solo/local.js";
import { getSeats } from "@solo/api.js";
import { loadSeries, saveSeries, ordinal } from "./room.js";

const NS = "solo-w5";
const BEST = "solo:w5:best";

/**
 * The week's own floor, unmodified, with one thing under it that a meeting has
 * and a single round does not: the evening. Every settled round is written
 * down (what the process turned out to be, and how every team did), and the
 * running totals rank the teams across rounds.
 */
export default function SoloFloor() {
  return (
    <>
      <Floor />
      <Series />
    </>
  );
}

function describe(t) {
  const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  if (!t) return "?";
  if (t.switchTick != null && t.phi2 !== t.phi1) return `φ ${f(t.phi1)} → ${f(t.phi2)} at tick ${t.switchTick}`;
  return t.phi1 === 1 ? "random walk (φ 1.0)" : `mean-reverting (φ ${f(t.phi1)})`;
}

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem(BEST));
  } catch {
    return null;
  }
}

async function recordIfSettled() {
  const c = await local.get("config");
  const round = c.round;
  if (round?.status !== "settled") return false;
  const series = loadSeries(NS);
  if (series.done.some((d) => d.roundId === round.roundId)) return false;
  const [rev, lb] = await Promise.all([local.get("reveal"), local.get("leaderboard")]);
  const seat = getSeats()[0];
  const st = seat ? await local.get("state", { playerId: seat.playerId, token: seat.token }).catch(() => null) : null;
  const myTeam = st?.team?.id ?? null;
  const rows = lb.leaderboard ?? [];
  const mine = rows.find((r) => r.id === myTeam);
  const again = loadSeries(NS); // re-read: another tab of the shell may have written meanwhile
  if (again.done.some((d) => d.roundId === round.roundId)) return false;
  again.done.push({
    roundId: round.roundId,
    n: (again.n ?? 0) + 1,
    process: describe(rev.truth),
    paid: rev.value,
    you: mine ? mine.valueC - mine.startC : 0,
    rank: mine?.rank ?? rows.length,
    of: rows.length,
    myTeam,
    teams: rows.map((r) => ({ id: r.id, name: r.name, size: r.size, pnlC: r.valueC - r.startC })),
  });
  saveSeries(NS, again);
  if (mine) {
    const best = loadBest();
    const pnl = mine.valueC - mine.startC;
    if (!best || pnl > best.pnlC) {
      try {
        localStorage.setItem(BEST, JSON.stringify({ pnlC: pnl, at: Date.now() }));
      } catch {}
    }
  }
  return true;
}

function Series() {
  const [series, setSeries] = useState(() => loadSeries(NS));
  const [best, setBest] = useState(loadBest);

  useEffect(() => {
    let stop = false;
    let t = null;
    const tick = async () => {
      try {
        await recordIfSettled();
      } catch {}
      if (stop) return;
      setSeries(loadSeries(NS));
      setBest(loadBest());
      t = setTimeout(tick, 1500);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, []);

  const done = series.done ?? [];
  if (!done.length) return null;
  const myTeam = done.at(-1)?.myTeam;
  const totals = new Map();
  for (const d of done) {
    for (const t of d.teams) {
      const cur = totals.get(t.id) ?? { id: t.id, name: t.name, size: t.size, pnlC: 0 };
      cur.pnlC += t.pnlC;
      cur.name = t.name;
      cur.size = t.size;
      totals.set(t.id, cur);
    }
  }
  const rows = [...totals.values()].sort((a, b) => b.pnlC - a.pnlC).map((t, i) => ({ ...t, rank: i + 1 }));
  const mine = rows.find((r) => r.id === myTeam);

  return (
    <div className="shell solo5-series">
      <section className="panel">
        <div className="panel-title">
          TONIGHT&apos;S SERIES · {done.length} ROUND{done.length === 1 ? "" : "S"}
          <span className="right">
            {mine ? `you are ${ordinal(mine.rank)} of ${rows.length}` : ""}
            {best ? ` · your best round ${money(best.pnlC, { sign: true })}` : ""}
          </span>
        </div>
        <div className="solo5-series__grid">
          <div>
            <div className="solo5-series__sub">TOTAL P&amp;L, ALL ROUNDS</div>
            <div className="lb">
              {rows.map((r) => (
                <div key={r.id} className={`lbrow ${r.id === myTeam ? "me" : ""} p${r.rank}`}>
                  <span className="rk">{r.rank}</span>
                  <span className="nm">{r.name}</span>
                  <span>
                    <span className={`vl ${r.pnlC > 0 ? "up" : r.pnlC < 0 ? "down" : ""}`}>{money(r.pnlC, { sign: true })}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="solo5-series__sub">ROUND BY ROUND</div>
            <ol className="solo5-log">
              {done
                .slice()
                .reverse()
                .map((d) => (
                  <li key={d.roundId}>
                    <span className="solo5-log__n">R{d.n}</span>
                    <span className="solo5-log__what">
                      {d.process}
                      <small>paid ${d.paid}</small>
                    </span>
                    <span className={`solo5-log__you ${d.you > 0 ? "up" : d.you < 0 ? "down" : ""}`}>
                      {money(d.you, { sign: true })}
                      <small>
                        {ordinal(d.rank)} of {d.of}
                      </small>
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
