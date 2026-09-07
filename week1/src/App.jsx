import React, { useEffect, useState, useCallback, useRef } from "react";
import { api, loadTeam, saveTeam, clearTeam } from "./api.js";
import { GAME_META } from "../shared/rules.js";
import { PixelSprite, PxButton } from "./components/PixelBits.jsx";
import { DELTA, DELTA_PALETTE } from "./components/sprites.js";
import NameGate from "./components/NameGate.jsx";
import Starfield from "./components/Starfield.jsx";
import IPDGame from "./components/IPDGame.jsx";
import IceCreamGame from "./components/IceCreamGame.jsx";
import Leaderboards from "./components/Leaderboards.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import BigBoard from "./components/BigBoard.jsx";
import WinnerReveal from "./components/WinnerReveal.jsx";

const TAB_ORDER = ["pd", "icecream"];

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "");
  const page = path.endsWith("/board") ? <BigBoard /> : path.endsWith("/admin") ? <AdminPanel /> : <MainApp />;
  return (
    <>
      <Starfield />
      {page}
    </>
  );
}

/** mm:ss for a millisecond remainder. */
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The winner reveal must play ONCE, when a round actually ends — not again on
 * every refresh afterwards. Two guards: we remember which reveals this browser
 * has played (across reloads), and we only auto-play one whose timer expired in
 * the last couple of minutes, so arriving late never triggers an old countdown.
 */
const SHOWN_KEY = "w1shownReveals";
const REVEAL_WINDOW_MS = 120_000;

function loadShown() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY)) ?? []);
  } catch {
    return new Set();
  }
}

function markShown(set, key) {
  set.add(key);
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...set].slice(-40)));
  } catch { /* private mode — it just won't survive a reload */ }
}

function MainApp() {
  const [team, setTeam] = useState(loadTeam);
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [revealGame, setRevealGame] = useState(null);
  // Which reveals this browser has already played, keyed `${game}:${startedAt}`.
  // Persisted: a refresh must NOT replay a countdown that already happened.
  const shownRef = useRef(loadShown());

  const poll = useCallback(async () => {
    try { setConfig(await api.get("config")); } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [poll]);

  const enabled = TAB_ORDER.filter((g) => config?.games?.[g]);

  useEffect(() => {
    if (!config) return;
    if (tab === "boards") return;
    if (!tab || (TAB_ORDER.includes(tab) && !config.games[tab])) setTab(enabled[0] ?? "boards");
  }, [config, tab, enabled.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a game's timer crosses its end, play the reveal once for that round.
  useEffect(() => {
    const timers = config?.timers ?? {};
    for (const g of TAB_ORDER) {
      const tm = timers[g];
      if (!tm) continue;
      const key = `${g}:${tm.startedAt}`;
      const expired = now >= tm.endsAt;
      const justExpired = expired && now - tm.endsAt < REVEAL_WINDOW_MS;
      if (expired && !shownRef.current.has(key)) {
        // Mark every ended round as seen — including ones that ended before we
        // loaded — but only actually PLAY one that just ended.
        markShown(shownRef.current, key);
        if (justExpired && !revealGame) setRevealGame(g);
      }
    }
  }, [now, config, revealGame]);

  const goTab = (t) => { setTab(t); window.scrollTo({ top: 0 }); };

  if (!team) return <NameGate onJoin={(t) => { saveTeam(t); setTeam(t); }} />;

  const timers = config?.timers ?? {};
  const activeTimer = tab !== "boards" && timers[tab] && now < timers[tab].endsAt ? timers[tab] : null;

  return (
    <div className="wrap">
      <header className="site-header">
        <div className="logo-block">
          <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={3} />
          <div>
            <div className="title-main">DELTA ARCADE</div>
            <div className="title-sub">WEEK 1 · GAMES OF STRATEGY</div>
          </div>
        </div>
        <div className="header-right">
          <div className="team-badge" title="your team"><span>TEAM</span>{team.name}</div>
          <PxButton variant="ghost" small title="switch teams — this one stays rejoinable by name"
            onClick={() => { clearTeam(); setTeam(null); }}>SWITCH TEAM</PxButton>
        </div>
      </header>

      <nav className="tabbar">
        {enabled.map((g) => (
          <button key={g} className={`tab ${tab === g ? "active" : ""}`} onClick={() => goTab(g)}>
            <span className="ico">{GAME_META[g].icon}</span>{GAME_META[g].name}
            {timers[g] && now < timers[g].endsAt && <span className="tab-timer">{clock(timers[g].endsAt - now)}</span>}
          </button>
        ))}
        <button className={`tab ${tab === "boards" ? "active" : ""}`} onClick={() => goTab("boards")}>
          <span className="ico">🏆</span>Leaderboards
        </button>
      </nav>

      {activeTimer && (
        <div className="timer-banner">
          ⏳ {GAME_META[tab].name} closes in <b>{clock(activeTimer.endsAt - now)}</b> — get your bot in
        </div>
      )}

      {config && enabled.length === 0 && tab !== "boards" ? (
        <div className="disabled-note">NO GAMES ARE OPEN RIGHT NOW<br />CHECK THE BIG SCREEN</div>
      ) : (
        <>
          {tab === "pd" && <IPDGame team={team} />}
          {tab === "icecream" && <IceCreamGame team={team} />}
          {tab === "boards" && <Leaderboards team={team} games={config?.games} />}
        </>
      )}

      <div className="footer-note">
        DELTA · Discovering Econometrics: Learning Through Application ·{" "}
        <a href="/week1/board" target="_blank" rel="noreferrer">big screen ↗</a>
      </div>

      {revealGame && <WinnerReveal game={revealGame} onClose={() => setRevealGame(null)} />}
    </div>
  );
}
