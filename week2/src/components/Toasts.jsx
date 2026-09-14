/**
 * Fill notifications and one-off shouts. They fade after a few seconds and
 * never steal a click — the book underneath stays live.
 *
 * On a phone only the newest one is on screen: a stack of them covers the
 * ladder, which is the one thing a small screen cannot spare. They still queue
 * and expire normally underneath, so nothing is lost, it is just not all shown
 * at once. On a desktop there is room, so they stack.
 */
import React, { useEffect, useRef } from "react";
import { useMedia, NARROW } from "./PixelBits.jsx";

export default function Toasts({ items, onExpire }) {
  // One timer per toast, started once. Rebuilding them all whenever a new
  // toast arrives would keep resetting the old ones, so during a busy stretch
  // of fills nothing would ever expire.
  const timers = useRef(new Map());
  useEffect(() => {
    for (const t of items) {
      if (timers.current.has(t.key)) continue;
      timers.current.set(
        t.key,
        setTimeout(() => {
          timers.current.delete(t.key);
          onExpire(t.key);
        }, t.ttl ?? 5200)
      );
    }
    for (const [key, id] of timers.current) {
      if (!items.some((t) => t.key === key)) {
        clearTimeout(id);
        timers.current.delete(key);
      }
    }
  }, [items, onExpire]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const id of map.values()) clearTimeout(id);
      map.clear();
    };
  }, []);

  const narrow = useMedia(NARROW);
  const shown = narrow ? items.slice(-1) : items;

  return (
    <div className="toasts">
      {shown.map((t) => (
        <div key={t.key} className={`toast ${t.kind ?? ""}`}>
          <div className="th">{t.title}</div>
          <div className="tb">{t.body}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Turn a batch of fills into as few toasts as possible.
 *
 * One click can eat several resting orders and come back as several fills, and
 * the trade is still one thing that happened — so fills are grouped by what
 * they were (which side, and whether you crossed or were crossed into) and
 * reported once.
 *
 *   you bought by crossing   → you LIFTED them
 *   you sold by crossing     → you HIT them
 *   your bid was traded into → they HIT you
 *   your offer was traded into → they LIFTED you
 */
export function fillToasts(fills) {
  const groups = new Map();
  for (const f of fills) {
    const key = `${f.side}${f.taker ? "T" : "M"}`;
    const g = groups.get(key) ?? { side: f.side, taker: f.taker, qty: 0, lo: f.px, hi: f.px, seq: f.s, names: new Set() };
    g.qty += f.qty;
    g.lo = Math.min(g.lo, f.px);
    g.hi = Math.max(g.hi, f.px);
    g.seq = Math.max(g.seq, f.s);
    if (f.cp) g.names.add(f.cp);
    groups.set(key, g);
  }

  return [...groups.values()].map((g) => {
    const bought = g.side === "B";
    const verb = g.taker ? (bought ? "LIFTED" : "HIT") : bought ? "HIT" : "LIFTED";
    const who = [...g.names];
    const other = who.length === 0 ? "the book" : who.length === 1 ? who[0] : `${who.length} others`;
    const title = g.taker ? `${bought ? "▲" : "▼"} YOU ${verb} ${other.toUpperCase()}` : `${bought ? "▲" : "▼"} ${other.toUpperCase()} ${verb} YOU`;
    const price = g.lo === g.hi ? `${g.lo}` : `${g.lo}–${g.hi}`;
    return {
      key: `fill-${g.side}-${g.taker ? "t" : "m"}-${g.seq}`,
      kind: g.side,
      title,
      body: `${bought ? "Bought" : "Sold"} ${g.qty} share${g.qty > 1 ? "s" : ""} at ${price}`,
    };
  });
}
