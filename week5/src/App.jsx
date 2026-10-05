import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, loadPlayer, savePlayer, clearPlayer, withPlayer } from "./api.js";
import { clock, Spinner } from "./components/PixelBits.jsx";
import Gate from "./components/Gate.jsx";
import OrderBook from "./components/OrderBook.jsx";
import YouPanel from "./components/YouPanel.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import Toasts, { fillToasts } from "./components/Toasts.jsx";
import Reveal from "./components/Reveal.jsx";
import Rules from "./components/Rules.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import BigBoard from "./components/BigBoard.jsx";
import DataPanel from "./components/DataPanel.jsx";
import HorizonChart, { ChartHeader } from "./components/HorizonChart.jsx";
import StaleBuild from "./components/StaleBuild.jsx";

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "");
  const page = path.endsWith("/admin") ? <AdminPanel /> : path.endsWith("/board") ? <BigBoard /> : <Floor />;
  return (
    <>
      <StaleBuild />
      <Boundary>{page}</Boundary>
    </>
  );
}

/**
 * A render crash unmounts the whole tree and leaves a black page. During a live
 * round that looks exactly like the network dying, so say what happened.
 */
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, where: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error("[week5] render crashed", err, info?.componentStack);
    this.setState({ where: info?.componentStack ?? null });
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="shell">
        <div className="dead-note">
          SOMETHING BROKE
          <br />
          <span style={{ color: "var(--dim)", fontSize: 9 }}>{String(this.state.err?.message ?? this.state.err)}</span>
          {this.state.where && <pre className="crash-where">{this.state.where.split("\n").slice(0, 6).join("\n")}</pre>}
          <br />
          <button className="pxbtn pxbtn--green" onClick={() => window.location.reload()}>
            RELOAD
          </button>
        </div>
      </div>
    );
  }
}

const SHOWN_KEY = "w5shownReveals";
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

/** `initial` seeds the first render (the render test uses it); the poll takes over from there. */
export function Floor({ initial = null } = {}) {
  const [player, setPlayer] = useState(() => initial?.player ?? loadPlayer());
  const [state, setState] = useState(initial?.state ?? null);
  const [config, setConfig] = useState(initial?.state ? { round: initial.state.round } : null);
  const [err, setErr] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [busy, setBusy] = useState(null);
  const [busyPx, setBusyPx] = useState(null);
  const [sizePick, setSizePick] = useState(null);
  const [tab, setTab] = useState(initial?.tab ?? "market");
  const [showRules, setShowRules] = useState(false);
  const [gateHolding, setGateHolding] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [showReveal, setShowReveal] = useState(false);
  const [now, setNow] = useState(Date.now());
  const shown = useRef(loadShown());
  const sinceRef = useRef(0);
  const clockSkew = useRef(0);
  const nextTickAt = useRef(null);

  const push = useCallback((t) => {
    setToasts((cur) => [...cur.filter((x) => x.key !== t.key), t].slice(-4));
  }, []);
  const expire = useCallback((key) => {
    setToasts((cur) => cur.filter((x) => x.key !== key));
  }, []);

  const pull = useCallback(async () => {
    try {
      if (!player) {
        const c = await api.get("config");
        if (c.round?.serverNow) clockSkew.current = c.round.serverNow - Date.now();
        setConfig(c);
        setErr(null);
        return;
      }
      const s = await api.get("state", { ...withPlayer(player), since: sinceRef.current });
      // Line the client's clock up with the server's, as week 3's board does,
      // so the countdown to the next print is the server's countdown.
      clockSkew.current = s.round.serverNow - Date.now();
      nextTickAt.current = s.round.nextTickAt;
      if (s.fills.length) {
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

  // Poll about once a second, and right after the next print is due, so a new
  // tick lands on screen within a few tens of milliseconds of printing.
  useEffect(() => {
    let stopped = false;
    let timer = null;
    const loop = async () => {
      if (stopped) return;
      await pull();
      if (stopped) return;
      let wait = document.visibilityState === "visible" ? 950 : 4000;
      if (nextTickAt.current != null) {
        const due = nextTickAt.current - (Date.now() + clockSkew.current) + 60;
        if (due > 0 && due < wait) wait = due;
      }
      timer = setTimeout(loop, wait);
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

  const round = config?.round ?? null;

  /* The reveal plays once per round on a given device. */
  useEffect(() => {
    if (round?.status !== "settled" || !player) return undefined;
    const key = `reveal-${round.roundId}`;
    if (shown.current.has(key)) return undefined;
    let gone = false;
    api
      .get("reveal")
      .then((r) => {
        if (gone) return;
        markShown(shown.current, key);
        setReveal(r);
        setShowReveal(true);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [round?.status, round?.roundId, player]);

  const act = async (label, fn, pxKey) => {
    setBusy(label);
    if (pxKey) setBusyPx(pxKey);
    try {
      await fn();
      await pull();
    } catch (e) {
      push({ key: `err-${Date.now()}-${Math.random()}`, kind: "bad", title: "✕ REJECTED", body: e.message, ttl: 6500 });
    } finally {
      setBusy(null);
      setBusyPx(null);
    }
  };

  const size = sizePick ?? round?.defaultSize ?? 1;

  const order = (side, px) =>
    act(
      `${side}${px}`,
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
  const cancelLevel = (side, px) => act("cancel", () => api.post("cancel", withPlayer(player, { side, px })));
  const cancelOne = (orderId) => act("cancel", () => api.post("cancel", withPlayer(player, { orderId })));
  const cancelAll = () => act("cancel", () => api.post("cancel", withPlayer(player, { all: true })));

  /* ── gates ─────────────────────────────────────────────────────────── */

  const serverNow = now + clockSkew.current;
  const msLeft = round?.endsAt != null ? Math.max(0, round.endsAt - serverNow) : null;

  if (!round) {
    return (
      <Shell>
        <div className="dead-note">
          NO ROUND IS OPEN
          <br />
          <span style={{ color: "var(--dim)", fontSize: 9 }}>WAIT FOR THE HOST TO SET ONE UP</span>
        </div>
      </Shell>
    );
  }

  if (!player || (state && !state.me?.teamId) || gateHolding) {
    return (
      <Shell round={round} msLeft={msLeft}>
        <Gate
          round={round}
          player={player}
          me={state?.me ?? null}
          team={state?.team ?? null}
          limits={{ teamSize: round?.teamSize ?? 4 }}
          onPlayer={(p) => {
            savePlayer(p);
            setPlayer(p);
          }}
          onHold={setGateHolding}
          onDone={() => {
            setGateHolding(false);
            pull();
          }}
        />
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell round={round} msLeft={msLeft}>
        <div className="dead-note">
          <Spinner text="JOINING" />
        </div>
      </Shell>
    );
  }

  if (showReveal && reveal) {
    return (
      <Reveal
        reveal={reveal}
        me={state.me}
        leaderboard={reveal.leaderboard ?? state.leaderboard}
        myTeamId={state.team?.id}
        onClose={() => setShowReveal(false)}
      />
    );
  }

  const me = state.me;
  const tradingShut = round.status !== "live";
  const msToNext = round.nextTickAt != null ? round.nextTickAt - serverNow : null;

  return (
    <Shell round={round} msLeft={msLeft}>
      <Toasts items={toasts} onExpire={expire} />
      {showRules && <Rules onClose={() => setShowRules(false)} />}

      <div className="floor-tabs">
        {[
          ["market", "MARKET"],
          ["data", `DATA${round.status === "lobby" ? "" : ` · ${round.H + (round.tickNow ?? 0)}`}`],
          ["board", "LEADERBOARD"],
        ].map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        <button className="ghost" onClick={() => setShowRules(true)}>
          RULES
        </button>
        {round.status === "settled" && reveal && (
          <button className="ghost" onClick={() => setShowReveal(true)}>
            REPLAY THE REVEAL
          </button>
        )}
      </div>

      {tab === "market" && (
        <div className="h-floor">
          <div className="h-left">
            <section className="panel panel--tight">
              <HorizonChart
                series={state.series}
                K={round.K}
                T={round.T}
                height={300}
                header={<ChartHeader round={round} series={state.series} msToNext={msToNext} />}
              />
            </section>
            {tradingShut && (
              <div className="shut-note">
                {round.status === "research"
                  ? `RESEARCH — the book opens in ${clock(msLeft ?? 0)}. Get the data from the DATA tab.`
                  : round.status === "lobby"
                    ? "WAITING FOR THE HOST"
                    : `SETTLED — Y_T = ${round.yT?.toFixed(2)} ${round.xStar === 100 ? ">" : "≤"} K = ${round.K}, so a share paid $${round.xStar}`}
              </div>
            )}
            <YouPanel
              me={me}
              team={state.team}
              mark={state.market.mark}
              settled={round.status === "settled"}
              onCancel={cancelOne}
              onCancelAll={cancelAll}
            />
          </div>
          <section className="panel h-right">
            <div className="panel-title">
              Y<sub>{round.T}</sub> &gt; {round.K}?
              <span className="right">
                {round.naiveDesk ? "naive desk quoting" : ""}
                {round.noiseDesks ? ` · ${round.noiseDesks} noise desks` : ""}
              </span>
            </div>
            <OrderBook
              book={state.market}
              last={state.market.last}
              me={me}
              center={round.center}
              tick={round.priceTick}
              lo={round.orderMin}
              hi={round.orderMax}
              mine={me.orders}
              size={size}
              onSize={setSizePick}
              onOrder={order}
              onCancelLevel={cancelLevel}
              onCancelAll={cancelAll}
              disabled={tradingShut || !!busy}
              busyPx={busyPx}
            />
          </section>
        </div>
      )}

      {tab === "data" && <DataPanel player={player} round={round} />}
      {tab === "board" && (
        <section className="panel">
          <div className="panel-title">LEADERBOARD</div>
          <Leaderboard rows={state.leaderboard} myTeamId={state.team?.id} settled={round.status === "settled"} />
        </section>
      )}

      {err && <div className="err-strip">{err}</div>}
    </Shell>
  );
}

function Shell({ children, round, msLeft }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <span>
            ND DELTA <b>WEEK 5</b>
          </span>
          <small>THE HORIZON MARKET</small>
        </div>
        {round && (
          <div className="topstate">
            <span className={`phase ${round.status}`}>{round.phase}</span>
            {msLeft != null && <span className="clock">{clock(msLeft)}</span>}
            {round.status !== "lobby" && (
              <span className="dim">
                tick {round.tickNow ?? 0}/{round.T}
              </span>
            )}
            <span className="dim">
              {round.players} players · {round.teams} teams
            </span>
          </div>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}
