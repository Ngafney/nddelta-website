/**
 * The scope: everything this player knows about the curve, and the one control
 * that changes it — taking a step downhill — sitting directly underneath, so a
 * step is chosen while looking at the thing being stepped on.
 *
 * BOTH axes are fitted to the points the player has actually walked to. That is
 * the design constraint: the chart must not quietly hand over the domain or the
 * range by drawing axes that span them, because anyone who can see where the
 * axes stop can see roughly where the answer has to be. So the window is their
 * own points plus padding, it moves as they step, and it carries no marker for
 * anything they have not paid for.
 *
 * The vertical axis is the one that matters: it is the same scale as the price
 * ladder, because the contract settles on min f. The lowest height seen so far
 * is drawn across the chart, since that line is an upper bound on the
 * settlement — the single most useful thing a player owns.
 *
 * The arrow on each point runs DOWNHILL, along −f'(x): the direction a step
 * would actually take you. The number printed beside it is the gradient itself.
 */
import React, { useEffect, useRef, useState } from "react";
import { PxButton, Spinner, money, num } from "./PixelBits.jsx";

const COL = {
  grid: "#132441",
  ink: "#e8eefb",
  muted: "#5b6f96",
  gold: "#f5c542",
  blue: "#60a5fa",
  green: "#3ad07f",
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

/** The vertical window: the values you own, padded, never degenerate. */
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

/** The horizontal window: the points you own, padded, never degenerate. */
export function xWindowFor(points, fallbackWidth = 12) {
  if (!points.length) return { x0: -fallbackWidth, x1: fallbackWidth };
  let lo = Math.min(...points.map((p) => p.x));
  let hi = Math.max(...points.map((p) => p.x));
  if (hi - lo < fallbackWidth) {
    const mid = (hi + lo) / 2;
    lo = mid - fallbackWidth / 2;
    hi = mid + fallbackWidth / 2;
  }
  const pad = (hi - lo) * 0.16;
  return { x0: lo - pad, x1: hi + pad };
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

export function drawFrame(ctx, w, h, map, pad, { yLabels = true } = {}) {
  ctx.clearRect(0, 0, w, h);

  // Vertical grid on a round step chosen for the window actually on screen.
  // Nothing here knows or implies where the domain ends.
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

  // Horizontal grid. These are PRICES — the same scale as the ladder.
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
  ctx.font = "10px 'Press Start 2P', monospace";
  ctx.fillText("x", w - pad.r - 8, h - pad.b + 17);
}

/** A point with its DOWNHILL arrow: along −f'(x), the way a step would go. */
export function drawPoint(ctx, map, pt, { active = false, w, h, pad } = {}) {
  const px = map.x(pt.x);
  const py = map.y(pt.y);

  // The tangent in SCREEN space, then walked along −f' so the arrow is the
  // direction of travel rather than the direction of the gradient.
  const perX = (w - pad.l - pad.r) / (map.x1 - map.x0 || 1);
  const perY = (h - pad.t - pad.b) / (map.hi - map.lo || 1);
  const slopeScreen = (-pt.d * perY) / perX;
  const dirX = pt.d > 0 ? -1 : pt.d < 0 ? 1 : 0; // −f' in x
  const len = active ? 76 : 46;
  const norm = Math.hypot(1, slopeScreen) || 1;
  const ux = (dirX || 1) / norm;
  const uy = (slopeScreen * (dirX || 1)) / norm;

  // the tangent line, drawn both ways so the slope itself still reads
  ctx.lineWidth = active ? 3 : 2;
  ctx.strokeStyle = active ? COL.gold : "#7f8db0";
  ctx.beginPath();
  ctx.moveTo(px - ux * len * 0.5, py - uy * len * 0.5);
  ctx.lineTo(px + ux * len, py + uy * len);
  ctx.stroke();

  if (dirX !== 0) {
    const hx = px + ux * len;
    const hy = py + uy * len;
    const a = Math.atan2(uy, ux);
    const hs = active ? 12 : 8;
    ctx.fillStyle = active ? COL.green : "#7f8db0";
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - hs * Math.cos(a - 0.42), hy - hs * Math.sin(a - 0.42));
    ctx.lineTo(hx - hs * Math.cos(a + 0.42), hy - hs * Math.sin(a + 0.42));
    ctx.closePath();
    ctx.fill();
  }

  const s = active ? 5 : 3.5;
  ctx.fillStyle = "#060d1c";
  ctx.fillRect(px - s - 2, py - s - 2, (s + 2) * 2, (s + 2) * 2);
  ctx.fillStyle = active ? COL.gold : COL.blue;
  ctx.fillRect(px - s, py - s, s * 2, s * 2);

  if (active) {
    ctx.fillStyle = COL.gold;
    ctx.font = "11px Consolas, ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(pt.x.toFixed(2), px, pad.t - 6);
  }
}

/** The lowest height seen so far — an upper bound on the settlement. */
function drawFloor(ctx, map, w, pad, best) {
  const y = map.y(best);
  ctx.strokeStyle = "#3ad07f88";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.l, y);
  ctx.lineTo(w - pad.r, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COL.green;
  ctx.font = "10px Consolas, ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText(`lowest seen ${best.toFixed(2)}`, pad.l + 6, y - 6);
}

export default function Scope({
  points,
  activeX,
  onPick,
  height = 300,
  revealCurve = null,
  yStar = null,
  // the step control, built into the same panel
  me,
  onDescend,
  busy,
  disabled,
  limits,
}) {
  const ref = useRef(null);
  const [lrExp, setLrExp] = useState(-1);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;

    const draw = () => {
      const { ctx, w, h } = fitCanvas(canvas, height);
      const pad = { l: 56, r: 14, t: 18, b: 26 };
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
        if (yStar != null) drawFloor(ctx, map, w, pad, yStar);
      } else if (points.length) {
        drawFloor(ctx, map, w, pad, Math.min(...points.map((p) => p.y)));
      }

      for (const p of points) if (p.x !== activeX) drawPoint(ctx, map, p, { w, h, pad });
      const act = points.find((p) => p.x === activeX);
      if (act) drawPoint(ctx, map, act, { active: true, w, h, pad });
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [points, activeX, height, revealCurve, yStar]);

  const active = points.find((p) => p.x === activeX) ?? points[points.length - 1] ?? null;
  const best = points.length ? Math.min(...points.map((p) => p.y)) : null;

  const maxStep = limits?.maxStep ?? 25;
  const [lrMin, lrHardMax] = limits?.learningRate ?? [0.0001, 1000];
  // The top of the slider IS the biggest legal step, rather than a place you
  // can drag to and then be told off. It moves with the slope you are standing
  // on, so the far right always means "as far as one step can take me".
  const slope = Math.abs(active?.d ?? 0);
  const lrMax = slope > 0 ? clamp(maxStep / slope, lrMin, lrHardMax) : lrHardMax;
  const lr = clamp(Math.pow(10, lrExp), lrMin, lrMax);
  const step = active ? -lr * active.d : 0;
  const target = active ? round2(active.x + step) : null;
  // Two very different dead ends, which used to share one wrong message:
  //   tooSmall  — the rate is so low the step rounds to nothing.
  //   alreadyThere — the step moves, possibly a long way, but lands on a point
  //     you have already paid for. At the top of the slider the step is always
  //     exactly maxStep, so repeated max steps walk a rigid lattice and land on
  //     old points constantly. Saying "that does not move" about a 25-unit step
  //     is simply false.
  const tooSmall = Math.abs(step) < 0.005;
  const alreadyThere = active ? points.some((p) => Math.abs(p.x - target) < 0.005) : true;
  const blocked = tooSmall || alreadyThere;

  /**
   * Walk the rate outward from where it is until the step lands somewhere new.
   * A dead end the player cannot get out of without understanding why is a bad
   * dead end; this is the way out, in one tap.
   */
  const nudgeRate = () => {
    if (!active) return;
    const lo = Math.log10(lrMin);
    const hi = Math.log10(lrMax);
    for (let d = 0.02; d <= 2; d += 0.02) {
      for (const cand of [lrExp + d, lrExp - d]) {
        if (cand < lo || cand > hi) continue;
        const l = clamp(Math.pow(10, cand), lrMin, lrMax);
        const s = -l * active.d;
        if (Math.abs(s) < 0.005) continue;
        const t = round2(active.x + s);
        if (!points.some((p) => Math.abs(p.x - t) < 0.005)) {
          setLrExp(Math.round(cand * 1000) / 1000);
          return;
        }
      }
    }
  };
  const cost = me?.descentCostC ?? 0;
  const broke = cost > (me?.spendableC ?? 0);

  return (
    <div className="scope">
      <canvas ref={ref} className="scope-canvas" />

      {!points.length ? (
        <div className="scope-empty">waiting for your opening point…</div>
      ) : (
        <>
          <div className="scope-readout">
            <div className="readout-cell">
              <i>YOUR x</i>
              <b style={{ color: "var(--gold)" }}>{num(active.x, 2)}</b>
            </div>
            <div className="readout-cell">
              <i>HEIGHT f(x)</i>
              <b>{num(active.y, 2)}</b>
            </div>
            <div className={`readout-cell ${active.d > 0 ? "down" : active.d < 0 ? "up" : "flat"}`}>
              <i>GRADIENT f'(x)</i>
              <b>
                {active.d > 0 ? "+" : ""}
                {num(active.d, 3)}
              </b>
            </div>
            <div className="readout-cell slope-arrow">
              <i>LOWEST SEEN</i>
              <b style={{ color: "var(--bid)" }}>{num(best, 2)}</b>
            </div>
          </div>

          <div className="floor-note">
            The answer is at or below <b>{num(best, 2)}</b> — that is your edge. Walk downhill to find out how far
            below it goes.
          </div>

          {points.length > 1 && (
            <div className="pointchips">
              {points.map((p) => (
                <button
                  key={p.x}
                  className={`chip ${p.x === active.x ? "on" : ""} ${p.y === best ? "low" : ""}`}
                  onClick={() => onPick?.(p.x)}
                  title={`f(${num(p.x, 2)}) = ${num(p.y, 2)}`}
                >
                  {num(p.y, 1)}
                  <small>x={num(p.x, 1)}</small>
                </button>
              ))}
            </div>
          )}

          {onDescend && (
            <div className="stepbox">
              <div className="stepbox-head">
                <span>
                  TAKE A STEP DOWNHILL · <b>{money(cost)}</b>
                </span>
                <code>x ← x − rate × f'(x)</code>
              </div>

              <div className="steprow">
                <div className="stepdial">
                  <span className="field-label">LEARNING RATE</span>
                  <div className="probe-offset">{fmtRate(lr)}</div>
                  <input
                    type="range"
                    min={Math.log10(lrMin)}
                    max={Math.log10(lrMax)}
                    step={0.001}
                    value={clamp(lrExp, Math.log10(lrMin), Math.log10(lrMax))}
                    onChange={(e) => setLrExp(Number(e.target.value))}
                    aria-label="learning rate"
                  />
                  <div className="steprange">
                    <span>creep</span>
                    <span>max step · {maxStep}</span>
                  </div>
                  <div className="nudge">
                    {[-1, -0.25, 0.25, 1].map((d) => (
                      <button
                        key={d}
                        onClick={() => setLrExp((v) => clamp(round2(v + d), Math.log10(lrMin), Math.log10(lrMax)))}
                      >
                        {d > 0 ? `+${d}` : d}
                      </button>
                    ))}
                    <button title="a third of the biggest step you could take" onClick={() => setLrExp(Math.log10(lrMax * 0.3))}>
                      1/3
                    </button>
                    <button
                      title="as far as one step can take you"
                      onClick={() => setLrExp(Math.log10(lrMax * 0.97))}
                    >
                      max
                    </button>
                  </div>
                </div>

                <div className="steppreview">
                  <span className="field-label">THE STEP</span>
                  <div className={`stepsize ${step < 0 ? "left" : step > 0 ? "right" : ""}`}>
                    {step > 0 ? "+" : ""}
                    {num(step, 2)}
                  </div>
                  <div className="probe-target">
                    lands on <b>x = {num(target, 2)}</b>
                  </div>
                  <PxButton
                    variant="green"
                    style={{ width: "100%", marginTop: 10 }}
                    disabled={busy || disabled || blocked || broke || active.d === 0}
                    onClick={() => onDescend(active.x, lr)}
                  >
                    {busy === "descend" ? (
                      <Spinner text="STEPPING" />
                    ) : active.d === 0 ? (
                      "SLOPE HERE IS ZERO"
                    ) : alreadyThere ? (
                      "YOU HAVE BEEN THERE"
                    ) : tooSmall ? (
                      "RATE TOO SMALL TO MOVE"
                    ) : broke ? (
                      "CASH IS COMMITTED"
                    ) : (
                      `STEP · ${money(cost)}`
                    )}
                  </PxButton>

                  {blocked && active.d !== 0 && (
                    <div className="stepblock">
                      {alreadyThere
                        ? `That step lands on x = ${num(target, 2)}, which you already walked to — you would be paying for a point you own.`
                        : "That rate is too small to move you anywhere new."}
                      <button className="pxbtn pxbtn--sm pxbtn--ghost" onClick={nudgeRate}>
                        FIND A RATE THAT MOVES
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="hint">
                {me?.descents ?? 0} step{me?.descents === 1 ? "" : "s"} taken · {money(me?.spentC ?? 0)} spent, and
                every dollar of it comes off your score.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

function fmtRate(lr) {
  if (lr >= 1000) return lr.toFixed(0);
  if (lr >= 10) return lr.toFixed(1);
  if (lr >= 1) return lr.toFixed(2);
  if (lr >= 0.01) return lr.toFixed(3);
  return lr.toExponential(1);
}
