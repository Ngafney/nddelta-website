/**
 * /week3/admin — the control room.
 *
 * Coin market: set up a round (how p is drawn, what a share pays, how long the
 * flip window and the trading run, how much money and what a flip costs), open
 * the flip window, and let the clock do the rest — trading opens by itself when
 * the window closes, and the coin settles itself at the bell. Nothing on this
 * page can move the answer after the round is built.
 *
 * Bandit lab: open or close it, and choose what the projector shows.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { PxButton, Spinner, clock, money, num } from "./PixelBits.jsx";
import { BanditBoard } from "./BanditLab.jsx";

export default function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem("w3admin") || null);
  return (
    <div className="wrap" style={{ maxWidth: 900 }}>
      <header className="site-header">
        <div className="logo-block">
          <div>
            <div className="title-main">CONTROL ROOM</div>
            <div className="title-sub">WEEK 3 · ADMIN</div>
          </div>
        </div>
        <div className="header-right">
          <a href="/week3/">← to the floor</a>
          <a href="/week3/board" target="_blank" rel="noreferrer">
            big screen ↗
          </a>
        </div>
      </header>
      {token ? (
        <Controls
          token={token}
          onLogout={() => {
            sessionStorage.removeItem("w3admin");
            setToken(null);
          }}
        />
      ) : (
        <Login
          onAuth={(t) => {
            sessionStorage.setItem("w3admin", t);
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
        <input type="password" placeholder="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus style={{ maxWidth: 240 }} />
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
  const [resetArmed, setResetArmed] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [peek, setPeek] = useState(false);

  // round setup form. Kept as TEXT: an empty box goes to the server as empty,
  // and the server reads empty as "use the default" — never as zero.
  const [prior, setPrior] = useState("uniform");
  const [settlement, setSettlement] = useState("prob");
  const [simSeconds, setSimSeconds] = useState("120");
  const [minutes, setMinutes] = useState("10");
  const [startCash, setStartCash] = useState("10000");
  const [simCost, setSimCost] = useState("100");
  const [liveFlipCost, setLiveFlipCost] = useState("500");
  const [defaultSize, setDefaultSize] = useState("10");
  const [forceP, setForceP] = useState("");
  const [keepPlayers, setKeepPlayers] = useState(true);
  const [lateJoin, setLateJoin] = useState(true);
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
  const cfg = info?.cfg ?? { banditOpen: true, board: "market" };
  const flipsBought = (info?.players ?? []).reduce((s, p) => s + (p.sims ?? p.simOrder ?? 0), 0);

  return (
    <>
      {info && !info.persistent && (
        <div className="err">
          Storage is per-invocation memory on this deployment — a round will not survive. Add the Upstash integration, or
          run the event from <code>node serve.js</code>.
        </div>
      )}

      {/* ── the coin market, now ── */}
      <section className="panel">
        <div className="panel-title">
          🪙 COIN MARKET
          <span className="right">{info?.kv === "upstash" ? "upstash" : "memory"} storage</span>
        </div>
        {!round ? (
          <div className="hint">
            Nothing set up yet. Build a round below — players can't join (for either game) until one exists.
          </div>
        ) : (
          <>
            <div className="stats" style={{ marginBottom: 12, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
              <div className="stat">
                <i>STATUS</i>
                <b style={{ color: status === "live" ? "var(--green)" : status === "settled" ? "var(--gold)" : status === "sims" ? "var(--blue)" : "var(--muted)" }}>
                  {status === "sims" ? "FLIP WINDOW" : status.toUpperCase()}
                </b>
                <small>{msLeft == null ? "no clock" : `${clock(Math.max(0, msLeft))} left`}</small>
              </div>
              <div className="stat">
                <i>THE COIN</i>
                <b>{round.priorName}</b>
                <small>{round.settlement === "flip" ? "settles on one final flip" : "settles at 100 × p"}</small>
              </div>
              <div className="stat">
                <i>PLAYERS</i>
                <b>{round.players}</b>
                <small>
                  {round.teams} team{round.teams === 1 ? "" : "s"} · {info.openOrders} orders working
                </small>
              </div>
              <div className="stat">
                <i>FLIPS</i>
                <b>{flipsBought}</b>
                <small>
                  {status === "lobby" || status === "sims" ? "ordered so far" : "bought"} · {money(round.simCostC)} each
                </small>
              </div>
              <div className="stat">
                <i>VOLUME</i>
                <b>{info.volume} shares</b>
                <small>
                  {money(round.startCashC)} each · {round.defaultSize} a click
                </small>
              </div>
            </div>

            <div className="row">
              {status === "lobby" && (
                <PxButton variant="green" disabled={!!busy} onClick={() => act("opened the flip window", () => api.post("admin/start", { token }))}>
                  {busy === "opened the flip window" ? <Spinner text="OPENING" /> : `OPEN THE FLIP WINDOW (${round.simSeconds}s)`}
                </PxButton>
              )}
              {status === "lobby" && (
                <PxButton variant="blue" disabled={!!busy} onClick={() => act("dealt the flips and started trading", () => api.post("admin/skip-sims", { token }))}>
                  {busy === "dealt the flips and started trading" ? <Spinner text="FLIPPING" /> : "START TRADING NOW"}
                </PxButton>
              )}
              {status === "sims" && (
                <>
                  <PxButton variant="ghost" small disabled={!!busy} onClick={() => act("+30 seconds", () => api.post("admin/extend", { token, seconds: 30 }))}>
                    +30 S
                  </PxButton>
                  <PxButton variant="ghost" small disabled={!!busy} onClick={() => act("−15 seconds", () => api.post("admin/extend", { token, seconds: -15 }))}>
                    −15 S
                  </PxButton>
                  <PxButton variant="blue" disabled={!!busy} onClick={() => act("dealt the flips and opened trading", () => api.post("admin/skip-sims", { token }))}>
                    {busy === "dealt the flips and opened trading" ? <Spinner text="FLIPPING" /> : "START TRADING NOW"}
                  </PxButton>
                </>
              )}
              {status === "live" && (
                <>
                  <PxButton variant="ghost" small disabled={!!busy} onClick={() => act("+1 minute", () => api.post("admin/extend", { token, seconds: 60 }))}>
                    +1 MIN
                  </PxButton>
                  <PxButton variant="ghost" small disabled={!!busy} onClick={() => act("+5 minutes", () => api.post("admin/extend", { token, seconds: 300 }))}>
                    +5 MIN
                  </PxButton>
                  <PxButton variant="ghost" small disabled={!!busy} onClick={() => act("−1 minute", () => api.post("admin/extend", { token, seconds: -60 }))}>
                    −1 MIN
                  </PxButton>
                  <PxButton variant="red" disabled={!!busy} onClick={() => act("closed trading and settled", () => api.post("admin/end", { token }))}>
                    {busy === "closed trading and settled" ? <Spinner text="SETTLING" /> : "CLOSE NOW & SETTLE"}
                  </PxButton>
                </>
              )}
              {info?.secret && status !== "settled" && (
                <PxButton variant="ghost" small onClick={() => setPeek((r) => !r)}>
                  {peek ? "HIDE THE ANSWER" : "PEEK AT THE ANSWER"}
                </PxButton>
              )}
            </div>

            {status === "lobby" && (
              <div className="hint">
                Players can join, form teams, and pre-pick their flips now. Opening the window starts a {round.simSeconds}s
                clock; when it runs out the flips are dealt and trading opens by itself for {round.minutes} minutes. The
                coin settles itself at the bell. <b>Start trading now</b> skips the window: everyone gets the flips they
                have picked so far (zero if they haven't picked) and the book opens immediately.
              </div>
            )}

            {peek && info?.secret && (
              <div className="note">
                p = <b style={{ fontSize: 20 }}>{num(info.secret.p * 100, 2)}</b>
                {info.secret.pinned ? " (pinned by you)" : ""}.{" "}
                {info.secret.settlement === "flip"
                  ? `The final flip will come up ${info.secret.finalHeads ? "HEADS — shares pay $100" : "TAILS — shares pay $0"}.`
                  : `Every share will pay ${money(Math.round(info.secret.settleValue * 100))}.`}{" "}
                Do not say this out loud.
              </div>
            )}

            {status === "settled" && (
              <div className="good">
                Settled: p was <b>{num((round.p ?? 0) * 100, 2)}</b>
                {round.settlement === "flip" ? `, the final flip came up ${round.finalHeads ? "HEADS" : "TAILS"}` : ""} — every
                share paid {money(round.settleC)}. The leaderboard is final and the reveal has played.
              </div>
            )}
          </>
        )}
        {msg && <div className="good">{msg}</div>}
        {err && <div className="err">{err}</div>}
      </section>

      {/* ── the bandit lab and the projector ── */}
      <section className="panel">
        <div className="panel-title">
          🎰 BANDIT LAB · PROJECTOR
          <span className="right">{info?.llm ? "AI compiler on" : "no OPENAI_API_KEY — offline quick-compiler"}</span>
        </div>
        <div className="row">
          <PxButton
            variant={cfg.banditOpen ? "red" : "green"}
            small
            disabled={!!busy}
            onClick={() => act(cfg.banditOpen ? "closed the bandit lab" : "opened the bandit lab", () => api.post("admin/config", { token, banditOpen: !cfg.banditOpen }))}
          >
            {cfg.banditOpen ? "CLOSE THE LAB" : "OPEN THE LAB"}
          </PxButton>
          <span className="hint" style={{ margin: 0 }}>
            The lab is <b style={{ color: cfg.banditOpen ? "var(--green)" : "var(--red)" }}>{cfg.banditOpen ? "OPEN" : "CLOSED"}</b> — closed means nobody can compile or run.
          </span>
        </div>
        <div className="row mt">
          <span className="field-label" style={{ margin: 0 }}>
            BIG SCREEN SHOWS
          </span>
          {["market", "bandit"].map((v) => (
            <span key={v} className={`chip ${cfg.board === v ? "on" : ""}`} style={{ cursor: "pointer" }} onClick={() => act(`big screen → ${v}`, () => api.post("admin/config", { token, board: v }))}>
              {v === "market" ? "🪙 coin market" : "🎰 bandit leaderboard"}
            </span>
          ))}
        </div>

        <div className="mt">
          <BanditBoard rows={info?.bandit ?? []} limit={10} />
        </div>
        <div className="row">
          {clearArmed ? (
            <>
              <PxButton variant="red" small disabled={!!busy} onClick={() => act("cleared the bandit board", async () => { await api.post("admin/bandit/clear", { token, confirm: "CLEAR" }); setClearArmed(false); })}>
                YES — CLEAR THE BANDIT BOARD
              </PxButton>
              <PxButton variant="ghost" small onClick={() => setClearArmed(false)}>
                CANCEL
              </PxButton>
            </>
          ) : (
            <PxButton variant="ghost" small onClick={() => setClearArmed(true)}>
              CLEAR BANDIT BOARD
            </PxButton>
          )}
          <span className="hint" style={{ margin: 0 }}>Teams keep their saved strategies.</span>
        </div>
      </section>

      {/* ── new round ── */}
      <section className="panel">
        <div className="panel-title">SET UP A NEW COIN</div>

        <span className="field-label">HOW p IS DRAWN</span>
        <div className="difficulties">
          {(rules?.priorOrder ?? []).map((k) => (
            <div key={k} className={`diff ${prior === k ? "on" : ""}`} onClick={() => setPrior(k)}>
              <span className="dn">{rules.priors[k].name}</span>
              <span className="db">{rules.priors[k].blurb}</span>
            </div>
          ))}
        </div>

        <span className="field-label mt">WHAT A SHARE PAYS</span>
        <div className="difficulties">
          {(rules?.settlementOrder ?? []).map((k) => (
            <div key={k} className={`diff ${settlement === k ? "on" : ""}`} onClick={() => setSettlement(k)}>
              <span className="dn">{rules.settlements[k].name}</span>
              <span className="db">{rules.settlements[k].blurb}</span>
            </div>
          ))}
        </div>
        <div className="hint">Players are told both of these — they are the prior and the payoff, and the lecture is about using them.</div>

        <div className="admin-grid mt">
          <div>
            <span className="field-label">FLIP WINDOW (SECONDS)</span>
            <input type="number" min={10} max={900} step={10} value={simSeconds} onChange={(e) => setSimSeconds(e.target.value)} />
          </div>
          <div>
            <span className="field-label">TRADING (MINUTES)</span>
            <input type="number" min={0.5} max={180} step="0.5" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          <div>
            <span className="field-label">STARTING CASH ($)</span>
            <input type="number" min={100} max={100000} step={1000} value={startCash} onChange={(e) => setStartCash(e.target.value)} />
          </div>
          <div>
            <span className="field-label">ONE FLIP COSTS ($)</span>
            <input type="number" min={0} max={1000} step={10} value={simCost} onChange={(e) => setSimCost(e.target.value)} />
          </div>
          <div>
            <span className="field-label">EXTRA FLIP DURING TRADING ($)</span>
            <input type="number" min={0} max={10000} step={50} value={liveFlipCost} onChange={(e) => setLiveFlipCost(e.target.value)} />
          </div>
          <div>
            <span className="field-label">SHARES PER CLICK</span>
            <input type="number" min={1} max={50} step={1} value={defaultSize} onChange={(e) => setDefaultSize(e.target.value)} />
          </div>
          <div>
            <span className="field-label">PIN p (BLANK = RANDOM)</span>
            <input type="number" min={0} max={100} step="0.1" placeholder="0–100, e.g. 62" value={forceP} onChange={(e) => setForceP(e.target.value)} />
          </div>
        </div>
        <div className="hint">
          Pin p only for a worked example where you already want to know the answer. Any box left empty falls back to its
          default, never to zero.
        </div>

        <div className="row mt">
          <label className="row row--tight" style={{ cursor: "pointer" }}>
            <input type="checkbox" style={{ width: 18 }} checked={keepPlayers} onChange={(e) => setKeepPlayers(e.target.checked)} />
            <span>keep players and teams (fresh money; bandit strategies stay with their team)</span>
          </label>
        </div>
        <div className="row">
          <label className="row row--tight" style={{ cursor: "pointer" }}>
            <input type="checkbox" style={{ width: 18 }} checked={lateJoin} onChange={(e) => setLateJoin(e.target.checked)} />
            <span>allow joining after trading opens (late joiners get one flip purchase of their own)</span>
          </label>
        </div>

        <div className="mt">
          <PxButton
            variant="blue"
            disabled={!!busy}
            onClick={() =>
              act("built a new coin", () =>
                api.post("admin/round", { token, prior, settlement, simSeconds, minutes, startCash, simCost, liveFlipCost, defaultSize, forceP, keepPlayers, lateJoin })
              )
            }
          >
            {busy === "built a new coin" ? <Spinner text="BUILDING" /> : "BUILD ROUND"}
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
                <th style={{ textAlign: "right" }}>FLIPS</th>
                <th style={{ textAlign: "right" }}>HEADS</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(info?.players ?? []).map((p) => (
                <tr key={p.id} className={info.suspicious?.some((g) => g.some((x) => x.id === p.id)) ? "flag" : ""}>
                  <td>{p.name}</td>
                  <td style={{ color: "var(--muted)" }}>{p.team ?? "—"}</td>
                  <td className="n">{money(p.valueC)}</td>
                  <td className="n">{p.pos}</td>
                  <td className="n">{p.sims ?? <span style={{ color: "var(--dim)" }}>{p.simOrder} ordered</span>}</td>
                  <td className="n">{p.heads ?? "—"}</td>
                  <td>
                    <button
                      className="pxbtn pxbtn--ghost pxbtn--sm"
                      disabled={!!busy}
                      title={p.pos !== 0 ? "they are holding shares — they cannot be removed" : "remove this player"}
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
          <b>
            {info?.kv} {info?.persistent ? "" : "(NOT PERSISTENT)"}
          </b>
        </div>
        <div className="kv">
          <span>strategy compiler</span>
          <b>{info?.llm ? "AI (OPENAI_API_KEY set)" : "offline quick-compiler"}</b>
        </div>

        <div className="row mt">
          {resetArmed ? (
            <>
              <PxButton
                variant="red"
                disabled={!!busy}
                onClick={() =>
                  act("wiped the game", async () => {
                    await api.post("admin/reset", { token, confirm: "RESET" });
                    setResetArmed(false);
                  })
                }
              >
                {busy === "wiped the game" ? <Spinner text="WIPING" /> : "YES — WIPE EVERYTHING"}
              </PxButton>
              <PxButton variant="ghost" small onClick={() => setResetArmed(false)}>
                CANCEL
              </PxButton>
              <span className="hint" style={{ margin: 0 }}>
                Deletes the round, every player and team, the history, every saved strategy and the bandit board. Your
                password survives.
              </span>
            </>
          ) : (
            <PxButton variant="ghost" small onClick={() => setResetArmed(true)}>
              RESET EVERYTHING
            </PxButton>
          )}
        </div>

        <div className="row mt">
          <input type="password" placeholder="new admin password" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={{ maxWidth: 220 }} />
          <PxButton
            variant="ghost"
            small
            disabled={!!busy || newPw.length < 3}
            onClick={() =>
              act("changed the password", async () => {
                const r = await api.post("admin/password", { token, password: newPw });
                sessionStorage.setItem("w3admin", r.token);
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
