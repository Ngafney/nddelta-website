/**
 * The chart the whole round is about.
 *
 *   history (t ≤ 0)     greyed: this is what everyone had before the open
 *   live ticks (t > 0)  bright, one more every few seconds
 *   K                   the line Y has to finish above
 *   T                   the tick it has to finish above it AT
 *
 * The x-axis always runs out to T, so the empty space to the right of the last
 * print is the time still to go — the horizon. The y-axis is fitted to what has
 * been printed (and K), never to anything that has not: drawing the axis to the
 * whole path would hand the room the range of the future.
 *
 * Canvas work happens in effects only, so the server render (and the render
 * test) produce the frame and the header and nothing else.
 */
import React, { useEffect, useRef } from "react";
import { COL, fitCanvas, makeMap, drawFrame, polyline, vRule, hRule, yWindow } from "./chartKit.js";
import { clock } from "./PixelBits.jsx";

export default function HorizonChart({
  series,
  K,
  T,
  height = 300,
  big = false,
  // The reveal draws the whole path and marks where φ changed.
  future = null,
  switchTick = null,
  header = null,
}) {
  const ref = useRef(null);
  const size = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !series) return undefined;
    const draw = () => paint(canvas, { series, K, T, height, big, future, switchTick });
    draw();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        const w = canvas.clientWidth;
        if (w !== size.current) {
          size.current = w;
          draw();
        }
      });
      ro.observe(canvas);
    }
    return () => ro?.disconnect();
  }, [series, K, T, height, big, future, switchTick]);

  return (
    <div className={`hchart ${big ? "big" : ""}`}>
      {header}
      {series ? (
        <canvas ref={ref} className="hcanvas" style={{ width: "100%", height }} aria-label={`Y against t, with K = ${K} and T = ${T}`} />
      ) : (
        <div className="hchart-empty" style={{ height }}>
          THE CHART APPEARS WHEN RESEARCH OPENS
        </div>
      )}
    </div>
  );
}

/**
 * The strip above the chart: where we are, how long until the next print, and
 * where Y stands against K. Pure, so the floor and the board share it.
 */
export function ChartHeader({ round, series, msToNext, big = false }) {
  if (!round) return null;
  const last = series?.ys?.length ? series.ys[series.ys.length - 1] : null;
  const above = last != null && last > round.K;
  const live = round.status === "live";
  return (
    <div className={`hhead ${big ? "big" : ""}`}>
      <span className="hh-cell">
        <i>TICK</i>
        <b>
          {round.tickNow ?? 0}
          <small> / {round.T}</small>
        </b>
      </span>
      <span className="hh-cell">
        <i>{live ? "NEXT PRINT" : round.status === "research" ? "BOOK OPENS" : round.status === "settled" ? "SETTLED" : "WAITING"}</i>
        <b>{live ? (msToNext == null ? "—" : `${Math.max(0, Math.ceil(msToNext / 1000))}s`) : round.status === "research" ? clock(round.msLeft ?? 0) : "—"}</b>
      </span>
      <span className="hh-cell">
        <i>Y NOW</i>
        <b className={last == null ? "" : above ? "up" : "down"}>{last == null ? "—" : last.toFixed(2)}</b>
      </span>
      <span className="hh-cell">
        <i>LINE</i>
        <b>
          K = {round.K}
        </b>
      </span>
      <span className="hh-cell">
        <i>TO GO</i>
        <b>
          {round.T - (round.tickNow ?? 0)} <small>× {round.secondsPerTick}s</small>
        </b>
      </span>
    </div>
  );
}

function paint(canvas, { series, K, T, height, big, future, switchTick }) {
  const { ctx, w, h } = fitCanvas(canvas, height);
  const pad = big ? { l: 64, r: 22, t: 22, b: 34 } : { l: 52, r: 16, t: 18, b: 28 };
  const t0 = series.t0;
  const ys = series.ys;
  const shownTo = t0 + ys.length - 1; // the last t on screen
  const full = future ?? null; // whole live path 0..T, reveal only
  const vals = ys.concat([K]);
  if (full) vals.push(...full);
  const { lo, hi } = yWindow(vals, 2);
  const xEnd = Math.max(T, shownTo);
  const map = makeMap(w, h, lo, hi, pad, t0, xEnd + Math.max(1, Math.round((xEnd - t0) * 0.015)));
  drawFrame(ctx, w, h, map, pad, { fontPx: big ? 14 : 11 });

  // The horizon: everything after the last print, shaded.
  if (!full && shownTo < T) {
    ctx.fillStyle = "rgba(96,165,250,0.05)";
    ctx.fillRect(map.x(shownTo), pad.t, map.x(T) - map.x(shownTo), h - pad.t - pad.b);
  }

  // K is labelled at the left edge: the right edge is where the last print sits.
  hRule(ctx, map, K, pad, w, { color: COL.gold, label: `K = ${K}`, width: big ? 2 : 1.5, at: "left" });
  // OPEN is labelled on the history side, T on the live side, so the two never
  // collide however short the live window is on screen.
  vRule(ctx, map, 0, pad, h, { color: COL.muted, label: "OPEN", align: "right" });
  vRule(ctx, map, T, pad, h, { color: COL.gold, label: "T", dash: [2, 3], align: "right" });
  if (switchTick != null) vRule(ctx, map, switchTick, pad, h, { color: COL.purple, label: "φ SWITCHED", dash: [3, 3], row: 1 });

  // History, greyed.
  const hist = [];
  for (let i = 0; i < ys.length; i++) {
    const t = t0 + i;
    if (t > 0) break;
    hist.push([t, ys[i]]);
  }
  polyline(ctx, map, hist, { color: COL.hist, width: big ? 2 : 1.5 });

  // Live ticks, bright. On the reveal the whole live path is drawn.
  const live = [];
  const liveYs = full ?? ys.slice(-(Math.max(0, shownTo) + 1));
  if (full) for (let s = 0; s < full.length; s++) live.push([s, full[s]]);
  else for (let i = 0; i < ys.length; i++) if (t0 + i >= 0) live.push([t0 + i, ys[i]]);
  polyline(ctx, map, live, { color: COL.blue, width: big ? 3.5 : 2.5 });

  // The last print gets a dot, coloured by which side of K it is on.
  const tl = full ? full.length - 1 : shownTo;
  const yl = full ? full[full.length - 1] : ys[ys.length - 1];
  if (yl != null && tl >= 0 && liveYs.length) {
    const r = big ? 7 : 5;
    ctx.fillStyle = "#060d1c";
    ctx.fillRect(map.x(tl) - r - 2, map.y(yl) - r - 2, (r + 2) * 2, (r + 2) * 2);
    ctx.fillStyle = yl > K ? COL.green : COL.red;
    ctx.fillRect(map.x(tl) - r, map.y(yl) - r, r * 2, r * 2);
  }
}

/**
 * The reveal's second picture: what the contract was really worth at every
 * tick (the true fair value, under the true process) against what the room
 * actually paid for it, with the naive desk's random-walk price for contrast.
 */
export function FairChart({ fair, mids, naive, height = 280, big = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !fair) return;
    const { ctx, w, h } = fitCanvas(canvas, height);
    const pad = big ? { l: 56, r: 22, t: 18, b: 34 } : { l: 44, r: 16, t: 14, b: 28 };
    const T = fair.length - 1;
    const map = makeMap(w, h, 0, 100, pad, 0, T);
    drawFrame(ctx, w, h, map, pad, { fontPx: big ? 14 : 11 });
    hRule(ctx, map, 50, pad, w, { color: COL.dim, label: null, dash: [2, 4], width: 1 });
    if (naive) polyline(ctx, map, naive.map((v, t) => [t, v]), { color: COL.muted, width: 1.5, dash: [5, 4] });
    polyline(
      ctx,
      map,
      (mids ?? []).map((m) => [m.t, m.mid ?? m.last]),
      { color: COL.blue, width: big ? 3 : 2.5 }
    );
    polyline(ctx, map, fair.map((v, t) => [t, v]), { color: COL.gold, width: big ? 3.5 : 3 });
  }, [fair, mids, naive, height, big]);

  return (
    <div className="hchart">
      <div className="fairlegend">
        <span className="lg gold">TRUE FAIR VALUE</span>
        <span className="lg blue">MARKET MID</span>
        {naive && <span className="lg dim">NAIVE DESK (RANDOM WALK)</span>}
      </div>
      <canvas ref={ref} className="hcanvas" style={{ width: "100%", height }} aria-label="true fair value against the market price, tick by tick" />
    </div>
  );
}
