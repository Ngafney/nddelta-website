/**
 * /week1/board — the projector page. Zero interaction: it polls, rotates
 * through the enabled games' leaderboards, and continuously replays the
 * actual top-two Chicken match. Fonts sized for the back of the room.
 */
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { GAME_META } from "../../shared/rules.js";
import { Board } from "./Leaderboards.jsx";
import ReplayChicken from "./ReplayChicken.jsx";
import ReplaySplitSteal from "./ReplaySplitSteal.jsx";
import PDStrip from "./PDStrip.jsx";
import { PixelSprite } from "./PixelBits.jsx";
import { DELTA, DELTA_PALETTE, TROPHY, TROPHY_PALETTE } from "./sprites.js";

const ROTATE_MS = 12000;

export default function BigBoard() {
  const [data, setData] = useState(null);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const load = () => api.get("board").then(setData).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const slides = useMemo(() => {
    if (!data) return [];
    const s = [];
    if (data.games.bandit) s.push("bandit");
    if (data.games.chicken) s.push("chicken");
    if (data.games.pd) s.push("pd");
    return s; // empty = all games closed; say so instead of faking a board
  }, [data]);

  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setSlide((i) => (i + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [slides.length]);

  if (!data) {
    return (
      <div className="bigboard" style={{ textAlign: "center", paddingTop: "20vh" }}>
        <span className="spinner">LOADING</span>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="bigboard">
        <header className="site-header" style={{ justifyContent: "center", gap: 22 }}>
          <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={4} />
          <div style={{ textAlign: "center" }}>
            <div className="title-main">DELTA ARCADE</div>
            <div className="title-sub">WEEK 1 · GAMES OF STRATEGY</div>
          </div>
        </header>
        <div className="disabled-note">
          GAMES OPEN SOON
          <br />
          JOIN AT nddelta.com/week1
        </div>
      </div>
    );
  }

  const cur = slides[slide % slides.length];
  const matchCols = [
    { key: "avg", label: "AVG / MATCH", cls: "score", fmt: (v) => v.toFixed(1) },
    { key: "wins", label: "W", cls: "dim" },
    { key: "losses", label: "L", cls: "dim" },
    { key: "draws", label: "D", cls: "dim" },
  ];

  return (
    <div className="bigboard">
      <header className="site-header" style={{ justifyContent: "center", gap: 22 }}>
        <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={4} />
        <div style={{ textAlign: "center" }}>
          <div className="title-main">DELTA ARCADE</div>
          <div className="title-sub">WEEK 1 · LIVE STANDINGS · nddelta.com/week1</div>
        </div>
        <PixelSprite grid={TROPHY} palette={TROPHY_PALETTE} scale={4} />
      </header>

      <div className="rotator-dots">
        {slides.map((s, i) => (
          <i key={s} className={i === slide % slides.length ? "cur" : ""} />
        ))}
      </div>

      {cur === "bandit" && (
        <div className="board-duo">
          <section className="panel board">
            <div className="panel-title">🎰 BANDIT · MANUAL <span className="tag">best run · % of oracle</span></div>
            <Board rows={data.bandit.manual} columns={[
              { key: "oraclePct", label: "% ORACLE", cls: "score", fmt: (v) => (v == null ? "—" : `${v.toFixed(0)}%`) },
              { key: "points", label: "POINTS", cls: "dim", fmt: (v) => (v == null ? "—" : v.toFixed(1)) },
            ]} />
          </section>
          <section className="panel board">
            <div className="panel-title">🤖 BANDIT · ALGORITHM <span className="tag">avg of 10,000 games</span></div>
            <Board rows={data.bandit.algo} columns={[
              { key: "score", label: "AVG", cls: "score", fmt: (v) => v.toFixed(1) },
              { key: "oraclePct", label: "% ORACLE", cls: "dim", fmt: (v) => (v == null ? "—" : `${v.toFixed(0)}%`) },
              { key: "stratName", label: "STRATEGY", cls: "dim", fmt: (v) => v ?? "—" },
            ]} />
          </section>
        </div>
      )}

      {(cur === "chicken" || cur === "pd") && (
        <div className="board-duo">
          <section className="panel board">
            <div className="panel-title">
              {GAME_META[cur].icon} {GAME_META[cur].name} · STANDINGS
            </div>
            <Board
              rows={data[cur].standings.map((s, i) => ({ rank: i + 1, teamId: s.id, ...s }))}
              columns={matchCols}
              crown
            />
          </section>
          <section className="panel">
            <div className="panel-title">
              ⚔ TITLE FIGHT <span className="tag">the actual #1 vs #2 match, replayed</span>
            </div>
            <TitleFight game={cur} replay={data[cur].replay} />
          </section>
        </div>
      )}
    </div>
  );
}

function TitleFight({ game, replay }) {
  const [matchIdx, setMatchIdx] = useState(0);

  // Cycle through the pairing's five matches so the screen never loops
  // the same 20 seconds all night.
  useEffect(() => {
    if (!replay) return;
    const t = setInterval(() => setMatchIdx((i) => (i + 1) % replay.matches.length), 26000);
    return () => clearInterval(t);
  }, [replay?.a?.id, replay?.b?.id, replay?.matches?.length]);

  if (!replay) return <div className="empty">Waiting for two bots on the board…</div>;
  const m = replay.matches[matchIdx % replay.matches.length];

  return (
    <>
      <div className="hint" style={{ marginBottom: 8 }}>match {matchIdx % replay.matches.length + 1} of {replay.matches.length}</div>
      {game === "chicken" ? (
        <ReplayChicken key={`${replay.a.id}|${replay.b.id}|${matchIdx}`} rounds={m.rounds} nameA={replay.a.name} nameB={replay.b.name} autoLoop big />
      ) : (
        <ReplaySplitSteal key={`${replay.a.id}|${replay.b.id}|${matchIdx}`} rounds={m.rounds} nameA={replay.a.name} nameB={replay.b.name} autoLoop big />
      )}
    </>
  );
}
