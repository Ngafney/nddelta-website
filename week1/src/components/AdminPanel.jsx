/**
 * /week1/admin — the control room. Toggle games live (so a class can meet
 * one game at a time), reset boards, evict entries, force a recompute,
 * change the password. Auth is a server-checked password → signed token.
 */
import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { GAME_META, GAMES } from "../../shared/rules.js";
import { PxButton, Spinner } from "./PixelBits.jsx";

export default function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem("w1admin") || null);
  return (
    <div className="wrap" style={{ maxWidth: 640 }}>
      <header className="site-header">
        <div className="logo-block">
          <div>
            <div className="title-main">CONTROL ROOM</div>
            <div className="title-sub">WEEK 1 · ADMIN</div>
          </div>
        </div>
        <div className="header-right">
          <a href="/week1/">← back to the arcade</a>
        </div>
      </header>
      {token ? <Controls token={token} onLogout={() => { sessionStorage.removeItem("w1admin"); setToken(null); }} />
             : <Login onAuth={(t) => { sessionStorage.setItem("w1admin", t); setToken(t); }} />}
    </div>
  );
}

function Login({ onAuth }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function go(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post("admin/auth", { password: pw });
      onAuth(res.token);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-title">WHO GOES THERE</div>
      <form onSubmit={go} className="row">
        <input type="password" placeholder="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus style={{ maxWidth: 240 }} />
        <PxButton type="submit" disabled={busy || !pw}>{busy ? <Spinner text="CHECKING" /> : "ENTER"}</PxButton>
      </form>
      {err && <div className="err">{err}</div>}
    </section>
  );
}

function Controls({ token, onLogout }) {
  const [games, setGames] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [persistent, setPersistent] = useState(true);
  const [boards, setBoards] = useState(null);
  const [timers, setTimers] = useState({});
  const [now, setNow] = useState(Date.now());

  const loadBoards = async () => {
    try {
      const [p, i] = await Promise.all([
        api.get("leaderboard?game=pd"),
        api.get("leaderboard?game=icecream"),
      ]);
      setBoards({ pd: p.standings, "ice-bank": i.bankruptcies });
    } catch {}
  };

  const loadConfig = async () => {
    try {
      const c = await api.get("config");
      setGames(c.games);
      setPersistent(c.persistent !== false);
      setTimers(c.timers ?? {});
    } catch {}
  };

  useEffect(() => {
    loadConfig();
    loadBoards();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function setTimer(game, seconds) {
    await act(seconds ? `set ${game} timer` : `stop ${game} timer`, async () => {
      const res = await api.post("admin/timer", { token, game, seconds });
      setTimers((tm) => ({ ...tm, [game]: res.timer }));
    });
  }
  const remain = (g) => (timers[g] && timers[g].endsAt > now ? timers[g].endsAt - now : 0);
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  async function act(label, fn) {
    setBusy(label);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(`✓ ${label} done`);
    } catch (e) {
      setErr(e.message);
      if (e.status === 401) onLogout();
    } finally {
      setBusy(null);
    }
  }

  async function toggle(g) {
    const next = { ...games, [g]: !games[g] };
    setGames(next); // optimistic; server result confirms
    act(`toggle ${g}`, async () => {
      const res = await api.post("admin/config", { token, games: next });
      setGames(res.games);
    });
  }

  const only = (g) =>
    act(`only ${g}`, async () => {
      const next = Object.fromEntries(GAMES.map((x) => [x, x === g]));
      const res = await api.post("admin/config", { token, games: next });
      setGames(res.games);
    });

  if (!games) return <section className="panel"><Spinner text="LOADING" /></section>;

  return (
    <>
      {!persistent && (
        <div className="err" style={{ marginBottom: 18 }}>
          ⚠ STORAGE IS NOT PERSISTENT — the server has no Upstash credentials, so every score will
          vanish between requests. Add the Upstash Redis integration in Vercel before the event.
        </div>
      )}
      <section className="panel">
        <div className="panel-title">GAMES <span className="tag">live for everyone within ~5s</span></div>
        {GAMES.map((g) => (
          <div className="toggle-row" key={g}>
            <span style={{ fontSize: 16 }}>{GAME_META[g].icon}</span>
            <span className="nm">{GAME_META[g].name}</span>
            <PxButton variant="ghost" small onClick={() => only(g)}>ONLY THIS</PxButton>
            <div className={`pxswitch ${games[g] ? "on" : ""}`} onClick={() => toggle(g)}>
              <i />
            </div>
          </div>
        ))}
        <div className="row mt">
          <PxButton variant="ghost" small onClick={() => act("open all", async () => {
            const res = await api.post("admin/config", { token, games: Object.fromEntries(GAMES.map((g) => [g, true])) });
            setGames(res.games);
          })}>OPEN ALL</PxButton>
          <PxButton variant="ghost" small onClick={() => act("close all", async () => {
            const res = await api.post("admin/config", { token, games: Object.fromEntries(GAMES.map((g) => [g, false])) });
            setGames(res.games);
          })}>CLOSE ALL</PxButton>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">ROUND TIMERS <span className="tag">everyone sees the countdown; a winner reveal fires at 0</span></div>
        {GAMES.map((g) => (
          <div className="toggle-row" key={g}>
            <span style={{ fontSize: 16 }}>{GAME_META[g].icon}</span>
            <span className="nm">{GAME_META[g].name}</span>
            {remain(g) > 0 ? (
              <span style={{ color: "var(--gold)", fontVariantNumeric: "tabular-nums", marginRight: 8 }}>{mmss(remain(g))}</span>
            ) : (
              <span className="hint" style={{ marginRight: 8 }}>idle</span>
            )}
            {[5, 10, 15, 30].map((m) => (
              <PxButton key={m} variant="ghost" small onClick={() => setTimer(g, m * 60)}>{m}m</PxButton>
            ))}
            <PxButton variant="red" small onClick={() => setTimer(g, 0)}>STOP</PxButton>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-title">BOARDS</div>
        <div className="admin-tools">
          {["pd", "icecream"].map((b) => (
            <PxButton
              key={b}
              variant="red"
              small
              onClick={() => window.confirm(`Wipe the ${b} board? This can't be undone.`) && act(`reset ${b}`, async () => { await api.post("admin/reset", { token, board: b }); await loadBoards(); })}
            >
              RESET {b.toUpperCase()}
            </PxButton>
          ))}
          <PxButton variant="blue" small onClick={() => act("recompute", () => api.post("admin/recompute", { token }))}>
            RECOMPUTE TOURNAMENT
          </PxButton>
        </div>
      </section>

      <section className="panel board">
        <div className="panel-title">ENTRIES <span className="tag">remove a bogus row</span></div>
        {!boards ? (
          <Spinner text="LOADING" />
        ) : (
          ["pd", "ice-bank"].map((bk) => (
            <EntryList
              key={bk}
              label={bk}
              rows={boards[bk]}
              onRemove={(teamId) =>
                window.confirm(`Remove this entry from ${bk}?`) &&
                act(`remove from ${bk}`, async () => {
                  await api.post("admin/remove-entry", { token, board: bk, teamId });
                  await loadBoards();
                })
              }
            />
          ))
        )}
      </section>

      <section className="panel">
        <div className="panel-title">PASSWORD</div>
        <div className="row">
          <input type="password" placeholder="new password" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={{ maxWidth: 240 }} />
          <PxButton variant="ghost" small disabled={newPw.length < 3} onClick={() => act("change password", async () => {
            const res = await api.post("admin/password", { token, password: newPw });
            sessionStorage.setItem("w1admin", res.token);
            setNewPw("");
          })}>CHANGE</PxButton>
        </div>
      </section>

      {busy && <div className="hint"><Spinner text={busy.toUpperCase()} /></div>}
      {msg && <div className="hint" style={{ color: "var(--green)" }}>{msg}</div>}
      {err && <div className="err">{err}</div>}
    </>
  );
}

/** One compact board with a remove button per team row. */
function EntryList({ label, rows, onRemove }) {
  const entries = (rows ?? [])
    .map((r) => ({
      teamId: (r.teamId ?? r.id ?? "").replace(/^team:/, ""),
      name: r.name,
      seed: r.seed || String(r.id ?? "").startsWith("seed:"),
      score: r.score ?? r.avg,
    }))
    .filter((r) => !r.seed); // house bots aren't removable
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="field-label">{label}</div>
      {entries.length === 0 ? (
        <div className="hint">no team entries</div>
      ) : (
        entries.map((r) => (
          <div className="toggle-row" key={r.teamId} style={{ padding: "7px 0" }}>
            <span style={{ flex: 1 }}>{r.name}</span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>{typeof r.score === "number" ? r.score.toFixed(1) : "—"}</span>
            <PxButton variant="red" small onClick={() => onRemove(r.teamId)}>✕</PxButton>
          </div>
        ))
      )}
    </div>
  );
}
