import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { local } from "./local.js";
import { bindStorage, wipe } from "./kv.js";
import { bindSession, setSeats, getSeats, currentSeat, switchSeat, onSeatChange } from "./api.js";
import "./solo.css";

/**
 * The frame around a solo game. Three jobs:
 *
 *  1. SETUP — your name, an optional friend on the same screen, how many bot
 *     teams and how good they are, and the week's own few settings. Nothing
 *     here shows anything a player would not know at the meeting.
 *  2. HOST — the solo player is also the host, but only gets the host's
 *     buttons (open, reveal, next…), never the control room's peek at the
 *     answer. The bar shows one primary action for the phase, like the
 *     meeting's control room.
 *  3. SEATS — with a friend, two players on one team, one screen; the bar
 *     switches whose screen you are looking at.
 *
 * The game itself is the original week's floor, unmodified, talking to the
 * week's real server running in this tab.
 *
 * `game` is the week's adapter (solo/weekN/game.js).
 */
export default function SoloShell({ game }) {
  const ns = `solo-w${game.week}`;
  const [meta, setMeta] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`${ns}:meta`));
    } catch {
      return null;
    }
  });

  if (!meta) return <Setup game={game} ns={ns} onStarted={setMeta} />;
  return <Playing game={game} ns={ns} meta={meta} onQuit={() => setMeta(null)} />;
}

/* ── setup ─────────────────────────────────────────────────────────────── */

function Setup({ game, ns, onStarted }) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("solo:name") || "";
    } catch {
      return "";
    }
  });
  const [friend, setFriend] = useState(false);
  const [friendName, setFriendName] = useState("");
  const [teams, setTeams] = useState(game.botTeams?.def ?? 7);
  const [level, setLevel] = useState("sharp");
  const [cfg, setCfg] = useState(() => Object.fromEntries((game.settings ?? []).map((s) => [s.key, s.def])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const nameOk = name.trim().length >= 2 && name.trim().length <= 18;
  const friendOk = !friend || (friendName.trim().length >= 2 && friendName.trim().length <= 18 && friendName.trim().toLowerCase() !== name.trim().toLowerCase());

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      try {
        localStorage.setItem("solo:name", name.trim());
      } catch {}
      // A clean slate for this week.
      bindStorage(`${ns}:kv`);
      wipe();
      bindStorage(`${ns}:kv`);
      bindSession(ns);
      const { token: admin } = await local.post("admin/auth", { password: "123" });
      const you = [name.trim(), ...(friend ? [friendName.trim()] : [])];
      const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const out = await game.setup({ admin, cfg, you, botTeams: teams, level, seed, ns });
      setSeats(out.seats);
      const meta = { admin, cfg, you, botTeams: teams, level, seed, bots: out.bots, extra: out.extra ?? null, startedAt: Date.now() };
      sessionStorage.setItem(`${ns}:meta`, JSON.stringify(meta));
      onStarted(meta);
    } catch (e) {
      console.error(e);
      setErr(e.message || String(e));
      setBusy(false);
    }
  };

  const range = game.botTeams ?? { min: 3, max: 14, def: 7 };

  return (
    <div className="solo-setup">
      <div className="solo-setup__glow" aria-hidden="true" />
      <div className="solo-card">
        <a className="solo-back" href="/games">
          ← All games
        </a>
        <div className="solo-kicker">
          Week {game.week} · Solo
        </div>
        <h1 className="solo-title">{game.title}</h1>
        <p className="solo-lede">{game.blurb}</p>

        {game.howTo?.length ? (
          <ol className="solo-how">
            {game.howTo.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        ) : null}

        <div className="solo-grid">
          <label className="solo-field">
            <span>Your name</span>
            <input value={name} maxLength={18} onChange={(e) => setName(e.target.value)} placeholder="e.g. George" autoFocus />
          </label>

          <div className="solo-field">
            <span>Players on this screen</span>
            <div className="solo-seg">
              <button className={!friend ? "on" : ""} onClick={() => setFriend(false)}>
                Just me
              </button>
              <button className={friend ? "on" : ""} onClick={() => setFriend(true)}>
                Me + a friend
              </button>
            </div>
          </div>

          {friend && (
            <label className="solo-field">
              <span>Friend's name</span>
              <input value={friendName} maxLength={18} onChange={(e) => setFriendName(e.target.value)} placeholder="Your teammate" />
              <small>You'll be on one team. Switch whose screen you're on from the top bar.</small>
            </label>
          )}

          <label className="solo-field">
            <span>
              Other teams <b>{teams}</b>
            </span>
            <input type="range" min={range.min} max={range.max} value={teams} onChange={(e) => setTeams(Number(e.target.value))} />
            <small>Each one is a bot team with its own private information.</small>
          </label>

          <div className="solo-field">
            <span>How good are they?</span>
            <div className="solo-seg">
              {[
                ["casual", "Casual"],
                ["sharp", "Sharp"],
                ["shark", "Sharks"],
              ].map(([k, l]) => (
                <button key={k} className={level === k ? "on" : ""} onClick={() => setLevel(k)}>
                  {l}
                </button>
              ))}
            </div>
            <small>{{ casual: "Wide quotes, slow to react. A good first game.", sharp: "A normal meeting: a few people who know what they're doing.", shark: "Tight markets and fast hands. Mistakes get picked off." }[level]}</small>
          </div>

          {(game.settings ?? []).map((s) => (
            <div className="solo-field" key={s.key}>
              <span>{s.label}</span>
              {s.type === "seg" ? (
                <div className="solo-seg">
                  {s.options.map((o) => (
                    <button key={String(o.v)} className={cfg[s.key] === o.v ? "on" : ""} onClick={() => setCfg((c) => ({ ...c, [s.key]: o.v }))}>
                      {o.l}
                    </button>
                  ))}
                </div>
              ) : (
                <select value={String(cfg[s.key])} onChange={(e) => setCfg((c) => ({ ...c, [s.key]: s.options.find((o) => String(o.v) === e.target.value)?.v }))}>
                  {s.options.map((o) => (
                    <option key={String(o.v)} value={String(o.v)}>
                      {o.l}
                    </option>
                  ))}
                </select>
              )}
              {s.hint && <small>{typeof s.hint === "function" ? s.hint(cfg[s.key]) : s.hint}</small>}
            </div>
          ))}
        </div>

        {err && <div className="solo-err">{err}</div>}

        <button className="solo-go" disabled={!nameOk || !friendOk || busy} onClick={start}>
          {busy ? "Setting up the room…" : "Start the game"}
        </button>
        <p className="solo-foot">
          Runs entirely in your browser. At a meeting? <a href={`/week${game.week}/`}>Join the live game</a> instead.
        </p>
      </div>
    </div>
  );
}

/* ── playing ───────────────────────────────────────────────────────────── */

function Playing({ game, ns, meta, onQuit }) {
  const [ready, setReady] = useState(false);
  const [seat, setSeat] = useState(0);
  const [round, setRound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [floorKey, setFloorKey] = useState(0);
  const runner = useRef(null);

  // Rebind the store and the seats (also after a reload), then start the room.
  useEffect(() => {
    bindStorage(`${ns}:kv`);
    bindSession(ns);
    setSeat(currentSeat());
    const off = onSeatChange(() => setSeat(currentSeat()));
    runner.current = game.bots({ meta, ns });
    runner.current?.start();
    setReady(true);
    return () => {
      off();
      runner.current?.stop();
    };
  }, [game, meta, ns]);

  // The host's view of the round: the public config only.
  useEffect(() => {
    if (!ready) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const c = await local.get(game.configRoute ?? "config");
        if (!stop) setRound(game.roundOf ? game.roundOf(c) : c.round ?? null);
      } catch {}
      if (!stop) setTimeout(tick, 900);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [ready, game]);

  const ctx = useMemo(
    () => ({
      meta,
      ns,
      round,
      admin: (route, body = {}) => local.post(`admin/${route}`, { ...body, token: meta.admin }),
      seats: getSeats(),
      runner: runner.current,
    }),
    [meta, ns, round]
  );

  const act = useCallback(
    async (fn) => {
      setBusy(true);
      setNote(null);
      try {
        const r = await fn(ctx);
        if (r?.note) setNote(r.note);
        if (r?.remount) setFloorKey((k) => k + 1);
      } catch (e) {
        setNote(e.message || String(e));
      }
      setBusy(false);
    },
    [ctx]
  );

  const quit = () => {
    runner.current?.stop();
    wipe();
    try {
      sessionStorage.removeItem(`${ns}:meta`);
      sessionStorage.removeItem(`${ns}:seats`);
    } catch {}
    onQuit();
  };

  if (!ready) return null;
  const Floor = game.Floor;
  const seats = getSeats();
  const controls = round ? game.controls(ctx) : [];
  const status = round ? game.status?.(ctx) : "Setting up…";

  return (
    <div className="solo-wrap">
      <div className="solo-bar" role="toolbar" aria-label="Solo host controls">
        <a className="solo-bar__brand" href="/games" title="All games">
          <span className="solo-bar__delta">Δ</span>
          <span className="solo-bar__name">
            Week {game.week} <em>solo</em>
          </span>
        </a>
        <div className="solo-bar__status">{status}</div>
        <div className="solo-bar__ctl">
          {controls.map((c) => (
            <button
              key={c.key ?? c.label}
              className={`solo-btn ${c.primary ? "solo-btn--primary" : ""} ${c.on ? "solo-btn--on" : ""}`}
              disabled={busy || c.disabled}
              title={c.hint ?? ""}
              onClick={() => act(c.run)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {seats.length > 1 && (
          <div className="solo-seats" aria-label="Whose screen">
            {seats.map((s, i) => (
              <button key={s.playerId} className={i === seat ? "on" : ""} onClick={() => switchSeat(i)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="solo-bar__end">
          <button className="solo-btn solo-btn--ghost" onClick={() => window.confirm("Start over with a new game?") && quit()}>
            New game
          </button>
        </div>
      </div>
      {note && (
        <div className="solo-note" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
      <div className="solo-stage">
        <Floor key={`${seat}-${floorKey}`} />
      </div>
    </div>
  );
}
