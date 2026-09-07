/**
 * The Kahoot-style winner reveal. When a game's admin timer expires, this
 * takes over the screen: a 3-2-1 countdown, then the top teams rise onto a
 * podium one at a time, then the full final leaderboard. Used both in the
 * player app (as a dismissible overlay) and on the projector big board.
 *
 * It reads the game's final leaderboard once and animates it. `metric` picks
 * which number to show; for ice cream we celebrate BOTH boards.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { GAME_META } from "../../shared/rules.js";

const PHASES = ["countdown", "podium", "board"];

function useLeaderRows(game) {
  const [rows, setRows] = useState(null); // [{ boardLabel, entries:[{name, value, teamId}] }]
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (game === "pd") {
          const r = await api.get("leaderboard?game=pd");
          const entries = (r.standings ?? []).map((s) => ({ name: s.name, value: s.avg, teamId: s.id.replace(/^team:/, ""), seed: s.seed }));
          if (alive) setRows([{ boardLabel: "AVG / MATCH", fmt: (v) => v.toFixed(1), entries }]);
        } else {
          const r = await api.get("leaderboard?game=icecream");
          if (alive) setRows([
            { boardLabel: "SHARPE", fmt: (v) => Number(v).toFixed(2), entries: (r.sharpe ?? []).map((s) => ({ name: s.name, value: s.score, teamId: s.teamId })) },
            { boardLabel: "FEWEST BANKRUPTCIES", fmt: (v) => `${v}`, entries: (r.bankruptcies ?? []).map((s) => ({ name: s.name, value: s.score, teamId: s.teamId })) },
          ]);
        }
      } catch {
        if (alive) setRows([]);
      }
    })();
    return () => { alive = false; };
  }, [game]);
  return rows;
}

export default function WinnerReveal({ game, onClose, projector = false }) {
  const rows = useLeaderRows(game);
  const [phase, setPhase] = useState(0);
  const [count, setCount] = useState(3);
  const meta = GAME_META[game];

  // 3-2-1 countdown, then advance to the podium and finally the board.
  useEffect(() => {
    if (phase !== 0) return;
    if (count <= 0) { setPhase(1); return; }
    const t = setTimeout(() => setCount((c) => c - 1), 900);
    return () => clearTimeout(t);
  }, [phase, count]);

  useEffect(() => {
    if (phase !== 1) return;
    const t = setTimeout(() => setPhase(2), 4200);
    return () => clearTimeout(t);
  }, [phase]);

  const primary = rows?.[0];
  const podium = useMemo(() => (primary?.entries ?? []).filter((e) => !e.seed).slice(0, 3), [primary]);

  return (
    <div className={`reveal ${projector ? "reveal--proj" : ""}`}>
      <div className="reveal-inner">
        <div className="reveal-head">
          <span className="reveal-ico">{meta.icon}</span>
          <span>{meta.name.toUpperCase()} — TIME!</span>
        </div>

        {phase === 0 && (
          <div className="reveal-count" key={count}>{count > 0 ? count : "GO"}</div>
        )}

        {phase === 1 && (
          <div className="podium">
            {[1, 0, 2].map((slot) => {
              const e = podium[slot];
              const place = slot + 1;
              return (
                <div key={slot} className={`podium-col p${place} ${e ? "filled" : "empty"}`}>
                  <div className="podium-team">{e ? e.name : "—"}</div>
                  <div className="podium-bar" style={{ animationDelay: `${(2 - Math.abs(1 - slot)) * 220}ms` }}>
                    <div className="podium-place">{place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉"}</div>
                    {e && <div className="podium-val">{primary.fmt(e.value)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {phase === 2 && (
          <div className="reveal-boards">
            {(rows ?? []).map((b) => (
              <div className="reveal-board" key={b.boardLabel}>
                <div className="reveal-board-title">{b.boardLabel}</div>
                <ol>
                  {b.entries.slice(0, 8).map((e, i) => (
                    <li key={e.teamId + b.boardLabel} className={e.seed ? "seed" : ""}>
                      <span className="rk">{i + 1}</span>
                      <span className="nm">{e.name}{e.seed ? " ·bot" : ""}</span>
                      <span className="vl">{b.fmt(e.value)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}

        {!projector && (
          <button className="pxbtn pxbtn--gold reveal-close" onClick={onClose}>
            {phase < 2 ? "SKIP" : "BACK TO THE GAME"}
          </button>
        )}
      </div>
    </div>
  );
}
