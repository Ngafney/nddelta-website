/**
 * All three books on screen at once: one ladder per book, side by side, with
 * a shared size picker and the parity check in a toolbar above them. Each
 * ladder has its own small header — name, what it pays, bid · last · ask,
 * your position in it — and is greyed out until the host opens that book.
 */
import React from "react";
import OrderBook from "./OrderBook.jsx";
import { parityCheck } from "./Books.jsx";
import { PxButton, money } from "./PixelBits.jsx";
import { BOOK_ORDER, BOOKS } from "../../shared/rules.js";

export default function Ladders({ round, market, me, size, onSize, onOrder, onCancelLevel, onCancelBook, onCancelAll, disabled, busyPx, height = 440 }) {
  const parity = parityCheck(round, market);
  const pnl = me ? me.valueC - me.startC : 0;
  return (
    <div className="ladders">
      <div className="trade-bar">
        <span className="field-label" style={{ margin: 0 }}>
          SHARES
        </span>
        <div className="sizepick">
          {[...new Set([1, 5, size, 10, 25, 50])]
            .filter((n) => n >= 1 && n <= 50)
            .sort((a, b) => a - b)
            .slice(0, 6)
            .map((n) => (
              <button key={n} className={size === n ? "on" : ""} onClick={() => onSize(n)}>
                {n}
              </button>
            ))}
        </div>
        {me && (
          <span className="tb-cell">
            <i>FREE</i>
            <b>{money(Math.max(0, me.freeC))}</b>
          </span>
        )}
        {me && (
          <span className="tb-cell">
            <i>P&amp;L</i>
            <b className={pnl > 0 ? "up" : pnl < 0 ? "down" : ""}>{money(pnl, { sign: true })}</b>
          </span>
        )}
        <span className={`tb-parity ${parity.gap != null && Math.abs(parity.gap) >= 1 ? "off" : ""}`} title="put–call parity: CALL − PUT should equal SUM − K">
          <i>PARITY</i>
          <b>
            C−P {parity.cp ?? "—"} <em>{parity.gap == null ? "?" : Math.abs(parity.gap) < 0.5 ? "=" : "≠"}</em> S−K {parity.fk ?? "—"}
          </b>
        </span>
        <PxButton variant="red" small disabled={disabled || !me?.orders?.length} onClick={onCancelAll}>
          CANCEL ALL{me?.orders?.length ? ` (${me.orders.length})` : ""}
        </PxButton>
      </div>

      <div className="ladder-grid">
        {BOOK_ORDER.map((k) => {
          const b = round.books[k];
          const m = market[k];
          const pos = me?.pos?.[k] ?? 0;
          const shut = !b.open;
          const mine = (me?.orders ?? []).filter((o) => o.mkt === k);
          return (
            <section key={k} className={`ladder ${k} ${shut ? "shut" : ""}`}>
              <header className="ladder-head">
                <span className="lh-name">
                  {BOOKS[k].short}
                  <small>{k === "fut" ? "pays S" : k === "call" ? `pays max(S − ${round.K}, 0)` : `pays max(${round.K} − S, 0)`}</small>
                </span>
                <span className={`lh-pos ${pos > 0 ? "up" : pos < 0 ? "down" : "dim"}`}>{pos > 0 ? `long ${pos}` : pos < 0 ? `short ${-pos}` : "flat"}</span>
                {shut && <span className="lh-shut">{round.status === "live" ? "NOT OPEN YET" : round.status === "settled" ? `PAID ${round.payouts?.[k] ?? "—"}` : "SHUT"}</span>}
                {!shut && round.fair && <span className="lh-fair">fair {round.fair[k].toFixed(1)}</span>}
              </header>
              <OrderBook
                key={`${round.roundId}-${k}-${round.locked ? "L" : "U"}`}
                compact
                height={height}
                book={m}
                last={m.last}
                me={me}
                center={b.center}
                tick={1}
                lo={b.orderMin}
                hi={b.orderMax}
                mine={mine}
                size={size}
                onSize={onSize}
                onOrder={(side, px) => onOrder(k, side, px)}
                onCancelLevel={(side, px) => onCancelLevel(k, side, px)}
                onCancelAll={() => onCancelBook(k)}
                disabled={disabled || shut}
                busyPx={busyPx}
                busyKey={k}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
