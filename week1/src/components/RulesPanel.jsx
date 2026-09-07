/**
 * The rules, stated plainly on every game tab. Open by default the first
 * time a team sees a game; collapsed-but-present forever after. The text
 * and the payoff numbers come from shared/rules.js — the same constants
 * the engine scores with and the LLM compiles against.
 */
import React, { useState } from "react";
import { RULES_TEXT, PAYOFFS, ACTIONS } from "../../shared/rules.js";

export default function RulesPanel({ game }) {
  const seenKey = `w1rules:${game}`;
  // Collapsed by default — the pages stay minimalist; rules open on click.
  const [open, setOpen] = useState(false);

  function toggle() {
    setOpen(!open);
    try {
      localStorage.setItem(seenKey, "1");
    } catch {}
  }

  return (
    <section className={`panel rules ${open ? "open" : ""}`}>
      <div className="panel-title rules-toggle" onClick={toggle}>
        <span className="chev">▶</span> HOW IT WORKS
      </div>
      {open && (
        <>
          <div className="rules-body">{RULES_TEXT[game].simple}</div>
          {PAYOFFS[game] && (
            <>
              <PayoffMatrix game={game} />
              <div className="hint">
                each cell: <span style={{ color: "var(--gold)" }}>your points</span> /{" "}
                <span style={{ color: "var(--blue)" }}>their points</span>
              </div>
            </>
          )}
          <Deeper game={game} />
        </>
      )}
    </section>
  );
}

/** The advanced layer, folded away so it never scares a beginner. */
function Deeper({ game }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 16 }}>
      <button className="pxbtn pxbtn--ghost pxbtn--sm" onClick={() => setOpen(!open)}>
        {open ? "▾ GOING DEEPER" : "▸ GOING DEEPER — the math, for teams who want the edge"}
      </button>
      {open && (
        <div className="rules-body" style={{ marginTop: 12, borderLeft: "3px solid var(--purple)", paddingLeft: 14 }}>
          {RULES_TEXT[game].details}
        </div>
      )}
    </div>
  );
}

export function PayoffMatrix({ game }) {
  const [a, b] = ACTIONS[game]; // aggressive, cooperative
  const P = PAYOFFS[game];
  const cellClass = (mine, theirs) => {
    const v = P[mine][theirs];
    return v > 0 ? "good" : v < -20 ? "bad" : "";
  };
  return (
    <div className="payoff-grid">
      <div className="cell hdr">YOU ↓ · THEY →</div>
      <div className="cell hdr">{a}</div>
      <div className="cell hdr">{b}</div>
      {[a, b].map((mine) => (
        <React.Fragment key={mine}>
          <div className="cell hdr">{mine}</div>
          {[a, b].map((theirs) => (
            <div key={theirs} className={`cell ${cellClass(mine, theirs)}`}>
              <span className="me">{fmt(P[mine][theirs])}</span> / <span className="them">{fmt(P[theirs][mine])}</span>
            </div>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

const fmt = (v) => (v > 0 ? `+${v}` : `${v}`);
