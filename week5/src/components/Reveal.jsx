/**
 * The bell, in five beats — week 3's reveal, with week 5's two pictures.
 *
 *   3 · 2 · 1            the room goes quiet
 *   the path             all of it, against K: where Y finished, and what paid
 *   fair vs market       what the contract was REALLY worth at every tick,
 *                        against what the room paid for it — and the naive
 *                        desk's random-walk price, for contrast
 *   the truth            "This was φ = 0.9" — and the switch, if there was one
 *   the podium           top three teams rise
 *   the board            everyone, final
 *
 * Past the countdown nothing advances by itself for a player — every step is a
 * click. The projector has nobody to click it, so it alone runs on a timer.
 */
import React, { useEffect, useMemo, useState } from "react";
import { PxButton, money, num } from "./PixelBits.jsx";
import HorizonChart, { FairChart } from "./HorizonChart.jsx";

const STEPS = 5;
const TITLES = ["TIME", "THE PATH", "WHAT IT WAS WORTH", "THE PROCESS", "THE PODIUM", "FINAL STANDINGS"];

/** `startPhase` skips the countdown (the render test uses it to reach each beat). */
export default function Reveal({ reveal, me, leaderboard, myTeamId, onClose, projector = false, startPhase = 0 }) {
  const [phase, setPhase] = useState(startPhase);
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (!projector || phase === 0 || phase >= STEPS) return undefined;
    const t = setTimeout(() => setPhase((p) => p + 1), phase <= 2 ? 11000 : 8000);
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

  const r = reveal ?? {};
  const series = useMemo(() => (r.history ? { t0: r.t0, ys: r.history, tick: 0 } : null), [r.history, r.t0]);
  const above = r.yT > r.K;
  const truth = r.truth ?? {};
  const err = useMemo(() => roomError(r), [r]);

  return (
    <div className="reveal">
      <div className="reveal-inner">
        <div className="reveal-head">{TITLES[phase]}</div>

        {phase === 0 && (
          <div className="reveal-count" key={count}>
            {count > 0 ? count : "GO"}
          </div>
        )}

        {phase === 1 && (
          <div className="reveal-wide">
            <HorizonChart series={series} K={r.K} T={r.T} future={r.path} switchTick={truth.switchTick} height={projector ? 420 : 320} big={projector} />
            <div className="reveal-sub">
              <div className="reveal-stat">
                <i>Y AT TICK {r.T}</i>
                <b className={above ? "up" : "down"}>{num(r.yT, 2)}</b>
              </div>
              <div className="reveal-stat">
                <i>THE LINE</i>
                <b style={{ color: "var(--gold)" }}>K = {r.K}</b>
              </div>
              <div className="reveal-stat">
                <i>EVERY SHARE PAYS</i>
                <b className={above ? "up" : "down"}>{money(r.settleC ?? 0)}</b>
              </div>
            </div>
          </div>
        )}

        {phase === 2 && (
          <div className="reveal-wide">
            <FairChart fair={r.fair} mids={r.mids} naive={r.naive} height={projector ? 400 : 300} big={projector} />
            <div className="hint" style={{ textAlign: "center" }}>
              Gold is what the contract was truly worth at each tick, given the real process. Blue is what the room was
              paying. {err != null && <>On average the room was off by <b>{num(err, 1)} points</b>.</>}{" "}
              {r.desks?.[0] && (
                <>
                  The naive desk, which always assumes a random walk, finished{" "}
                  <b className={r.desks[0].pnlC >= 0 ? "up" : "down"}>{money(r.desks[0].pnlC, { sign: true })}</b>.
                </>
              )}
            </div>
          </div>
        )}

        {phase === 3 && (
          <>
            <div className="bignum phi">φ = {fmtPhi(truth.phi1)}</div>
            {truth.switchTick != null && (
              <div className="reveal-head" style={{ marginTop: 14, color: "var(--purple)" }}>
                …UNTIL TICK {truth.switchTick}. THEN φ = {fmtPhi(truth.phi2)}
              </div>
            )}
            <div className="reveal-sub">
              <div className="reveal-stat">
                <i>THIS WAS</i>
                <b style={{ color: "var(--muted)" }}>{describe(truth)}</b>
              </div>
              <div className="reveal-stat">
                <i>μ · σ</i>
                <b style={{ color: "var(--muted)" }}>
                  {truth.phi1 === 1 && (truth.switchTick == null || truth.phi2 === 1) ? "—" : num(truth.mu, 2)} · {num(truth.sigma, 2)}
                </b>
              </div>
              {r.fitAtOpen && (
                <div className="reveal-stat">
                  <i>OLS ON THE HISTORY SAID</i>
                  <b style={{ color: "var(--muted)" }}>
                    fitted φ = {num(r.fitAtOpen.phi, 3)} ± {num(r.fitAtOpen.sePhi, 3)}
                  </b>
                </div>
              )}
              <div className="reveal-stat">
                <i>FAIR AT THE OPEN</i>
                <b>{num(r.fair?.[0], 1)}</b>
              </div>
              <div className="reveal-stat">
                <i>RANDOM-WALK PRICE</i>
                <b style={{ color: "var(--muted)" }}>{num(r.naive?.[0], 1)}</b>
              </div>
            </div>
            <div className="hint" style={{ textAlign: "center", marginTop: 12 }}>
              Same chart, different φ, different price. Seed <code>{truth.seed}</code>.
            </div>
          </>
        )}

        {phase === 4 && <Podium rows={leaderboard} />}

        {phase === 5 && (
          <div className="final-board">
            <div className="final-col">
              <div className="panel-title">TEAMS</div>
              <ol>
                {(leaderboard ?? []).slice(0, 10).map((row) => (
                  <li key={row.id} className={row.id === myTeamId ? "me" : ""}>
                    <span className="rk">{row.rank}</span>
                    <span className="nm">{row.name}</span>
                    <span className="vl">{money(row.valueC)}</span>
                  </li>
                ))}
              </ol>
            </div>
            {(leaderboard ?? []).some((row) => row.members?.length) && (
              <div className="final-col">
                <div className="panel-title">TOP INDIVIDUALS</div>
                <ol>
                  {(leaderboard ?? [])
                    .flatMap((row) => (row.members ?? []).map((m) => ({ ...m, team: row.name })))
                    .sort((a, b) => b.valueC - a.valueC)
                    .slice(0, 10)
                    .map((m, i) => (
                      <li key={m.id} className={m.id === me?.id ? "me" : ""}>
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
            <PxButton variant={phase < STEPS ? "gold" : "green"} onClick={phase < STEPS ? () => setPhase(phase + 1) : onClose}>
              {phase < STEPS ? `NEXT — ${TITLES[phase + 1]} →` : "BACK TO THE FLOOR"}
            </PxButton>
          </div>
        )}
      </div>
    </div>
  );
}

/** 0.9 → "0.9", 1 → "1.0", 0.913 → "0.913": as the host typed it. */
const fmtPhi = (v) => (v == null ? "?" : Number.isInteger(v) ? Number(v).toFixed(1) : String(v));

function describe(t) {
  const one = (phi) => (phi === 1 ? "a random walk" : phi > 0.98 ? "nearly a random walk" : "mean-reverting");
  if (t.switchTick != null && t.phi2 !== t.phi1) return `${one(t.phi1)}, then ${one(t.phi2)}`;
  return one(t.phi1);
}

/** Mean absolute gap, in points, between the room's mid and the true fair value. */
function roomError(r) {
  if (!r?.fair || !r?.mids?.length) return null;
  let s = 0;
  let n = 0;
  for (const m of r.mids) {
    const px = m.mid ?? m.last;
    if (px == null || m.t >= r.T) continue;
    s += Math.abs(px - r.fair[m.t]);
    n++;
  }
  return n ? s / n : null;
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
              {e && <div className="podium-members">{(e.members ?? []).map((m) => m.name).join(" · ")}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
