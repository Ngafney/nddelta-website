/**
 * A 200-round Prisoner's Dilemma match, readable at a glance.
 *
 * The old pot animation was built for ten rounds; at Axelrod's length the
 * useful view is the whole match at once — a dense two-row strip (one cell per
 * round, green = cooperate, red = defect) plus the cumulative score curves, so
 * you can SEE where a partnership formed or collapsed. A window selector zooms
 * into any stretch to read individual rounds.
 */
import React, { useMemo, useState } from "react";

const C = "COOPERATE";

export default function PDReplay({ rounds, nameA, nameB, scoreA, scoreB, big = false }) {
  const [from, setFrom] = useState(0);
  const span = big ? 50 : 25;

  const { curveA, curveB, coopA, coopB } = useMemo(() => {
    let a = 0, b = 0, ca = 0, cb = 0;
    const cA = [], cB = [];
    for (const r of rounds) {
      a += r.pa; b += r.pb;
      if (r.a === C) ca++;
      if (r.b === C) cb++;
      cA.push(a); cB.push(b);
    }
    return { curveA: cA, curveB: cB, coopA: ca, coopB: cb };
  }, [rounds]);

  const n = rounds.length;
  const maxScore = Math.max(1, curveA[n - 1] ?? 1, curveB[n - 1] ?? 1);
  const W = 600, H = big ? 150 : 110;
  const path = (curve) => curve.map((v, i) => `${(i / Math.max(1, n - 1)) * W},${H - (v / maxScore) * H}`).join(" ");
  const winEnd = Math.min(n, from + span);

  return (
    <div className="pdr">
      <div className="pdr-head">
        <span className="you">■ {nameA} <b>{scoreA}</b></span>
        <span className="pdr-vs">vs</span>
        <span className="them"><b>{scoreB}</b> {nameB} ■</span>
      </div>

      {/* every round, one cell each — the shape of the whole match */}
      <div className="pdr-strip" role="img" aria-label="every round of the match">
        <div className="pdr-row">
          {rounds.map((r, i) => <i key={i} className={r.a === C ? "c" : "d"} title={`R${i + 1} ${nameA}: ${r.a}`} />)}
        </div>
        <div className="pdr-row">
          {rounds.map((r, i) => <i key={i} className={r.b === C ? "c" : "d"} title={`R${i + 1} ${nameB}: ${r.b}`} />)}
        </div>
      </div>

      {/* cumulative score — where the match was won */}
      <svg className="pdr-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polyline points={path(curveA)} className="pdr-line-a" />
        <polyline points={path(curveB)} className="pdr-line-b" />
      </svg>

      <div className="pdr-stats">
        <span>{nameA} cooperated <b>{Math.round((100 * coopA) / n)}%</b></span>
        <span>{nameB} cooperated <b>{Math.round((100 * coopB) / n)}%</b></span>
        <span>{n} rounds</span>
      </div>

      <div className="pdr-zoom">
        <input type="range" min={0} max={Math.max(0, n - span)} value={from}
          onChange={(e) => setFrom(Number(e.target.value))} aria-label="scroll rounds" />
        <span className="pdr-range">R{from + 1}–{winEnd}</span>
      </div>
      <div className="pdr-window">
        {rounds.slice(from, winEnd).map((r, i) => (
          <div className="pdr-cell" key={from + i}>
            <div className="rl">{from + i + 1}</div>
            <div className={`m ${r.a === C ? "c" : "d"}`}>{r.a === C ? "C" : "D"}</div>
            <div className={`m ${r.b === C ? "c" : "d"}`}>{r.b === C ? "C" : "D"}</div>
            <div className="pay">{r.pa}/{r.pb}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
