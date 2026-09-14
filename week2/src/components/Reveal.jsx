/**
 * The bell.
 *
 *   3 · 2 · 1                       the room goes quiet
 *   the curve unfurls               outward from the last point YOU saw, to
 *                                   both ends of the domain, so the reveal is
 *                                   personal: it starts where your knowledge
 *                                   stopped
 *   the minimum lights up           x* marked, settlement price slammed on
 *   the podium                      top three teams rise
 *   the full board                  everyone, final
 *
 * In prediction mode there is no curve to unfurl, so the resolution lands as
 * one enormous number instead and the rest of the sequence is identical.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { fitCanvas, makeMap, windowFor, drawFrame, drawPoint } from "./Scope.jsx";
import { PxButton, money, num } from "./PixelBits.jsx";

const SPREAD_MS = 2600;
const HOLD_MS = 2600;

export default function Reveal({ reveal, points, leaderboard, myTeamId, onClose, projector = false }) {
  const [phase, setPhase] = useState(0); // 0 countdown · 1 the answer · 2 podium · 3 board
  const [count, setCount] = useState(3);

  // The big screen has nobody to click it, so that one alone runs on a timer.
  useEffect(() => {
    if (!projector || phase === 0 || phase >= 3) return undefined;
    const t = setTimeout(() => setPhase((p) => p + 1), phase === 1 ? SPREAD_MS + HOLD_MS : 5200);
    return () => clearTimeout(t);
  }, [projector, phase]);

  useEffect(() => {
    if (phase !== 0) return undefined;
    if (count <= 0) {
      setPhase(1);
      return undefined;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 850);
    return () => clearTimeout(t);
  }, [phase, count]);

  // Past the countdown nothing advances on its own. A reveal that moves while
  // somebody is still reading it is a reveal nobody actually sees, so every
  // step from here is a click.

  const prediction = reveal?.mode === "prediction";
  // What settles is the minimum VALUE of f, not where it occurs.
  const settleValue = prediction ? reveal?.value : reveal?.yStar;

  return (
    <div className="reveal">
      <div className="reveal-inner">
        <div className="reveal-head">
          {phase === 0
            ? "TIME"
            : phase === 1
              ? prediction
                ? "THE MARKET RESOLVES"
                : "THE FUNCTION"
              : phase === 2
                ? "THE PODIUM"
                : "FINAL STANDINGS"}
        </div>

        {phase === 0 && <div className="reveal-count" key={count}>{count > 0 ? count : "GO"}</div>}

        {phase === 1 &&
          (prediction ? (
            <PredictionSlam reveal={reveal} />
          ) : (
            <CurveSpread reveal={reveal} points={points} />
          ))}

        {phase === 1 && (
          <div className="reveal-sub">
            <div className="reveal-stat">
              <i>{prediction ? "RESOLVES AT" : "THE LOWEST f GETS"}</i>
              <b>{num(settleValue, 2)}</b>
            </div>
            {!prediction && reveal?.xStar != null && (
              <div className="reveal-stat">
                <i>WHICH IT HITS AT x =</i>
                <b style={{ color: "var(--muted)" }}>{num(reveal.xStar, 2)}</b>
              </div>
            )}
            <div className="reveal-stat">
              <i>EVERY SHARE PAYS</i>
              <b>{money(reveal?.settleC ?? 0)}</b>
            </div>
          </div>
        )}

        {phase === 2 && <Podium rows={leaderboard} />}

        {phase === 3 && (
          <div className="final-board">
            <div className="final-col">
              <div className="panel-title">TEAMS</div>
              <ol>
                {(leaderboard ?? []).slice(0, 10).map((r) => (
                  <li key={r.id} className={r.id === myTeamId ? "me" : ""}>
                    <span className="rk">{r.rank}</span>
                    <span className="nm">{r.name}</span>
                    <span className="vl">{money(r.valueC)}</span>
                  </li>
                ))}
              </ol>
            </div>
            {(leaderboard ?? []).some((r) => r.members?.length) && (
              <div className="final-col">
                <div className="panel-title">TOP INDIVIDUALS</div>
                <ol>
                  {(leaderboard ?? [])
                    .flatMap((r) => r.members.map((m) => ({ ...m, team: r.name })))
                    .sort((a, b) => b.valueC - a.valueC)
                    .slice(0, 10)
                    .map((m, i) => (
                      <li key={m.id}>
                        <span className="rk">{i + 1}</span>
                        <span className="nm">
                          {m.name} <small style={{ color: "var(--dim)" }}>{m.team}</small>
                        </span>
                        <span className="vl">{money(m.valueC)}</span>
                      </li>
                    ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {!projector && phase > 0 && (
          <div style={{ marginTop: 28 }}>
            <PxButton variant={phase < 3 ? "gold" : "green"} onClick={phase < 3 ? () => setPhase(phase + 1) : onClose}>
              {phase === 1 ? "NEXT — THE PODIUM →" : phase === 2 ? "NEXT — THE BOARD →" : "BACK TO THE FLOOR"}
            </PxButton>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── the curve, unfurling ─────────────────────────────────────────────── */

function CurveSpread({ reveal, points }) {
  const ref = useRef(null);
  const start = useRef(0);
  // The poll hands down a NEW points array every second. If the animation
  // depended on it, the unfurl restarted every second and the curve appeared
  // to draw itself over and over. It reads the latest points through a ref
  // instead, and the effect below runs once per round.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // The domain only becomes public at the bell, so it is read off the revealed
  // curve rather than assumed anywhere.
  const bounds = useMemo(() => {
    const c = reveal?.curve;
    if (!c?.length) return { lo: 0, hi: 1 };
    return { lo: c[0][0], hi: c[c.length - 1][0] };
  }, [reveal]);

  // Where the unfurl begins: the last point this player bought, or the answer
  // itself if they never bought one.
  const origin = useMemo(() => {
    if (points?.length) return points[points.length - 1].x;
    return reveal?.xStar ?? (bounds.lo + bounds.hi) / 2;
  }, [points, reveal, bounds]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !reveal?.curve) return undefined;
    let raf = 0;

    const render = (now) => {
      const h = Math.max(260, Math.min(520, Math.round(window.innerHeight * 0.46)));
      const { ctx, w } = fitCanvas(canvas, h);
      const pad = { l: 54, r: 16, t: 22, b: 28 };
      const ys = reveal.curve.map(([, y]) => y);
      const { lo, hi } = windowFor(ys);
      const map = makeMap(w, h, lo, hi, pad, bounds.lo, bounds.hi);
      drawFrame(ctx, w, h, map, pad);

      const elapsed = now - start.current;
      const t = Math.min(1, elapsed / SPREAD_MS);
      const ease = 1 - Math.pow(1 - t, 3);
      const left = origin - ease * Math.max(origin - bounds.lo, 0.001);
      const right = origin + ease * Math.max(bounds.hi - origin, 0.001);

      // the unfurled part of the curve
      ctx.strokeStyle = "#f5c542";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#f5c54288";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      let started = false;
      for (const [x, y] of reveal.curve) {
        if (x < left || x > right) continue;
        const sx = map.x(x);
        const sy = map.y(y);
        if (started) ctx.lineTo(sx, sy);
        else {
          ctx.moveTo(sx, sy);
          started = true;
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // the two moving heads
      for (const edge of [left, right]) {
        if (edge <= bounds.lo || edge >= bounds.hi) continue;
        const y = valueAt(reveal.curve, edge);
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "#fff";
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(map.x(edge), map.y(y), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // everything the player had walked to, still in place
      for (const p of pointsRef.current ?? []) drawPoint(ctx, map, p, { w, h, pad });

      // the floor, once the unfurl has reached it
      if (left <= reveal.xStar && right >= reveal.xStar) {
        const age = Math.min(1, (elapsed - SPREAD_MS * 0.55) / 700);
        const sx = map.x(reveal.xStar);
        const sy = map.y(reveal.yStar ?? 0);
        // A HORIZONTAL line: the settlement is a height, so the line that
        // matters runs across the chart at that height, not down at its x.
        ctx.strokeStyle = "#3ad07f";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(pad.l, sy);
        ctx.lineTo(w - pad.r, sy);
        ctx.stroke();
        ctx.setLineDash([]);

        // The ring lands and stops. A permanent pulse just reads as flicker.
        const pulse = 9 + (1 - Math.max(0, age)) * 26;
        ctx.strokeStyle = "#3ad07f";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(6, pulse), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#3ad07f";
        ctx.fillRect(sx - 4, sy - 4, 8, 8);

        ctx.fillStyle = "#3ad07f";
        ctx.font = "12px 'Press Start 2P', monospace";
        ctx.textAlign = sx > w / 2 ? "right" : "left";
        ctx.textAlign = "left";
        ctx.fillText(`min f = ${(reveal.yStar ?? 0).toFixed(2)}`, pad.l + 8, sy - 10);
      }

      // Once the curve is fully out and the marker has settled, draw the last
      // frame and stop. Nothing on this chart moves after that.
      if (elapsed < SPREAD_MS + 1400) raf = requestAnimationFrame(render);
    };

    start.current = performance.now();
    raf = requestAnimationFrame(render);
    const onResize = () => {
      // A resize needs one more frame, but must not restart the unfurl.
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
    // Once per round: not per poll, and not per points array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.roundId]);

  return <canvas ref={ref} className="reveal-canvas" />;
}

/** Linear read-off of the sampled curve — only used for the two moving heads. */
function valueAt(curve, x) {
  const n = curve.length - 1;
  const lo = curve[0][0];
  const hi = curve[n][0];
  const i = Math.max(0, Math.min(n - 1, Math.floor(((x - lo) / (hi - lo || 1)) * n)));
  const [x0, y0] = curve[i];
  const [x1, y1] = curve[i + 1];
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/* ── the prediction slam ──────────────────────────────────────────────── */

function PredictionSlam({ reveal }) {
  const v = reveal?.value ?? 0;
  const tone = v >= 99.5 ? "yes" : v <= 0.5 ? "no" : "";
  return (
    <div>
      {reveal?.question && (
        <div className="question" style={{ maxWidth: 800, margin: "0 auto 28px", textAlign: "left" }}>
          <small>THE QUESTION</small>
          {reveal.question}
        </div>
      )}
      <div className={`bignum ${tone}`}>{num(v, v % 1 === 0 ? 0 : 2)}</div>
      <div className="reveal-head" style={{ marginTop: 10 }}>
        {v >= 99.5 ? "YES" : v <= 0.5 ? "NO" : "PARTIAL"}
      </div>
    </div>
  );
}

/* ── the podium ───────────────────────────────────────────────────────── */

function Podium({ rows }) {
  const top = (rows ?? []).slice(0, 3);
  return (
    <div className="podium">
      {[1, 0, 2].map((slot) => {
        const e = top[slot];
        const place = slot + 1;
        return (
          <div key={slot} className={`podium-col p${place} ${e ? "filled" : "empty"}`}>
            <div className="podium-team">{e ? e.name : "—"}</div>
            <div className="podium-bar" style={{ animationDelay: `${(2 - Math.abs(1 - slot)) * 240}ms` }}>
              <div className="podium-place">{place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉"}</div>
              {e && <div className="podium-val">{money(e.valueC)}</div>}
              {e && <div className="podium-members">{e.members.map((m) => m.name).join(" · ")}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
