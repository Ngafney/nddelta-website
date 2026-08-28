/**
 * The Split-or-Steal replay: 100 points sit on the table as a pile of
 * pixel coins, both sides' choices are face-down cards that tremble
 * through a tension beat, flip together — then the coins go where the
 * payoff says: shared out to both sides, swept to the thief, or burned
 * on the spot when both steal. The data is the actual seeded match.
 *
 * Per-round scene: enter → tension (cards shake) → reveal (flip) →
 * outcome (coins fly / burn) → next round.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { mulberry32 } from "../../shared/rng.js";

const ROUND_MS = 2700;
const TENSION_AT = 260;
const REVEAL_AT = 1000;
const OUTCOME_AT = 1420;

/** Coin mound layout, offsets from the pot centre (px, unscaled). */
const COINS = [
  { x: -22, y: 4 }, { x: -11, y: 8 }, { x: 0, y: 10 }, { x: 11, y: 8 }, { x: 22, y: 4 },
  { x: -15, y: -2 }, { x: -4, y: 0 }, { x: 7, y: -2 }, { x: 16, y: 0 }, { x: 1, y: -8 },
];

export default function ReplaySplitSteal({ rounds, nameA, nameB, autoLoop = false, big = false }) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("enter"); // enter → tension → reveal → outcome
  const [playing, setPlaying] = useState(true);
  const [finished, setFinished] = useState(false);
  const timers = useRef([]);

  // Full action words — SPLIT/STEAL share a first letter, so a first-letter
  // signature is constant and the match-change reset never fires.
  const sig = rounds.map((r) => `${r.a}${r.b}`).join("|");

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const after = (ms, fn) => timers.current.push(setTimeout(fn, ms));

  // Pausing or finishing FREEZES the frame (no reset to "enter"), so the
  // final score and the revealed cards stay on screen.
  useEffect(() => {
    clearTimers();
    if (!playing || finished) return;
    setPhase("enter");
    after(TENSION_AT, () => setPhase("tension"));
    after(REVEAL_AT, () => setPhase("reveal"));
    after(OUTCOME_AT, () => setPhase("outcome"));
    after(ROUND_MS, () => {
      if (idx < rounds.length - 1) setIdx(idx + 1);
      else if (autoLoop) setIdx(0);
      else setFinished(true);
    });
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, playing, finished, sig, autoLoop]);

  useEffect(() => {
    setIdx(0);
    setPlaying(true);
    setFinished(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const toggle = () => {
    if (finished) {
      setFinished(false);
      setIdx(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };
  const scrubTo = (i) => {
    setFinished(false);
    setIdx(i);
    setPlaying(true);
  };

  const r = rounds[idx];
  const revealed = phase === "reveal" || phase === "outcome";
  const bothSteal = r.a === "STEAL" && r.b === "STEAL";
  const bothSplit = r.a === "SPLIT" && r.b === "SPLIT";
  const scoreA = rounds.slice(0, idx + (phase === "outcome" ? 1 : 0)).reduce((s, x) => s + x.pa, 0);
  const scoreB = rounds.slice(0, idx + (phase === "outcome" ? 1 : 0)).reduce((s, x) => s + x.pb, 0);

  // Where each coin flies in the outcome phase.
  const coinFate = (i) => {
    if (phase !== "outcome") return null;
    if (bothSteal) return "burn";
    if (bothSplit) return i % 2 === 0 ? "left" : "right";
    return r.a === "STEAL" ? "left" : "right"; // winner takes the pot
  };

  // Slight per-coin scatter so the flights don't look mechanical.
  const jitter = useMemo(() => {
    const rand = mulberry32(0xc01 + idx);
    return COINS.map(() => ({ dy: (rand() - 0.5) * 34, delay: Math.floor(rand() * 180) }));
  }, [idx]);

  return (
    <div className="replay">
      <div className={`pdscene ${big ? "big" : ""} ${phase === "outcome" && bothSteal ? "shake" : ""}`}>
        <div className="round-banner">ROUND {idx + 1} / {rounds.length}</div>

        {/* the table line */}
        <div className="pd-table" />

        {/* the pot */}
        <div className="pot">
          {COINS.map((c, i) => {
            const fate = coinFate(i);
            return (
              <i
                key={`${idx}-${i}`}
                className={`pcoin ${fate ? `fly-${fate}` : ""}`}
                style={{
                  left: c.x,
                  top: c.y,
                  "--jdy": `${jitter[i].dy}px`,
                  animationDelay: fate ? `${jitter[i].delay}ms` : `${i * 120}ms`,
                }}
              />
            );
          })}
          {phase === "outcome" && bothSteal && <Fire />}
        </div>

        {/* the two cards */}
        <Card side="A" action={r.a} revealed={revealed} tension={phase === "tension"} name={nameA} />
        <Card side="B" action={r.b} revealed={revealed} tension={phase === "tension"} name={nameB} />

        {/* payoff floats */}
        {phase === "outcome" && (
          <>
            <div key={`pa${idx}`} className={`float-pay ${r.pa > 0 ? "pos" : "neg"}`} style={{ left: "31%" }}>
              {r.pa > 0 ? `+${r.pa}` : r.pa}
            </div>
            <div key={`pb${idx}`} className={`float-pay ${r.pb > 0 ? "pos" : "neg"}`} style={{ left: "69%" }}>
              {r.pb > 0 ? `+${r.pb}` : r.pb}
            </div>
          </>
        )}

        {phase === "outcome" && (
          <div className="outcome-flash" style={{ color: bothSteal ? "var(--red)" : bothSplit ? "var(--green)" : "var(--gold)" }}>
            {bothSteal ? "🔥 BOTH STEAL · −10 / −10" : bothSplit ? "SPLIT · 50 / 50" : r.a === "STEAL" ? `${nameA} TAKES IT ALL` : `${nameB} TAKES IT ALL`}
          </div>
        )}
      </div>

      <div className="replay-hud">
        <div className="names">
          <span className="you">■ {nameA}</span>{"  vs  "}
          <span className="them">■ {nameB}</span>
        </div>
        <div className="rounds">
          {rounds.map((_, i) => (
            <i
              key={i}
              className={i === idx ? "cur" : i < idx ? "done" : ""}
              onClick={() => scrubTo(i)}
            >
              {i + 1}
            </i>
          ))}
        </div>
        <div className="replay-score">
          <span className="you">{scoreA}</span>
          <span className="them">{scoreB}</span>
        </div>
        <button className="pxbtn pxbtn--ghost pxbtn--sm" onClick={toggle} title={finished ? "replay from the start" : playing ? "pause" : "play"}>
          {finished ? "↺" : playing ? "❚❚" : "▶"}
        </button>
      </div>
    </div>
  );
}

/**
 * A decision card: face-down "?" until the reveal, then a hard pixel
 * flip to the truth. The flip is a scaleX squash — flat, chunky, 8-bit.
 */
function Card({ side, action, revealed, tension, name }) {
  const split = action === "SPLIT";
  return (
    <div className={`pcard-slot ${side === "A" ? "left" : "right"}`}>
      <div
        className={[
          "pcard",
          tension ? "tense" : "",
          revealed ? "revealed" : "",
          revealed ? (split ? "is-split" : "is-steal") : "",
        ].join(" ")}
      >
        {revealed ? (
          <>
            <span className="pc-ico">{split ? "🤝" : "💰"}</span>
            <span className="pc-word">{action}</span>
          </>
        ) : (
          <span className="pc-back">?</span>
        )}
      </div>
      <div className={`pc-name ${side === "A" ? "you" : "them"}`}>{name}</div>
    </div>
  );
}

/** The pot on fire — three pixel flames flickering out of the coins. */
function Fire() {
  return (
    <div className="fire">
      {[0, 1, 2].map((i) => (
        <i key={i} style={{ left: (i - 1) * 14, animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}
