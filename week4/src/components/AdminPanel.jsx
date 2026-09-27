import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { PxButton, Spinner, money, clock } from "./PixelBits.jsx";
import { EVENTS } from "../../shared/events.js";

const BOT_SLOTS = [
  { key: "north-buy", label: "BUY NORTH", market: "north", side: "B" },
  { key: "north-sell", label: "SELL NORTH", market: "north", side: "A" },
  { key: "south-buy", label: "BUY SOUTH", market: "south", side: "B" },
  { key: "south-sell", label: "SELL SOUTH", market: "south", side: "A" },
];

export default function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem("w4admin") || null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);

  if (!token) {
    return (
      <div className="wrap wrap--narrow">
        <div className="panel">
          <h2>CONTROL ROOM</h2>
          <input
            type="password"
            value={pw}
            placeholder="password"
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />
          <PxButton onClick={go}>ENTER</PxButton>
          {err && <div className="err-strip">{err}</div>}
        </div>
      </div>
    );
  }
  return <Console token={token} onOut={() => (sessionStorage.removeItem("w4admin"), setToken(null))} />;

  async function go() {
    try {
      const r = await api.post("admin/auth", { password: pw });
      sessionStorage.setItem("w4admin", r.token);
      setToken(r.token);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }
}

function Console({ token, onOut }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);

  // Held as TEXT on purpose. Number("") is 0, so coercing on every keystroke
  // turns a cleared box into a real, silently wrong setting. Empty goes to the
  // server as empty, and the server reads empty as "use the default".
  const [eventKey, setEventKey] = useState("");
  const [startConf, setStartConf] = useState("65");
  const [sigmaKm, setSigmaKm] = useState("");
  const [researchMin, setResearchMin] = useState("15");
  const [tradingMin, setTradingMin] = useState("20");
  const [startCash, setStartCash] = useState("10000");
  const [defaultSize, setDefaultSize] = useState("10");
  const [keepPlayers, setKeepPlayers] = useState(false);
  const [bots, setBots] = useState(() =>
    Object.fromEntries(BOT_SLOTS.map((s) => [s.key, { on: false, shares: "200", everySec: "20" }]))
  );

  const pull = useCallback(async () => {
    try {
      const r = await api.get("admin/inspect", { token });
      setInfo(r);
      setErr(null);
      if (r.bots?.length) {
        setBots((cur) => {
          const next = { ...cur };
          for (const b of r.bots) {
            next[b.key] = { on: !!b.on, shares: String(b.shares || 200), everySec: String(b.everySec || 20) };
          }
          return next;
        });
      }
    } catch (e) {
      if (e.status === 401) onOut();
      else setErr(e.message);
    }
  }, [token, onOut]);

  useEffect(() => {
    pull();
    const h = setInterval(pull, 2500);
    return () => clearInterval(h);
  }, [pull]);

  const act = async (label, fn) => {
    setBusy(label);
    setErr(null);
    setNote(null);
    try {
      const out = await fn();
      await pull();
      return out;
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!info) return <Spinner text="CONNECTING" />;

  const round = info.round;
  const truth = info.truth;
  const live = round && round.status !== "settled";

  return (
    <div className="wrap admin">
      <header className="admin-top">
        <h2>CONTROL ROOM · WEEK 4</h2>
        <div>
          <span className={`phase ${round?.status ?? "none"}`}>{round?.phase ?? "NO ROUND"}</span>
          {round?.msLeft != null && <span className="clock">{clock(round.msLeft)}</span>}
          <button className="ghost" onClick={onOut}>
            LOG OUT
          </button>
        </div>
      </header>

      {err && <div className="err-strip">{err}</div>}
      {note && <div className="ok-strip">{note}</div>}

      {/* ── build ───────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-title">BUILD A ROUND</div>
        <p className="hint">
          Every one of these really hit. The room is shown a solution that is deliberately NOT the
          true impact point — it is the truth displaced by a draw from the covariance they are
          handed, which is what a published solution is. Leave the asteroid on RANDOM to be as
          surprised as they are.
        </p>
        <div className="admin-grid">
          <Field label="WHICH ASTEROID" hint="all four really hit">
            <div className="pickrow wrap">
              <button className={eventKey === "" ? "on" : ""} onClick={() => setEventKey("")}>
                RANDOM
              </button>
              {EVENTS.map((e) => (
                <button key={e.key} className={eventKey === e.key ? "on" : ""} onClick={() => setEventKey(e.key)}>
                  {e.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="CONFIDENCE ON THE OPENING SOLUTION" hint="what a good team should reach">
            <div className="slider-row">
              <input type="range" min={52} max={95} value={Number(startConf) || 65} onChange={(e) => setStartConf(e.target.value)} />
              <b>{Number(startConf) || 65}%</b>
            </div>
          </Field>
          <Field label="OPENING σ ALONG THE CORRIDOR, km" hint="blank = 600, the default corridor width">
            <input type="number" min={40} max={4000} step={50} value={sigmaKm} onChange={(e) => setSigmaKm(e.target.value)} />
          </Field>
          <Field label="STARTING CASH ($)">
            <input type="number" min={100} max={10000000} step={1000} value={startCash} onChange={(e) => setStartCash(e.target.value)} />
          </Field>
          <Field label="SHARES PER CLICK">
            <input type="number" min={1} max={50} value={defaultSize} onChange={(e) => setDefaultSize(e.target.value)} />
          </Field>
        </div>
        <label className="checkrow">
          <input type="checkbox" checked={keepPlayers} onChange={(e) => setKeepPlayers(e.target.checked)} />
          keep the players and teams from the last round
        </label>
        <PxButton
          variant="gold"
          disabled={!!busy}
          onClick={() =>
            act("build", async () => {
              const out = await api.post("admin/round", {
                token,
                event: eventKey || undefined,
                startConfidence: (Number(startConf) || 65) / 100,
                sigmaKm,
                startCash,
                defaultSize,
                tradingMinutes: tradingMin,
                keepPlayers,
              });
              setNote(
                `${out.truth.event} — it came down at ${fmtLat(out.truth.trueLat)}, ` +
                  `so ${out.truth.winner.toUpperCase()} of the ${fmtLat(out.truth.lineDeg)} line pays.`
              );
            })
          }
        >
          {busy === "build" ? <Spinner text="BUILDING" /> : "BUILD"}
        </PxButton>
      </section>

      {/* ── run ─────────────────────────────────────────────────── */}
      {round && (
        <section className="panel">
          <div className="panel-title">RUN IT</div>
          <div className="admin-grid">
            <Field label="RESEARCH MINUTES">
              <input type="number" min={0.5} max={180} step="0.5" value={researchMin} onChange={(e) => setResearchMin(e.target.value)} />
            </Field>
            <Field label="TRADING MINUTES">
              <input type="number" min={0.5} max={180} step="0.5" value={tradingMin} onChange={(e) => setTradingMin(e.target.value)} />
            </Field>
          </div>
          <div className="btnrow">
            <PxButton
              disabled={!!busy || !live}
              onClick={() => act("start", () => api.post("admin/start", { token, minutes: researchMin }))}
            >
              1 · OPEN RESEARCH
            </PxButton>
            <PxButton
              variant="green"
              disabled={!!busy || !live}
              onClick={() => act("open", () => api.post("admin/open", { token, minutes: tradingMin }))}
            >
              2 · OPEN THE BOOKS
            </PxButton>
            <PxButton
              disabled={!!busy || !live}
              onClick={() => act("extend", () => api.post("admin/extend", { token, minutes: 5 }))}
            >
              +5 MIN
            </PxButton>
            <PxButton
              variant="red"
              disabled={!!busy || !live}
              onClick={() => act("end", () => api.post("admin/end", { token }))}
            >
              3 · IMPACT &amp; SETTLE
            </PxButton>
          </div>
        </section>
      )}

      {/* ── data ────────────────────────────────────────────────── */}
      {round && truth && (
        <section className="panel">
          <div className="panel-title">
            THE RECORD — RELEASE {round.released} OF {round.releaseCount}
          </div>
          <div className="releases">
            {truth.releases?.map((r, i) => {
              const out = i < round.released;
              return (
                <div key={i} className={`relrow ${out ? "out" : ""}`}>
                  <span className="relidx">{i + 1}</span>
                  <span>σ {Math.round(r.sigmaKm)} km along</span>
                  <span className="dim">N {(r.pNorth * 100).toFixed(0)}%</span>
                  <span className="relconf">
                    {(r.confidence * 100).toFixed(0)}%<em> conf</em>
                  </span>
                  <span className="dim" />
                  <span className="relstate">{out ? "RELEASED" : "held"}</span>
                </div>
              );
            })}
          </div>
          <PxButton
            variant="gold"
            disabled={!!busy || round.released >= round.releaseCount}
            onClick={() =>
              act("release", async () => {
                const out = await api.post("admin/release", { token });
                setNote(`Release ${out.released} is out — ${out.rows} rows, to ${out.leadDays} days before impact.`);
              })
            }
          >
            {round.released >= round.releaseCount ? "THE WHOLE RECORD IS OUT" : "RELEASE THE NEXT BATCH"}
          </PxButton>
        </section>
      )}

      {/* ── bots ────────────────────────────────────────────────── */}
      {round && (
        <section className="panel">
          <div className="panel-title">NOISE DESK</div>
          <p className="hint">
            Uninformed market orders on a fixed schedule. The room is told these exist and what they are doing.
          </p>
          <div className="bots">
            {BOT_SLOTS.map((slot) => {
              const b = bots[slot.key];
              const stat = info.bots?.find((x) => x.key === slot.key);
              return (
                <div key={slot.key} className={`botrow ${b.on ? "on" : ""} ${slot.market}`}>
                  <label className="botname">
                    <input
                      type="checkbox"
                      checked={b.on}
                      onChange={(e) => setBots((c) => ({ ...c, [slot.key]: { ...c[slot.key], on: e.target.checked } }))}
                    />
                    {slot.label}
                  </label>
                  <span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={b.shares}
                      onChange={(e) => setBots((c) => ({ ...c, [slot.key]: { ...c[slot.key], shares: e.target.value } }))}
                    />
                    <i>shares</i>
                  </span>
                  <span>
                    every
                    <input
                      type="number"
                      min={2}
                      max={600}
                      value={b.everySec}
                      onChange={(e) => setBots((c) => ({ ...c, [slot.key]: { ...c[slot.key], everySec: e.target.value } }))}
                    />
                    <i>sec</i>
                  </span>
                  <span className="dim botstat">{stat ? `${stat.sent ?? 0} sent · ${stat.fills ?? 0} filled` : ""}</span>
                </div>
              );
            })}
          </div>
          <PxButton
            disabled={!!busy}
            onClick={() =>
              act("bots", () =>
                api.post("admin/bots", {
                  token,
                  bots: BOT_SLOTS.map((s) => ({
                    key: s.key,
                    on: bots[s.key].on,
                    shares: bots[s.key].shares,
                    everySec: bots[s.key].everySec,
                  })),
                })
              )
            }
          >
            APPLY THE DESK
          </PxButton>
        </section>
      )}

      {/* ── the answer ──────────────────────────────────────────── */}
      {truth && (
        <section className="panel truth">
          <div className="panel-title">THE ANSWER (YOURS ONLY)</div>
          <div className="truthgrid">
            <div>
              <i>ASTEROID</i>
              <b>{truth.event?.name ?? "—"}</b>
            </div>
            <div>
              <i>IT LANDED</i>
              <b>{fmtLat(truth.event?.lat ?? 0)}</b>
            </div>
            <div>
              <i>THE LINE</i>
              <b>{fmtLat(truth.lineDeg ?? 0)}</b>
            </div>
            <div>
              <i>SO IT PAYS</i>
              <b className={truth.winner}>{truth.winner?.toUpperCase()}</b>
            </div>
            <div>
              <i>WARNING</i>
              <b>{truth.event?.leadHours}h</b>
            </div>
            <div>
              <i>CORRIDOR</i>
              <b>
                {truth.corridor?.azimuthDeg}°{" "}
                {truth.corridor?.geometry === "modelled" ? "(modelled)" : "(published)"}
              </b>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            {truth.event?.where} · {truth.event?.story}
          </div>
        </section>
      )}

      {/* ── people ──────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-title">PLAYERS ({info.players.length})</div>
        <div className="playertable">
          {info.players.map((p) => (
            <div key={p.id} className="prow">
              <span>{p.name}</span>
              <span className="dim">{p.team ?? "—"}</span>
              <span>{money(p.cashC)}</span>
              <span className="dim">
                N {p.pos.north >= 0 ? "+" : ""}
                {p.pos.north} · S {p.pos.south >= 0 ? "+" : ""}
                {p.pos.south}
              </span>
              <span className="dim">{p.downloads} ⭳</span>
              <button className="ghost" onClick={() => act("kick", () => api.post("admin/kick", { token, playerId: p.id }))}>
                REMOVE
              </button>
            </div>
          ))}
          {!info.players.length && <div className="hint">Nobody has joined yet.</div>}
        </div>
      </section>

      {info.audit?.length > 0 && (
        <section className="panel">
          <div className="panel-title">AUDIT</div>
          {info.audit.map((a, i) => (
            <div key={i} className="err-strip">
              {a}
            </div>
          ))}
        </section>
      )}

      <section className="panel danger">
        <div className="panel-title">RESET EVERYTHING</div>
        <p className="hint">
          Wipes the round, every player, every team and the sky. Devices can rejoin fresh afterwards.
        </p>
        <PxButton
          variant="red"
          disabled={!!busy}
          onClick={() => {
            if (!window.confirm("Wipe the whole game?")) return;
            act("reset", () => api.post("admin/reset", { token, confirm: "RESET" }));
          }}
        >
          RESET
        </PxButton>
      </section>
    </div>
  );
}

/** "18.0°N" — a latitude the way a person says it. */
const fmtLat = (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? "N" : "S"}`;

function Field({ label, hint, children }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <em className="field-hint">{hint}</em>}
    </div>
  );
}
