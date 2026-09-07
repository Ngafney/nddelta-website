/**
 * /week1/board — the projector page. Zero interaction: it polls, rotates
 * through the enabled games' leaderboards, replays the actual top-two
 * Split-or-Steal title match, shows the live round countdown, and — when a
 * game's timer hits zero — auto-plays the Kahoot-style winner reveal.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { GAME_META } from "../../shared/rules.js";
import { Board } from "./Leaderboards.jsx";
import ReplaySplitSteal from "./ReplaySplitSteal.jsx";
import WinnerReveal from "./WinnerReveal.jsx";
import { PixelSprite } from "./PixelBits.jsx";
import { DELTA, DELTA_PALETTE, TROPHY, TROPHY_PALETTE } from "./sprites.js";

const ROTATE_MS = 12000;
const clock = (ms) => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor((Math.max(0, ms) % 60000) / 1000)).padStart(2, "0")}`;

export default function BigBoard() {
  const [data, setData] = useState(null);
  const [slide, setSlide] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [reveal, setReveal] = useState(null);
  const shownRef = useRef(new Set());

  useEffect(() => {
    const load = () => api.get("board").then(setData).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { clearInterval(t); clearInterval(tick); };
  }, []);

  const slides = useMemo(() => {
    if (!data) return [];
    const s = [];
    if (data.games.pd) s.push("pd");
    if (data.games.icecream) s.push("icecream");
    return s;
  }, [data]);

  useEffect(() => {
    if (slides.length < 2 || reveal) return;
    const t = setInterval(() => setSlide((i) => (i + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [slides.length, reveal]);

  // Fire (and auto-dismiss) the winner reveal when a timer crosses zero — once
  // per round. A reload must not replay a countdown that already happened, so
  // rounds that ended before we loaded are marked seen without playing.
  useEffect(() => {
    const timers = data?.timers ?? {};
    for (const g of ["pd", "icecream"]) {
      const tm = timers[g];
      if (!tm) continue;
      const key = `${g}:${tm.startedAt}`;
      const expired = now >= tm.endsAt;
      if (expired && !shownRef.current.has(key)) {
        shownRef.current.add(key);
        if (now - tm.endsAt < 120_000 && !reveal) {
          setReveal(g);
          setTimeout(() => setReveal(null), 26000);
        }
      }
    }
  }, [now, data, reveal]);

  if (!data) return <div className="bigboard" style={{ textAlign: "center", paddingTop: "20vh" }}><span className="spinner">LOADING</span></div>;

  if (reveal) return <WinnerReveal game={reveal} projector />;

  const timers = data.timers ?? {};
  const active = ["pd", "icecream"].map((g) => (timers[g] && timers[g].endsAt > now ? { g, ms: timers[g].endsAt - now } : null)).filter(Boolean);

  if (slides.length === 0) {
    return (
      <div className="bigboard">
        <Head sub="WEEK 1 · GAMES OF STRATEGY" />
        <div className="disabled-note">GAMES OPEN SOON<br />JOIN AT nddelta.com/week1</div>
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
      <Head sub="WEEK 1 · LIVE STANDINGS · nddelta.com/week1" trophy />

      {active.length > 0 && (
        <div className="bb-timers">
          {active.map(({ g, ms }) => (
            <div className="bb-timer" key={g}><span>{GAME_META[g].icon} {GAME_META[g].name}</span><b>{clock(ms)}</b></div>
          ))}
        </div>
      )}

      <div className="rotator-dots">
        {slides.map((s, i) => <i key={s} className={i === slide % slides.length ? "cur" : ""} />)}
      </div>

      {cur === "pd" && (
        <div className="board-duo">
          <section className="panel board">
            <div className="panel-title">{GAME_META.pd.icon} {GAME_META.pd.name} · STANDINGS</div>
            <Board rows={data.pd.standings.map((s, i) => ({ rank: i + 1, teamId: s.id, ...s }))} columns={matchCols} crown />
          </section>
          <section className="panel">
            <div className="panel-title">⚔ TITLE FIGHT <span className="tag">the actual #1 vs #2 match, replayed</span></div>
            <TitleFight replay={data.pd.replay} />
          </section>
        </div>
      )}

      {cur === "icecream" && (
        <section className="panel board">
          <div className="panel-title">{GAME_META.icecream.icon} SUNSET SCOOPS · FEWEST BANKRUPTCIES</div>
          <Board rows={data.icecream.bankruptcies} crown columns={[
            { key: "score", label: "BANKRUPTCIES", cls: "score", fmt: (v) => `${v}` },
            { key: "totalProfit", label: "PROFIT", cls: "dim", fmt: (v) => (v == null ? "—" : "$" + Math.round(v).toLocaleString()) },
          ]} />
        </section>
      )}
    </div>
  );
}

function Head({ sub, trophy }) {
  return (
    <header className="site-header" style={{ justifyContent: "center", gap: 22 }}>
      <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={4} />
      <div style={{ textAlign: "center" }}>
        <div className="title-main">DELTA ARCADE</div>
        <div className="title-sub">{sub}</div>
      </div>
      {trophy && <PixelSprite grid={TROPHY} palette={TROPHY_PALETTE} scale={4} />}
    </header>
  );
}

function TitleFight({ replay }) {
  const [matchIdx, setMatchIdx] = useState(0);
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
      <ReplaySplitSteal key={`${replay.a.id}|${replay.b.id}|${matchIdx}`} rounds={m.rounds} nameA={replay.a.name} nameB={replay.b.name} autoLoop big />
    </>
  );
}
