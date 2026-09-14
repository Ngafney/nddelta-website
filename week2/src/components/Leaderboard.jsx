/**
 * The leaderboard ranks TEAMS. Your own team opens up so you can find your own
 * number inside it; everyone else stays a single line, because their positions
 * are their business until the bell.
 */
import React from "react";
import { money, moneyShort } from "./PixelBits.jsx";

export default function Leaderboard({ rows, myTeamId, settled, compact = false, limit = 60 }) {
  if (!rows?.length) return <div className="hint">No teams on the board yet.</div>;
  return (
    <div className="lb">
      {rows.slice(0, limit).map((r) => {
        const mine = r.id === myTeamId;
        const pnl = r.valueC - r.startC;
        return (
          <React.Fragment key={r.id}>
            <div className={`lbrow ${mine ? "me" : ""} p${r.rank}`}>
              <span className="rk">{r.rank}</span>
              <span className="nm">
                {r.name}
                <small>
                  {r.size} {r.size === 1 ? "player" : "players"}
                  {r.sawAll ? " · saw the curve" : ""}
                </small>
              </span>
              <span>
                <span className="vl">{compact ? moneyShort(r.valueC) : money(r.valueC)}</span>
                <span className={`dl ${pnl > 0 ? "up" : pnl < 0 ? "down" : ""}`}>
                  <br />
                  {money(pnl, { sign: true })}
                </span>
              </span>
            </div>
            {mine && r.members.length > 1 && (
              <div className="lbmembers">
                {r.members.map((m) => (
                  <div key={m.id} className="lbmember">
                    <span>{m.name}</span>
                    <span className="v">
                      {money(m.valueC)}
                      {settled ? "" : ` · ${m.pos > 0 ? "+" : ""}${m.pos}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
