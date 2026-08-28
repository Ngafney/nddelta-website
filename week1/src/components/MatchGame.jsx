/**
 * The tournament-game tab shell, shared by Chicken and Split-or-Steal:
 * rules, the strategy lab, the exhibition replay, and the standings.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import RulesPanel from "./RulesPanel.jsx";
import StrategyLab from "./StrategyLab.jsx";
import ReplayChicken from "./ReplayChicken.jsx";
import ReplaySplitSteal from "./ReplaySplitSteal.jsx";
import PDStrip from "./PDStrip.jsx";
import { Board } from "./Leaderboards.jsx";

export default function MatchGame({ team, game }) {
  const [standings, setStandings] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get(`leaderboard?game=${game}`);
      setStandings(res.standings);
    } catch {}
  }, [game]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000); // other teams submit; standings follow
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <>
      <RulesPanel game={game} />

      <section className="panel">
        <div className="panel-title">STRATEGY LAB</div>
        <StrategyLab
          team={team}
          game={game}
          onScored={refresh}
          renderExhibition={(ex) => (
            <section className="mt">
              <div className="panel-title" style={{ marginTop: 8 }}>
                ⚔ EXHIBITION VS THE CHAMPION — {ex.opponent.name}
                <span className="tag">not scored · full match replay</span>
              </div>
              {game === "chicken" ? (
                <ReplayChicken rounds={ex.rounds} nameA={team.name} nameB={ex.opponent.name} />
              ) : (
                <>
                  <ReplaySplitSteal rounds={ex.rounds} nameA={team.name} nameB={ex.opponent.name} />
                  <div className="mt">
                    <PDStrip rounds={ex.rounds} nameA={team.name} nameB={ex.opponent.name} scoreA={ex.yourScore} scoreB={ex.theirScore} summary />
                  </div>
                </>
              )}
            </section>
          )}
        />
      </section>

      <section className="panel board">
        <div className="panel-title">
          🏆 TOURNAMENT STANDINGS <span className="tag">avg points per match · every bot plays every bot ×5</span>
        </div>
        <Board
          rows={standings?.map((s, i) => ({ rank: i + 1, teamId: s.id.replace(/^team:/, ""), ...s }))}
          me={team.teamId}
          crown
          columns={[
            { key: "avg", label: "AVG / MATCH", cls: "score", fmt: (v) => v.toFixed(1) },
            { key: "wins", label: "W", cls: "dim" },
            { key: "losses", label: "L", cls: "dim" },
            { key: "draws", label: "D", cls: "dim" },
          ]}
        />
        <div className="hint">
          Ranked by average points, not wins — a bot can win every duel expensively and still rank
          below one that loses cheap. Surviving matters more than dominating. HOUSE BOTS are ours;
          beating all three is the entry exam.
        </div>
      </section>
    </>
  );
}
