import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, loadPlayer, savePlayer, clearPlayer, withPlayer } from "./api.js";
import {
  PixelSprite,
  PxButton,
  clock,
  money,
  moneyShort,
  num,
  useMedia,
  NARROW,
  DELTA,
  DELTA_PALETTE,
} from "./components/PixelBits.jsx";
import Gate from "./components/Gate.jsx";
import Scope from "./components/Scope.jsx";
import OrderBook from "./components/OrderBook.jsx";
import YouPanel from "./components/YouPanel.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import Toasts, { fillToasts } from "./components/Toasts.jsx";
import Reveal from "./components/Reveal.jsx";
import Rules from "./components/Rules.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import BigBoard from "./components/BigBoard.jsx";
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
const SHOWN_KEY = "w2shownReveals";
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

function Floor() {
  const [player, setPlayer] = useState(loadPlayer);
  const [state, setState] = useState(null);
  const [config, setConfig] = useState(null);
  const [err, setErr] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(null);
  const [busyPx, setBusyPx] = useState(null);
  const [size, setSize] = useState(1);
  const [anchorX, setAnchorX] = useState(null);
  const [tab, setTab] = useState("floor");
  const [now, setNow] = useState(Date.now());
  const [reveal, setReveal] = useState(null);
  const [showReveal, setShowReveal] = useState(false);
  const [limits, setLimits] = useState(null);
  // Which round this player has actually stepped into. A new one never takes
  // the screen out from under them — they click through to it.
  const [entered, setEntered] = useState(null);
  // The gate is showing something the player has to dismiss themselves — the
  // team code. Without this the poll notices they now HAVE a team about a
  // second later and the whole gate unmounts mid-read, which is exactly what
  // it looked like: the code flashed up and vanished.
  const [gateHolding, setGateHolding] = useState(false);

  const narrow = useMedia(NARROW);
  const sinceRef = useRef(0);
  const shownRef = useRef(loadShown());
  const clockSkew = useRef(0);

  const push = useCallback((t) => setToasts((ts) => [...ts.slice(-4), t]), []);
  const drop = useCallback((key) => setToasts((ts) => ts.filter((t) => t.key !== key)), []);

  /* ── polling ────────────────────────────────────────────────────────── */

  const pull = useCallback(async () => {
    try {
      if (!player) {
        setConfig(await api.get("config"));
        setErr(null);
        return;
      }
      const s = await api.get("state", { ...withPlayer(player), since: sinceRef.current });
      clockSkew.current = s.round.serverNow - Date.now();
      if (s.fills.length) {
        // One trade, one notification: a click that eats three resting orders
        // is still one thing that happened.
        for (const t of fillToasts(s.fills)) push(t);
        for (const f of s.fills) sinceRef.current = Math.max(sinceRef.current, f.s);
      }
      setState(s);
      setConfig({ round: s.round });
      setErr(null);
    } catch (e) {
      if (e.status === 401) {
        clearPlayer();
        setPlayer(null);
        setState(null);
      } else if (e.code === "no-round") {
        setState(null);
        setConfig({ round: null });
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
      .then((r) => setLimits(r.limits))
      .catch(() => {});
  }, []);

  const round = state?.round ?? config?.round ?? null;
  const me = state?.me ?? null;
  const team = state?.team ?? null;
  const live = round?.status === "live";
  const settled = round?.status === "settled";
  const msLeft = round?.endsAt == null ? null : round.endsAt - (now + clockSkew.current);

  /* ── rounds coming and going ────────────────────────────────────────── */

  // First round we ever see is adopted silently; after that, a new round waits
  // behind a click so nobody is yanked out of a reveal they are still reading.
  useEffect(() => {
    if (!round?.roundId) return;
    if (entered === null) setEntered(round.roundId);
  }, [round?.roundId, entered]);

  const newRoundWaiting = round?.roundId && entered && round.roundId !== entered;

  const enterRound = () => {
    setEntered(round.roundId);
    setAnchorX(null);
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
      }
      return;
    }
    api
      .get("reveal")
      .then(setReveal)
      .catch(() => {});
  }, [settled, round?.roundId, reveal, newRoundWaiting]);

  useEffect(() => {
    if (me?.points?.length && !me.points.some((p) => p.x === anchorX)) {
      setAnchorX(me.points[me.points.length - 1].x);
    }
  }, [me?.points, anchorX]);

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

  const order = (side, px) => {
    setBusyPx(`${side}${px}`);
    return act(
      "order",
      async () => {
        // No optimistic toast here. The poll that follows carries the real
        // fills and announces them once; echoing it locally was the second
        // notification everybody was seeing.
        await api.post("order", withPlayer(player, { side, px, qty: size }));
      },
      `${side}${px}`
    );
  };

  const cancelLevel = (side, px) => act("cancel", () => api.post("cancel", withPlayer(player, { side, px })));
  const cancelOne = (orderId) => act("cancel", () => api.post("cancel", withPlayer(player, { orderId })));
  const cancelAll = () => act("cancel", () => api.post("cancel", withPlayer(player, { all: true })));

  const descend = (anchor, lr) =>
    act(
      "descend",
      async () => {
        const r = await api.post("descend", withPlayer(player, { anchorX: anchor, lr }));
        setAnchorX(r.point.x);
        push({
          key: `d-${r.point.x}-${Date.now()}`,
          kind: "win",
          title: "↓ ONE STEP DOWN",
          body: `x = ${num(r.point.x, 2)} · f = ${num(r.point.y, 2)}`,
        });
      },
      "descend"
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
        limits={limits}
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

  // A fresh round is up. Nothing changes on screen until they say so.
  if (newRoundWaiting) {
    return (
      <Shell>
        <div style={{ textAlign: "center" }}>
          <div className="dead-note" style={{ padding: "30px 20px 10px" }}>
            A NEW ROUND IS UP
            <br />
            <span style={{ color: "var(--dim)", fontSize: 9 }}>
              {round.status === "lobby" ? "NOT OPEN YET" : "ALREADY TRADING"}
            </span>
          </div>
          <div className="hint" style={{ marginBottom: 18 }}>
            Fresh money, a fresh curve, and your team intact. Take your time — the last board is still behind this.
          </div>
          <PxButton variant="green" onClick={enterRound}>
            NEXT →
          </PxButton>
        </div>
      </Shell>
    );
  }

  const mark = state.market.mark;
  const timerClass = msLeft == null ? "" : msLeft <= 0 ? "dead" : msLeft < 60_000 ? "warn" : "";
  const pnl = me.valueC - me.startC;

  return (
    <>
      <div className="wrap">
        <header className="site-header">
          <div className="logo-block">
            <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={3} />
            <div>
              <div className="title-main">{round.mode === "prediction" ? "DELTA MARKETS" : "GRADIENT TRADING"}</div>
              <div className="title-sub">WEEK 2 · {round.mode === "prediction" ? "PREDICTION" : "FIND THE FLOOR"}</div>
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
            <div className={`clockbox ${timerClass}`}>
              <i>
                {round.status === "settled"
                  ? "SETTLED"
                  : round.status === "ended"
                    ? "CLOSED"
                    : round.status === "lobby"
                      ? "PRE-OPEN"
                      : "TIME"}
              </i>
              <b>{msLeft == null ? "—:—" : clock(msLeft)}</b>
            </div>
          </div>
        </header>

        {round.status === "lobby" && (
          <div className="banner">
            The market has not opened yet. You are in — <b>{round.players}</b> player
            {round.players === 1 ? "" : "s"} across <b>{round.teams}</b> team{round.teams === 1 ? "" : "s"} so far.
          </div>
        )}
        {round.status === "ended" && <div className="banner red">Trading is closed. Waiting on the result…</div>}
        {settled && (
          <div className="banner">
            Settled at <b>{num(round.xStar, 2)}</b> — every share paid {money(round.settleC)}.{" "}
            <button className="pxbtn pxbtn--sm pxbtn--ghost" style={{ marginLeft: 8 }} onClick={() => setShowReveal(true)}>
              REPLAY
            </button>
          </div>
        )}
        {round.mode === "prediction" && round.question && (
          <div className="panel panel--tight">
            <div className="question">
              <small>THE QUESTION · SETTLES 0–100</small>
              {round.question}
            </div>
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
              {round.hasCurve && (
                <div className="panel">
                  <div className="panel-title">
                    WHAT YOU KNOW
                    <span className="right">
                      {me.points.length} point{me.points.length === 1 ? "" : "s"} walked
                    </span>
                  </div>
                  <Scope
                    points={me.points}
                    activeX={anchorX}
                    onPick={setAnchorX}
                    height={narrow ? 230 : 300}
                    revealCurve={reveal?.curve ?? null}
                    yStar={settled ? reveal?.yStar ?? null : null}
                    me={me}
                    onDescend={live ? descend : null}
                    busy={busy}
                    disabled={!live}
                    limits={limits}
                  />
                </div>
              )}

              <div className="panel">
                <div className="panel-title">
                  ORDER BOOK
                  <span className="right">
                    {state.market.volume} shares traded · ticks of {round.tick}
                  </span>
                </div>
                <OrderBook
                  book={state.market}
                  last={state.market.last}
                  me={me}
                  center={round.center}
                  tick={round.tick}
                  mine={me.orders}
                  size={size}
                  onSize={setSize}
                  onOrder={order}
                  onCancelLevel={cancelLevel}
                  onCancelAll={cancelAll}
                  disabled={!live || busy === "order"}
                  busyPx={busyPx}
                />
              </div>
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
              LEADERBOARD · BY TEAM
              <span className="right">{settled ? "final" : `marked at ${num(mark, 1)}`}</span>
            </div>
            <Leaderboard rows={state.leaderboard} myTeamId={me.teamId} settled={settled} />
          </div>
        )}

        {tab === "rules" && <Rules mode={round.mode} />}

        <div className="footer-note">
          DELTA · Discovering Econometrics: Learning Through Application ·{" "}
          <a href="/week2/board" target="_blank" rel="noreferrer">
            big screen ↗
          </a>
        </div>
      </div>

      <Toasts items={toasts} onExpire={drop} />

      {showReveal && reveal && (
        <Reveal
          reveal={reveal}
          points={me.points}
          leaderboard={state.leaderboard}
          myTeamId={me.teamId}
          onClose={() => setShowReveal(false)}
        />
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
            <div className="title-main">GRADIENT TRADING</div>
            <div className="title-sub">WEEK 2</div>
          </div>
        </div>
      </header>
      <div className="panel">{children}</div>
    </div>
  );
}
