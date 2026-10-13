import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, loadPlayer, savePlayer, clearPlayer, withPlayer } from "./api.js";
import { clock, Spinner, PxButton } from "./components/PixelBits.jsx";
import Gate from "./components/Gate.jsx";
import YouPanel from "./components/YouPanel.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import Toasts, { fillToasts } from "./components/Toasts.jsx";
import Reveal from "./components/Reveal.jsx";
import Rules from "./components/Rules.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import BigBoard from "./components/BigBoard.jsx";
import StaleBuild from "./components/StaleBuild.jsx";
import Draw from "./components/Draw.jsx";
import SumChart from "./components/SumChart.jsx";
import Ladders from "./components/Ladders.jsx";
import NumberPick from "./components/NumberPick.jsx";
import * as sfx from "./components/sfx.js";

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

/** A render crash unmounts the whole tree and leaves a black page. Say what happened. */
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, where: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error("[week6] render crashed", err, info?.componentStack);
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

const SHOWN_KEY = "w6shownReveals";
const SOUND_KEY = "w6sound";
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
const loadSound = (fallback) => {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
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
  const [tab, setTab] = useState(initial?.tab ?? "floor");
  const [showRules, setShowRules] = useState(false);
  const [gateHolding, setGateHolding] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [showReveal, setShowReveal] = useState(false);
  const [pickOpen, setPickOpen] = useState(true);
  const [sound, setSound] = useState(() => loadSound(false));
  // Which ladder just filled, and which way, for the flash.
  const [hits, setHits] = useState({});
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const [now, setNow] = useState(Date.now());
  const shown = useRef(loadShown());
  const sinceRef = useRef(0);
  const clockSkew = useRef(0);
  const nextAt = useRef(null);

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
      clockSkew.current = s.round.serverNow - Date.now();
      nextAt.current = s.round.auto?.nextAt ?? s.round.pickEndsAt ?? null;
      if (s.fills.length) {
        for (const t of fillToasts(s.fills)) push(t);
        for (const f of s.fills) sinceRef.current = Math.max(sinceRef.current, f.s);
        // Light the ladders that filled, and blip once per side.
        const stamp = Date.now();
        const next = {};
        const sides = new Set();
        for (const f of s.fills) {
          next[f.mkt ?? f.market] = { side: f.side, at: stamp };
          sides.add(f.side);
        }
        setHits((cur) => ({ ...cur, ...next }));
        if (soundRef.current) for (const side of sides) sfx.fill(side);
        setTimeout(() => setHits((cur) => Object.fromEntries(Object.entries(cur).filter(([, v]) => v.at !== stamp))), 950);
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
      let wait = document.visibilityState === "visible" ? 950 : 4000;
      if (nextAt.current != null) {
        const due = nextAt.current - (Date.now() + clockSkew.current) + 60;
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

  useEffect(() => {
    setPickOpen(true);
  }, [round?.roundId]);

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

  const order = (mkt, side, px) =>
    act(
      `${mkt}${side}${px}`,
      async () => {
        const res = await api.post("order", withPlayer(player, { mkt, side, px, qty: size }));
        if (res?.selfCanceled?.length) {
          const n = res.selfCanceled.reduce((s, o) => s + o.qty, 0);
          push({
            key: `self-${Date.now()}`,
            kind: "bad",
            title: "YOUR OWN ORDER PULLED",
            body: `this crossed ${n} share${n > 1 ? "s" : ""} of your own resting ${res.selfCanceled[0].side === "B" ? "bid" : "offer"} at ${res.selfCanceled[0].px}, so that was cancelled instead of trading against yourself`,
            ttl: 7000,
          });
        }
        if (res?.canceled > 0) {
          push({
            key: `ioc-${Date.now()}`,
            kind: "bad",
            title: `${res.filled} FILLED · ${res.canceled} CANCELED`,
            body: "your balance could not carry the rest at every sum still possible, so it was not left resting",
            ttl: 7000,
          });
        }
      },
      `${mkt}${side}${px}`
    );
  const cancelLevel = (mkt, side, px) => act("cancel", () => api.post("cancel", withPlayer(player, { mkt, side, px })));
  const cancelBook = (mkt) => act("cancel", () => api.post("cancel", withPlayer(player, { all: true, mkt })));
  const cancelOne = (orderId) => act("cancel", () => api.post("cancel", withPlayer(player, { orderId })));
  const cancelAll = () => act("cancel", () => api.post("cancel", withPlayer(player, { all: true })));
  const pick = (n) => act("pick", () => api.post("team/number", withPlayer(player, { number: n })));
  const toggleSound = () => {
    const v = !sound;
    sfx.unlock();
    setSound(v);
    if (v) sfx.tick(1);
    try {
      localStorage.setItem(SOUND_KEY, v ? "1" : "0");
    } catch {}
  };

  const serverNow = now + clockSkew.current;
  const msLeft = round?.pickEndsAt != null && round.status === "lobby" ? Math.max(0, round.pickEndsAt - serverNow) : null;
  const liveRound = round ? { ...round, serverNow } : null;

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
    return <Reveal reveal={reveal} me={state.me} leaderboard={reveal.leaderboard ?? state.leaderboard} myTeamId={state.team?.id} onClose={() => setShowReveal(false)} />;
  }

  const me = state.me;
  const team = state.team;
  const tradingShut = round.status !== "live";
  const needsPick = round.status === "lobby" && team && team.number == null;

  return (
    <Shell round={round} msLeft={msLeft} sound={sound} onSound={toggleSound} team={team}>
      <Toasts items={toasts} onExpire={expire} />
      {showRules && <Rules onClose={() => setShowRules(false)} />}

      {needsPick && pickOpen && (
        <div className="modal">
          <div className="modal-card pick-card">
            <div className="modal-head">
              <h2>NEW ROUND — PICK YOUR NUMBER</h2>
            </div>
            <p className="hint">
              <b style={{ color: "var(--gold)" }}>{team.name}</b> needs a fresh number. Any of you can pick it.
              {msLeft != null ? ` Trading opens in ${clock(msLeft)} — a team that has not picked gets a number drawn for it.` : " If nobody picks before the host opens trading, a number is drawn for you."}
            </p>
            <NumberPick value={team.number} onPick={pick} disabled={busy === "pick"} big />
            <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
              <PxButton variant="ghost" small onClick={() => setPickOpen(false)}>
                SOMEONE ELSE WILL
              </PxButton>
            </div>
          </div>
        </div>
      )}

      <div className="floor-tabs">
        {[
          ["floor", "THE FLOOR"],
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

      {tab === "floor" && (
        <div className="floor6">
          <section className="panel panel--tight">
            <Draw round={liveRound} sound={sound} />
          </section>

          {round.status === "lobby" && team && (
            <div className={`shut-note ${team.number == null ? "warn" : ""}`}>
              {team.number == null ? (
                <>
                  YOUR TEAM HAS NOT PICKED A NUMBER.{" "}
                  <button className="linkbtn" onClick={() => setPickOpen(true)}>
                    PICK ONE
                  </button>
                </>
              ) : (
                <>
                  YOUR NUMBER IS <b className="gold">{team.number}</b>
                  {team.drawn ? " (drawn for you)" : team.pickedBy ? ` (picked by ${team.pickedBy})` : ""}.{" "}
                  {msLeft != null ? `TRADING OPENS IN ${clock(msLeft)}.` : "WAITING FOR THE HOST TO OPEN TRADING."}{" "}
                  <button className="linkbtn" onClick={() => setPickOpen(true)}>
                    CHANGE IT
                  </button>
                </>
              )}
            </div>
          )}
          {round.status === "settled" && (
            <div className="shut-note">
              SETTLED — S = {round.settleS}. SUM PAID ${round.payouts?.fut} · CALL PAID ${round.payouts?.call} · PUT PAID ${round.payouts?.put}
            </div>
          )}

          <section className="panel panel--tight">
            <Ladders
              round={round}
              market={state.market}
              me={me}
              size={size}
              onSize={setSizePick}
              onOrder={order}
              onCancelLevel={cancelLevel}
              onCancelBook={cancelBook}
              onCancelAll={cancelAll}
              disabled={tradingShut || !!busy}
              busyPx={busyPx}
              hits={hits}
            />
          </section>

          <div className="floor6-bottom">
            <section className="panel panel--tight">
              <SumChart round={round} height={180} />
            </section>
            <YouPanel me={me} team={team} settled={round.status === "settled"} onCancel={cancelOne} onCancelAll={cancelAll} />
          </div>
        </div>
      )}

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

function Shell({ children, round, msLeft, sound, onSound, team }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <span>
            ND DELTA <b>WEEK 6</b>
          </span>
          <small>THE SUM</small>
        </div>
        {round && (
          <div className="topstate">
            <span className={`phase ${round.status}`}>{round.phase}</span>
            {msLeft != null && <span className="clock">{clock(msLeft)}</span>}
            {round.locked && (
              <span className="dim">
                {round.revealedCount}/{round.N} drawn
              </span>
            )}
            {team && team.number != null && (
              <span className="yournum-pill" title="your team's number — only your team can see it">
                YOURS <b>{team.number}</b>
              </span>
            )}
            <span className="dim">
              {round.players} players · {round.teams} teams
            </span>
            {onSound && (
              <button className="ghost soundbtn" onClick={onSound} title={sound ? "sound on" : "sound off"}>
                {sound ? "🔔" : "🔕"}
              </button>
            )}
          </div>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}
