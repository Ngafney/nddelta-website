import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { PxButton, Spinner, money, clock, num } from "./PixelBits.jsx";
import { PRESETS, PRESET_ORDER, DEFAULTS } from "../../shared/rules.js";

/**
 * The control room. Build a round (pick the process in secret), run it, and
 * peek at the truth while the room argues about it.
 */
export default function AdminPanel() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem("w5admin") || null;
    } catch {
      return null;
    }
  });
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);

  async function go() {
    try {
      const r = await api.post("admin/auth", { password: pw });
      try {
        sessionStorage.setItem("w5admin", r.token);
      } catch {}
      setToken(r.token);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }

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
  return (
    <Console
      token={token}
      onOut={() => {
        try {
          sessionStorage.removeItem("w5admin");
        } catch {}
        setToken(null);
      }}
    />
  );
}

/** The form starts on the mean-reverting preset with every default filled in. */
const initialForm = () => ({
  preset: "meanrev",
  phi1: String(PRESETS.meanrev.phi1),
  phi2: String(DEFAULTS.phi2),
  switchTick: "",
  sigma: String(DEFAULTS.sigma),
  mu: String(DEFAULTS.mu),
  K: String(DEFAULTS.K),
  yOpen: String(DEFAULTS.yOpen),
  H: String(DEFAULTS.H),
  T: String(DEFAULTS.T),
  secondsPerTick: String(DEFAULTS.secondsPerTick),
  researchMinutes: String(DEFAULTS.researchMinutes),
  naiveBot: DEFAULTS.naiveBot,
  seed: "",
  startCash: "10000",
  defaultSize: "10",
  keepPlayers: true,
});

/** `initial` seeds the first render (the render test uses it). */
export function Console({ token, onOut, initial = null }) {
  const [info, setInfo] = useState(initial);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [showPeek, setShowPeek] = useState(!!initial?.showPeek);
  // Held as TEXT on purpose (as in week 4): Number("") is 0, so coercing on every
  // keystroke would turn a cleared box into a real, silently wrong setting.
  const [form, setForm] = useState(initialForm);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value, preset: PHI_FIELDS.has(k) ? "custom" : f.preset }));

  const pickPreset = (key) => {
    const p = PRESETS[key];
    setForm((f) =>
      key === "custom"
        ? { ...f, preset: "custom" }
        : {
            ...f,
            preset: key,
            phi1: String(p.phi1),
            phi2: p.phi2 == null ? String(p.phi1) : String(p.phi2),
            switchTick: p.switchTick == null ? "" : String(p.switchTick),
          }
    );
  };

  // The first time a round is seen, the form starts from ITS settings, so the
  // panel never shows one process while another is running.
  const prefilled = useRef(false);
  useEffect(() => {
    const p = info?.peek;
    if (!p || prefilled.current) return;
    prefilled.current = true;
    setForm((f) => ({
      ...f,
      preset: p.preset,
      phi1: String(p.phi1),
      phi2: String(p.phi2),
      switchTick: p.switchTick == null ? "" : String(p.switchTick),
      sigma: String(p.sigma),
      mu: String(p.mu),
      K: String(p.K),
      yOpen: String(p.yOpen),
      H: String(p.H),
      T: String(p.T),
      secondsPerTick: String(p.secondsPerTick),
    }));
  }, [info]);

  const pull = useCallback(async () => {
    try {
      setInfo(await api.get("admin/inspect", { token }));
      setErr(null);
    } catch (e) {
      if (e.status === 401) onOut();
      else setErr(e.message);
    }
  }, [token, onOut]);

  useEffect(() => {
    pull();
    const h = setInterval(pull, 1500);
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
  const status = round?.status ?? "none";
  const locked = status === "live" || status === "settled";
  const peek = info.peek;
  const payload = () => ({ token, ...form, switchTick: form.switchTick.trim(), seed: form.seed.trim() });

  return (
    <div className="wrap admin">
      <header className="admin-top">
        <h2>CONTROL ROOM · WEEK 5</h2>
        <div>
          <span className={`phase ${status}`}>{round?.phase ?? "NO ROUND"}</span>
          {round?.msLeft != null && <span className="clock">{clock(round.msLeft)}</span>}
          {round && status !== "lobby" && (
            <span className="dim">
              {" "}
              tick {round.tickNow}/{round.T}
            </span>
          )}
          <button className="ghost" onClick={onOut}>
            LOG OUT
          </button>
        </div>
      </header>

      {!info.persistent && (
        <div className="err-strip">
          STORAGE IS NOT PERSISTENT — on Vercel without Upstash every request starts blank. Run serve.js for a live room.
        </div>
      )}
      {err && <div className="err-strip">{err}</div>}
      {note && <div className="ok-strip">{note}</div>}

      {/* ── build ───────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-title">
          THE PROCESS <span className="right">{locked ? "LOCKED FOR THIS ROUND — changes go into the next one you build" : "hidden from players"}</span>
        </div>
        <p className="hint">
          Y<sub>t+1</sub> = μ + φ<sub>t</sub>(Y<sub>t</sub> − μ) + σε. φ = 1 is a random walk. φ is φ1 up to the switch tick
          and φ2 after it. The history is generated backwards so it ends exactly at Y_open, and every round draws a new seed
          unless you pin one.
        </p>
        <div className="admin-grid">
          <Field label="PRESET" hint={PRESETS[form.preset]?.blurb}>
            <select value={form.preset} onChange={(e) => pickPreset(e.target.value)}>
              {PRESET_ORDER.map((k) => (
                <option key={k} value={k}>
                  {PRESETS[k].name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="φ1" hint="before the switch (or all round)">
            <input type="number" step="0.01" min={-0.99} max={1} value={form.phi1} onChange={set("phi1")} />
          </Field>
          <Field label="φ2" hint="after the switch">
            <input type="number" step="0.01" min={-0.99} max={1} value={form.phi2} onChange={set("phi2")} />
          </Field>
          <Field label="SWITCH TICK" hint="blank = no switch · live ticks only">
            <input type="number" min={1} value={form.switchTick} onChange={set("switchTick")} placeholder="none" />
          </Field>
          <Field label="σ" hint="noise per tick">
            <input type="number" step="0.1" min={0.01} value={form.sigma} onChange={set("sigma")} />
          </Field>
          <Field label="μ" hint="the level it reverts to">
            <input type="number" step="0.5" value={form.mu} onChange={set("mu")} />
          </Field>
          <Field label="K" hint="the line — public">
            <input type="number" step="0.5" value={form.K} onChange={set("K")} />
          </Field>
          <Field label="Y_OPEN" hint="where the history ends">
            <input type="number" step="0.5" value={form.yOpen} onChange={set("yOpen")} />
          </Field>
          <Field label="HISTORY LENGTH H">
            <input type="number" min={20} max={1000} value={form.H} onChange={set("H")} />
          </Field>
          <Field label="LIVE TICKS T">
            <input type="number" min={5} max={300} value={form.T} onChange={set("T")} />
          </Field>
          <Field label="SECONDS PER TICK" hint="1 – 30">
            <input type="number" min={1} max={30} value={form.secondsPerTick} onChange={set("secondsPerTick")} />
          </Field>
          <Field label="RESEARCH MINUTES">
            <input type="number" min={0.25} max={60} step="0.25" value={form.researchMinutes} onChange={set("researchMinutes")} />
          </Field>
          <Field label="PIN A SEED" hint="blank = fresh random seed">
            <input type="text" value={form.seed} onChange={set("seed")} placeholder="random" />
          </Field>
          <Field label="STARTING CASH ($)">
            <input type="number" min={100} step={1000} value={form.startCash} onChange={set("startCash")} />
          </Field>
          <Field label="SHARES PER CLICK">
            <input type="number" min={1} max={50} value={form.defaultSize} onChange={set("defaultSize")} />
          </Field>
        </div>
        <label className="checkrow">
          <input type="checkbox" checked={form.naiveBot} onChange={set("naiveBot")} />
          naive desk on — quotes ±4 around the random-walk price every 10 s
        </label>
        <label className="checkrow">
          <input type="checkbox" checked={form.keepPlayers} onChange={set("keepPlayers")} />
          keep the players and teams from the last round
        </label>
        <div className="btnrow">
          <PxButton
            variant="gold"
            disabled={!!busy}
            onClick={() =>
              act("build", async () => {
                const out = await api.post("admin/round", payload());
                setNote(`Round ${out.round.roundId} built — ${out.peek.presetName}, seed ${out.peek.seed}. Open research when the room is ready.`);
              })
            }
          >
            {busy === "build" ? <Spinner text="BUILDING" /> : "CREATE ROUND"}
          </PxButton>
          <PxButton
            disabled={!!busy || !round || locked}
            onClick={() =>
              act("settings", async () => {
                const out = await api.post("admin/settings", payload());
                setNote(`Settings saved and the process redrawn (seed ${out.peek.seed}). Players and teams kept.`);
              })
            }
          >
            SAVE SETTINGS TO THIS ROUND
          </PxButton>
        </div>
      </section>

      {/* ── run ─────────────────────────────────────────────────── */}
      {round && (
        <section className="panel">
          <div className="panel-title">RUN IT</div>
          <div className="btnrow">
            <PxButton disabled={!!busy || status !== "lobby"} onClick={() => act("start", () => api.post("admin/start", { token, minutes: form.researchMinutes }))}>
              1 · START RESEARCH
            </PxButton>
            <PxButton variant="green" disabled={!!busy || (status !== "lobby" && status !== "research")} onClick={() => act("open", () => api.post("admin/open", { token }))}>
              2 · OPEN TRADING
            </PxButton>
            <PxButton disabled={!!busy || status !== "research"} onClick={() => act("extend", () => api.post("admin/extend", { token, seconds: 60 }))}>
              +1 MIN RESEARCH
            </PxButton>
            <PxButton
              variant="red"
              disabled={!!busy || status === "settled"}
              onClick={() => {
                if (!window.confirm("End now? Every remaining tick prints at once and the round settles on the real Y_T.")) return;
                act("end", () => api.post("admin/end", { token }));
              }}
            >
              END NOW
            </PxButton>
          </div>
          <p className="hint">
            Research ends on its own and the book opens. Once live, the round settles by itself when tick T prints — the live
            clock is the process, so it cannot be extended. END NOW jumps straight to tick T.
          </p>
        </section>
      )}

      {/* ── peek ────────────────────────────────────────────────── */}
      {peek && (
        <section className="panel truth">
          <div className="panel-title">
            PEEK (YOURS ONLY)
            <span className="right">
              <button className="ghost" onClick={() => setShowPeek((v) => !v)}>
                {showPeek ? "HIDE" : "SHOW"}
              </button>
            </span>
          </div>
          {showPeek ? (
            <div className="truthgrid">
              <div>
                <i>PROCESS</i>
                <b>{peek.presetName}</b>
              </div>
              <div>
                <i>φ1 → φ2</i>
                <b>
                  {peek.phi1}
                  {peek.switchTick != null ? ` → ${peek.phi2} after tick ${peek.switchTick}` : ""}
                </b>
              </div>
              <div>
                <i>μ · σ</i>
                <b>
                  {peek.mu} · {peek.sigma}
                </b>
              </div>
              <div>
                <i>TICK · Y NOW</i>
                <b>
                  {peek.tick} · {num(peek.yNow, 2)}
                </b>
              </div>
              <div>
                <i>TRUE FAIR VALUE</i>
                <b className="north">{num(peek.fairNow, 1)}</b>
              </div>
              <div>
                <i>NAIVE (RANDOM WALK)</i>
                <b>{num(peek.naiveNow, 1)}</b>
              </div>
              <div>
                <i>MARKET MID</i>
                <b>{info.market?.bestBid != null && info.market?.bestAsk != null ? num(info.market.mid, 1) : "—"}</b>
              </div>
              <div>
                <i>OLS AT THE OPEN</i>
                <b>{peek.fitAtOpen ? `fitted φ ${num(peek.fitAtOpen.phi, 3)} ± ${num(peek.fitAtOpen.sePhi, 3)}` : "—"}</b>
              </div>
              <div>
                <i>SEED</i>
                <b className="dim">
                  {peek.seed}
                  {peek.pinned ? " (pinned)" : ""}
                </b>
              </div>
            </div>
          ) : (
            <p className="hint">Hidden so it does not end up on a shared screen. Click SHOW.</p>
          )}
        </section>
      )}

      {/* ── desks ───────────────────────────────────────────────── */}
      {info.desks && (
        <section className="panel">
          <div className="panel-title">HOUSE DESKS</div>
          <div className="kv">
            <span>NAIVE DESK {info.desks.naive.on ? "" : "(off)"}</span>
            <b>
              {info.desks.naive.on
                ? `${info.desks.naive.bid ?? "—"} / ${info.desks.naive.ask ?? "—"} · ${info.desks.naive.sent} quotes`
                : "—"}
            </b>
          </div>
          {info.desks.noise.map((n) => (
            <div className="kv" key={n.key}>
              <span>{n.key.toUpperCase()}</span>
              <b>
                {n.sent} sent · {n.fills} filled
              </b>
            </div>
          ))}
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
              <span>{money(p.valueC)}</span>
              <span className="dim">
                {p.pos > 0 ? "+" : ""}
                {p.pos} sh · {p.orders} orders
              </span>
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
        <p className="hint">Wipes the round, every player and team, and the round history. The password survives.</p>
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

/** Editing any φ field by hand means the form is no longer a preset. */
const PHI_FIELDS = new Set(["phi1", "phi2", "switchTick"]);

function Field({ label, hint, children }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <em className="field-hint">{hint}</em>}
    </div>
  );
}
