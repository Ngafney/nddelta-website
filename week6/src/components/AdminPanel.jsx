import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { PxButton, Spinner, money, clock, num } from "./PixelBits.jsx";
import { DEFAULTS, BOOK_ORDER, BOOKS } from "../../shared/rules.js";

/**
 * The control room, in the order the host needs it:
 *
 *   1. one big button for whatever comes next (open · draw · new round)
 *   2. which books are open
 *   …and everything else folded away until it is wanted.
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
  const [form, setForm] = useState(initialForm);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

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
  const settled = status === "settled";
  const peek = info.peek;
  const sharp = info.sharp;
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
  const build = () =>
    act("build", async () => {
      const out = await api.post("admin/round", payload());
      prefilled.current = true;
      setNote(`Round ${out.round.roundId} built. Teams pick their numbers; open trading when the room is ready.`);
    });

  return (
    <div className="wrap admin admin6">
      <header className="admin-top">
        <h2>CONTROL ROOM · THE SUM</h2>
        <div>
          <span className={`phase ${status}`}>{round?.phase ?? "NO ROUND"}</span>
          {round?.msLeft != null && <span className="clock">{clock(round.msLeft)}</span>}
          {round && (
            <span className="dim">
              {" "}
              {round.teams} teams · {round.players} players
              {round.locked ? ` · ${round.revealedCount}/${round.N} drawn · sum ${round.sum}` : peek?.unpicked ? ` · ${peek.unpicked} without a number` : ""}
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

      {/* ── 1 · what comes next ─────────────────────────────────── */}
      <section className="panel primary">
        {!round && (
          <div className="primary-row">
            <PxButton variant="gold" disabled={!!busy} onClick={build}>
              {busy === "build" ? <Spinner text="BUILDING" /> : "CREATE A ROUND"}
            </PxButton>
            <p className="hint">Players join at /week6/, form teams and pick numbers. Then you open trading.</p>
          </div>
        )}

        {lobby && (
          <div className="primary-row">
            <PxButton variant="green" disabled={!!busy || !round.teams} onClick={() => act("open", () => api.post("admin/open", { token }))}>
              {busy === "open" ? <Spinner text="OPENING" /> : "OPEN TRADING"}
            </PxButton>
            <div className="secondary">
              {round.pickEndsAt == null ? (
                <>
                  <span className="dim">or give them a clock:</span>
                  <PxButton small disabled={!!busy || !round.teams} onClick={() => act("pick", () => api.post("admin/pick", { token, seconds: form.pickSeconds }))}>
                    {form.pickSeconds}s TO PICK, THEN OPEN
                  </PxButton>
                </>
              ) : (
                <>
                  <span className="dim">opens in {clock(round.msLeft ?? 0)}</span>
                  <PxButton small disabled={!!busy} onClick={() => act("extend", () => api.post("admin/extend", { token, seconds: 30 }))}>
                    +30s
                  </PxButton>
                  <PxButton small disabled={!!busy} onClick={() => act("hold", () => api.post("admin/hold", { token }))}>
                    STOP THE CLOCK
                  </PxButton>
                </>
              )}
            </div>
            <p className="hint">
              Opening locks the teams and their numbers. {peek?.unpicked ? `${peek.unpicked} team${peek.unpicked === 1 ? " has" : "s have"} not picked — they get a number drawn.` : "Every team has a number."}
            </p>
          </div>
        )}

        {live && (
          <div className="primary-row">
            <PxButton variant="gold" disabled={!!busy} onClick={() => act("reveal", () => api.post("admin/reveal", { token }))}>
              {busy === "reveal" ? <Spinner text="DRAWING" /> : `DRAW THE NEXT NUMBER · ${round.revealedCount + 1} OF ${round.N}`}
            </PxButton>
            <div className="secondary">
              <PxButton
                small
                variant={round.auto.on ? "red" : "green"}
                disabled={!!busy}
                onClick={() => act("auto", () => api.post("admin/auto", { token, on: !round.auto.on, everySec: form.autoEverySec }))}
              >
                {round.auto.on ? "STOP AUTO" : "AUTO"}
              </PxButton>
              <label className="inlinefield">
                every
                <input type="number" min={1} max={120} value={form.autoEverySec} onChange={set("autoEverySec")} />s
              </label>
              {round.auto.on && round.auto.nextAt != null && <span className="dim">next in {Math.max(0, Math.ceil((round.auto.nextAt - round.serverNow) / 1000))}s</span>}
              <span className="spacer" />
              <PxButton
                small
                variant="red"
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm("Draw every remaining number now and settle?")) return;
                  act("end", () => api.post("admin/end", { token }));
                }}
              >
                DRAW ALL &amp; SETTLE
              </PxButton>
            </div>
            <div className="potstrip">
              {Array.from({ length: round.N }, (_, i) => (
                <span key={i} className={`potmini ${i < round.revealedCount ? "in" : ""}`}>
                  {i < round.revealedCount ? round.revealed[i] : "·"}
                </span>
              ))}
              <span className="dim" style={{ marginLeft: 8 }}>
                sum {round.sum} · still possible {round.lo}–{round.hi} · K {round.K}
              </span>
            </div>
          </div>
        )}

        {settled && (
          <div className="primary-row">
            <PxButton variant="gold" disabled={!!busy} onClick={build}>
              {busy === "build" ? <Spinner text="BUILDING" /> : "NEW ROUND — SAME TEAMS, FRESH NUMBERS"}
            </PxButton>
            <p className="hint">
              S = {round.settleS}. SUM paid {round.payouts?.fut}, CALL {round.payouts?.call}, PUT {round.payouts?.put}. The reveal is playing on the board.
            </p>
          </div>
        )}
      </section>

      {/* ── 2 · the books ───────────────────────────────────────── */}
      {round && !settled && (
        <section className="panel">
          <div className="panel-title">
            BOOKS <span className="right">click to open or shut · shutting pulls that book's resting orders</span>
          </div>
          <div className="btnrow">
            {BOOK_ORDER.map((k) => (
              <PxButton key={k} variant={round.books[k].enabled ? "green" : "ghost"} disabled={!!busy} onClick={() => act(`book-${k}`, () => api.post("admin/books", { token, [k]: !round.books[k].enabled }))}>
                {round.books[k].enabled ? "● " : "○ "}
                {BOOKS[k].short}
                {round.locked ? ` ${round.books[k].orderMin}–${round.books[k].orderMax}` : ""}
              </PxButton>
            ))}
            {round.locked && <span className="dim">K = {round.K}</span>}
          </div>
        </section>
      )}

      {/* ── folded away ─────────────────────────────────────────── */}
      {round && !settled && (
        <details className="panel fold">
          <summary>
            DESKS <span className="dim">· noise {info.desks?.cfg.on ? `${info.desks.desks.length} on` : "off"} · insider {sharp?.loop ? "looping" : `${sharp?.strikes ?? 0} strikes`}</span>
          </summary>
          <div className="fold-body">
            <div className="panel-title">NOISE DESKS <span className="right">takers only — they never quote</span></div>
            <div className="admin-grid five">
              <Field label="ON">
                <input type="checkbox" checked={form.noiseOn} onChange={set("noiseOn")} />
              </Field>
              <Field label="DESKS" hint="0 – 6">
                <input type="number" min={0} max={6} value={form.desks} onChange={set("desks")} />
              </Field>
              <Field label="EVERY (s)">
                <input type="number" min={2} max={120} value={form.everySec} onChange={set("everySec")} />
              </Field>
              <Field label="SHARES">
                <input type="number" min={1} max={50} value={form.size} onChange={set("size")} />
              </Field>
              <Field label="SWEEP ($)">
                <input type="number" min={0} max={50} value={form.sweep} onChange={set("sweep")} />
              </Field>
            </div>
            <div className="btnrow">
              <PxButton small disabled={!!busy} onClick={() => act("bots", () => api.post("admin/bots", noisePayload()))}>
                APPLY
              </PxButton>
              {info.desks && <span className="dim">{info.desks.desks.map((d) => `${d.name.replace("NOISE DESK ", "")}: ${d.sent} sent / ${d.fills} filled`).join(" · ") || "off"}</span>}
            </div>

            {sharp && (
              <>
                <div className="panel-title" style={{ marginTop: 16 }}>
                  THE INSIDER <span className="right">knows S · sweeps anything priced more than its edge from the true payoff · never quotes</span>
                </div>
                <div className="admin-grid five">
                  <Field label="EDGE ($)">
                    <input type="number" min={0} step="0.05" value={form.edge} onChange={set("edge")} />
                  </Field>
                  <Field label="SHARES / STRIKE">
                    <input type="number" min={1} max={2000} value={form.sharpSize} onChange={set("sharpSize")} />
                  </Field>
                  <Field label="LOOP EVERY (s)">
                    <input type="number" min={2} max={600} value={form.sharpEvery} onChange={set("sharpEvery")} />
                  </Field>
                </div>
                <div className="btnrow">
                  <PxButton
                    variant="gold"
                    small
                    disabled={!!busy || !live}
                    onClick={() =>
                      act("strike", async () => {
                        const out = await api.post("admin/sharp", sharpPayload({ strike: true }));
                        const r = out.report;
                        setNote(r ? `Strike: ${r.shares} shares — SUM ${fmtSigned(r.fut)} · CALL ${fmtSigned(r.call)} · PUT ${fmtSigned(r.put)}` : "Nothing to take.");
                      })
                    }
                  >
                    {busy === "strike" ? <Spinner text="STRIKING" /> : "STRIKE ONCE"}
                  </PxButton>
                  <PxButton small variant={sharp.loop ? "red" : "green"} disabled={!!busy} onClick={() => act("sharp-loop", () => api.post("admin/sharp", sharpPayload({ loop: !sharp.loop })))}>
                    {sharp.loop ? "STOP THE LOOP" : `LOOP EVERY ${form.sharpEvery}s`}
                  </PxButton>
                  <PxButton small disabled={!!busy} onClick={() => act("sharp-cfg", () => api.post("admin/sharp", sharpPayload()))}>
                    APPLY SETTINGS
                  </PxButton>
                  <span className="dim">
                    {sharp.strikes} strike{sharp.strikes === 1 ? "" : "s"} · {sharp.fills} shares taken
                    {sharp.lastReport ? ` · last: SUM ${fmtSigned(sharp.lastReport.fut)} CALL ${fmtSigned(sharp.lastReport.call)} PUT ${fmtSigned(sharp.lastReport.put)}` : ""}
                    {sharp.loop && sharp.nextAt != null && live ? ` · next in ${Math.max(0, Math.ceil((sharp.nextAt - round.serverNow) / 1000))}s` : ""}
                  </span>
                  <b className={sharp.trueC > 0 ? "up" : sharp.trueC < 0 ? "down" : ""} title="at the true payoffs">{money(sharp.trueC ?? sharp.pnlC, { sign: true })}</b>
                </div>
                {sharp.lastError && <p className="hint">last error: {sharp.lastError}</p>}
              </>
            )}
          </div>
        </details>
      )}

      {peek && (
        <details className="panel fold truth">
          <summary>
            PEEK <span className="dim">· the answer · yours only</span>
          </summary>
          <div className="fold-body">
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
                </div>
                <div className="playertable" style={{ marginTop: 10 }}>
                  {peek.teams.map((t) => (
                    <div key={t.id} className={`prow ${t.revealed ? "dim" : ""}`}>
                      <span>{t.name}</span>
                      <span className="dim">{t.members} players</span>
                      <b className={t.number == null ? "down" : "north"}>{t.number == null ? "no number" : t.number}</b>
                      <span className="dim">{t.drawn ? "drawn for them" : t.revealed ? "out" : round.locked ? "hidden" : ""}</span>
                    </div>
                  ))}
                </div>
                <button className="ghost" onClick={() => setShowPeek(false)}>
                  HIDE
                </button>
              </>
            ) : (
              <p className="hint">
                Hidden so it does not end up on a shared screen.{" "}
                <button className="ghost" onClick={() => setShowPeek(true)}>
                  SHOW
                </button>
              </p>
            )}
          </div>
        </details>
      )}

      <details className="panel fold" open={!round}>
        <summary>
          {round ? "NEXT ROUND SETTINGS" : "ROUND SETTINGS"} <span className="dim">· K, clocks, books at the start, cash</span>
        </summary>
        <div className="fold-body">
          <div className="admin-grid">
            <Field label="STRIKE K" hint="blank = 5 × N at the open">
              <input type="number" min={1} value={form.K} onChange={set("K")} placeholder="auto" />
            </Field>
            <Field label="PICK CLOCK (s)">
              <input type="number" min={5} max={600} value={form.pickSeconds} onChange={set("pickSeconds")} />
            </Field>
            <Field label="AUTO DRAW FROM THE START">
              <input type="checkbox" checked={form.autoOn} onChange={set("autoOn")} />
            </Field>
            <Field label="AUTO EVERY (s)">
              <input type="number" min={1} max={120} value={form.autoEverySec} onChange={set("autoEverySec")} />
            </Field>
            <Field label="BOOKS OPEN AT THE START">
              <span className="checks">
                {BOOK_ORDER.map((k) => (
                  <label key={k}>
                    <input type="checkbox" checked={form[k]} onChange={set(k)} /> {BOOKS[k].short}
                  </label>
                ))}
              </span>
            </Field>
            <Field label="PIN A SEED" hint="blank = random">
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
            keep the players and teams (they pick fresh numbers)
          </label>
          <div className="btnrow">
            <PxButton variant="gold" small disabled={!!busy} onClick={build}>
              {busy === "build" ? <Spinner text="BUILDING" /> : "CREATE ROUND"}
            </PxButton>
            <PxButton
              small
              disabled={!!busy || !round || !lobby}
              onClick={() =>
                act("settings", async () => {
                  await api.post("admin/settings", payload());
                  setNote("Settings saved to this round. Players, teams and numbers kept.");
                })
              }
            >
              SAVE TO THIS ROUND
            </PxButton>
          </div>
        </div>
      </details>

      <details className="panel fold">
        <summary>
          PLAYERS <span className="dim">· {info.players.length}</span>
        </summary>
        <div className="fold-body">
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
          {info.audit?.length > 0 && (
            <>
              <div className="panel-title" style={{ marginTop: 12 }}>
                AUDIT
              </div>
              {info.audit.map((a, i) => (
                <div key={i} className="err-strip">
                  {a}
                </div>
              ))}
            </>
          )}
        </div>
      </details>

      <details className="panel fold danger">
        <summary>RESET EVERYTHING</summary>
        <div className="fold-body">
          <p className="hint">Wipes the round, every player and team, and the round history. The password survives.</p>
          <PxButton
            variant="red"
            small
            disabled={!!busy}
            onClick={() => {
              if (!window.confirm("Wipe the whole game?")) return;
              act("reset", () => api.post("admin/reset", { token, confirm: "RESET" }));
            }}
          >
            RESET
          </PxButton>
        </div>
      </details>
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
