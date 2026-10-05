/**
 * Canvas plumbing, ported from week2/src/components/Scope.jsx — fitCanvas,
 * makeMap and drawFrame, unchanged except that drawFrame takes its axis label
 * and the x-grid labels can be turned off. Copied rather than imported because
 * each week is its own package with its own React; importing across them would
 * let a bundler pull a second copy of React out of week2/node_modules.
 */

export const COL = {
  grid: "#132441",
  ink: "#e8eefb",
  muted: "#5b6f96",
  dim: "#3a4d74",
  gold: "#f5c542",
  blue: "#60a5fa",
  green: "#3ad07f",
  red: "#f8717a",
  purple: "#a78bfa",
  hist: "#5b6f96",
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

/** Screen mapping for an [x0,x1] × [lo,hi] window inside a padded box. */
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

/** 1, 2, 2.5 or 5 times a power of ten — whichever is closest above `raw`. */
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

function shortNum(v) {
  if (Number.isInteger(v)) return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
  const a = Math.abs(v);
  if (a >= 100000) return `${(v / 1000).toFixed(0)}k`;
  if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (a >= 10) return v.toFixed(0);
  return v.toFixed(1);
}

export function drawFrame(ctx, w, h, map, pad, { yLabels = true, xLabel = "t", fontPx = 11 } = {}) {
  ctx.clearRect(0, 0, w, h);

  ctx.lineWidth = 1;
  ctx.font = `${fontPx}px Consolas, ui-monospace, monospace`;
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
    ctx.fillText(shortNum(t), x, h - pad.b + fontPx + 5);
  }

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

  ctx.textAlign = "left";
  ctx.fillStyle = COL.muted;
  ctx.font = `italic ${fontPx + 1}px Consolas, ui-monospace, monospace`;
  ctx.fillText(xLabel, w - pad.r - 8, h - pad.b + fontPx + 6);
}

/** A polyline through (x, y) pairs, skipping nulls. */
export function polyline(ctx, map, pts, { color, width = 2, dash = null }) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  let pen = false;
  for (const [x, y] of pts) {
    if (y == null || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(map.x(x), map.y(y));
    else ctx.moveTo(map.x(x), map.y(y));
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}

/** A labelled vertical rule at x. */
export function vRule(ctx, map, x, pad, h, { color, label, dash = [4, 4], align = "left", row = 0 }) {
  const sx = Math.round(map.x(x)) + 0.5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(sx, pad.t);
  ctx.lineTo(sx, h - pad.b);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = color;
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.textAlign = align;
    ctx.fillText(label, sx + (align === "left" ? 5 : -5), pad.t + 11 + row * 14);
  }
  ctx.restore();
}

/** A labelled horizontal rule at y. */
export function hRule(ctx, map, y, pad, w, { color, label, dash = [6, 4], width = 1.5, at = "right" }) {
  const sy = Math.round(map.y(y)) + 0.5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(pad.l, sy);
  ctx.lineTo(w - pad.r, sy);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = color;
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.textAlign = at;
    ctx.fillText(label, at === "left" ? pad.l + 6 : w - pad.r - 4, sy - 6);
  }
  ctx.restore();
}

/** The vertical window over some values, padded and never degenerate. */
export function yWindow(values, minSpan = 2, padFrac = 0.12) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (!v.length) return { lo: 0, hi: 1 };
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * padFrac;
  return { lo: lo - pad, hi: hi + pad };
}
