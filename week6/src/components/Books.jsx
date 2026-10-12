/**
 * The three books at a glance, and the parity check between them.
 *
 * One card per book: bid · last · ask, your position, and whether the host
 * has opened it. Click a card to put its ladder on screen. Under the cards,
 * put–call parity worked live from the mids: CALL − PUT should equal SUM − K,
 * and when all three have a two-sided market the gap is shown in dollars.
 */
import React from "react";
import { BOOK_ORDER } from "../../shared/rules.js";

export default function Books({ round, market, me, selected, onSelect, big = false }) {
  if (!round) return null;
  const books = round.books;
  const parity = parityCheck(round, market);
  return (
    <div className={`books ${big ? "big" : ""}`}>
      <div className="bookcards">
        {BOOK_ORDER.map((k) => {
          const b = books[k];
          const m = market?.[k];
          const pos = me?.pos?.[k] ?? 0;
          const shut = !b.open;
          return (
            <button
              key={k}
              type="button"
              className={`bookcard ${k} ${selected === k ? "on" : ""} ${shut ? "shut" : ""}`}
              onClick={() => onSelect?.(k)}
              disabled={!onSelect}
            >
              <span className="bc-name">
                {b.short}
                <small>{k === "fut" ? "pays S" : k === "call" ? `pays max(S − ${round.K}, 0)` : `pays max(${round.K} − S, 0)`}</small>
              </span>
              <span className="bc-px">
                <span className="bidv">{m?.bestBid ?? "—"}</span>
                <b className="lastv">{m?.last ?? "—"}</b>
                <span className="askv">{m?.bestAsk ?? "—"}</span>
              </span>
              <span className="bc-foot">
                {shut ? (
                  <em className="shutlbl">{round.status === "live" ? "NOT OPEN YET" : round.status === "settled" ? `PAID ${round.payouts?.[k] ?? "—"}` : "OPENS WITH THE ROUND"}</em>
                ) : (
                  <em className={pos > 0 ? "up" : pos < 0 ? "down" : "dim"}>
                    {pos > 0 ? `long ${pos}` : pos < 0 ? `short ${-pos}` : "flat"}
                    {round.fair ? ` · fair ${round.fair[k].toFixed(1)}` : ""}
                  </em>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className={`parity ${parity.gap != null && Math.abs(parity.gap) >= 1 ? "off" : ""}`}>
        <span>
          CALL − PUT <b>{parity.cp ?? "—"}</b>
        </span>
        <span className="eq">{parity.gap == null ? "=?" : Math.abs(parity.gap) < 0.5 ? "=" : "≠"}</span>
        <span>
          SUM − K <b>{parity.fk ?? "—"}</b>
        </span>
        <small>
          {parity.gap == null
            ? "parity needs a two-sided market in all three"
            : Math.abs(parity.gap) < 0.5
              ? "parity holds"
              : `off by ${Math.abs(parity.gap).toFixed(1)} — ${parity.gap > 0 ? "the options are rich to the sum" : "the sum is rich to the options"}`}
        </small>
      </div>
    </div>
  );
}

/** CALL − PUT against SUM − K, from the mids where there are two sides. */
export function parityCheck(round, market) {
  const mid = (k) => {
    const m = market?.[k];
    if (!m) return null;
    if (m.bestBid != null && m.bestAsk != null) return (m.bestBid + m.bestAsk) / 2;
    return m.last ?? null;
  };
  const f = mid("fut");
  const c = mid("call");
  const p = mid("put");
  if (f == null || c == null || p == null) return { cp: c != null && p != null ? fmt(c - p) : null, fk: f != null ? fmt(f - round.K) : null, gap: null };
  return { cp: fmt(c - p), fk: fmt(f - round.K), gap: c - p - (f - round.K) };
}

const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
