import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { money, clock, Spinner } from "./PixelBits.jsx";

/**
 * The projector view. Big enough to read from the back of a lecture hall, and
 * it never asks anyone to do anything.
 */
export default function BigBoard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let stop = false;
    const loop = async () => {
      try {
        const d = await api.get("board");
        if (!stop) setData(d);
      } catch {}
      if (!stop) setTimeout(loop, 1200);
    };
    loop();
    return () => {
      stop = true;
    };
  }, []);

  if (!data?.round) {
    return (
      <div className="bb">
        <Spinner text="WAITING FOR A ROUND" />
      </div>
    );
  }
  const r = data.round;
  const host = window.location.host;
  const settled = r.status === "settled";

  return (
    <div className="bb">
      <header className="bb-top">
        <div className="title-main">MONTE CARLO</div>
        <div className="title-sub">WHERE DOES IT LAND?</div>
        <div className="bb-clock">
          <span className={`phase ${r.status}`}>{r.phase}</span>
          {r.msLeft != null && <b>{clock(r.msLeft)}</b>}
        </div>
      </header>

      {(r.status === "lobby" || r.status === "research") && (
        <div className="bb-join">
          <div className="joinline">
            {host}/week4/ — <b>JOIN NOW</b>
          </div>
          <div className="dim">
            {r.players} players · {r.teams} teams · up to {r.teamSize} to a team
          </div>
        </div>
      )}

      <div className="bb-markets">
        {["north", "south"].map((m) => {
          const mk = data.markets[m];
          const won = settled && r.winner === m;
          const lost = settled && r.winner && r.winner !== m;
          return (
            <div key={m} className={`bb-market ${m} ${won ? "won" : ""} ${lost ? "lost" : ""}`}>
              <h2>{m.toUpperCase()}</h2>
              <div className="bb-px">{mk.mark != null ? Math.round(mk.mark) : "—"}</div>
              <div className="bb-bidask">
                <span>bid {mk.bestBid ?? "—"}</span>
                <span>ask {mk.bestAsk ?? "—"}</span>
              </div>
              <div className="dim">{mk.volume} shares traded</div>
              {won && <div className="bb-won">PAYS $100</div>}
              {lost && <div className="bb-lost">PAYS NOTHING</div>}
            </div>
          );
        })}
      </div>

      <div className="bb-data">
        RELEASE <b>{r.released}</b> OF {r.releaseCount}
        {r.nextLeadDays != null && <span className="dim"> · next batch reaches {r.nextLeadDays}d before impact</span>}
        {r.bots?.length > 0 && <span className="dim"> · {r.bots.length} noise desks active</span>}
      </div>

      <div className="bb-board">
        {data.leaderboard.map((t) => (
          <div key={t.id} className={`lbrow p${t.rank}`}>
            <span className="rk">{t.rank}</span>
            <span className="nm">{t.name}</span>
            <span className="vl">{money(t.valueC)}</span>
            <span className={`dl ${t.valueC - t.startC >= 0 ? "up" : "down"}`}>
              {t.valueC - t.startC >= 0 ? "+" : ""}
              {money(t.valueC - t.startC)}
            </span>
          </div>
        ))}
        {!data.leaderboard.length && <div className="hint">No teams yet.</div>}
      </div>
    </div>
  );
}
