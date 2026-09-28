import React from "react";
import { label } from "../labels.js";
import { money } from "./PixelBits.jsx";

/**
 * Where you stand, on both books at once.
 *
 * The two outcomes are shown side by side rather than collapsed into one,
 * because they are the game: if HIT pays you are worth one thing and if MISS
 * pays you are worth another, and a player who cannot see both cannot tell
 * whether they are hedged or merely busy.
 *
 * They show PROFIT AT SETTLEMENT, not buying power. An earlier version showed
 * buying power here - cash net of what resting orders tie up - which is the
 * right number for "can I place this order" and the wrong one for every
 * question a trader actually asks. A playtester went looking for "what do I
 * make if I am right" and could not find it anywhere on the screen.
 */
export default function YouPanel({ me, team, markets, round }) {
  if (!me) return null;
  const pnl = me.valueC - me.startC;
  const settled = round?.status === "settled";

  return (
    <div className="youpanel">
      <div className="you-row">
        <Cell label="CASH" value={money(me.cashC)} />
        <Cell label="RESERVED" value={money(me.reservedC)} sub="by resting orders" dim />
        <Cell label="FREE" value={money(me.freeC)} sub="left to spend" />
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
              <i>{label(m)}</i>
              <b>
                {pos > 0 ? "+" : ""}
                {pos}
              </b>
              <em>{mark != null ? `mark ${Math.round(mark)}` : "no market"}</em>
            </div>
          );
        })}
        {["north", "south"].map((outcome) => {
          // Profit if this side pays: settled cash, less what you started with.
          const at = me.settleC?.[outcome];
          const gain = at == null ? null : at - me.startC;
          return (
            <div key={outcome} className={`ifbox ${outcome}`}>
              <i>IF {label(outcome)} PAYS</i>
              <b className={gain == null ? "" : gain > 0 ? "up" : gain < 0 ? "down" : ""}>
                {gain == null ? "\u2014" : `${gain >= 0 ? "+" : ""}${money(gain)}`}
              </b>
              <em>{at == null ? "" : `worth ${money(at)}`}</em>
            </div>
          );
        })}
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
