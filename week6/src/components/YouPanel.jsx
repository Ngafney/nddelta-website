/**
 * Your money, at a glance, and the orders you have working — across all three
 * books. Four numbers are always on screen: cash, what your resting orders
 * are holding, your positions, and the portfolio marked to each book's last.
 */
import React from "react";
import { money } from "./PixelBits.jsx";
import { BOOK_ORDER, BOOKS } from "../../shared/rules.js";

export default function YouPanel({ me, team, settled, onCancel, onCancelAll }) {
  if (!me) return null;
  const pnl = me.valueC - me.startC;
  const reserved = me.bidResC + me.askResC;

  return (
    <div className="panel">
      <div className="panel-title">
        YOU · {me.name}
        <span className="right">
          {team ? team.name : "no team"}
          {team?.number != null ? ` · your number ${team.number}` : ""}
        </span>
      </div>

      <div className="stats">
        <div className="stat">
          <i>CASH</i>
          <b>{money(me.cashC)}</b>
          <small>{money(Math.max(0, me.freeC))} free if S ends at {me.worstS ?? "—"}, your worst case</small>
        </div>
        <div className="stat">
          <i>HELD BY ORDERS (GROSS)</i>
          <b style={{ color: reserved ? "var(--blue)" : undefined }}>{money(reserved)}</b>
          <small>
            {money(me.bidResC)} bids · {money(me.askResC)} offers
          </small>
        </div>
        <div className="stat wide">
          <i>POSITIONS</i>
          <div className="poschips">
            {BOOK_ORDER.map((k) => {
              const p = me.pos?.[k] ?? 0;
              return (
                <span key={k} className={`poschip ${p > 0 ? "long" : p < 0 ? "short" : ""}`}>
                  <i>{BOOKS[k].short}</i>
                  <b>
                    {p > 0 ? "+" : ""}
                    {p}
                  </b>
                </span>
              );
            })}
          </div>
        </div>
        <div className="stat wide">
          <i>{settled ? "FINAL" : "PORTFOLIO"}</i>
          <b className={pnl > 0 ? "up" : pnl < 0 ? "down" : ""}>{money(me.valueC)}</b>
          <small className={pnl > 0 ? "up" : pnl < 0 ? "down" : ""}>
            {money(pnl, { sign: true })} {settled ? "" : "· marked at each book's mid"}
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
                <span className="w">
                  {BOOKS[o.mkt]?.short} {o.side === "B" ? "BID" : "OFFER"}
                </span>
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
                  {money(m.valueC)} · {posText(m.pos)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** "S+10 C−3 P0" — a position across the books in one breath. */
export function posText(pos) {
  if (!pos) return "flat";
  const bits = BOOK_ORDER.filter((k) => pos[k]).map((k) => `${BOOKS[k].short[0]}${pos[k] > 0 ? "+" : "−"}${Math.abs(pos[k])}`);
  return bits.length ? bits.join(" ") : "flat";
}
