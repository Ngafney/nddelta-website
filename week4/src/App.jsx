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
import Orrery from "./components/Orrery.jsx";
import DataPanel from "./components/DataPanel.jsx";
import StaleBuild from "./components/StaleBuild.jsx";

const MARKETS = ["north", "south"];
const META = {
  north: { name: "NORTH", blurb: "lands north of the equator" },
  south: { name: "SOUTH", blurb: "lands south of the equator" },
};

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
 * A render crash in React unmounts the whole tree, and what is left is an
 * empty black page with nothing to click and nothing to read. During a live
 * round that is indistinguishable from the network dying. Say what happened
 * and offer the one thing that usually fixes it.
 */
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    // Left in on purpose: this is the only breadcrumb when it happens to
    // somebody else's phone in the middle of a lecture.
    console.error("[week4] render crashed", err);
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="shell">
        <div className="dead-note">
          SOMETHING BROKE
          <br />
          <span style={{ color: "var(--dim)", fontSize: 9 }}>{String(this.state.err?.message ?? this.state.err)}</span>
          <br />
          <br />
          <button className="pxbtn pxbtn--green" onClick={() => window.location.reload()}>
            RELOAD
          </button>
        </div>
      </div>
    );
  }
}

const SHOWN_KEY = "w4shownReveals";
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
  const [sizePick, setSizePick] = useState(null);
  const [tab, setTab] = useState("trade");
  const [showRules, setShowRules] = useState(false);
  const [gateHolding, setGateHolding] = useState(false);
  const [entered, setEntered] = useState(null);
  const [reveal, setReveal] = useState(null);
  const shown = useRef(loadShown());
  const sinceRef = useRef(0);
  const clockSkew = useRef(0);
  const timers = useRef(new Map());
  /** The release index this device has already shouted about. */
  const announced = useRef(0);

  const push = useCallback((t) => {
    setToasts((cur) => [...cur.filter((x) => x.key !== t.key), t].slice(-4));
    const old = timers.current.get(t.key);
    if (old) clearTimeout(old);
    timers.current.set(
      t.key,
      setTimeout(() => {
        setToasts((cur) => cur.filter((x) => x.key !== t.key));
        timers.current.delete(t.key);
      }, t.ttl ?? 5200)
    );
  }, []);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach(clearTimeout);
  }, []);

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

  const round = config?.round ?? null;
  const released = round?.released ?? 0;

  /* A new release is the most important thing that happens mid-round, so it
     gets the loudest thing the app has — and fires exactly once per batch. */
  useEffect(() => {
    if (!released) return;
    if (announced.current === 0) {
      announced.current = released;
      return;
    }
    if (released > announced.current) {
      announced.current = released;
      const rel = round?.releaseLog?.[released - 1];
      push({
        key: `release-${released}`,
        kind: "release",
        title: `NEW DATA · RELEASE ${released}`,
        body: rel
          ? `${rel.rows} more observations, up to ${rel.leadDays} days before impact`
          : "the record just grew",
        ttl: 14000,
      });
    }
  }, [released, round, push]);

  /* The reveal plays once per round on a given device. */
  useEffect(() => {
    if (round?.status !== "settled") return;
    const key = `reveal-${round.roundId}`;
    if (shown.current.has(key)) return;
    let gone = false;
    api
      .get("reveal")
      .then((r) => {
        if (gone) return;
        markShown(shown.current, key);
        setReveal(r);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [round?.status, round?.roundId]);

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

  const order = (market, side, px) =>
    act(
      `${market}${side}${px}`,
      async () => {
        const res = await api.post("order", withPlayer(player, { market, side, px, qty: size }));
        // A cancelled remainder is not a fill, so the poll will never mention
        // it. Say it here, once, or the shares quietly vanish.
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
      `${market}${side}${px}`
    );

  const cancelLevel = (market, side, px) =>
    act("cancel", () => api.post("cancel", withPlayer(player, { market, side, px })));
  const cancelAll = (market) => act("cancel", () => api.post("cancel", withPlayer(player, { all: true, market })));

  /* ── gates ─────────────────────────────────────────────────────────── */

  if (!round) {
    return (
      <Shell>
        <div className="dead-note">
          NO ROUND IS OPEN
          <br />
          <span style={{ color: "var(--dim)", fontSize: 9 }}>WAIT FOR THE OPERATOR TO SET ONE UP</span>
        </div>
      </Shell>
    );
  }

  // `state &&` rather than `!state?...`: on a slow first poll a returning
  // player already on a team would otherwise see the gate flash past.
  if (!player || (state && !state.me?.teamId) || gateHolding) {
    return (
      <Shell round={round}>
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
            // Lower the hold FIRST. The gate is held mounted on purpose while
            // the code is on screen, and nothing else ever lowers it: the
            // effect that would is inside the component the hold keeps alive.
            setGateHolding(false);
            pull();
          }}
        />
      </Shell>
    );
  }

  if (round.status === "settled" && entered !== round.roundId && reveal) {
    return <Reveal data={reveal} onNext={() => setEntered(round.roundId)} />;
  }

  // The poll has not come back yet. Without this the render falls through to
  // the floor and reads `state.me` off null, which is a blank page and no
  // explanation -- exactly what a player sees in the second after they join.
  if (!state) {
    return (
      <Shell round={round}>
        <div className="dead-note">
          <Spinner text="JOINING" />
        </div>
      </Shell>
    );
  }

  const me = state.me;
  const msLeft = round.endsAt ? Math.max(0, round.endsAt - (Date.now() + clockSkew.current)) : null;
  const tradingShut = round.status !== "live";

  return (
    <Shell round={round} msLeft={msLeft}>
      <Toasts toasts={toasts} />
      {showRules && <Rules onClose={() => setShowRules(false)} />}

      <div className="floor-tabs">
        {[
          ["trade", "MARKETS"],
          ["data", `DATA${released ? ` · ${released}` : ""}`],
          ["sky", "ORRERY"],
          ["board", "LEADERBOARD"],
        ].map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        <button className="ghost" onClick={() => setShowRules(true)}>
          RULES
        </button>
      </div>

      {tab === "trade" && (
        <>
          <YouPanel me={me} team={state.team} markets={state.markets} round={round} />
          {tradingShut && (
            <div className="shut-note">
              {round.status === "research"
                ? "RESEARCH WINDOW — the books open when the operator says so"
                : round.status === "lobby"
                ? "WAITING FOR THE OPERATOR"
                : "THE BOOKS ARE SHUT — the asteroid is arriving"}
            </div>
          )}
          <PairHint markets={state.markets} />
          <div className="twobooks">
            {MARKETS.map((m) => (
              <section key={m} className={`bookcol ${m}`}>
                <header className="bookhead">
                  <h2>{META[m].name}</h2>
                  <small>{META[m].blurb}</small>
                </header>
                <OrderBook
                  book={state.markets[m]}
                  last={state.markets[m].last}
                  me={{ pos: me.pos[m], buyC: me.freeC, valueC: me.valueC, startC: me.startC }}
                  center={round.center}
                  tick={round.tick}
                  lo={round.orderMin}
                  hi={round.orderMax}
                  mine={me.orders.filter((o) => o.market === m)}
                  size={size}
                  onSize={setSizePick}
                  onOrder={(side, px) => order(m, side, px)}
                  onCancelLevel={(side, px) => cancelLevel(m, side, px)}
                  onCancelAll={() => cancelAll(m)}
                  disabled={tradingShut || !!busy}
                  busyPx={busyPx}
                />
              </section>
            ))}
          </div>
        </>
      )}

      {tab === "data" && <DataPanel player={player} round={round} onToast={push} />}
      {tab === "sky" && <Orrery player={player} round={round} />}
      {tab === "board" && <Leaderboard me={me} team={state.team} />}

      {err && <div className="err-strip">{err}</div>}
    </Shell>
  );
}

/**
 * The two books are one question asked twice, so the two prices should add to
 * a hundred. When they do not, somebody in the room is wrong, and saying so
 * out loud is the fastest way to teach what a prediction market price means.
 */
function PairHint({ markets }) {
  const n = markets?.north?.mark;
  const s = markets?.south?.mark;
  if (n == null || s == null) return null;
  const sum = Math.round(n + s);
  const off = sum - 100;
  return (
    <div className={`pairhint ${Math.abs(off) >= 3 ? "loud" : ""}`}>
      <span>
        NORTH <b>{Math.round(n)}</b> + SOUTH <b>{Math.round(s)}</b> = <b>{sum}</b>
      </span>
      {off === 0 ? (
        <em>the books agree</em>
      ) : (
        <em>
          {off > 0 ? "over" : "under"} by {Math.abs(off)} — exactly one of them pays 100
        </em>
      )}
    </div>
  );
}

function Shell({ children, round, msLeft }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <span>
            ND DELTA <b>WEEK 4</b>
          </span>
          <small>MONTE CARLO</small>
        </div>
        {round && (
          <div className="topstate">
            <span className={`phase ${round.status}`}>{round.phase}</span>
            {msLeft != null && <span className="clock">{clock(msLeft)}</span>}
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
