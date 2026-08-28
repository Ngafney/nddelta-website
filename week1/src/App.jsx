import React, { useEffect, useState, useCallback } from "react";
import { api, loadTeam, saveTeam, clearTeam } from "./api.js";
import { GAME_META } from "../shared/rules.js";
import { PixelSprite, PxButton } from "./components/PixelBits.jsx";
import { DELTA, DELTA_PALETTE } from "./components/sprites.js";
import NameGate from "./components/NameGate.jsx";
import Starfield from "./components/Starfield.jsx";
import BanditGame from "./components/BanditGame.jsx";
import MatchGame from "./components/MatchGame.jsx";
import Leaderboards from "./components/Leaderboards.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import BigBoard from "./components/BigBoard.jsx";

const TAB_ORDER = ["bandit", "chicken", "pd"];

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

function MainApp() {
  const [team, setTeam] = useState(loadTeam);
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState(null);

  // Config poll — the admin can flip games live and every open browser follows.
  const poll = useCallback(async () => {
    try {
      const c = await api.get("config");
      setConfig(c);
    } catch {
      /* server hiccup; keep last known config */
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [poll]);

  const enabled = TAB_ORDER.filter((g) => config?.games?.[g]);

  // Keep the active tab valid as games toggle on and off under us.
  useEffect(() => {
    if (!config) return;
    if (tab === "boards") return;
    if (!tab || (TAB_ORDER.includes(tab) && !config.games[tab])) {
      setTab(enabled[0] ?? "boards");
    }
  }, [config, tab, enabled.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching tabs from deep in a long tab must land you at the top of the
  // new one — not stranded mid-scroll where its header is off-screen.
  const goTab = (t) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  if (!team) {
    return <NameGate onJoin={(t) => { saveTeam(t); setTeam(t); }} />;
  }

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
          <div className="team-badge" title="your team">
            <span>TEAM</span>
            {team.name}
          </div>
          <PxButton
            variant="ghost"
            small
            title="switch teams — this one stays rejoinable by name"
            onClick={() => { clearTeam(); setTeam(null); }}
          >
            SWITCH TEAM
          </PxButton>
        </div>
      </header>

      <nav className="tabbar">
        {enabled.map((g) => (
          <button key={g} className={`tab ${tab === g ? "active" : ""}`} onClick={() => goTab(g)}>
            <span className="ico">{GAME_META[g].icon}</span>
            {GAME_META[g].name}
          </button>
        ))}
        <button className={`tab ${tab === "boards" ? "active" : ""}`} onClick={() => goTab("boards")}>
          <span className="ico">🏆</span>
          Leaderboards
        </button>
      </nav>

      {config && enabled.length === 0 && tab !== "boards" ? (
        <div className="disabled-note">
          NO GAMES ARE OPEN RIGHT NOW
          <br />
          CHECK THE BIG SCREEN
        </div>
      ) : (
        <>
          {tab === "bandit" && <BanditGame team={team} />}
          {tab === "chicken" && <MatchGame team={team} game="chicken" />}
          {tab === "pd" && <MatchGame team={team} game="pd" />}
          {tab === "boards" && <Leaderboards team={team} games={config?.games} />}
        </>
      )}

      <div className="footer-note">
        DELTA · Discovering Econometrics: Learning Through Application ·{" "}
        <a href="/week1/board" target="_blank" rel="noreferrer">big screen ↗</a>
      </div>
    </div>
  );
}
