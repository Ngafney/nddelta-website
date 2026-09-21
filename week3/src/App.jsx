import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, loadPlayer, savePlayer, clearPlayer, withPlayer } from "./api.js";
import { PixelSprite, PxButton, clock, money, moneyShort, num, DELTA, DELTA_PALETTE } from "./components/PixelBits.jsx";
import Gate from "./components/Gate.jsx";
import SimPanel from "./components/SimPanel.jsx";
import OrderBook from "./components/OrderBook.jsx";
import YouPanel from "./components/YouPanel.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import Toasts, { fillToasts } from "./components/Toasts.jsx";
import Reveal from "./components/Reveal.jsx";
import Rules from "./components/Rules.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import BigBoard from "./components/BigBoard.jsx";
import BanditLab from "./components/BanditLab.jsx";
import StaleBuild from "./components/StaleBuild.jsx";

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "");
  const page = path.endsWith("/admin") ? <AdminPanel /> : path.endsWith("/board") ? <BigBoard /> : <Floor />;
  return (
    <>
      {/* A tab left open across a redeploy runs old code forever unless
          something tells it. This does. */}
      <StaleBuild />
      {page}
    </>
  );
}

/** Reveals already played on this browser, so a refresh does not replay one. */
const SHOWN_KEY = "w3shownReveals";
const loadShown = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY)) ?? []);
  } catch {
    return new Set();
  }
};
const markShown = (set, key) => {
  set.add(key);
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...set].slice(-40)));
  } catch {}
};

const GAME_KEY = "w3game";

function Floor() {
  const [player, setPlayer] = useState(loadPlayer);
  const [state, setState] = useState(null);
  const [config, setConfig] = useState(null);
  const [err, setErr] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(null);
  const [busyPx, setBusyPx] = useState(null);
  // null means "use whatever the round says".
  const [sizePick, setSizePick] = useState(null);
  const [game, setGameRaw] = useState(() => {
    try {
      return localStorage.getItem(GAME_KEY) || "market";
    } catch {
      return "market";
    }
  });
  const [tab, setTab] = useState("floor");
  const [now, setNow] = useState(Date.now());
  const [reveal, setReveal] = useState(null);
  const [showReveal, setShowReveal] = useState(false);
  const [rules, setRules] = useState(null);
  // Which round this player has actually stepped into. A new one never takes
  // the screen out from under them — they click through to it.
  const [entered, setEntered] = useState(null);
  // The gate is showing the team code; keep it mounted until dismissed.
  const [gateHolding, setGateHolding] = useState(false);

  const sinceRef = useRef(0);
  const shownRef = useRef(loadShown());
  const clockSkew = useRef(0);

  const setGame = (g) => {
    setGameRaw(g);
    try {
      localStorage.setItem(GAME_KEY, g);
    } catch {}
    window.scrollTo({ top: 0 });
  };

  const push = useCallback((t) => setToasts((ts) => [...ts.slice(-4), t]), []);
  const drop = useCallback((key) => setToasts((ts) => ts.filter((t) => t.key !== key)), []);

  /* ── polling ────────────────────────────────────────────────────────── */

  const pull = useCallback(async () => {
    try {
      const cfg = await api.get("config");
      if (!player) {
        setConfig(cfg);
        setErr(null);
        return;
      }
      const s = await api.get("state", { ...withPlayer(player), since: sinceRef.current });
      clockSkew.current = s.round.serverNow - Date.now();
      if (s.fills.length) {
        for (const t of fillToasts(s.fills)) push(t);
        for (const f of s.fills) sinceRef.current = Math.max(sinceRef.current, f.s);
      }
      setState(s);
      setConfig({ ...cfg, round: s.round });
      setErr(null);
    } catch (e) {
      if (e.status === 401) {
        clearPlayer();
        setPlayer(null);
        setState(null);
      } else if (e.code === "no-round") {
        setState(null);
        setConfig((c) => ({ ...(c ?? {}), round: null }));
      } else {
        setErr(e.message);
      }
    }
  }, [player, push]);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    const loop = async () => {
      if (stopped) return;
      await pull();
      if (stopped) return;
      timer = setTimeout(loop, document.visibilityState === "visible" ? 950 : 4000);
    };
    loop();
    const onVis = () => document.visibilityState === "visible" && pull();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pull]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api
      .get("rules")
      .then(setRules)
      .catch(() => {});
  }, []);

  const round = state?.round ?? config?.round ?? null;
  const me = state?.me ?? null;
  const team = state?.team ?? null;
  const live = round?.status === "live";
  const settled = round?.status === "settled";
  const msLeft = round?.endsAt == null ? null : round.endsAt - (now + clockSkew.current);

  /* ── rounds coming and going ────────────────────────────────────────── */

  useEffect(() => {
    if (!round?.roundId) return;
    if (entered === null) setEntered(round.roundId);
  }, [round?.roundId, entered]);

  const newRoundWaiting = round?.roundId && entered && round.roundId !== entered;

  const enterRound = () => {
    setEntered(round.roundId);
    setSizePick(null);
    sinceRef.current = 0;
    setReveal(null);
    setShowReveal(false);
    setTab("floor");
  };

  /* ── the reveal ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!settled || !round?.roundId || newRoundWaiting) return;
    const key = `${round.roundId}:settled`;
    if (reveal?.roundId === round.roundId) {
      if (!shownRef.current.has(key)) {
        markShown(shownRef.current, key);
        setShowReveal(true);
        setGame("market");
      }
      return;
    }
    api
      .get("reveal")
      .then(setReveal)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, round?.roundId, reveal, newRoundWaiting]);

  /* ── actions ────────────────────────────────────────────────────────── */

  const act = useCallback(
    async (label, fn, tag) => {
      setBusy(tag ?? label);
      setErr(null);
      try {
        await fn();
        await pull();
      } catch (e) {
        setErr(e.message);
        push({ key: `err-${Date.now()}-${Math.random()}`, kind: "bad", title: "✕ REJECTED", body: e.message, ttl: 6000 });
      } finally {
        setBusy(null);
        setBusyPx(null);
      }
    },
    [pull, push]
  );

  const size = sizePick ?? round?.defaultSize ?? 1;

  const order = (side, px) => {
    setBusyPx(`${side}${px}`);
    return act(
      "order",
      async () => {
        const res = await api.post("order", withPlayer(player, { side, px, qty: size }));
        if (res?.canceled > 0) {
          push({
            key: `ioc-${Date.now()}`,
            kind: "bad",
            title: `${res.filled} FILLED · ${res.canceled} CANCELED`,
            body: "your balance could not carry the rest, so it was not left resting",
            ttl: 7000,
          });
        }
      },
      `${side}${px}`
    );
  };

  const cancelLevel = (side, px) => act("cancel", () => api.post("cancel", withPlayer(player, { side, px })));
  const cancelOne = (orderId) => act("cancel", () => api.post("cancel", withPlayer(player, { orderId })));
  const cancelAll = () => act("cancel", () => api.post("cancel", withPlayer(player, { all: true })));
  const orderSims = (n) => act("sims", () => api.post("sims/order", withPlayer(player, { n })), "sims");
  const lateSims = (n) =>
    act(
      "sims",
      async () => {
        const r = await api.post("sims/late", withPlayer(player, { n }));
        push({ key: `sims-${Date.now()}`, kind: "win", title: "🪙 FLIPPED", body: `${r.sims.heads} heads in ${r.sims.n} flips` });
      },
      "sims"
    );

  /* ── gates ──────────────────────────────────────────────────────────── */

  if (!round) {
    return (
      <Shell>
        <div className="dead-note">
          NO ROUND IS OPEN
          <br />
          <span style={{ color: "var(--dim)", fontSize: 9 }}>WAIT FOR THE ADMIN TO SET ONE UP</span>
        </div>
      </Shell>
    );
  }

  if (!player || (state && !me?.teamId) || gateHolding) {
    return (
      <Gate
        player={player}
        round={round}
        limits={rules?.limits}
        team={state?.team ?? null}
        onPlayer={(p) => {
          savePlayer(p);
          setPlayer(p);
        }}
        onHold={setGateHolding}
        onTeam={() => {
          setGateHolding(false);
          pull();
        }}
      />
    );
  }

  if (!state) {
    return (
      <Shell>
        <div className="dead-note">CONNECTING…</div>
      </Shell>
    );
  }

  if (newRoundWaiting) {
    return (
      <Shell>
        <div style={{ textAlign: "center" }}>
          <div className="dead-note" style={{ padding: "30px 20px 10px" }}>
            A NEW ROUND IS UP
            <br />
            <span style={{ color: "var(--dim)", fontSize: 9 }}>
              {round.status === "lobby" ? "NOT OPEN YET" : round.status === "sims" ? "CHOOSE YOUR FLIPS" : "ALREADY TRADING"}
            </span>
          </div>
          <div className="hint" style={{ marginBottom: 18 }}>
            Fresh money, a fresh coin, and your team intact. Take your time — the last board is still behind this.
          </div>
          <PxButton variant="green" onClick={enterRound}>
            NEXT →
          </PxButton>
        </div>
      </Shell>
    );
  }

  const mark = state.market.mark;
  const timerClass = msLeft == null ? "" : msLeft <= 0 ? "dead" : msLeft < 30_000 ? "warn" : "";
  const pnl = me.valueC - me.startC;
  const prior = rules?.priors?.[round.prior] ?? null;
  const banditOpen = config?.banditOpen !== false;

  return (
    <>
      <div className="wrap">
        <header className="site-header">
          <div className="logo-block">
            <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={3} />
            <div>
              <div className="title-main">COIN FLIPS</div>
              <div className="title-sub">WEEK 3 · PROBABILITY</div>
            </div>
          </div>
          <div className="header-right">
            {team && (
              <div className="badge">
                <span>TEAM</span>
                {team.name}
              </div>
            )}
            {team && round.status !== "settled" && (
              <div className="badge badge--code" title="read this out to add a team-mate">
                <span>CODE</span>
                {team.code}
              </div>
            )}
            {game === "market" && (
              <div className={`clockbox ${timerClass}`}>
                <i>
                  {round.status === "settled"
                    ? "SETTLED"
                    : round.status === "sims"
                      ? "FLIPS LOCK"
                      : round.status === "lobby"
                        ? "PRE-OPEN"
                        : "TRADING"}
                </i>
                <b>{msLeft == null ? "—:—" : clock(msLeft)}</b>
              </div>
            )}
          </div>
        </header>

        <div className="gameswitch">
          <button className={game === "market" ? "on" : ""} onClick={() => setGame("market")}>
            <span className="gi">🪙</span>
            <span>
              <span className="gn">COIN MARKET</span>
              <span className="gd">
                {round.status === "sims"
                  ? `choose your flips · ${clock(msLeft ?? 0)}`
                  : round.status === "live"
                    ? "trading now"
                    : round.status === "settled"
                      ? "settled"
                      : "opens soon"}
              </span>
            </span>
          </button>
          <button className={game === "bandit" ? "on" : ""} onClick={() => setGame("bandit")}>
            <span className="gi">🎰</span>
            <span>
              <span className="gn">BANDIT LAB</span>
              <span className="gd">{banditOpen ? "5 coins · 100 flips · write a strategy" : "closed"}</span>
            </span>
          </button>
        </div>

        {game === "bandit" ? (
          <BanditLab player={player} team={team} open={banditOpen} llm={!!config?.llm} />
        ) : (
          <>
            {round.status === "lobby" && (
              <div className="banner">
                The coin market hasn't opened yet — <b>{round.players}</b> player{round.players === 1 ? "" : "s"} across{" "}
                <b>{round.teams}</b> team{round.teams === 1 ? "" : "s"} so far. You can already pick how many flips you
                want below.
              </div>
            )}
            {round.status === "sims" && (
              <div className="banner">
                <b>Choose your flips.</b> Trading opens in <b>{clock(msLeft ?? 0)}</b>, the moment your flips are dealt.
              </div>
            )}
            {settled && (
              <div className="banner">
                p was <b>{num((round.p ?? 0) * 100, 2)}</b>
                {round.settlement === "flip" ? ` · the final flip came up ${round.finalHeads ? "HEADS" : "TAILS"}` : ""} —
                every share paid {money(round.settleC)}.{" "}
                <button className="pxbtn pxbtn--sm pxbtn--ghost" style={{ marginLeft: 8 }} onClick={() => setShowReveal(true)}>
                  REPLAY
                </button>
              </div>
            )}

            <div className="mobilebar">
              <div>
                <i>CASH</i>
                <b>{moneyShort(me.cashC)}</b>
              </div>
              <div>
                <i>SHARES</i>
                <b className={me.pos > 0 ? "long" : me.pos < 0 ? "short" : ""}>
                  {me.pos > 0 ? "+" : ""}
                  {me.pos}
                </b>
              </div>
              <div>
                <i>{settled ? "FINAL" : "P&L"}</i>
                <b className={pnl > 0 ? "up" : pnl < 0 ? "down" : ""}>{money(pnl, { sign: true })}</b>
              </div>
            </div>

            <nav className="tabbar">
              <button className={`tab ${tab === "floor" ? "active" : ""}`} onClick={() => setTab("floor")}>
                <span className="ico">📈</span>FLOOR
              </button>
              <button className={`tab ${tab === "board" ? "active" : ""}`} onClick={() => setTab("board")}>
                <span className="ico">🏆</span>LEADERBOARD
              </button>
              <button className={`tab ${tab === "rules" ? "active" : ""}`} onClick={() => setTab("rules")}>
                <span className="ico">📖</span>RULES
              </button>
            </nav>

            {err && <div className="err">{err}</div>}

            {tab === "floor" && (
              <div className="floor">
                <div>
                  <SimPanel round={round} me={me} prior={prior} onOrder={orderSims} onLate={lateSims} busy={busy} />

                  {round.status !== "lobby" && round.status !== "sims" && (
                    <div className="panel">
                      <div className="panel-title">
                        STEP 2 · ORDER BOOK
                        <span className="right">
                          {state.market.volume} shares traded ·{" "}
                          {round.settlement === "flip" ? "settles 100 or 0 on one flip" : "settles at 100 × p"}
                        </span>
                      </div>
                      <OrderBook
                        book={state.market}
                        last={state.market.last}
                        me={me}
                        center={round.center}
                        tick={round.tick}
                        lo={round.orderMin}
                        hi={round.orderMax}
                        mine={me.orders}
                        size={size}
                        onSize={setSizePick}
                        onOrder={order}
                        onCancelLevel={cancelLevel}
                        onCancelAll={cancelAll}
                        disabled={!live || busy === "order" || me.canBuyLate}
                        busyPx={busyPx}
                      />
                    </div>
                  )}
                </div>

                <div className="floor-side">
                  <YouPanel me={me} team={team} mark={mark} settled={settled} onCancel={cancelOne} onCancelAll={cancelAll} />

                  <div className="panel panel--tight">
                    <div className="panel-title">TAPE</div>
                    <div className="tape">
                      {state.market.tape.length === 0 && <div className="hint">No trades yet.</div>}
                      {state.market.tape.map((t) => (
                        <div key={t.s} className={`tape-row ${t.aggr}`}>
                          <span className="p">{t.px}</span>
                          <span className="q">
                            {t.qty} share{t.qty > 1 ? "s" : ""}
                          </span>
                          <span className="t">{new Date(t.ts).toLocaleTimeString([], { hour12: false })}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === "board" && (
              <div className="panel">
                <div className="panel-title">
                  COIN MARKET · BY TEAM
                  <span className="right">{settled ? "final" : `marked at ${num(mark, 1)}`}</span>
                </div>
                <Leaderboard rows={state.leaderboard} myTeamId={me.teamId} settled={settled} />
              </div>
            )}

            {tab === "rules" && <Rules rules={rules} round={round} />}
          </>
        )}

        <div className="footer-note">
          DELTA · Discovering Econometrics: Learning Through Application ·{" "}
          <a href="/week3/board" target="_blank" rel="noreferrer">
            big screen ↗
          </a>
        </div>
      </div>

      <Toasts items={toasts} onExpire={drop} />

      {showReveal && reveal && (
        <Reveal reveal={reveal} me={me} leaderboard={state.leaderboard} myTeamId={me.teamId} onClose={() => setShowReveal(false)} />
      )}
    </>
  );
}

function Shell({ children }) {
  return (
    <div className="wrap wrap--narrow">
      <header className="site-header">
        <div className="logo-block">
          <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={3} />
          <div>
            <div className="title-main">COIN FLIPS</div>
            <div className="title-sub">WEEK 3</div>
          </div>
        </div>
      </header>
      <div className="panel">{children}</div>
    </div>
  );
}
