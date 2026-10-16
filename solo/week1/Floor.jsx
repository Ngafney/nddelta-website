import React, { useEffect, useState } from "react";
import App from "@week/src/App.jsx";
import { live, readHistory } from "./room.js";

/**
 * The original Week 1 app, unmodified, with one slim strip above it that only
 * solo needs: the plain statement that there's no AI here (and how to phrase
 * a plan for the built-in reader), what's moving in the room, and your record.
 */
export default function Floor() {
  return (
    <>
      <SoloStrip />
      <App />
    </>
  );
}

const PD_PHRASES = [
  "cooperate first, then copy their last move",
  "tit for tat, but forgive 10% of the time",
  "defect on the last 3 rounds",
  "defect on round 4 as a test. If they don't retaliate, defect for the rest of the match",
  "if they have never cooperated, defect",
  "defect only if they defected twice in a row",
  "cooperate until they defect, then defect forever",
  "win-stay lose-shift",
  "cooperate 70% of the time at random",
];
const ICE_PHRASES = [
  "every day hold 1,500 under-70 contracts 6 days out until they settle",
  "if the forecast 4 days out is below 72°, hold 1,200 under-75 contracts for that day",
  "hold rain contracts 5 days out, 1,000 × the rain chance",
  "hold 300 under-70 for each day 3 to 7 days out",
];

function SoloStrip() {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const recent = live.feed.filter((f) => now - f.at < 9000).slice(-1)[0];
  const hist = readHistory();
  const ranked = hist.filter((h) => h.pdRank);
  const best = ranked.length ? Math.min(...ranked.map((h) => h.pdRank)) : null;
  const wins = ranked.filter((h) => h.pdRank === 1).length;

  return (
    <div className="w1s">
      <div className="w1s-row">
        <button className="w1s-ai" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="w1s-dot" aria-hidden="true" />
          No AI in solo mode: a built-in reader turns your plain English into the bot. Always check what it says your bot will do.
          <span className="w1s-more">{open ? "Hide phrasing tips" : "Phrasing tips"}</span>
        </button>
        <div className="w1s-side">
          {recent && (
            <span className={`w1s-feed ${recent.tone}`} key={recent.at}>
              {recent.text}
            </span>
          )}
          {hist.length > 0 && (
            <span className="w1s-rec" title="Your solo games on this browser">
              {hist.length} game{hist.length > 1 ? "s" : ""}
              {best ? ` · best #${best}` : ""}
              {wins ? ` · ${wins} win${wins > 1 ? "s" : ""}` : ""}
            </span>
          )}
        </div>
      </div>
      {open && (
        <div className="w1s-tips">
          <p>
            The reader understands the usual building blocks and tells you anything it couldn't use. Combine them in sentences. You can
            also paste JavaScript (a function body that returns a move or a portfolio).
          </p>
          <div className="w1s-cols">
            <div>
              <b>Prisoner's Dilemma</b>
              <ul>
                {PD_PHRASES.map((p) => (
                  <li key={p}>“{p}”</li>
                ))}
              </ul>
            </div>
            <div>
              <b>Sunset Scoops</b>
              <ul>
                {ICE_PHRASES.map((p) => (
                  <li key={p}>“{p}”</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      {live.final && <Final res={live.final} />}
    </div>
  );
}

function Final({ res }) {
  const line = res.pdRank
    ? res.pdRank === 1
      ? `You won the tournament out of ${res.pdOf} teams.`
      : `You finished #${res.pdRank} of ${res.pdOf}. ${res.winner ? `${res.winner} won.` : ""}`
    : `You didn't have a bot in the tournament. ${res.winner ? `${res.winner} won.` : ""}`;
  const ice = res.iceRank ? ` Sunset Scoops: #${res.iceRank} of ${res.iceOf}, ${res.bankruptcies} bankruptcies.` : "";
  return (
    <div className="w1s-final">
      <b>Final.</b> {line}
      {ice} Look at your replays to see what beat you, then press <b>Play again</b> in the top bar for a new room.
    </div>
  );
}
