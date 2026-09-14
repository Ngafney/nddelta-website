/**
 * The book. One row per tick, running as far as anybody cares to scroll in
 * either direction — including through zero and out the other side.
 *
 * There is no visible end to the ladder on purpose. Players are blind to where
 * settlement can actually land, and a ladder that stopped somewhere would hand
 * that over for free. So the rows are generated as you go: scroll near either
 * edge and another slab appears. Only the slice on screen is ever in the DOM,
 * so a few thousand ticks costs nothing.
 *
 * Click the left half of a row to bid there, the right half to offer there.
 * Your own lots sit in a gold chip on your side of the row — click the chip to
 * pull them. Depth is drawn as a bar behind the number so the shape of the
 * book reads from across a room.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PxButton, useMedia, NARROW } from "./PixelBits.jsx";

// Row height is a layout constant the virtualizer does arithmetic with, so it
// cannot live in CSS alone. Touch targets get taller on a phone.
const ROW_DESKTOP = 30;
const ROW_TOUCH = 40;
const SLAB = 300; // ticks added each time you reach an edge
const EDGE = 40; // rows from the edge that triggers another slab
const OVERSCAN = 8;
const MAX_ROWS = 40000; // a hard stop so a stuck scroll cannot eat memory

// Center the ladder before the browser paints, so it never flashes at the
// wrong scroll position. Falls back to useEffect where there is no DOM.
const useBeforePaint = typeof window === "undefined" || !window.document ? useEffect : useLayoutEffect;

export default function OrderBook({
  book,
  last,
  center,
  tick = 1,
  mine,
  size,
  onSize,
  onOrder,
  onCancelLevel,
  onCancelAll,
  disabled,
  busyPx,
}) {
  const scrollRef = useRef(null);
  const viewportRef = useRef(0);
  const primed = useRef(false);
  const narrow = useMedia(NARROW);
  const ROW = narrow ? ROW_TOUCH : ROW_DESKTOP;

  // The ladder is [lo, hi] in ticks either side of where it opened.
  const [span, setSpan] = useState({ lo: -SLAB, hi: SLAB });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);

  const pxOf = useCallback((i) => center + i * tick, [center, tick]);
  const rows = span.hi - span.lo + 1;

  const bidMap = useMemo(() => new Map((book?.bids ?? []).map((l) => [l.px, l])), [book]);
  const askMap = useMemo(() => new Map((book?.asks ?? []).map((l) => [l.px, l])), [book]);
  const maxQty = useMemo(() => {
    let m = 1;
    for (const l of [...(book?.bids ?? []), ...(book?.asks ?? [])]) m = Math.max(m, l.qty);
    return m;
  }, [book]);

  const bb = book?.bestBid ?? null;
  const ba = book?.bestAsk ?? null;
  const mid = book?.mid ?? last ?? center;

  /** Scroll so that `px` sits in the middle of the viewport. */
  const scrollToPx = useCallback(
    (px, smooth) => {
      const el = scrollRef.current;
      if (!el) return;
      const i = Math.round((px - center) / tick);
      // Make sure the target is inside the generated ladder first.
      setSpan((s) => ({ lo: Math.min(s.lo, i - SLAB), hi: Math.max(s.hi, i + SLAB) }));
      requestAnimationFrame(() => {
        const cur = spanRef.current;
        const r = cur.hi - i; // rows from the top; price descends down the list
        el.scrollTo({ top: Math.max(0, r * ROW - el.clientHeight / 2 + ROW / 2), behavior: smooth ? "smooth" : "auto" });
      });
    },
    [center, tick, ROW]
  );

  // Keep a ref of the span so the rAF above reads the value it just set.
  const spanRef = useRef(span);
  spanRef.current = span;

  useBeforePaint(() => {
    if (primed.current) return;
    const el = scrollRef.current;
    if (!el) return;
    primed.current = true;
    setViewH(el.clientHeight || 600);
    const r = span.hi; // index 0 is the opening center
    el.scrollTop = Math.max(0, r * ROW - (el.clientHeight || 600) / 2 + ROW / 2);
    setScrollTop(el.scrollTop);
  });

  // Grow the ladder when a scroll approaches either end. Prepending shifts
  // everything down, so the scroll position is corrected in the same frame and
  // the user never sees a jump.
  const onScroll = (e) => {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    viewportRef.current = el.clientHeight;
    if (rows >= MAX_ROWS) return;
    if (el.scrollTop < EDGE * ROW) {
      setSpan((s) => ({ ...s, hi: s.hi + SLAB }));
      el.scrollTop += SLAB * ROW;
      setScrollTop(el.scrollTop);
    } else if (el.scrollTop + el.clientHeight > rows * ROW - EDGE * ROW) {
      setSpan((s) => ({ ...s, lo: s.lo - SLAB }));
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + viewH) / ROW) + OVERSCAN);
  const visible = [];
  for (let r = first; r <= lastRow; r++) visible.push(pxOf(span.hi - r));

  return (
    <div>
      <div className="spread-strip">
        <span>
          BID <b className="bidv">{bb ?? "—"}</b>
        </span>
        <span>
          LAST <b className="lastv">{last ?? "—"}</b>
        </span>
        <span>
          ASK <b className="askv">{ba ?? "—"}</b>
        </span>
        <span>
          SPREAD <b>{bb != null && ba != null ? ba - bb : "—"}</b>
        </span>
      </div>

      <div className="book-tools">
        <span className="field-label" style={{ margin: 0 }}>
          LOTS
        </span>
        <div className="sizepick">
          {[1, 2, 5, 10, 25].map((n) => (
            <button key={n} className={size === n ? "on" : ""} onClick={() => onSize(n)}>
              {n}
            </button>
          ))}
        </div>
        <PxButton variant="ghost" small onClick={() => scrollToPx(Math.round(mid / tick) * tick, true)}>
          JUMP TO MIDDLE
        </PxButton>
        <PxButton variant="red" small disabled={disabled || !mine?.length} onClick={onCancelAll}>
          CANCEL ALL{mine?.length ? ` (${mine.length})` : ""}
        </PxButton>
      </div>

      <div className="book-head">
        <span>YOUR BID · LOTS</span>
        <span>TICK</span>
        <span>LOTS · YOUR OFFER</span>
      </div>

      <div className="book" ref={scrollRef} onScroll={onScroll}>
        <div style={{ height: rows * ROW, position: "relative" }}>
          {visible.map((px, n) => {
            const r = first + n;
            const b = bidMap.get(px);
            const a = askMap.get(px);
            const isInside = (bb != null && px === bb) || (ba != null && px === ba);
            const myHere = (b?.mine ?? 0) + (a?.mine ?? 0) > 0;
            return (
              <div
                key={px}
                data-px={px}
                className={`bookrow ${myHere ? "mine" : ""} ${isInside ? "inside" : ""} ${last === px ? "lastpx" : ""}`}
                style={{ position: "absolute", top: r * ROW, left: 0, right: 0, height: ROW }}
              >
                <button
                  className="side bid"
                  disabled={disabled || busyPx === `B${px}`}
                  title={`bid ${size} lot${size > 1 ? "s" : ""} at ${px}`}
                  onClick={() => onOrder("B", px)}
                >
                  <span className="depth" style={{ width: b ? `${(b.qty / maxQty) * 100}%` : 0 }} />
                  {b?.mine ? (
                    <span
                      className="mylots"
                      role="button"
                      title={`cancel your ${b.mine} lot${b.mine > 1 ? "s" : ""} bid at ${px}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancelLevel("B", px);
                      }}
                    >
                      {b.mine} ✕
                    </span>
                  ) : null}
                  <span className={`qty ${b ? "" : "zero"}`}>{b ? b.qty : "·"}</span>
                </button>

                <div className={`px ${px % (tick * 10) === 0 ? "round" : ""}`}>{px}</div>

                <button
                  className="side ask"
                  disabled={disabled || busyPx === `A${px}`}
                  title={`offer ${size} lot${size > 1 ? "s" : ""} at ${px}`}
                  onClick={() => onOrder("A", px)}
                >
                  <span className="depth" style={{ width: a ? `${(a.qty / maxQty) * 100}%` : 0 }} />
                  <span className={`qty ${a ? "" : "zero"}`}>{a ? a.qty : "·"}</span>
                  {a?.mine ? (
                    <span
                      className="mylots"
                      role="button"
                      title={`cancel your ${a.mine} lot${a.mine > 1 ? "s" : ""} offer at ${px}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancelLevel("A", px);
                      }}
                    >
                      ✕ {a.mine}
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hint">
        The ladder keeps going in both directions — scroll as far as you like, or jump back to the middle. Clicking
        above the best offer, or below the best bid, crosses the book and trades at the resting price.
        {mine?.length ? ` You have ${mine.length} order${mine.length > 1 ? "s" : ""} working.` : ""}
      </div>
    </div>
  );
}
