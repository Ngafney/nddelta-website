/**
 * The scope: everything this player knows about the curve, and nothing else.
 *
 * BOTH axes are fitted to the points you have actually bought. That is the
 * whole design constraint: the chart must not quietly hand over the domain or
 * the range by drawing axes that span them, because a player who can see where
 * the x axis stops can see roughly where the minimum has to be. So the window
 * is your own points plus padding, it moves as you buy more, and it carries no
 * marker for anything you have not paid for.
 *
 * Each point carries its exact tangent, drawn as a real tangent line in screen
 * space with an arrowhead, plus the number.
 */
import React, { useEffect, useRef } from "react";
import { num } from "./PixelBits.jsx";

const COL = {
  grid: "#132441",
  gridStrong: "#1d3760",
  ink: "#e8eefb",
  muted: "#5b6f96",
  gold: "#f5c542",
  goldDim: "#7a5c00",
  blue: "#60a5fa",
  green: "#3ad07f",
  red: "#f8717a",
  purple: "#a78bfa",
};

/** Fit the drawing box to the device pixel ratio so nothing looks fuzzy. */
export function fitCanvas(canvas, height) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 800;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: height };
}

/**
 * Screen mapping for an [x0,x1] x [lo,hi] window inside a padded box.
 * The x window is a parameter, never an assumption about the domain.
 */
export function makeMap(w, h, lo, hi, pad, x0 = 0, x1 = 100) {
  const span = hi - lo || 1;
  const xSpan = x1 - x0 || 1;
  return {
    x: (v) => pad.l + ((v - x0) / xSpan) * (w - pad.l - pad.r),
    y: (v) => pad.t + (1 - (v - lo) / span) * (h - pad.t - pad.b),
    lo,
    hi,
    x0,
    x1,
  };
}

/** The horizontal window: the points you own, padded, never degenerate. */
export function xWindowFor(points, fallbackHalfWidth = 120) {
  if (!points.length) return { x0: -fallbackHalfWidth, x1: fallbackHalfWidth };
  let lo = Math.min(...points.map((p) => p.x));
  let hi = Math.max(...points.map((p) => p.x));
  if (hi - lo < fallbackHalfWidth) {
    const mid = (hi + lo) / 2;
    lo = mid - fallbackHalfWidth / 2;
    hi = mid + fallbackHalfWidth / 2;
  }
  const pad = (hi - lo) * 0.16;
  return { x0: lo - pad, x1: hi + pad };
}

/** The vertical window: the points you own, padded, never degenerate. */
export function windowFor(values, minSpan = 1) {
  if (!values.length) return { lo: -1, hi: 1 };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.18;
  return { lo: lo - pad, hi: hi + pad };
}

export function drawFrame(ctx, w, h, map, pad, { yLabels = true } = {}) {
  ctx.clearRect(0, 0, w, h);

  // Vertical grid on a round step chosen for the window we are actually
  // showing. Nothing here knows or implies where the domain ends.
  ctx.lineWidth = 1;
  ctx.font = "11px Consolas, ui-monospace, monospace";
  ctx.textAlign = "center";
  const step = niceStep((map.x1 - map.x0) / 8);
  const start = Math.ceil(map.x0 / step) * step;
  for (let t = start; t <= map.x1; t += step) {
    const x = map.x(t);
    ctx.strokeStyle = COL.grid;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, pad.t);
    ctx.lineTo(Math.round(x) + 0.5, h - pad.b);
    ctx.stroke();
    ctx.fillStyle = "#a9bcdd";
    ctx.fillText(shortNum(t), x, h - pad.b + 16);
  }

  // horizontal grid
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const v = map.lo + ((map.hi - map.lo) * i) / 4;
    const y = Math.round(map.y(v)) + 0.5;
    ctx.strokeStyle = COL.grid;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
    if (yLabels) {
      ctx.fillStyle = COL.muted;
      ctx.fillText(shortNum(v), pad.l - 6, y + 4);
    }
  }

  // the axis label
  ctx.textAlign = "left";
  ctx.fillStyle = COL.muted;
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillText("x", w - pad.r - 8, h - pad.b + 17);
}

/** 1, 2, 2.5 or 5 times a power of ten — whichever is closest below `raw`. */
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

function shortNum(v) {
  const a = Math.abs(v);
  if (a >= 100000) return `${(v / 1000).toFixed(0)}k`;
  if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (a >= 10) return v.toFixed(0);
  return v.toFixed(1);
}

/** A point with its true tangent, arrowed. */
export function drawPoint(ctx, map, pt, { active = false, w, h, pad } = {}) {
  const px = map.x(pt.x);
  const py = map.y(pt.y);

  // The tangent in SCREEN space: dy/dpx = -(f'(x) * yScale) / xScale.
  const perX = (w - pad.l - pad.r) / (map.x1 - map.x0 || 1); // screen px per unit of x
  const perY = (h - pad.t - pad.b) / (map.hi - map.lo || 1); // screen px per unit of f
  const slopeScreen = (-pt.d * perY) / perX;
  const len = active ? 74 : 44;
  const norm = Math.hypot(1, slopeScreen) || 1;
  const ux = 1 / norm;
  const uy = slopeScreen / norm;

  ctx.lineWidth = active ? 3 : 2;
  ctx.strokeStyle = active ? COL.gold : "#7f8db0";
  ctx.beginPath();
  ctx.moveTo(px - ux * len * 0.55, py - uy * len * 0.55);
  ctx.lineTo(px + ux * len, py + uy * len);
  ctx.stroke();

  // arrowhead on the +x end — the direction of the gradient vector (1, f')
  const hx = px + ux * len;
  const hy = py + uy * len;
  const a = Math.atan2(uy, ux);
  const hs = active ? 11 : 8;
  ctx.fillStyle = active ? COL.gold : "#7f8db0";
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - hs * Math.cos(a - 0.42), hy - hs * Math.sin(a - 0.42));
  ctx.lineTo(hx - hs * Math.cos(a + 0.42), hy - hs * Math.sin(a + 0.42));
  ctx.closePath();
  ctx.fill();

  // the point itself, drawn as a pixel square
  const s = active ? 5 : 3.5;
  ctx.fillStyle = "#060d1c";
  ctx.fillRect(px - s - 2, py - s - 2, (s + 2) * 2, (s + 2) * 2);
  ctx.fillStyle = active ? COL.gold : COL.blue;
  ctx.fillRect(px - s, py - s, s * 2, s * 2);

  // a dropped line to the axis so the x is readable at a glance
  ctx.strokeStyle = active ? "#f5c54255" : "#60a5fa33";
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, py + s);
  ctx.lineTo(px, h - pad.b);
  ctx.stroke();
  ctx.setLineDash([]);

  if (active) {
    ctx.fillStyle = COL.gold;
    ctx.font = "11px Consolas, ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(pt.x.toFixed(2), px, pad.t - 6);
  }
}

export default function Scope({ points, activeX, onPick, height = 270, revealCurve = null, xStar = null }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const { ctx, w, h } = fitCanvas(canvas, height);
      const pad = { l: 52, r: 14, t: 18, b: 24 };
      // Once the curve is open to you the whole thing is fair game; until then
      // the window is strictly your own points.
      const ys = points.map((p) => p.y);
      let { x0, x1 } = xWindowFor(points);
      if (revealCurve) {
        for (const [, y] of revealCurve) ys.push(y);
        x0 = revealCurve[0][0];
        x1 = revealCurve[revealCurve.length - 1][0];
      }
      const { lo, hi } = windowFor(ys);
      const map = makeMap(w, h, lo, hi, pad, x0, x1);
      drawFrame(ctx, w, h, map, pad);

      if (revealCurve) {
        ctx.strokeStyle = COL.gold;
        ctx.lineWidth = 2;
        ctx.beginPath();
        revealCurve.forEach(([x, y], i) => (i ? ctx.lineTo(map.x(x), map.y(y)) : ctx.moveTo(map.x(x), map.y(y))));
        ctx.stroke();
        if (xStar != null) {
          const sx = map.x(xStar);
          ctx.strokeStyle = COL.green;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sx, pad.t);
          ctx.lineTo(sx, h - pad.b);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      for (const p of points) if (p.x !== activeX) drawPoint(ctx, map, p, { w, h, pad });
      const act = points.find((p) => p.x === activeX);
      if (act) drawPoint(ctx, map, act, { active: true, w, h, pad });
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [points, activeX, height, revealCurve, xStar]);

  const active = points.find((p) => p.x === activeX) ?? points[points.length - 1] ?? null;
  // "left"/"right", never "toward 0" — the ends of the domain are not ours to
  // mention.
  const dir = !active ? null : active.d > 0 ? "left" : active.d < 0 ? "right" : "here";

  return (
    <div className="scope">
      <canvas ref={ref} className="scope-canvas" />
      {!points.length ? (
        <div className="scope-empty">waiting for your opening point…</div>
      ) : (
        <>
          <div className="scope-readout">
            <div className="readout-cell">
              <i>YOUR X</i>
              <b style={{ color: "var(--gold)" }}>{num(active.x, 2)}</b>
            </div>
            <div className="readout-cell">
              <i>f(x)</i>
              <b>{num(active.y, 3)}</b>
            </div>
            <div className={`readout-cell ${active.d > 0 ? "down" : active.d < 0 ? "up" : "flat"}`}>
              <i>GRADIENT f'(x)</i>
              <b>
                {active.d > 0 ? "+" : ""}
                {num(active.d, 4)}
              </b>
            </div>
            <div className="readout-cell slope-arrow">
              <i>DOWNHILL</i>
              <b style={{ color: dir === "here" ? "var(--green)" : "var(--ink)" }}>
                {dir === "left" ? "◀ to the left" : dir === "right" ? "to the right ▶" : "— you are flat"}
              </b>
            </div>
          </div>
          {points.length > 1 && (
            <div className="pointchips">
              {points.map((p) => (
                <button key={p.x} className={`chip ${p.x === activeX ? "on" : ""}`} onClick={() => onPick?.(p.x)}>
                  x={num(p.x, 2)}
                  <small>
                    {p.d > 0 ? "+" : ""}
                    {num(p.d, 2)}
                  </small>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
