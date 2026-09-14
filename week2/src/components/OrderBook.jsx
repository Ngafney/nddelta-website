/**
 * The book. One row per tick, running as far as anybody cares to scroll in
 * either direction — including through zero and out the other side.
 *
 * There is no visible end to the ladder on purpose. Players are blind to where
 * settlement can actually land, and a ladder that stopped somewhere would hand
 * that over for free. So rows are generated as you go: scroll near either edge
 * and another slab appears. Only the slice on screen is ever in the DOM, so a
 * few thousand ticks costs nothing.
 *
 * ZOOM changes the row height, which is the honest way to fit more prices on
 * screen at once. The rows are absolutely positioned, so that height is
 * arithmetic the virtualizer depends on and cannot live in CSS alone.
 *
 * Click the left half of a row to bid there, the right half to offer there.
 * Your own shares sit in a gold chip on your side of the row — click the chip
 * to pull them. Depth is drawn as a bar behind the number so the shape of the
 * book reads from across a room.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PxButton, money, useMedia, NARROW } from "./PixelBits.jsx";

// Row heights, tightest first. The virtualizer does arithmetic with these.
// The default is the WIDEST view, not a comfortable one: the first thing a
// trader needs is the shape of the whole book, and they can zoom in once they
// know where to look.
const ZOOMS_DESKTOP = [14, 18, 24, 32, 42];
const ZOOMS_TOUCH = [20, 26, 34, 42, 52];
const DEFAULT_ZOOM = 0;
const SLAB = 300; // ticks added each time you reach an edge
const EDGE = 40; // rows from the edge that triggers another slab
const OVERSCAN = 8;
const MAX_ROWS = 40000; // a hard stop so a stuck scroll cannot eat memory

const useBeforePaint = typeof window === "undefined" || !window.document ? useEffect : useLayoutEffect;

export default function OrderBook({
  book,
  last,
  me,
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
  const primed = useRef(false);
  const narrow = useMedia(NARROW);
  const zooms = narrow ? ZOOMS_TOUCH : ZOOMS_DESKTOP;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM); // index into `zooms`
  const ROW = zooms[Math.min(zoom, zooms.length - 1)];

  const [span, setSpan] = useState({ lo: -SLAB, hi: SLAB });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(700);

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

  const spanRef = useRef(span);
  spanRef.current = span;

  /** Scroll so that `px` sits in the middle of the viewport. */
  const scrollToPx = useCallback(
    (px, smooth) => {
      const el = scrollRef.current;
      if (!el) return;
      const i = Math.round((px - center) / tick);
      setSpan((s) => ({ lo: Math.min(s.lo, i - SLAB), hi: Math.max(s.hi, i + SLAB) }));
      requestAnimationFrame(() => {
        const r = spanRef.current.hi - i; // price descends down the list
        el.scrollTo({
          top: Math.max(0, r * ROW - el.clientHeight / 2 + ROW / 2),
          behavior: smooth ? "smooth" : "auto",
        });
      });
    },
    [center, tick, ROW]
  );

  useBeforePaint(() => {
    if (primed.current) return;
    const el = scrollRef.current;
    if (!el) return;
    primed.current = true;
    setViewH(el.clientHeight || 700);
    el.scrollTop = Math.max(0, span.hi * ROW - (el.clientHeight || 700) / 2 + ROW / 2);
    setScrollTop(el.scrollTop);
  });

  // Zooming keeps whatever price is under the middle of the viewport where it
  // is, rather than dumping you somewhere else on the ladder.
  const changeZoom = (delta) => {
    const el = scrollRef.current;
    const next = Math.max(0, Math.min(zooms.length - 1, zoom + delta));
    if (next === zoom) return;
    const centerRow = el ? (el.scrollTop + el.clientHeight / 2) / ROW : 0;
    setZoom(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.scrollTop = Math.max(0, centerRow * zooms[next] - el.clientHeight / 2);
      setScrollTop(el.scrollTop);
    });
  };

  const onScroll = (e) => {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    setViewH(el.clientHeight);
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

  const tight = ROW <= 20;
  // The type size is derived from the row height rather than set in CSS, so a
  // stylesheet can never disagree with the arithmetic the rows are placed by.
  const fontPx = Math.max(9, Math.min(15, Math.round(ROW * 0.62)));

  const pos = me?.pos ?? 0;
  const pnl = me ? me.valueC - me.startC : 0;

  // An empty stretch of ladder looks identical whether the book is empty or
  // whether you have simply scrolled away from it. These say which.
  const topPx = visible.length ? visible[0] : center;
  const botPx = visible.length ? visible[visible.length - 1] : center;
  const levels = [...(book?.bids ?? []), ...(book?.asks ?? [])];
  let above = null;
  let below = null;
  for (const l of levels) {
    if (l.px > topPx && (above === null || l.px < above)) above = l.px;
    if (l.px < botPx && (below === null || l.px > below)) below = l.px;
  }
  const sideOf = (px) => ((book?.asks ?? []).some((l) => l.px === px) ? "asks" : "bids");

  return (
    <div>
      {/* Your position, stated plainly and immediately above the ladder, so
          nobody clicks a side without knowing which way they are already. */}
      {me && (
        <div className={`posbar ${pos > 0 ? "long" : pos < 0 ? "short" : "flat"}`}>
          <span className="posbar-main">
            <i>{pos > 0 ? "LONG" : pos < 0 ? "SHORT" : "FLAT"}</i>
            <b>
              {pos > 0 ? "+" : ""}
              {pos}
            </b>
            <em>{Math.abs(pos) === 1 ? "share" : "shares"}</em>
          </span>
          <span className="posbar-cell">
            <i>FREE CASH</i>
            <b>{money(me.buyC)}</b>
          </span>
          <span className="posbar-cell">
            <i>P&amp;L</i>
            <b className={pnl > 0 ? "up" : pnl < 0 ? "down" : ""}>{money(pnl, { sign: true })}</b>
          </span>
        </div>
      )}

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
          SHARES
        </span>
        <div className="sizepick">
          {/* Always offer the round's own default, whatever the admin set it to. */}
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
        <div className="sizepick zoompick" title="how many prices fit on screen at once">
          <button disabled={zoom <= 0} onClick={() => changeZoom(-1)} aria-label="show more prices">
            −
          </button>
          <span className="zoomlbl">ZOOM</span>
          <button
            disabled={zoom >= zooms.length - 1}
            onClick={() => changeZoom(1)}
            aria-label="show fewer, larger prices"
          >
            +
          </button>
        </div>
        <PxButton variant="ghost" small onClick={() => scrollToPx(Math.round(mid / tick) * tick, true)}>
          MIDDLE
        </PxButton>
        <PxButton variant="red" small disabled={disabled || !mine?.length} onClick={onCancelAll}>
          CANCEL ALL{mine?.length ? ` (${mine.length})` : ""}
        </PxButton>
      </div>

      <div className="book-head">
        <span>YOUR BID · SHARES</span>
        <span>PRICE</span>
        <span>SHARES · YOUR OFFER</span>
      </div>

      <div className="bookwrap">
        {above != null && (
          <button className="bookedge top" onClick={() => scrollToPx(above, true)}>
            ▲ {sideOf(above)} up at {above}
          </button>
        )}
        {below != null && (
          <button className="bookedge bottom" onClick={() => scrollToPx(below, true)}>
            ▼ {sideOf(below)} down at {below}
          </button>
        )}
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
                className={`bookrow ${myHere ? "mine" : ""} ${isInside ? "inside" : ""} ${
                  last === px ? "lastpx" : ""
                } ${tight ? "tight" : ""}`}
                style={{
                  position: "absolute",
                  top: r * ROW,
                  left: 0,
                  right: 0,
                  height: ROW,
                  fontSize: fontPx,
                }}
              >
                <button
                  className="side bid"
                  disabled={disabled || busyPx === `B${px}`}
                  title={`bid ${size} share${size > 1 ? "s" : ""} at ${px}`}
                  onClick={() => onOrder("B", px)}
                >
                  <span className="depth" style={{ width: b ? `${(b.qty / maxQty) * 100}%` : 0 }} />
                  {b?.mine ? (
                    <span
                      className="mylots"
                      role="button"
                      title={`cancel your ${b.mine} share${b.mine > 1 ? "s" : ""} bid at ${px}`}
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
                  title={`offer ${size} share${size > 1 ? "s" : ""} at ${px}`}
                  onClick={() => onOrder("A", px)}
                >
                  <span className="depth" style={{ width: a ? `${(a.qty / maxQty) * 100}%` : 0 }} />
                  <span className={`qty ${a ? "" : "zero"}`}>{a ? a.qty : "·"}</span>
                  {a?.mine ? (
                    <span
                      className="mylots"
                      role="button"
                      title={`cancel your ${a.mine} share${a.mine > 1 ? "s" : ""} offer at ${px}`}
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
      </div>

      <div className="hint">
        The ladder keeps going both ways — scroll as far as you like, zoom to fit more prices on screen, or jump back
        to the middle. Clicking above the best offer, or below the best bid, crosses the book and trades at the
        resting price.
        {mine?.length ? ` You have ${mine.length} order${mine.length > 1 ? "s" : ""} working.` : ""}
      </div>
    </div>
  );
}
