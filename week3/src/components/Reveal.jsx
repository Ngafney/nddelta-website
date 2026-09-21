/**
 * The bell.
 *
 *   3 · 2 · 1                  the room goes quiet
 *   the coin                   p, enormous — and the final flip, if this round
 *                              settles on one
 *   was it worth it?           every player's flips against their P&L: did
 *                              buying information pay?
 *   the podium                 top three teams rise
 *   the full board             everyone, final
 *
 * Past the countdown nothing advances on its own for a player — every step is
 * a click. The projector has nobody to click it, so it alone runs on a timer.
 */
import React, { useEffect, useState } from "react";
import { PxButton, money, num } from "./PixelBits.jsx";

const STEPS = 4;

export default function Reveal({ reveal, me, leaderboard, myTeamId, onClose, projector = false }) {
  const [phase, setPhase] = useState(0); // 0 countdown · 1 the coin · 2 scatter · 3 podium · 4 board
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (!projector || phase === 0 || phase >= STEPS) return undefined;
    const t = setTimeout(() => setPhase((p) => p + 1), phase === 1 ? 7000 : 8000);
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

  const flip = reveal?.settlement === "flip";

  return (
    <div className="reveal">
      <div className="reveal-inner">
        <div className="reveal-head">
          {phase === 0
            ? "TIME"
            : phase === 1
              ? "THE COIN'S TRUE p"
              : phase === 2
                ? "DID BUYING FLIPS PAY?"
                : phase === 3
                  ? "THE PODIUM"
                  : "FINAL STANDINGS"}
        </div>

        {phase === 0 && (
          <div className="reveal-count" key={count}>
            {count > 0 ? count : "GO"}
          </div>
        )}

        {phase === 1 && (
          <>
            <div className="bignum">{num((reveal?.p ?? 0) * 100, 1)}</div>
            {flip && (
              <div className="reveal-head" style={{ marginTop: 14, color: reveal.finalHeads ? "var(--green)" : "var(--red)" }}>
                THE FINAL FLIP: {reveal.finalHeads ? "HEADS" : "TAILS"}
              </div>
            )}
            <div className="reveal-sub">
              <div className="reveal-stat">
                <i>DRAWN FROM</i>
                <b style={{ color: "var(--muted)" }}>{reveal?.priorName}</b>
              </div>
              <div className="reveal-stat">
                <i>EVERY SHARE PAYS</i>
                <b>{money(reveal?.settleC ?? 0)}</b>
              </div>
              {me?.sims && (
                <div className="reveal-stat">
                  <i>YOUR FLIPS SAID</i>
                  <b style={{ color: "var(--muted)" }}>
                    {me.sims.n ? `${me.sims.heads}/${me.sims.n} = ${num((100 * me.sims.heads) / me.sims.n, 1)}` : "nothing"}
                  </b>
                </div>
              )}
            </div>
          </>
        )}

        {phase === 2 && (
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            <Scatter points={reveal?.scatter ?? []} meName={me?.name} />
            <div className="hint" style={{ textAlign: "center" }}>
              Each dot is a player: how many flips they bought, and how much they made or lost overall — flips included.
            </div>
          </div>
        )}

        {phase === 3 && <Podium rows={leaderboard} />}

        {phase === 4 && (
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
                          {m.name} <small style={{ color: "var(--dim)" }}>{m.team} · {m.sims} flips</small>
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
            <PxButton variant={phase < STEPS ? "gold" : "green"} onClick={phase < STEPS ? () => setPhase(phase + 1) : onClose}>
              {phase === 1
                ? "NEXT — DID FLIPS PAY? →"
                : phase === 2
                  ? "NEXT — THE PODIUM →"
                  : phase === 3
                    ? "NEXT — THE BOARD →"
                    : "BACK TO THE FLOOR"}
            </PxButton>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Flips bought (x) against profit and loss (y), one dot per player. The whole
 * lecture in one picture: information has a price, and so does not having it.
 */
export function Scatter({ points, meName, height = 320 }) {
  const W = 760;
  const H = height;
  const pad = { l: 78, r: 18, t: 16, b: 42 };
  const pnl = points.map((p) => (p.valueC - p.startC) / 100);
  const lo = Math.min(0, ...pnl);
  const hi = Math.max(0, ...pnl);
  const span = hi - lo || 1;
  const yLo = lo - span * 0.08;
  const yHi = hi + span * 0.08;
  const x = (n) => pad.l + (n / 100) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - yLo) / (yHi - yLo)) * (H - pad.t - pad.b);
  const ticks = niceTicks(yLo, yHi, 5);

  return (
    <svg className="scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="flips bought against profit and loss">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#8ea3c8" : "#182c4e"} strokeWidth={t === 0 ? 2 : 1} />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fill="#8ea3c8" fontSize="13" fontFamily="Consolas, monospace">
            {t >= 0 ? "+" : "−"}${Math.abs(t).toLocaleString()}
          </text>
        </g>
      ))}
      {[0, 25, 50, 75, 100].map((n) => (
        <text key={n} x={x(n)} y={H - pad.b + 20} textAnchor="middle" fill="#8ea3c8" fontSize="13" fontFamily="Consolas, monospace">
          {n}
        </text>
      ))}
      <text x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle" fill="#5b6f96" fontSize="12" fontFamily="Consolas, monospace">
        flips bought
      </text>
      {points.map((p, i) => {
        const v = (p.valueC - p.startC) / 100;
        const mine = p.name === meName;
        return (
          <circle
            key={i}
            cx={x(p.n)}
            cy={y(v)}
            r={mine ? 8 : 5.5}
            fill={mine ? "#f5c542" : v >= 0 ? "#3ad07f" : "#f8717a"}
            fillOpacity={mine ? 1 : 0.8}
            stroke="#060d1c"
            strokeWidth="1.5"
          >
            <title>
              {p.name}: {p.n} flips, {v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString()}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}

function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(Math.round(t));
  return out;
}

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
