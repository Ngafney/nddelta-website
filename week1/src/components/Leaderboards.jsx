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
  const [pd, setPd] = useState(null);
  const [ice, setIce] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [p, i] = await Promise.all([
          api.get("leaderboard?game=pd"),
          api.get("leaderboard?game=icecream"),
        ]);
        if (!alive) return;
        setPd(p.standings);
        setIce(i);
      } catch {}
    }
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const matchCols = [
    { key: "avg", label: "AVG / MATCH", cls: "score", fmt: (v) => v.toFixed(1) },
    { key: "wins", label: "W", cls: "dim" },
    { key: "losses", label: "L", cls: "dim" },
    { key: "draws", label: "D", cls: "dim" },
  ];

  return (
    <>
      {games?.pd && (
        <section className="panel board">
          <div className="panel-title">{GAME_META.pd.icon} PRISONER'S DILEMMA · TOURNAMENT</div>
          <Board rows={pd?.map((s, i) => ({ rank: i + 1, teamId: s.id.replace(/^team:/, ""), ...s }))} me={team.teamId} columns={matchCols} crown />
        </section>
      )}
      {games?.icecream && (
        <div className="board-duo">
          <section className="panel board">
            <div className="panel-title">{GAME_META.icecream.icon} SUNSET SCOOPS · SHARPE <span className="tag">steadiest profit wins</span></div>
            <Board rows={ice?.sharpe} me={team.teamId} crown columns={[
              { key: "score", label: "SHARPE", cls: "score", fmt: (v) => Number(v).toFixed(2) },
              { key: "bankruptcies", label: "BANKRUPT", cls: "dim", fmt: (v) => (v == null ? "—" : v) },
              { key: "stratName", label: "STRATEGY", cls: "dim", fmt: (v) => v ?? "—" },
            ]} />
          </section>
          <section className="panel board">
            <div className="panel-title">{GAME_META.icecream.icon} SUNSET SCOOPS · FEWEST BANKRUPTCIES</div>
            <Board rows={ice?.bankruptcies} me={team.teamId} crown columns={[
              { key: "score", label: "BANKRUPTCIES", cls: "score", fmt: (v) => `${v}` },
              { key: "sharpe", label: "SHARPE", cls: "dim", fmt: (v) => (v == null ? "—" : Number(v).toFixed(2)) },
              { key: "stratName", label: "STRATEGY", cls: "dim", fmt: (v) => v ?? "—" },
            ]} />
          </section>
        </div>
      )}
    </>
  );
}
