/**
 * Your money, at a glance, and the orders you have working.
 *
 * Four numbers matter and all four are always on screen: cash, what your
 * resting orders have reserved, your position in shares, and the portfolio marked
 * to the last trade. P&L is always YOUR P&L, even though the leaderboard scores
 * your team.
 */
import React from "react";
import { PxButton, money, num } from "./PixelBits.jsx";

export default function YouPanel({ me, team, mark, settled, onCancel, onCancelAll }) {
  if (!me) return null;
  const pnl = me.valueC - me.startC;
  const reserved = me.bidResC + me.askResC;

  return (
    <div className="panel">
      <div className="panel-title">
        YOU · {me.name}
        <span className="right">{team ? team.name : "no team"}</span>
      </div>

      <div className="stats">
        <div className="stat">
          <i>CASH</i>
          <b>{money(me.cashC)}</b>
          <small>{money(me.buyC)} free to bid</small>
        </div>
        <div className="stat">
          <i>RESERVED</i>
          <b style={{ color: reserved ? "var(--blue)" : undefined }}>{money(reserved)}</b>
          <small>
            {money(me.bidResC)} bids · {money(me.askResC)} offers
          </small>
        </div>
        <div className={`stat ${me.pos > 0 ? "pos-long" : me.pos < 0 ? "pos-short" : ""}`}>
          <i>POSITION</i>
          <b>
            {me.pos > 0 ? "+" : ""}
            {me.pos} {Math.abs(me.pos) === 1 ? "share" : "shares"}
          </b>
          <small>{me.pos > 0 ? "long the floor" : me.pos < 0 ? "short the floor" : "flat"}</small>
        </div>
        <div className="stat">
          <i>{settled ? "FINAL" : "PORTFOLIO"}</i>
          <b className={pnl > 0 ? "up" : pnl < 0 ? "down" : ""}>{money(me.valueC)}</b>
          <small className={pnl > 0 ? "up" : pnl < 0 ? "down" : ""}>
            {money(pnl, { sign: true })} {settled ? "" : `· marked at ${num(mark, 1)}`}
          </small>
        </div>
      </div>

      {me.orders.length > 0 && (
        <>
          <div className="row mt" style={{ justifyContent: "space-between" }}>
            <span className="field-label" style={{ margin: 0 }}>
              WORKING ORDERS
            </span>
            <button className="pxbtn pxbtn--ghost pxbtn--sm" onClick={onCancelAll}>
              PULL ALL
            </button>
          </div>
          <div className="myorders">
            {me.orders.map((o) => (
              <div key={o.id} className={`myorder ${o.side}`}>
                <span className="w">{o.side === "B" ? "BID" : "OFFER"}</span>
                <span>
                  {o.qty} @ {o.px}
                </span>
                <span className="sp">{money(o.holdC ?? 0)} held</span>
                <button onClick={() => onCancel(o.id)}>pull</button>
              </div>
            ))}
          </div>
        </>
      )}

      {team && team.members.length > 1 && (
        <>
          <span className="field-label mt">YOUR TEAM · {money(team.valueC)} AVG</span>
          <div className="lbmembers" style={{ padding: 0 }}>
            {team.members.map((m) => (
              <div key={m.id} className={`lbmember ${m.me ? "me" : ""}`}>
                <span>{m.name}</span>
                <span className="v">
                  {money(m.valueC)} · {m.pos > 0 ? "+" : ""}
                  {m.pos}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
