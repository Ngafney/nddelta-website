import React from "react";
import { money } from "./PixelBits.jsx";

/**
 * Where you stand, on both books at once.
 *
 * The two solvency numbers are shown side by side rather than collapsed into
 * one, because they are the game: if NORTH lands you are worth one thing and
 * if SOUTH lands you are worth another, and a player who cannot see both
 * cannot tell whether they are hedged or merely busy.
 */
export default function YouPanel({ me, team, markets, round }) {
  if (!me) return null;
  const pnl = me.valueC - me.startC;
  const settled = round?.status === "settled";

  return (
    <div className="youpanel">
      <div className="you-row">
        <Cell label="CASH" value={money(me.cashC)} />
        <Cell label="RESERVED" value={money(me.reservedC)} dim />
        <Cell label="FREE" value={money(me.freeC)} />
        <Cell
          label="PORTFOLIO"
          value={money(me.valueC)}
          sub={`${pnl >= 0 ? "+" : ""}${money(pnl)}`}
          tone={pnl > 0 ? "up" : pnl < 0 ? "down" : ""}
        />
      </div>

      <div className="you-row you-pos">
        {["north", "south"].map((m) => {
          const pos = me.pos?.[m] ?? 0;
          const mark = markets?.[m]?.mark;
          return (
            <div key={m} className={`posbox ${m} ${pos > 0 ? "long" : pos < 0 ? "short" : "flat"}`}>
              <i>{m.toUpperCase()}</i>
              <b>
                {pos > 0 ? "+" : ""}
                {pos}
              </b>
              <em>{mark != null ? `mark ${Math.round(mark)}` : "no market"}</em>
            </div>
          );
        })}
        <div className="ifbox">
          <i>IF NORTH</i>
          <b className={me.powers?.north >= 0 ? "" : "down"}>{money(me.powers?.north ?? 0)}</b>
        </div>
        <div className="ifbox">
          <i>IF SOUTH</i>
          <b className={me.powers?.south >= 0 ? "" : "down"}>{money(me.powers?.south ?? 0)}</b>
        </div>
      </div>

      {team && (
        <div className="you-team">
          <span>
            {team.name} <b>{team.code}</b>
          </span>
          <span className="dim">
            {team.size}/{team.max} · team average {money(team.valueC)}
          </span>
        </div>
      )}
      {settled && <div className="you-settled">SETTLED — {round.winner?.toUpperCase()} PAID 100</div>}
    </div>
  );
}

function Cell({ label, value, sub, tone, dim }) {
  return (
    <div className={`ycell ${dim ? "dim" : ""}`}>
      <i>{label}</i>
      <b className={tone}>{value}</b>
      {sub && <em className={tone}>{sub}</em>}
    </div>
  );
}
