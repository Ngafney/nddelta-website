/**
 * Fill notifications and one-off shouts. They stack bottom-right, fade after a
 * few seconds, and never steal a click — the book underneath stays live.
 */
import React, { useEffect, useRef } from "react";

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

  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.key} className={`toast ${t.kind ?? ""}`}>
          <div className="th">{t.title}</div>
          <div className="tb">{t.body}</div>
        </div>
      ))}
    </div>
  );
}

/** Turn a server fill record into a toast. */
export function fillToast(f) {
  return {
    key: `fill-${f.s}`,
    kind: f.side,
    title: f.side === "B" ? "▲ BOUGHT" : "▼ SOLD",
    body: `${f.qty} lot${f.qty > 1 ? "s" : ""} at ${f.px} ${f.taker ? "— you crossed" : `— ${f.cp} hit you`}`,
  };
}
