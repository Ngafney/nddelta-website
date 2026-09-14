/**
 * /week2/admin — the control room.
 *
 * Set up a round (which mode, which curve, how long, how much money), open it,
 * stretch or stop the clock, and — in prediction mode only — say what the
 * answer was. A gradient round's settlement is NOT on this page on purpose:
 * x* is drawn and proved when the round is created, so there is nothing here
 * that could move it after seeing where the market went.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { PxButton, Spinner, clock, money, num } from "./PixelBits.jsx";

export default function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem("w2admin") || null);
  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <header className="site-header">
        <div className="logo-block">
          <div>
            <div className="title-main">CONTROL ROOM</div>
            <div className="title-sub">WEEK 2 · ADMIN</div>
          </div>
        </div>
        <div className="header-right">
          <a href="/week2/">← to the floor</a>
          <a href="/week2/board" target="_blank" rel="noreferrer">
            big screen ↗
          </a>
        </div>
      </header>
      {token ? (
        <Controls
          token={token}
          onLogout={() => {
            sessionStorage.removeItem("w2admin");
            setToken(null);
          }}
        />
      ) : (
        <Login
          onAuth={(t) => {
            sessionStorage.setItem("w2admin", t);
            setToken(t);
          }}
        />
      )}
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
      onAuth((await api.post("admin/auth", { password: pw })).token);
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
        <input
          type="password"
          placeholder="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          style={{ maxWidth: 240 }}
        />
        <PxButton type="submit" disabled={busy || !pw}>
          {busy ? <Spinner text="CHECKING" /> : "ENTER"}
        </PxButton>
      </form>
      {err && <div className="err">{err}</div>}
    </section>
  );
}

function Controls({ token, onLogout }) {
  const [info, setInfo] = useState(null);
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [reveal, setReveal] = useState(false);

  // round setup form
  const [mode, setMode] = useState("gradient");
  const [difficulty, setDifficulty] = useState("wavy");
  const [minutes, setMinutes] = useState(12);
  const [startCash, setStartCash] = useState(100000);
  const [question, setQuestion] = useState("");
  const [keepPlayers, setKeepPlayers] = useState(true);
  const [lateJoin, setLateJoin] = useState(true);
  const [resolveTo, setResolveTo] = useState("100");
  const [newPw, setNewPw] = useState("");

  const load = useCallback(async () => {
    try {
      setInfo(await api.get("admin/inspect", { token }));
    } catch (e) {
      if (e.status === 401) onLogout();
      else setErr(e.message);
    }
  }, [token, onLogout]);

  useEffect(() => {
    load();
    api.get("rules").then(setRules).catch(() => {});
    const t = setInterval(load, 2500);
    const c = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load]);

  async function act(label, fn) {
    setBusy(label);
    setErr(null);
    setMsg(null);
    try {
      const out = await fn();
      setMsg(`✓ ${label}`);
      await load();
      return out;
    } catch (e) {
      setErr(e.message);
      if (e.status === 401) onLogout();
    } finally {
      setBusy(null);
    }
  }

  const round = info?.round ?? null;
  const status = round?.status ?? "none";
  const msLeft = round?.endsAt == null ? null : round.endsAt - now;

  return (
    <>
      {info && !info.persistent && (
        <div className="err">
          Storage is per-invocation memory on this deployment — a round will not survive. Add the Upstash integration, or
          run the event from <code>node serve.js</code>.
        </div>
      )}

      {/* ── live round ── */}
      <section className="panel">
        <div className="panel-title">
          THE ROUND
          <span className="right">{info?.kv === "upstash" ? "upstash" : "memory"} storage</span>
        </div>
        {!round ? (
          <div className="hint">Nothing set up yet. Build a round below.</div>
        ) : (
          <>
            <div className="stats" style={{ marginBottom: 12 }}>
              <div className="stat">
                <i>MODE</i>
                <b>{round.modeName}</b>
                <small>{round.mode === "gradient" ? round.difficultyName : "admin-resolved"}</small>
              </div>
              <div className="stat">
                <i>STATUS</i>
                <b
                  style={{
                    color:
                      status === "live" ? "var(--green)" : status === "settled" ? "var(--gold)" : "var(--muted)",
                  }}
                >
                  {status.toUpperCase()}
                </b>
                <small>{msLeft == null ? "no clock" : `${clock(Math.max(0, msLeft))} left`}</small>
              </div>
              <div className="stat">
                <i>PLAYERS</i>
                <b>{round.players}</b>
                <small>
                  {round.teams} team{round.teams === 1 ? "" : "s"} · {info.openOrders} orders working
                </small>
              </div>
              <div className="stat">
                <i>VOLUME</i>
                <b>{info.volume} lots</b>
                <small>start money {money(round.startCashC)} each</small>
              </div>
            </div>

            {round.question && (
              <div className="question" style={{ marginBottom: 14 }}>
                <small>THE QUESTION</small>
                {round.question}
              </div>
            )}

            <div className="row">
              {status === "lobby" && (
                <PxButton variant="green" disabled={busy} onClick={() => act("opened the market", () => api.post("admin/start", { token, minutes }))}>
                  {busy === "opened the market" ? <Spinner text="OPENING" /> : `OPEN FOR ${minutes} MIN`}
                </PxButton>
              )}
              {status === "live" && (
                <>
                  <PxButton variant="ghost" small disabled={busy} onClick={() => act("+1 minute", () => api.post("admin/extend", { token, seconds: 60 }))}>
                    +1 MIN
                  </PxButton>
                  <PxButton variant="ghost" small disabled={busy} onClick={() => act("+5 minutes", () => api.post("admin/extend", { token, seconds: 300 }))}>
                    +5 MIN
                  </PxButton>
                  <PxButton variant="ghost" small disabled={busy} onClick={() => act("−1 minute", () => api.post("admin/extend", { token, seconds: -60 }))}>
                    −1 MIN
                  </PxButton>
                  <PxButton variant="red" disabled={busy} onClick={() => act("closed trading", () => api.post("admin/end", { token }))}>
                    {busy === "closed trading" ? <Spinner text="CLOSING" /> : "CLOSE NOW"}
                  </PxButton>
                </>
              )}
              {info?.xStar != null && round.mode === "gradient" && (
                <PxButton variant="ghost" small onClick={() => setReveal((r) => !r)}>
                  {reveal ? "HIDE THE ANSWER" : "PEEK AT x*"}
                </PxButton>
              )}
            </div>

            {reveal && info?.xStar != null && (
              <div className="note">
                x* = <b style={{ fontSize: 20 }}>{num(info.xStar, 2)}</b> — do not say this out loud. Local minima on
                this curve: {info.diagnostics?.localMinima ?? "?"} · range {num(info.diagnostics?.range ?? 0, 0)} ·
                self-check {info.diagnostics?.ok ? "passed" : "FAILED"}.
              </div>
            )}

            {/* resolution — prediction mode only */}
            {round.mode === "prediction" && status !== "settled" && status !== "lobby" && (
              <>
                <div className="field-label mt">RESOLVE THE MARKET</div>
                <div className="row">
                  <PxButton variant="green" disabled={busy} onClick={() => act("resolved YES (100)", () => api.post("admin/resolve", { token, value: 100 }))}>
                    YES · 100
                  </PxButton>
                  <PxButton variant="red" disabled={busy} onClick={() => act("resolved NO (0)", () => api.post("admin/resolve", { token, value: 0 }))}>
                    NO · 0
                  </PxButton>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={resolveTo}
                    onChange={(e) => setResolveTo(e.target.value)}
                    style={{ maxWidth: 120 }}
                  />
                  <PxButton
                    disabled={busy || resolveTo === "" || Number(resolveTo) < 0 || Number(resolveTo) > 100}
                    onClick={() => act(`resolved at ${resolveTo}`, () => api.post("admin/resolve", { token, value: Number(resolveTo) }))}
                  >
                    RESOLVE HERE
                  </PxButton>
                </div>
                <div className="hint">
                  Whatever you pick is what every lot pays. Trading is already closed, so nobody can act on it.
                </div>
              </>
            )}

            {status === "settled" && (
              <div className="good">
                Settled at <b>{num(round.xStar, 2)}</b>. The leaderboard is final and the reveal has played.
              </div>
            )}
          </>
        )}
        {msg && <div className="good">{msg}</div>}
        {err && <div className="err">{err}</div>}
      </section>

      {/* ── new round ── */}
      <section className="panel">
        <div className="panel-title">SET UP A NEW ROUND</div>

        <div className="modeswitch">
          {(rules?.modeOrder ?? ["gradient", "prediction"]).map((k) => {
            const m = rules?.modes?.[k];
            return (
              <b key={k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>
                <span className="mi">{m?.icon ?? "•"}</span>
                <span className="mn">{m?.name ?? k}</span>
                <span className="md">{m?.blurb}</span>
              </b>
            );
          })}
        </div>

        {mode === "gradient" ? (
          <>
            <span className="field-label">THE CURVE</span>
            <div className="difficulties">
              {(rules?.order ?? []).map((k) => (
                <div key={k} className={`diff ${difficulty === k ? "on" : ""}`} onClick={() => setDifficulty(k)}>
                  <span className="dn">{rules.difficulties[k].name}</span>
                  <span className="db">{rules.difficulties[k].blurb}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <span className="field-label">THE QUESTION</span>
            <input
              type="text"
              placeholder="Will it snow in South Bend before Friday?"
              maxLength={160}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <div className="hint">
              Yes/no questions resolve at 100 or 0, so the price reads as a probability in percent. You can also resolve
              anywhere in between.
            </div>
          </>
        )}

        <div className="admin-grid mt">
          <div>
            <span className="field-label">MINUTES</span>
            <input type="number" min={0.5} max={180} step="0.5" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </div>
          <div>
            <span className="field-label">STARTING CASH EACH ($)</span>
            <input type="number" min={100} max={10000000} step={5000} value={startCash} onChange={(e) => setStartCash(Number(e.target.value))} />
          </div>
        </div>

        <div className="row mt">
          <label className="row row--tight" style={{ cursor: "pointer" }}>
            <input type="checkbox" style={{ width: 18 }} checked={keepPlayers} onChange={(e) => setKeepPlayers(e.target.checked)} />
            <span>keep players and teams (they just get fresh money)</span>
          </label>
        </div>
        <div className="row">
          <label className="row row--tight" style={{ cursor: "pointer" }}>
            <input type="checkbox" style={{ width: 18 }} checked={lateJoin} onChange={(e) => setLateJoin(e.target.checked)} />
            <span>allow joining after the market opens</span>
          </label>
        </div>

        <div className="mt">
          <PxButton
            variant="blue"
            disabled={busy || (mode === "prediction" && question.trim().length < 3)}
            onClick={() =>
              act("built a new round", () =>
                api.post("admin/round", { token, mode, difficulty, minutes, startCash, question, keepPlayers, lateJoin })
              )
            }
          >
            {busy === "built a new round" ? <Spinner text="BUILDING" /> : "BUILD ROUND"}
          </PxButton>
          <span className="hint" style={{ marginLeft: 12 }}>
            This replaces whatever is on the floor right now.
          </span>
        </div>
      </section>

      {/* ── people ── */}
      <section className="panel">
        <div className="panel-title">
          PEOPLE
          <span className="right">{info?.players?.length ?? 0} in the round</span>
        </div>

        {info?.suspicious?.length > 0 && (
          <div className="err">
            Same browser signature and network on more than one account — worth a look, not proof:{" "}
            {info.suspicious.map((g) => g.map((p) => p.name).join(" + ")).join(" · ")}
          </div>
        )}

        <div className="admtable-wrap">
        <table className="admtable">
          <thead>
            <tr>
              <th>NAME</th>
              <th>TEAM</th>
              <th style={{ textAlign: "right" }}>VALUE</th>
              <th style={{ textAlign: "right" }}>POS</th>
              <th style={{ textAlign: "right" }}>PTS</th>
              <th style={{ textAlign: "right" }}>SPENT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(info?.players ?? []).map((p) => (
              <tr key={p.id} className={info.suspicious?.some((g) => g.some((x) => x.id === p.id)) ? "flag" : ""}>
                <td>
                  {p.name}
                  {p.sawAll ? " ★" : ""}
                </td>
                <td style={{ color: "var(--muted)" }}>{p.team ?? "—"}</td>
                <td className="n">{money(p.valueC)}</td>
                <td className="n">{p.pos}</td>
                <td className="n">{p.points}</td>
                <td className="n">{money(p.spentC)}</td>
                <td>
                  <button
                    className="pxbtn pxbtn--ghost pxbtn--sm"
                    disabled={busy}
                    title={p.pos !== 0 ? "they are holding lots — they cannot be removed" : "remove this player"}
                    onClick={() => act(`removed ${p.name}`, () => api.post("admin/kick", { token, playerId: p.id }))}
                  >
                    KICK
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {(info?.teams ?? []).length > 0 && (
          <>
            <span className="field-label mt">TEAM CODES</span>
            <div className="row row--tight">
              {info.teams.map((t) => (
                <span key={t.id} className="chip" title={t.members.join(", ")}>
                  {t.name} <small>{t.code}</small>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── health ── */}
      <section className="panel">
        <div className="panel-title">HEALTH</div>
        <div className="kv">
          <span>book integrity</span>
          <b style={{ color: info?.audit?.length ? "var(--red)" : "var(--green)" }}>
            {info?.audit?.length ? info.audit.join(" · ") : "every invariant holds"}
          </b>
        </div>
        <div className="kv">
          <span>storage</span>
          <b>{info?.kv} {info?.persistent ? "" : "(NOT PERSISTENT)"}</b>
        </div>
        {info?.diagnostics && (
          <>
            <div className="kv">
              <span>curve self-check</span>
              <b style={{ color: info.diagnostics.ok ? "var(--green)" : "var(--red)" }}>
                {info.diagnostics.ok ? "argmin is exactly x*" : "FAILED"}
              </b>
            </div>
            <div className="kv">
              <span>decoy valleys</span>
              <b>{info.diagnostics.localMinima}</b>
            </div>
          </>
        )}

        <div className="row mt">
          <input type="password" placeholder="new admin password" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={{ maxWidth: 220 }} />
          <PxButton
            variant="ghost"
            small
            disabled={busy || newPw.length < 3}
            onClick={() =>
              act("changed the password", async () => {
                const r = await api.post("admin/password", { token, password: newPw });
                sessionStorage.setItem("w2admin", r.token);
                setNewPw("");
                window.location.reload();
              })
            }
          >
            CHANGE PASSWORD
          </PxButton>
          <PxButton variant="ghost" small onClick={onLogout}>
            LOG OUT
          </PxButton>
        </div>
      </section>
    </>
  );
}
