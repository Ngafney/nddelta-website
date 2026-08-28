/**
 * Board — the one leaderboard table everything renders — and the
 * all-boards tab.
 */
import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { GAME_META } from "../../shared/rules.js";
import { PixelSprite } from "./PixelBits.jsx";
import { MEDAL, MEDAL_PALETTES } from "./sprites.js";

export function Board({ rows, me, columns, crown = false }) {
  if (!rows) return <div className="empty">loading…</div>;
  if (rows.length === 0) return <div className="empty">Nobody on the board yet. Be first.</div>;
  // The champion crown goes to the top STUDENT team — house bots rank as the
  // bar to beat, but the title is a team's to win.
  const crownId = crown ? rows.find((r) => !r.seed)?.teamId : null;
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>TEAM</th>
          {columns.map((c) => (
            <th key={c.key} style={c.cls === "score" ? { textAlign: "right" } : undefined}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.teamId ?? r.id} className={r.teamId === me ? "me" : ""}>
            <td className="rank">{medal(r.rank)}</td>
            <td className="teamcell" title={r.name}>
              {r.teamId === crownId && <span title="top team" style={{ marginRight: 5 }}>👑</span>}
              {r.name}
              {r.seed && <span className="seedtag">HOUSE BOT</span>}
            </td>
            {columns.map((c) => (
              <td key={c.key} className={c.cls}>
                {c.fmt ? c.fmt(r[c.key]) : r[c.key] ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Pixel medals for the podium, plain numbers below it. */
const medal = (rank) =>
  rank >= 1 && rank <= 3 ? (
    <PixelSprite grid={MEDAL} palette={MEDAL_PALETTES[rank - 1]} scale={2} style={{ verticalAlign: "middle" }} />
  ) : (
    rank
  );

export default function Leaderboards({ team, games }) {
  const [bandit, setBandit] = useState(null);
  const [chicken, setChicken] = useState(null);
  const [pd, setPd] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [b, c, p] = await Promise.all([
          api.get("leaderboard?game=bandit"),
          api.get("leaderboard?game=chicken"),
          api.get("leaderboard?game=pd"),
        ]);
        if (!alive) return;
        setBandit(b);
        setChicken(c.standings);
        setPd(p.standings);
      } catch {}
    }
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const matchCols = [
    { key: "avg", label: "AVG / MATCH", cls: "score", fmt: (v) => v.toFixed(1) },
    { key: "wins", label: "W", cls: "dim" },
    { key: "losses", label: "L", cls: "dim" },
    { key: "draws", label: "D", cls: "dim" },
  ];
  const rankHint = (
    <div className="hint">
      Ranked by average points, not wins. HOUSE BOTS are ours — beating all three is the entry exam.
    </div>
  );

  return (
    <>
      {games?.bandit && (
        <div className="board-duo">
          <section className="panel board">
            <div className="panel-title">🎰 BANDIT · MANUAL <span className="tag">best run</span></div>
            <Board rows={bandit?.manual} me={team.teamId} columns={[
              { key: "oraclePct", label: "% ORACLE", cls: "score", fmt: (v) => (v == null ? "—" : `${v.toFixed(0)}%`) },
              { key: "points", label: "POINTS", cls: "dim", fmt: (v) => (v == null ? "—" : v.toFixed(1)) },
            ]} />
          </section>
          <section className="panel board">
            <div className="panel-title">🤖 BANDIT · ALGORITHM <span className="tag">avg of 10,000</span></div>
            <Board rows={bandit?.algo} me={team.teamId} columns={[
              { key: "score", label: "AVG", cls: "score", fmt: (v) => v.toFixed(1) },
              { key: "oraclePct", label: "% ORACLE", cls: "dim", fmt: (v) => (v == null ? "—" : `${v.toFixed(0)}%`) },
              { key: "stratName", label: "STRATEGY", cls: "dim", fmt: (v) => v ?? "—" },
            ]} />
          </section>
        </div>
      )}
      {games?.chicken && (
        <section className="panel board">
          <div className="panel-title">{GAME_META.chicken.icon} CHICKEN · TOURNAMENT</div>
          <Board rows={chicken?.map((s, i) => ({ rank: i + 1, teamId: s.id.replace(/^team:/, ""), ...s }))} me={team.teamId} columns={matchCols} crown />
          {rankHint}
        </section>
      )}
      {games?.pd && (
        <section className="panel board">
          <div className="panel-title">{GAME_META.pd.icon} SPLIT OR STEAL · TOURNAMENT</div>
          <Board rows={pd?.map((s, i) => ({ rank: i + 1, teamId: s.id.replace(/^team:/, ""), ...s }))} me={team.teamId} columns={matchCols} crown />
          {rankHint}
        </section>
      )}
    </>
  );
}
