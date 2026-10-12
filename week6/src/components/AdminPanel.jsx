import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { PxButton, Spinner, money, clock, num } from "./PixelBits.jsx";
import { DEFAULTS, BOOK_ORDER, BOOKS } from "../../shared/rules.js";

/**
 * The control room. Build a round, open the books one at a time, pull the
 * numbers out of the pot by hand or on a clock, and watch the truth while the
 * room argues about it.
 */
export default function AdminPanel() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem("w6admin") || null;
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
        sessionStorage.setItem("w6admin", r.token);
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
          <input type="password" value={pw} placeholder="password" onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
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
          sessionStorage.removeItem("w6admin");
        } catch {}
        setToken(null);
      }}
    />
  );
}

const initialForm = () => ({
  K: "",
  pickSeconds: String(DEFAULTS.pickSeconds),
  autoOn: DEFAULTS.autoOn,
  autoEverySec: String(DEFAULTS.autoEverySec),
  fut: DEFAULTS.books.fut,
  call: DEFAULTS.books.call,
  put: DEFAULTS.books.put,
  noiseOn: DEFAULTS.noise.on,
  desks: String(DEFAULTS.noise.desks),
  everySec: String(DEFAULTS.noise.everySec),
  size: String(DEFAULTS.noise.size),
  sweep: String(DEFAULTS.noise.sweep),
  edge: (DEFAULTS.sharp.edgeC / 100).toFixed(2),
  sharpSize: String(DEFAULTS.sharp.size),
  sharpEvery: String(DEFAULTS.sharp.everySec),
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
  // Held as TEXT on purpose: Number("") is 0, so coercing on every keystroke
  // would turn a cleared box into a real, silently wrong setting.
  const [form, setForm] = useState(initialForm);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  // The first time a round is seen, the form starts from ITS settings.
  const prefilled = useRef(false);
  useEffect(() => {
    const p = info?.peek;
    if (!p || prefilled.current) return;
    prefilled.current = true;
    setForm((f) => ({
      ...f,
      K: p.Kreq == null ? "" : String(p.Kreq),
      pickSeconds: String(p.pickSeconds ?? DEFAULTS.pickSeconds),
      autoOn: !!p.auto?.on,
      autoEverySec: String(p.auto?.everySec ?? DEFAULTS.autoEverySec),
      fut: !!p.books?.fut,
      call: !!p.books?.call,
      put: !!p.books?.put,
      noiseOn: !!p.noise?.on,
      desks: String(p.noise?.desks ?? DEFAULTS.noise.desks),
      everySec: String(p.noise?.everySec ?? DEFAULTS.noise.everySec),
      size: String(p.noise?.size ?? DEFAULTS.noise.size),
      sweep: String(p.noise?.sweep ?? DEFAULTS.noise.sweep),
      edge: ((info.sharp?.cfg?.edgeC ?? DEFAULTS.sharp.edgeC) / 100).toFixed(2),
      sharpSize: String(info.sharp?.cfg?.size ?? DEFAULTS.sharp.size),
      sharpEvery: String(info.sharp?.cfg?.everySec ?? DEFAULTS.sharp.everySec),
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
    const h = setInterval(pull, 1200);
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
  const lobby = status === "lobby";
  const live = status === "live";
  const peek = info.peek;
  const payload = () => ({
    token,
    K: form.K.trim(),
    pickSeconds: form.pickSeconds,
    autoOn: form.autoOn,
    autoEverySec: form.autoEverySec,
    books: { fut: form.fut, call: form.call, put: form.put },
    noise: { on: form.noiseOn, desks: form.desks, everySec: form.everySec, size: form.size, sweep: form.sweep },
    seed: form.seed.trim(),
    startCash: form.startCash,
    defaultSize: form.defaultSize,
    keepPlayers: form.keepPlayers,
  });
  const noisePayload = () => ({ token, on: form.noiseOn, desks: form.desks, everySec: form.everySec, size: form.size, sweep: form.sweep });
  const sharpPayload = (extra = {}) => ({ token, edge: form.edge, size: form.sharpSize, everySec: form.sharpEvery, ...extra });
  const sharp = info.sharp;

  return (
    <div className="wrap admin">
      <header className="admin-top">
        <h2>CONTROL ROOM · WEEK 6 · THE POT</h2>
        <div>
          <span className={`phase ${status}`}>{round?.phase ?? "NO ROUND"}</span>
          {round?.msLeft != null && <span className="clock">{clock(round.msLeft)}</span>}
          {round?.locked && (
            <span className="dim">
              {" "}
              {round.revealedCount}/{round.N} out · sum {round.sum}
            </span>
          )}
          <button className="ghost" onClick={onOut}>
            LOG OUT
          </button>
        </div>
      </header>

      {!info.persistent && <div className="err-strip">STORAGE IS NOT PERSISTENT — on Vercel without Upstash every request starts blank. Run serve.js for a live room.</div>}
      {err && <div className="err-strip">{err}</div>}
      {note && <div className="ok-strip">{note}</div>}

      {/* ── the pot, live ───────────────────────────────────────── */}
      {round && round.locked && (
        <section className="panel">
          <div className="panel-title">
            THE POT <span className="right">{live ? `${round.left} still in` : "empty"}</span>
          </div>
          <div className="btnrow">
            <PxButton variant="gold" disabled={!!busy || !live} onClick={() => act("reveal", () => api.post("admin/reveal", { token }))}>
              {busy === "reveal" ? <Spinner text="PULLING" /> : `▶ REVEAL NEXT (${round.revealedCount + 1} of ${round.N})`}
            </PxButton>
            <PxButton
              variant={round.auto.on ? "red" : "green"}
              disabled={!!busy || !live}
              onClick={() => act("auto", () => api.post("admin/auto", { token, on: !round.auto.on, everySec: form.autoEverySec }))}
            >
              {round.auto.on ? "⏸ PAUSE AUTO" : `⏵ AUTO EVERY ${form.autoEverySec}s`}
            </PxButton>
            <label className="inlinefield">
              every
              <input type="number" min={1} max={120} value={form.autoEverySec} onChange={set("autoEverySec")} />s
              {round.auto.on && (
                <button className="ghost" onClick={() => act("auto", () => api.post("admin/auto", { token, on: true, everySec: form.autoEverySec }))}>
                  APPLY
                </button>
              )}
            </label>
            <PxButton
              variant="red"
              disabled={!!busy || !live}
              onClick={() => {
                if (!window.confirm("Empty the pot now? Every remaining number comes out at once and the round settles.")) return;
                act("end", () => api.post("admin/end", { token }));
              }}
            >
              END NOW
            </PxButton>
          </div>
          <div className="potstrip">
            {Array.from({ length: round.N }, (_, i) => (
              <span key={i} className={`potmini ${i < round.revealedCount ? "in" : ""}`}>
                {i < round.revealedCount ? round.revealed[i] : "·"}
              </span>
            ))}
          </div>
          {round.auto.on && round.auto.nextAt != null && <p className="hint">AUTO is on — next number in {Math.max(0, Math.ceil((round.auto.nextAt - round.serverNow) / 1000))}s.</p>}
        </section>
      )}

      {/* ── books and desks, live knobs ─────────────────────────── */}
      {round && status !== "settled" && (
        <section className="panel">
          <div className="panel-title">
            THE BOOKS <span className="right">switch any time · shutting a book pulls its resting orders</span>
          </div>
          <div className="btnrow">
            {BOOK_ORDER.map((k) => (
              <PxButton
                key={k}
                variant={round.books[k].enabled ? "green" : "ghost"}
                disabled={!!busy}
                onClick={() => act(`book-${k}`, () => api.post("admin/books", { token, [k]: !round.books[k].enabled }))}
              >
                {round.books[k].enabled ? "● " : "○ "}
                {BOOKS[k].name}
                {round.locked ? ` · ${round.books[k].orderMin}–${round.books[k].orderMax}` : ""}
              </PxButton>
            ))}
          </div>
          <div className="panel-title" style={{ marginTop: 14 }}>
            NOISE DESKS <span className="right">takers only — they never quote</span>
          </div>
          <div className="admin-grid">
            <Field label="ON">
              <input type="checkbox" checked={form.noiseOn} onChange={set("noiseOn")} />
            </Field>
            <Field label="DESKS" hint="0 – 6">
              <input type="number" min={0} max={6} value={form.desks} onChange={set("desks")} />
            </Field>
            <Field label="EVERY (s)" hint="each desk, staggered">
              <input type="number" min={2} max={120} value={form.everySec} onChange={set("everySec")} />
            </Field>
            <Field label="SHARES" hint="per market order">
              <input type="number" min={1} max={50} value={form.size} onChange={set("size")} />
            </Field>
            <Field label="SWEEP" hint="how far through the mark">
              <input type="number" min={0} max={50} value={form.sweep} onChange={set("sweep")} />
            </Field>
          </div>
          <div className="btnrow">
            <PxButton disabled={!!busy} onClick={() => act("bots", () => api.post("admin/bots", noisePayload()))}>
              APPLY DESKS
            </PxButton>
            {info.desks && (
              <span className="dim">
                {info.desks.cfg.on ? `${info.desks.desks.length} on` : "off"} ·{" "}
                {info.desks.desks.map((d) => `${d.name.replace("NOISE DESK ", "")}: ${d.sent} sent / ${d.fills} filled`).join(" · ")}
              </span>
            )}
          </div>
        </section>
      )}

      {/* ── the insider ─────────────────────────────────────────── */}
      {round && status !== "settled" && sharp && (
        <section className="panel truth">
          <div className="panel-title">
            THE INSIDER <span className="right">knows S · only ever takes · sweeps anything priced more than its edge from the true payoff</span>
          </div>
          <div className="admin-grid">
            <Field label="EDGE ($)" hint="take an order only if it is at least this far from the true payoff">
              <input type="number" min={0} step="0.05" value={form.edge} onChange={set("edge")} />
            </Field>
            <Field label="SHARES PER STRIKE" hint="across all books">
              <input type="number" min={1} max={2000} value={form.sharpSize} onChange={set("sharpSize")} />
            </Field>
            <Field label="LOOP EVERY (s)">
              <input type="number" min={2} max={600} value={form.sharpEvery} onChange={set("sharpEvery")} />
            </Field>
          </div>
          <div className="btnrow">
            <PxButton
              variant="gold"
              disabled={!!busy || !live}
              onClick={() =>
                act("strike", async () => {
                  const out = await api.post("admin/sharp", sharpPayload({ strike: true }));
                  const r = out.report;
                  setNote(r ? `Strike: ${r.shares} shares — SUM ${fmtSigned(r.fut)} · CALL ${fmtSigned(r.call)} · PUT ${fmtSigned(r.put)}` : "Nothing to take.");
                })
              }
            >
              {busy === "strike" ? <Spinner text="STRIKING" /> : "⚡ STRIKE ONCE"}
            </PxButton>
            <PxButton variant={sharp.loop ? "red" : "green"} disabled={!!busy} onClick={() => act("sharp-loop", () => api.post("admin/sharp", sharpPayload({ loop: !sharp.loop })))}>
              {sharp.loop ? "⏸ STOP THE LOOP" : `⟳ LOOP EVERY ${form.sharpEvery}s`}
            </PxButton>
            <PxButton disabled={!!busy} onClick={() => act("sharp-cfg", () => api.post("admin/sharp", sharpPayload()))}>
              APPLY SETTINGS
            </PxButton>
          </div>
          <div className="kv">
            <span>
              {sharp.strikes} strike{sharp.strikes === 1 ? "" : "s"} · {sharp.fills} shares taken
              {sharp.lastReport ? ` · last: SUM ${fmtSigned(sharp.lastReport.fut)} CALL ${fmtSigned(sharp.lastReport.call)} PUT ${fmtSigned(sharp.lastReport.put)}` : ""}
              {sharp.loop && sharp.nextAt != null && live ? ` · next in ${Math.max(0, Math.ceil((sharp.nextAt - round.serverNow) / 1000))}s` : ""}
            </span>
            <b className={sharp.pnlC > 0 ? "up" : sharp.pnlC < 0 ? "down" : ""}>{money(sharp.pnlC, { sign: true })}</b>
          </div>
          {sharp.lastError && <p className="hint">last error: {sharp.lastError}</p>}
        </section>
      )}

      {/* ── run ─────────────────────────────────────────────────── */}
      {round && lobby && (
        <section className="panel">
          <div className="panel-title">
            OPEN THE ROUND <span className="right">{round.teams} team{round.teams === 1 ? "" : "s"} so far{peek?.unpicked ? ` · ${peek.unpicked} without a number` : ""}</span>
          </div>
          <div className="btnrow">
            <PxButton disabled={!!busy || round.pickEndsAt != null || !round.teams} onClick={() => act("pick", () => api.post("admin/pick", { token, seconds: form.pickSeconds }))}>
              1 · START THE {form.pickSeconds}s PICK CLOCK
            </PxButton>
            <PxButton disabled={!!busy || round.pickEndsAt == null} onClick={() => act("extend", () => api.post("admin/extend", { token, seconds: 30 }))}>
              +30s
            </PxButton>
            <PxButton disabled={!!busy || round.pickEndsAt == null} onClick={() => act("hold", () => api.post("admin/hold", { token }))}>
              HOLD
            </PxButton>
            <PxButton variant="green" disabled={!!busy || !round.teams} onClick={() => act("open", () => api.post("admin/open", { token }))}>
              2 · OPEN TRADING NOW
            </PxButton>
          </div>
          <p className="hint">
            When the pick clock runs out, trading opens by itself. Opening seals the pot: N, K and every number are fixed, no new teams can
            form, and a team that never picked gets a number drawn for it (and is told).
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
            <>
              <div className="truthgrid">
                <div>
                  <i>S · THE SUM</i>
                  <b className="north">{peek.S}</b>
                </div>
                <div>
                  <i>N · K</i>
                  <b>
                    {peek.N} · {peek.K}
                    {peek.Kauto ? " (auto)" : ""}
                  </b>
                </div>
                <div>
                  <i>PAYS</i>
                  <b>{peek.payouts ? `SUM ${peek.payouts.fut} · CALL ${peek.payouts.call} · PUT ${peek.payouts.put}` : "—"}</b>
                </div>
                <div>
                  <i>FAIR (UNIFORM) NOW</i>
                  <b>{peek.fair ? `${num(peek.fair.fut, 1)} · ${num(peek.fair.call, 1)} · ${num(peek.fair.put, 1)}` : "—"}</b>
                </div>
                <div>
                  <i>MARKET MARKS</i>
                  <b>{peek.marks ? `${num(peek.marks.fut, 1)} · ${num(peek.marks.call, 1)} · ${num(peek.marks.put, 1)}` : "—"}</b>
                </div>
                <div>
                  <i>NEXT OUT</i>
                  <b>{peek.next ? `${peek.next.name} → ${peek.next.number}` : "—"}</b>
                </div>
                <div>
                  <i>SEED</i>
                  <b className="dim">{peek.seed}</b>
                </div>
              </div>
              <div className="playertable" style={{ marginTop: 10 }}>
                {peek.teams.map((t) => (
                  <div key={t.id} className={`prow ${t.revealed ? "dim" : ""}`}>
                    <span>{t.name}</span>
                    <span className="dim">{t.members} players</span>
                    <b className={t.number == null ? "down" : "north"}>{t.number == null ? "no number" : t.number}</b>
                    <span className="dim">{t.drawn ? "drawn" : t.revealed ? "out" : round.locked ? "in the pot" : ""}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">Hidden so it does not end up on a shared screen. Click SHOW.</p>
          )}
        </section>
      )}

      {/* ── build ───────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-title">
          {round ? "NEXT ROUND" : "BUILD A ROUND"} <span className="right">{round && !lobby ? "the current round is sealed — these go into the next one" : ""}</span>
        </div>
        <div className="admin-grid">
          <Field label="STRIKE K" hint="blank = 5 × N at the open">
            <input type="number" min={1} value={form.K} onChange={set("K")} placeholder="auto" />
          </Field>
          <Field label="PICK CLOCK (s)" hint="how long teams get to pick">
            <input type="number" min={5} max={600} value={form.pickSeconds} onChange={set("pickSeconds")} />
          </Field>
          <Field label="AUTO REVEAL" hint="start on a clock">
            <input type="checkbox" checked={form.autoOn} onChange={set("autoOn")} />
          </Field>
          <Field label="AUTO EVERY (s)">
            <input type="number" min={1} max={120} value={form.autoEverySec} onChange={set("autoEverySec")} />
          </Field>
          <Field label="OPEN AT THE START">
            <span className="checks">
              {BOOK_ORDER.map((k) => (
                <label key={k}>
                  <input type="checkbox" checked={form[k]} onChange={set(k)} /> {BOOKS[k].short}
                </label>
              ))}
            </span>
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
          <input type="checkbox" checked={form.keepPlayers} onChange={set("keepPlayers")} />
          keep the players and teams from the last round (they pick fresh numbers)
        </label>
        <div className="btnrow">
          <PxButton
            variant="gold"
            disabled={!!busy}
            onClick={() =>
              act("build", async () => {
                const out = await api.post("admin/round", payload());
                prefilled.current = true;
                setNote(`Round ${out.round.roundId} built. Teams pick their numbers; start the pick clock or open trading when the room is ready.`);
              })
            }
          >
            {busy === "build" ? <Spinner text="BUILDING" /> : "CREATE ROUND"}
          </PxButton>
          <PxButton
            disabled={!!busy || !round || !lobby}
            onClick={() =>
              act("settings", async () => {
                await api.post("admin/settings", payload());
                setNote("Settings saved to this round. Players, teams and numbers kept.");
              })
            }
          >
            SAVE SETTINGS TO THIS ROUND
          </PxButton>
        </div>
      </section>

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
                {BOOK_ORDER.filter((k) => p.pos?.[k])
                  .map((k) => `${BOOKS[k].short[0]}${p.pos[k] > 0 ? "+" : ""}${p.pos[k]}`)
                  .join(" ") || "flat"}{" "}
                · {p.orders} orders
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

const fmtSigned = (v) => (v > 0 ? `+${v}` : String(v ?? 0));

function Field({ label, hint, children }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <em className="field-hint">{hint}</em>}
    </div>
  );
}
