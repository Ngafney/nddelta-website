import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, loadPlayer, savePlayer, clearPlayer, withPlayer } from "./api.js";
import { clock, Spinner, PxButton } from "./components/PixelBits.jsx";
import Gate from "./components/Gate.jsx";
import OrderBook from "./components/OrderBook.jsx";
import YouPanel from "./components/YouPanel.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import Toasts, { fillToasts } from "./components/Toasts.jsx";
import Reveal from "./components/Reveal.jsx";
import Rules from "./components/Rules.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import BigBoard from "./components/BigBoard.jsx";
import StaleBuild from "./components/StaleBuild.jsx";
import Pot from "./components/Pot.jsx";
import SumChart from "./components/SumChart.jsx";
import Books from "./components/Books.jsx";
import NumberPick from "./components/NumberPick.jsx";
import { BOOK_ORDER, BOOKS } from "../shared/rules.js";

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
  const [mkt, setMkt] = useState(initial?.mkt ?? null);
  const [showRules, setShowRules] = useState(false);
  const [gateHolding, setGateHolding] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [showReveal, setShowReveal] = useState(false);
  const [pickOpen, setPickOpen] = useState(true);
  const [sound, setSound] = useState(() => loadSound(false));
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

  // Poll about once a second, and right after the next scheduled event (an
  // AUTO reveal, the pick clock) so a new number lands on screen promptly.
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

  /* A new round re-opens the pick prompt. */
  useEffect(() => {
    setPickOpen(true);
  }, [round?.roundId]);

  /* Keep the selected book one the host has opened. */
  useEffect(() => {
    if (!round) return;
    const open = BOOK_ORDER.filter((k) => round.books[k].enabled);
    if (!mkt || !round.books[mkt]?.enabled) setMkt(open[0] ?? "fut");
  }, [round, mkt]);

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
  const book = mkt ?? "fut";

  const order = (side, px) =>
    act(
      `${side}${px}`,
      async () => {
        const res = await api.post("order", withPlayer(player, { mkt: book, side, px, qty: size }));
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
      `${side}${px}`
    );
  const cancelLevel = (side, px) => act("cancel", () => api.post("cancel", withPlayer(player, { mkt: book, side, px })));
  const cancelOne = (orderId) => act("cancel", () => api.post("cancel", withPlayer(player, { orderId })));
  const cancelAll = () => act("cancel", () => api.post("cancel", withPlayer(player, { all: true })));
  const pick = (n) => act("pick", () => api.post("team/number", withPlayer(player, { number: n })));
  const toggleSound = () => {
    const v = !sound;
    setSound(v);
    try {
      localStorage.setItem(SOUND_KEY, v ? "1" : "0");
    } catch {}
  };

  /* ── gates ─────────────────────────────────────────────────────────── */

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
    return (
      <Reveal reveal={reveal} me={state.me} leaderboard={reveal.leaderboard ?? state.leaderboard} myTeamId={state.team?.id} onClose={() => setShowReveal(false)} />
    );
  }

  const me = state.me;
  const team = state.team;
  const tradingShut = round.status !== "live" || !round.books[book]?.open;
  const needsPick = round.status === "lobby" && team && team.number == null;

  return (
    <Shell round={round} msLeft={msLeft} sound={sound} onSound={toggleSound}>
      <Toasts items={toasts} onExpire={expire} />
      {showRules && <Rules onClose={() => setShowRules(false)} />}

      {needsPick && pickOpen && (
        <div className="modal">
          <div className="modal-card pick-card">
            <div className="modal-head">
              <h2>NEW ROUND — PICK YOUR NUMBER</h2>
            </div>
            <p className="hint">
              <b style={{ color: "var(--gold)" }}>{team.name}</b> needs a fresh number for the pot. Any of you can pick it.
              {msLeft != null ? ` The host opens trading in ${clock(msLeft)} — a team that has not picked gets a number drawn for it.` : " If nobody picks before the host opens trading, a number is drawn for you."}
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
        <div className="h-floor">
          <div className="h-left">
            <section className="panel panel--tight">
              <Pot round={liveRound} sound={sound} />
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
                    {msLeft != null ? `THE BOOKS OPEN IN ${clock(msLeft)}.` : "WAITING FOR THE HOST TO OPEN THE BOOKS."}{" "}
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
              <SumChart round={round} height={200} />
            </section>

            <YouPanel me={me} team={team} settled={round.status === "settled"} onCancel={cancelOne} onCancelAll={cancelAll} />
          </div>

          <section className="panel h-right">
            <Books round={round} market={state.market} me={me} selected={book} onSelect={setMkt} />
            <div className="panel-title" style={{ marginTop: 12 }}>
              {BOOKS[book].name}
              <span className="right">
                {round.books[book].open ? `pays ${book === "fut" ? "$S" : book === "call" ? `max(S − ${round.K}, 0)` : `max(${round.K} − S, 0)`}` : round.status === "live" ? "not open yet" : ""}
                {round.noise?.desks ? ` · ${round.noise.desks} noise desks` : ""}
              </span>
            </div>
            <OrderBook
              key={`${round.roundId}-${book}-${round.locked ? "L" : "U"}`}
              book={state.market[book]}
              last={state.market[book].last}
              me={{ ...me, pos: me.pos?.[book] ?? 0, buyC: me.freeC }}
              center={round.books[book].center}
              tick={1}
              lo={round.books[book].orderMin}
              hi={round.books[book].orderMax}
              mine={me.orders.filter((o) => o.mkt === book)}
              size={size}
              onSize={setSizePick}
              onOrder={order}
              onCancelLevel={cancelLevel}
              onCancelAll={cancelAll}
              disabled={tradingShut || !!busy}
              busyPx={busyPx}
              unit="dollars"
            />
          </section>
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

function Shell({ children, round, msLeft, sound, onSound }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <span>
            ND DELTA <b>WEEK 6</b>
          </span>
          <small>THE POT</small>
        </div>
        {round && (
          <div className="topstate">
            <span className={`phase ${round.status}`}>{round.phase}</span>
            {msLeft != null && <span className="clock">{clock(msLeft)}</span>}
            {round.locked && (
              <span className="dim">
                {round.revealedCount}/{round.N} out
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
