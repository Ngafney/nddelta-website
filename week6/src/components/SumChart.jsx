/**
 * The running sum against how many numbers are out, inside the cone of what
 * is still possible: the floor of the cone is the sum so far (every number
 * left could be 0), the ceiling is the sum plus 10 for each number left. The
 * cone closes to a point at N. K is drawn across it.
 *
 * Canvas work happens in effects only, so the server render (and the render
 * test) produce the frame and nothing else.
 */
import React, { useEffect, useRef } from "react";
import { COL, fitCanvas, makeMap, drawFrame, polyline, hRule, vRule } from "./chartKit.js";

export default function SumChart({ round, height = 220, big = false }) {
  const ref = useRef(null);
  const size = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !round) return undefined;
    const draw = () => paint(canvas, round, height, big);
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
  }, [round, height, big]);

  if (!round) return null;
  return (
    <div className={`hchart ${big ? "big" : ""}`}>
      <div className="fairlegend">
        <span className="lg blue">SUM SO FAR</span>
        <span className="lg dim">STILL POSSIBLE</span>
        <span className="lg gold">K = {round.K}</span>
      </div>
      <canvas ref={ref} className="hcanvas" style={{ width: "100%", height }} aria-label={`the running sum against numbers revealed, inside the range still possible, with K = ${round.K}`} />
    </div>
  );
}

function paint(canvas, round, height, big) {
  const { ctx, w, h } = fitCanvas(canvas, height);
  const pad = big ? { l: 56, r: 22, t: 18, b: 34 } : { l: 44, r: 16, t: 14, b: 28 };
  const N = Math.max(1, round.N);
  const Smax = round.Smax;
  const map = makeMap(w, h, 0, Smax, pad, 0, N);
  drawFrame(ctx, w, h, map, pad, { fontPx: big ? 14 : 11, xLabel: "out" });

  const nums = round.revealed ?? [];
  const pts = [[0, 0]];
  const lo = [[0, 0]];
  const hi = [[0, Smax]];
  let s = 0;
  for (let i = 0; i < nums.length; i++) {
    s += nums[i];
    pts.push([i + 1, s]);
    lo.push([i + 1, s]);
    hi.push([i + 1, s + 10 * (N - i - 1)]);
  }

  // The cone, shaded, from the last point out to N.
  const k = nums.length;
  ctx.save();
  ctx.fillStyle = "rgba(96,165,250,0.08)";
  ctx.beginPath();
  ctx.moveTo(map.x(k), map.y(s));
  ctx.lineTo(map.x(k), map.y(s + 10 * (N - k)));
  ctx.lineTo(map.x(N), map.y(s + 10 * (N - k)) + (map.y(s) - map.y(s + 10 * (N - k))) / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  hRule(ctx, map, round.K, pad, w, { color: COL.gold, label: `K = ${round.K}`, width: big ? 2 : 1.5, at: "left" });
  vRule(ctx, map, N, pad, h, { color: COL.muted, label: "ALL OUT", dash: [2, 3], align: "right" });
  polyline(ctx, map, lo, { color: COL.dim, width: 1, dash: [3, 3] });
  polyline(ctx, map, hi, { color: COL.dim, width: 1, dash: [3, 3] });
  polyline(ctx, map, pts, { color: COL.blue, width: big ? 3.5 : 2.5 });

  // The last point gets a dot, coloured by which side of K it is on.
  const r = big ? 7 : 5;
  ctx.fillStyle = "#060d1c";
  ctx.fillRect(map.x(k) - r - 2, map.y(s) - r - 2, (r + 2) * 2, (r + 2) * 2);
  ctx.fillStyle = round.status === "settled" ? (s > round.K ? COL.green : COL.red) : COL.blue;
  ctx.fillRect(map.x(k) - r, map.y(s) - r, r * 2, r * 2);
}

/**
 * The reveal's picture, one per book: what the book was really worth under
 * the uniform prior as each number came out (gold), against what the room was
 * paying (blue), and the payoff it finished at (green).
 */
export function FairChart({ book, fair, mids, payout, settleMin, settleMax, height = 180, big = false, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !fair) return;
    const { ctx, w, h } = fitCanvas(canvas, height);
    const pad = big ? { l: 50, r: 18, t: 16, b: 30 } : { l: 40, r: 12, t: 12, b: 26 };
    const N = fair.length - 1;
    const top = Math.max(settleMax, 1);
    const map = makeMap(w, h, settleMin, top, pad, 0, N);
    drawFrame(ctx, w, h, map, pad, { fontPx: big ? 13 : 10, xLabel: "out" });
    hRule(ctx, map, payout, pad, w, { color: COL.green, label: `PAID ${payout}`, dash: [4, 4], width: 1.5, at: "left" });
    polyline(
      ctx,
      map,
      (mids ?? []).map((m) => [m.i, m[book]?.mid ?? m[book]?.last ?? null]),
      { color: COL.blue, width: big ? 3 : 2.5 }
    );
    polyline(ctx, map, fair.map((f, i) => [i, f[book]]), { color: COL.gold, width: big ? 3.5 : 3 });
  }, [book, fair, mids, payout, settleMin, settleMax, height, big]);

  return (
    <div className="hchart fairchart">
      <div className="fairlegend">
        <span className="lg name">{label}</span>
        <span className="lg gold">FAIR (UNIFORM)</span>
        <span className="lg blue">MARKET</span>
        <span className="lg green">PAID</span>
      </div>
      <canvas ref={ref} className="hcanvas" style={{ width: "100%", height }} aria-label={`${label}: fair value against the market, as the numbers came out`} />
    </div>
  );
}
