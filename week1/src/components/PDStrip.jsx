/**
 * Split-or-Steal round strip: ten columns, each showing both vault levers
 * and the payoff. Green is a split, red is a steal — the whole match
 * reads at a glance.
 */
import React from "react";

export default function PDStrip({ rounds, nameA, nameB, scoreA, scoreB, summary = false }) {
  return (
    <div>
      {summary ? (
        // Sitting under the live animation, this must read as the recap —
        // not a second, contradictory scoreboard.
        <div className="field-label">
          FULL MATCH RECAP · FINAL {scoreA} – {scoreB}
        </div>
      ) : (
        <div className="replay-hud" style={{ marginBottom: 6 }}>
          <div className="names">
            <span className="you">■ {nameA}</span>{"  vs  "}
            <span className="them">■ {nameB}</span>
          </div>
          <div className="replay-score">
            <span className="you">{scoreA}</span>
            <span className="them">{scoreB}</span>
          </div>
        </div>
      )}
      <div className="pd-strip">
        {rounds.map((r, i) => (
          <div className="pd-round" key={i} style={{ animation: `flashin 0.3s ease ${i * 0.08}s backwards` }}>
            <div className="rl">R{i + 1}</div>
            <div className={`cellA ${r.a === "SPLIT" ? "split" : "steal"}`}>{r.a === "SPLIT" ? "🤝" : "💰"}</div>
            <div className={`cellB ${r.b === "SPLIT" ? "split" : "steal"}`}>{r.b === "SPLIT" ? "🤝" : "💰"}</div>
            <div className="pay">
              {r.pa}/{r.pb}
            </div>
          </div>
        ))}
      </div>
      <div className="hint">🤝 = SPLIT · 💰 = STEAL · top row is {nameA}, bottom is {nameB}</div>
    </div>
  );
}
