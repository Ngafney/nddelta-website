import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { PxButton, Spinner, money, clock } from "./PixelBits.jsx";

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
  const [impactLat, setImpactLat] = useState("");
  const [startConf, setStartConf] = useState("65");
  const [endConf, setEndConf] = useState("90");
  const [stepDays, setStepDays] = useState(30);
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
          Solving a trajectory that lands on a chosen parallel takes a few seconds — it is a real
          integration, not a lookup. Leave the impact blank to be as surprised as the room.
        </p>
        <div className="admin-grid">
          <Field label="IMPACT LATITUDE (BLANK = RANDOM)" hint="+ north, − south · 0.5° to 12°">
            <input type="number" step="0.1" min={-12} max={12} value={impactLat} onChange={(e) => setImpactLat(e.target.value)} />
          </Field>
          <Field label="CONFIDENCE ON THE OPENING DATA" hint="what a good team should reach">
            <div className="slider-row">
              <input type="range" min={52} max={95} value={Number(startConf) || 65} onChange={(e) => setStartConf(e.target.value)} />
              <b>{Number(startConf) || 65}%</b>
            </div>
          </Field>
          <Field label="CONFIDENCE BY THE LAST RELEASE" hint="the noise is solved to hit this">
            <div className="slider-row">
              <input type="range" min={52} max={95} value={Number(endConf) || 90} onChange={(e) => setEndConf(e.target.value)} />
              <b>{Number(endConf) || 90}%</b>
            </div>
          </Field>
          <Field label="RELEASE STEP">
            <div className="pickrow">
              {[30, 60].map((d) => (
                <button key={d} className={stepDays === d ? "on" : ""} onClick={() => setStepDays(d)}>
                  {d === 30 ? "1 MONTH" : "2 MONTHS"}
                </button>
              ))}
            </div>
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
                impactLat,
                startConfidence: (Number(startConf) || 65) / 100,
                endConfidence: (Number(endConf) || 90) / 100,
                stepDays,
                startCash,
                defaultSize,
                tradingMinutes: tradingMin,
                keepPlayers,
              });
              setNote(
                `Built. It lands ${Math.abs(out.truth.latDeg).toFixed(2)}° ${
                  out.truth.winner === "north" ? "NORTH" : "SOUTH"
                }.`
              );
            })
          }
        >
          {busy === "build" ? <Spinner text="SOLVING THE TRAJECTORY" /> : "BUILD"}
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
              const cal = truth.calibration?.releases?.[i];
              const out = i < round.released;
              return (
                <div key={i} className={`relrow ${out ? "out" : ""}`}>
                  <span className="relidx">{i + 1}</span>
                  <span>{r.leadDays}d before impact</span>
                  <span className="dim">{r.count} rows</span>
                  <span className="relconf">
                    {cal ? `${(cal.confidence * 100).toFixed(0)}%` : "—"}
                    {cal && <em> conf</em>}
                  </span>
                  <span className="dim">{cal ? `σ ${cal.sigmaLoKm.toFixed(0)}–${cal.sigmaHiKm.toFixed(0)} km` : ""}</span>
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
              <i>LANDS</i>
              <b className={truth.winner}>{truth.winner.toUpperCase()}</b>
            </div>
            <div>
              <i>LATITUDE</i>
              <b>{truth.latDeg.toFixed(3)}°</b>
            </div>
            <div>
              <i>SOLAR PASS</i>
              <b>{truth.physics.perihelionSolarRadii.toFixed(1)} R☉</b>
            </div>
            <div>
              <i>GR DRIFT</i>
              <b>{Math.round(truth.physics.relativisticDriftKm).toLocaleString()} km</b>
            </div>
            <div>
              <i>NEWTONIAN</i>
              <b>
                {truth.physics.newtonianMisses
                  ? `misses by ${Math.round(truth.physics.newtonianMissKm).toLocaleString()} km`
                  : `${truth.physics.newtonianLatDeg?.toFixed(2)}°`}
              </b>
            </div>
            <div>
              <i>SURVEY GAIN</i>
              <b>{truth.calibration?.surveyImprovement?.toFixed(0)}×</b>
            </div>
          </div>
          {truth.calibration?.endShortfall > 0.02 && (
            <div className="warn-strip">
              This geometry could only reach{" "}
              {((truth.calibration.releases.at(-1)?.confidence ?? 0) * 100).toFixed(0)}% by the last release, not the{" "}
              {(truth.calibration.endConf * 100).toFixed(0)}% asked for. Rebuild for a different sky if that matters.
            </div>
          )}
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

function Field({ label, hint, children }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <em className="field-hint">{hint}</em>}
    </div>
  );
}
