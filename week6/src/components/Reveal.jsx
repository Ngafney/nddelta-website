/**
 * The bell, in five beats.
 *
 *   3 · 2 · 1            the room goes quiet
 *   the draw             every number, and whose it was
 *   what it paid         SUM, CALL, PUT — and parity, checked
 *   what it was worth    each book: the uniform fair value as the numbers came
 *                        out, against what the room paid
 *   the podium           top three teams rise
 *   the board            everyone, final
 *
 * Past the countdown nothing advances by itself for a player — every step is a
 * click. The projector has nobody to click it, so it alone runs on a timer.
 */
import React, { useEffect, useState } from "react";
import { PxButton, money } from "./PixelBits.jsx";
import { FairChart } from "./SumChart.jsx";
import { BOOK_ORDER, BOOKS } from "../../shared/rules.js";

const STEPS = 5;
const TITLES = ["TIME", "THE NUMBERS", "WHAT IT PAID", "WHAT IT WAS WORTH", "THE PODIUM", "FINAL STANDINGS"];

/** `startPhase` skips the countdown (the render test uses it to reach each beat). */
export default function Reveal({ reveal, me, leaderboard, myTeamId, onClose, projector = false, startPhase = 0 }) {
  const [phase, setPhase] = useState(startPhase);
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (!projector || phase === 0 || phase >= STEPS) return undefined;
    const t = setTimeout(() => setPhase((p) => p + 1), phase <= 3 ? 11000 : 8000);
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
  const pay = r.payouts ?? {};
  const Smax = 10 * (r.N ?? 0);

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
            <div className="bignum phi">S = {r.S}</div>
            <div className="reveal-pot">
              {(r.teams ?? []).map((t) => (
                <div key={t.id} className={`cell in v${t.number} named ${t.id === myTeamId ? "mine" : ""}`}>
                  <span className="cell-face">{t.number}</span>
                  <small>
                    {t.name}
                    {t.drawn ? " (drawn)" : ""}
                  </small>
                </div>
              ))}
            </div>
            <div className="hint" style={{ textAlign: "center" }}>
              In the order they came out. {r.N} numbers, {Smax} the most they could have summed to, K = {r.K}.
            </div>
          </div>
        )}

        {phase === 2 && (
          <>
            <div className="reveal-sub">
              {BOOK_ORDER.map((k) => (
                <div className="reveal-stat" key={k}>
                  <i>{BOOKS[k].name} PAID</i>
                  <b className={pay[k] > 0 ? "up" : "down"}>{money((pay[k] ?? 0) * 100)}</b>
                  <small style={{ color: "var(--dim)" }}>{k === "fut" ? "S" : k === "call" ? `max(${r.S} − ${r.K}, 0)` : `max(${r.K} − ${r.S}, 0)`}</small>
                </div>
              ))}
            </div>
            <div className="parity-big">
              CALL − PUT = {pay.call} − {pay.put} = <b>{(pay.call ?? 0) - (pay.put ?? 0)}</b>
              <span className="eq">=</span>
              SUM − K = {r.S} − {r.K} = <b>{(r.S ?? 0) - (r.K ?? 0)}</b>
            </div>
            <div className="hint" style={{ textAlign: "center" }}>
              Put–call parity, as promised. Long the call and short the put was the same thing as long the sum at K.
            </div>
          </>
        )}

        {phase === 3 && (
          <div className="reveal-wide">
            <div className="faircharts">
              {BOOK_ORDER.map((k) => (
                <FairChart
                  key={k}
                  book={k}
                  label={BOOKS[k].name}
                  fair={r.fair}
                  mids={r.mids}
                  payout={pay[k] ?? 0}
                  settleMin={0}
                  settleMax={k === "fut" ? Smax : k === "call" ? Math.max(1, Smax - (r.K ?? 0)) : Math.max(1, r.K ?? 1)}
                  height={projector ? 230 : 170}
                  big={projector}
                />
              ))}
            </div>
            <div className="hint" style={{ textAlign: "center" }}>
              Gold is what each book was worth if the hidden numbers were uniform, as each one came out. Blue is what the room was paying. Green
              is what it paid in the end.
              {r.sharp ? (
                <>
                  {" "}
                  The insider struck {r.sharp.strikes} time{r.sharp.strikes === 1 ? "" : "s"} and finished{" "}
                  <b className={r.sharp.pnlC >= 0 ? "up" : "down"}>{money(r.sharp.pnlC, { sign: true })}</b>.
                </>
              ) : null}
              {r.desks?.length ? (
                <>
                  {" "}
                  The noise desks finished{" "}
                  <b className={r.desks.reduce((s, d) => s + d.pnlC, 0) >= 0 ? "up" : "down"}>{money(r.desks.reduce((s, d) => s + d.pnlC, 0), { sign: true })}</b>{" "}
                  between them.
                </>
              ) : null}
            </div>
          </div>
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
