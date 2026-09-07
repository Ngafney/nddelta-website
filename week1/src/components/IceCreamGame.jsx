/**
 * Sunset Scoops — the ice-cream weather-hedging tab.
 *
 * You describe a hedging plan in plain English; the AI compiles it to a bot;
 * you run it over 10 years of weather and watch a cumulative-profit graph and
 * a day-by-day visualizer of every hedge it placed. One leaderboard: fewest
 * bankruptcies (ties broken by total profit). Sharpe is still shown as a stat.
 *
 * Minimalist by default — the page is spare; every hint, tip and long label
 * lives behind a collapsed reveal toggle (same pattern as RulesPanel).
 * Self-contained: fetches its own data via `api`.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, withTeam } from "../api.js";
import { PxButton, Spinner } from "./PixelBits.jsx";
import RulesPanel from "./RulesPanel.jsx";
import { Board } from "./Leaderboards.jsx";
import "./IceCreamGame.css";

/* Contract columns, in board order. */
const PRICE_KEYS = [
  ["under_65", "Under 65°"],
  ["over_65", "Over 65°"],
  ["under_70", "Under 70°"],
  ["over_70", "Over 70°"],
  ["under_75", "Under 75°"],
  ["over_75", "Over 75°"],
  ["under_80", "Under 80°"],
  ["over_80", "Over 80°"],
  ["rain_yes", "Rain YES"],
  ["rain_no", "Rain NO"],
];

/* Example phrasings — inspiration only, NOT click-to-fill. Deliberately plain. */
const EXAMPLES = [
  "if the forecast 3 days out is below 68°, hold 700 under-70 contracts for that day",
  "when rain looks likely 2 days out, hold rain-yes contracts sized to the rain chance",
];

const money = (v) => (v == null || Number.isNaN(v) ? "—" : (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString());
const signed = (v) => (v == null || Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "-") + "$" + Math.abs(Math.round(v)).toLocaleString());

/* Pick a weather mood from a day (drives hero + scene emoji). */
function moodOf(day) {
  if (!day) return { key: "sunny", emoji: "☀️", label: "SUNNY" };
  if (day.rained) return { key: "rainy", emoji: "🌧️", label: "RAINY" };
  if (day.tempHigh != null && day.tempHigh < 58) return { key: "cold", emoji: "❄️", label: "COLD" };
  if (day.tempHigh != null && day.tempHigh < 68) return { key: "cloudy", emoji: "⛅", label: "COOL" };
  return { key: "sunny", emoji: "☀️", label: "SUNNY" };
}

/* Trigger a client-side file download from a text blob. */
function downloadText(filename, text, type = "text/csv") {
  try {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch {
    /* download blocked — nothing we can do gracefully */
  }
}

/* ── the hero scene ─────────────────────────────────────────────────────── */

function Hero({ day }) {
  const mood = moodOf(day);
  return (
    <div className={`ic-hero ${mood.key}`}>
      {mood.key === "cold" || mood.key === "rainy" ? <div className="ic-moon">🌙</div> : <div className="ic-sun" />}
      <div className="ic-cloud c1" />
      <div className="ic-cloud c2" />
      <div className="ic-cloud c3" />
      {mood.key === "rainy" && (
        <div className="ic-rain">
          {Array.from({ length: 26 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 3.9) % 100}%`, animationDelay: `${(i % 7) * 0.09}s` }} />
          ))}
        </div>
      )}
      <div className="ic-cream">
        <div className="ic-cherry" />
        <div className="ic-scoop s3" />
        <div className="ic-scoop s2" />
        <div className="ic-scoop s1" />
        <div className="ic-conebody" />
      </div>
      <div className="ic-hero-weather">
        {mood.emoji} {mood.label}
        {day && <> · {day.tempHigh != null ? `${Math.round(day.tempHigh)}°` : ""}</>}
      </div>
      <div className="ic-hero-title">
        <div className="big">SUNSET SCOOPS</div>
        <span className="small">HEDGE THE WEATHER · KEEP THE SHOP ALIVE</span>
      </div>
    </div>
  );
}

/* ── a collapsible info toggle ──────────────────────────────────────────── */

function Info({ label = "WHAT'S THIS?", children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ic-info">
      <button className="ic-info-btn" onClick={() => setOpen((o) => !o)}>
        {open ? "▾ " : "▸ "}
        {label}
      </button>
      {open && <div className="ic-info-body">{children}</div>}
    </div>
  );
}

/* ── cumulative-profit chart (hand-drawn SVG) ───────────────────────────── */

function ProfitChart({ days, current, onScrub }) {
  const [hover, setHover] = useState(null); // {i, x, y}
  const W = 900;
  const H = 320;
  const padL = 64;
  const padR = 18;
  const padT = 18;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const geom = useMemo(() => {
    if (!days || days.length === 0) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of days) {
      if (d.cum < lo) lo = d.cum;
      if (d.cum > hi) hi = d.cum;
    }
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    // pad the range a touch
    const span = hi - lo;
    lo -= span * 0.06;
    hi += span * 0.06;
    const n = days.length;
    const xOf = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
    const yOf = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

    let line = "";
    for (let i = 0; i < n; i++) line += (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + " " + yOf(days[i].cum).toFixed(1);
    const area = line + `L${xOf(n - 1).toFixed(1)} ${(padT + plotH).toFixed(1)}L${xOf(0).toFixed(1)} ${(padT + plotH).toFixed(1)}Z`;

    // year gridlines from date changes
    const years = [];
    let lastYear = null;
    for (let i = 0; i < n; i++) {
      const y = (days[i].date || "").slice(0, 4);
      if (y && y !== lastYear) {
        years.push({ i, y });
        lastYear = y;
      }
    }
    // horizontal value ticks (5 lines incl. zero if in range)
    const ticks = [];
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      ticks.push({ v, y: yOf(v) });
    }
    const zeroY = v0InRange(lo, hi) ? yOf(0) : null;

    const bankruptcies = [];
    for (let i = 0; i < n; i++) if (days[i].bankrupt) bankruptcies.push({ i, x: xOf(i), y: yOf(days[i].cum) });

    return { xOf, yOf, line, area, years, ticks, zeroY, bankruptcies, n, lo, hi };
  }, [days, plotW, plotH]);

  if (!geom) return null;

  function handleMove(e) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const frac = Math.min(1, Math.max(0, (px - padL) / plotW));
    const i = Math.round(frac * (geom.n - 1));
    setHover({ i, x: geom.xOf(i), y: geom.yOf(days[i].cum) });
  }

  const curX = geom.xOf(current);
  const tip = hover ?? (current != null ? { i: current, x: curX, y: geom.yOf(days[current].cum) } : null);

  return (
    <div className="ic-chart-wrap">
      <svg
        className="ic-chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => hover && onScrub?.(hover.i)}
        style={{ cursor: "crosshair" }}
      >
        <defs>
          <linearGradient id="icFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5c542" stopOpacity="0.45" />
            <stop offset="55%" stopColor="#f5c542" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#f5c542" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* value gridlines + labels */}
        {geom.ticks.map((t, k) => (
          <g key={k}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#24406e" strokeWidth="1" opacity="0.5" />
            <text x={padL - 8} y={t.y + 4} textAnchor="end" fontSize="11" fill="#8ea3c8" fontFamily="monospace">
              {money(t.v)}
            </text>
          </g>
        ))}
        {/* zero baseline, emphasised */}
        {geom.zeroY != null && <line x1={padL} y1={geom.zeroY} x2={W - padR} y2={geom.zeroY} stroke="#5b6f96" strokeWidth="1.5" strokeDasharray="4 4" />}

        {/* year gridlines + labels */}
        {geom.years.map((yr, k) => {
          const x = geom.xOf(yr.i);
          return (
            <g key={k}>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="#182c4e" strokeWidth="1" />
              <text x={x} y={H - 10} textAnchor="middle" fontSize="10" fill="#5b6f96" fontFamily="monospace">
                {yr.y}
              </text>
            </g>
          );
        })}

        {/* area + line */}
        <path d={geom.area} fill="url(#icFill)" />
        <path d={geom.line} fill="none" stroke="#f5c542" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* bankruptcy markers */}
        {geom.bankruptcies.map((b, k) => (
          <g key={k}>
            <line x1={b.x} y1={padT} x2={b.x} y2={padT + plotH} stroke="#f8717a" strokeWidth="1" opacity="0.3" />
            <circle cx={b.x} cy={b.y} r="4" fill="#f8717a" stroke="#2a0f14" strokeWidth="1.5" />
          </g>
        ))}

        {/* current-day marker */}
        {current != null && (
          <g>
            <line x1={curX} y1={padT} x2={curX} y2={padT + plotH} stroke="#60a5fa" strokeWidth="1.5" opacity="0.8" />
            <circle cx={curX} cy={geom.yOf(days[current].cum)} r="4.5" fill="#60a5fa" stroke="#06111f" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {tip && (
        <div
          className="ic-chart-tip"
          style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}
        >
          {days[tip.i].date} · {money(days[tip.i].cum)}
          {days[tip.i].bankrupt && <span style={{ color: "var(--red)" }}> · BANKRUPT</span>}
        </div>
      )}

      <div className="ic-chart-legend">
        <span><i style={{ background: "#f5c542" }} /> cumulative profit</span>
        <span><i style={{ background: "#60a5fa" }} /> current day</span>
        <span><i style={{ background: "#f8717a" }} /> bankruptcy</span>
        <span style={{ color: "var(--dim)" }}>click the graph to jump there</span>
      </div>
    </div>
  );
}

function v0InRange(lo, hi) {
  return lo <= 0 && hi >= 0;
}

/* ── the rolling forecast-market strip (a compact forward curve) ─────────── */

function MarketStrip({ markets }) {
  const ms = markets ?? [];
  if (ms.length === 0) return <div className="ic-bets-empty">—</div>;
  const temps = ms.map((m) => m.tempMean).filter((t) => t != null);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const span = hi - lo || 1;
  const W = 260;
  const H = 40;
  const xOf = (i) => (ms.length <= 1 ? 0 : (i / (ms.length - 1)) * W);
  const yOf = (t) => H - 4 - ((t - lo) / span) * (H - 8);
  const line = ms.map((m, i) => (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + " " + yOf(m.tempMean).toFixed(1)).join(" ");

  return (
    <div className="ic-market">
      <svg className="ic-market-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={line} fill="none" stroke="#f5c542" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {ms.map((m, i) => (
          <circle key={i} cx={xOf(i)} cy={yOf(m.tempMean)} r="2" fill="#f5c542" />
        ))}
      </svg>
      <div className="ic-market-cells">
        {ms.map((m) => (
          <div key={m.offset} className={`ic-mcell ${m.offset === 0 ? "now" : ""}`}>
            <span className="mo">{m.offset === 0 ? "TODAY" : `+${m.offset}`}</span>
            <span className="mt">{m.tempMean != null ? `${Math.round(m.tempMean)}°` : "—"}</span>
            <span className="msd">{m.tempSd ? `±${Math.round(m.tempSd)}` : ""}</span>
            <span className="mr" title="rain chance" style={{ opacity: 0.25 + 0.75 * Math.min(1, (m.pRain ?? 0) / 0.6) }}>
              ☔{Math.round((m.pRain ?? 0) * 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── day-by-day visualizer ──────────────────────────────────────────────── */

function Visualizer({ run }) {
  const days = run.days;
  const [i, setI] = useState(0);
  const [dateInput, setDateInput] = useState("");
  const clamp = (n) => Math.min(days.length - 1, Math.max(0, n));
  const day = days[i];
  const mood = moodOf(day);

  const bankruptIdx = useMemo(() => days.reduce((acc, d, idx) => (d.bankrupt ? (acc.push(idx), acc) : acc), []), [days]);

  const jumpBankruptcy = (dir) => {
    if (bankruptIdx.length === 0) return;
    if (dir > 0) {
      const next = bankruptIdx.find((idx) => idx > i);
      setI(next ?? bankruptIdx[0]);
    } else {
      const prev = [...bankruptIdx].reverse().find((idx) => idx < i);
      setI(prev ?? bankruptIdx[bankruptIdx.length - 1]);
    }
  };

  const jumpDate = () => {
    if (!dateInput) return;
    const idx = days.findIndex((d) => (d.date || "").startsWith(dateInput.trim()));
    if (idx >= 0) setI(idx);
  };

  // reserves bar geometry
  const barMax = useMemo(() => Math.max(4000, ...days.map((d) => d.reserves ?? 0)), [days]);
  const res = day.reserves ?? 0;
  const resPct = Math.max(0, Math.min(100, (res / barMax) * 100));
  const resClass = day.bankrupt || res <= 0 ? "danger" : res < 800 ? "warn" : "safe";

  const trades = day.trades ?? [];
  const cLabel = (k) => PRICE_KEYS.find(([kk]) => kk === k)?.[1] ?? k;
  const offLabel = (o) => (o === 0 ? "today" : `+${o}d`);

  return (
    <div className="ic-viz">
      {/* header: date + weather scene */}
      <div className={`ic-viz-head ${day.bankrupt ? "bankrupt" : ""}`}>
        <div className="ic-viz-scene">{mood.emoji}</div>
        <div>
          <div className="ic-viz-date">{day.date}{day.bankrupt && <span style={{ color: "var(--red)" }}> · BANKRUPT!</span>}</div>
          <div className="ic-viz-dow">day {day.t ?? i + 1} of {days.length}{day.dow != null ? ` · ${dowName(day.dow)}` : ""}</div>
        </div>
        <div className="ic-viz-wx">
          forecast high <b>{day.forecastHigh != null ? `${Math.round(day.forecastHigh)}°` : "—"}</b> · actual <b>{day.tempHigh != null ? `${Math.round(day.tempHigh)}°` : "—"}</b>
          <br />
          {day.rained ? "it rained 🌧️" : "no rain"}
          {day.billed ? " · 💸 BILLING DAY" : ""}
        </div>
      </div>

      {/* controls */}
      <div className="ic-controls">
        <PxButton variant="ghost" small onClick={() => setI(clamp(i - 1))} disabled={i === 0}>◀ PREV</PxButton>
        <input
          className="ic-scrub"
          type="range"
          min={0}
          max={days.length - 1}
          value={i}
          onChange={(e) => setI(Number(e.target.value))}
        />
        <PxButton variant="ghost" small onClick={() => setI(clamp(i + 1))} disabled={i === days.length - 1}>NEXT ▶</PxButton>
      </div>
      <div className="ic-controls">
        <input
          type="text"
          value={dateInput}
          placeholder="jump to date e.g. 2027-07"
          onChange={(e) => setDateInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && jumpDate()}
          style={{ maxWidth: 190 }}
        />
        <PxButton variant="ghost" small onClick={jumpDate}>GO</PxButton>
        {bankruptIdx.length > 0 && (
          <>
            <PxButton variant="red" small onClick={() => jumpBankruptcy(-1)}>◀ BANKRUPTCY</PxButton>
            <PxButton variant="red" small onClick={() => jumpBankruptcy(1)}>BANKRUPTCY ▶</PxButton>
          </>
        )}
      </div>

      {/* forecast market + trades */}
      <div className="ic-daygrid">
        <div className="ic-panel-sm">
          <div className="h">Forecast market · next {day.markets?.length ?? 8} days</div>
          <MarketStrip markets={day.markets} />
        </div>

        <div className="ic-panel-sm">
          <div className="h">Trades today {day.openContracts ? `· ${day.openContracts.toLocaleString()} open` : ""}</div>
          {trades.length === 0 ? (
            <div className="ic-bets-empty">no trades today — the bot held steady</div>
          ) : (
            <div className="ic-trades">
              {trades.map((tr, k) => {
                const buy = (tr.to ?? 0) > (tr.from ?? 0);
                return (
                  <div key={k} className={`ic-trade ${buy ? "buy" : "sell"}`}>
                    <span className="tside">{buy ? "BUY" : "SELL"}</span>
                    <span className="tk">{cLabel(tr.contract)} <i>{offLabel(tr.offset)}</i></span>
                    <span className="tq">{tr.from}→{tr.to}</span>
                    <span className="tp">¢{Math.round((tr.price ?? 0) * 100)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="ic-pnl-split">
            <span>mark-to-mkt <b className={(day.mtm ?? 0) >= 0 ? "pos" : "neg"}>{signed(day.mtm)}</b></span>
            <span>settled <b className={(day.settled ?? 0) >= 0 ? "pos" : "neg"}>{signed(day.settled)}</b></span>
            <span>hedge P&amp;L <b className={(day.hedgePnl ?? 0) >= 0 ? "pos" : "neg"}>{signed(day.hedgePnl)}</b></span>
          </div>
        </div>
      </div>

      {/* money row */}
      <div className="ic-money">
        <div className="cell"><div className="v">{money(day.revenue)}</div><div className="k">revenue</div></div>
        <div className="cell"><div className={`v ${(day.hedgePnl ?? 0) >= 0 ? "pos" : "neg"}`}>{signed(day.hedgePnl)}</div><div className="k">hedge p&amp;l</div></div>
        <div className="cell"><div className={`v ${(day.profit ?? 0) >= 0 ? "pos" : "neg"}`}>{signed(day.profit)}</div><div className="k">day profit</div></div>
        <div className="cell"><div className="v">{money(day.cum)}</div><div className="k">cumulative</div></div>
      </div>

      {/* reserves bar toward bankruptcy */}
      <div className="ic-reserves">
        <div className="lbl">
          <span>RESERVES <b>{money(res)}</b></span>
          <span style={{ color: "var(--red)" }}>bankruptcy at $0</span>
        </div>
        <div className="ic-resbar">
          <span className="zero" />
          <span className={`fill ${resClass}`} style={{ width: `${resPct}%` }} />
        </div>
      </div>
    </div>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dowName(d) {
  return DOW[((d % 7) + 7) % 7] ?? "";
}

/* ── main component ─────────────────────────────────────────────────────── */

export default function IceCreamGame({ team }) {
  const draftKey = `w1lab:icecream:${team.teamId}`;
  const draft = (() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey)) ?? {};
    } catch {
      return {};
    }
  })();

  const [prompt, setPrompt] = useState(draft.prompt ?? "");
  const [compiled, setCompiled] = useState(draft.compiled ?? null); // {code, explain, summary, source}
  const [showCode, setShowCode] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(null); // 'compile' | 'run' | 'save' | 'training'
  const [err, setErr] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [runResult, setRunResult] = useState(draft.runResult ?? null); // {run, newBestBankruptcies}
  const [savedFlash, setSavedFlash] = useState(false);
  const [chartCurrent, setChartCurrent] = useState(0);

  const active = selected ?? compiled;
  const activeReady = !!active?.code;
  const activeName = selected ? selected.name : name.trim() || null;

  const refresh = useCallback(async () => {
    try {
      const res = await api.get(`strategies?teamId=${team.teamId}&token=${team.token}&game=icecream`);
      setSaved(res.strategies ?? []);
      return res.strategies ?? [];
    } catch {
      return null;
    }
  }, [team]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ prompt, compiled, runResult }));
    } catch {}
  }, [draftKey, prompt, compiled, runResult]);

  async function compile() {
    setBusy("compile");
    setErr(null);
    setRefusal(null);
    setSelected(null);
    try {
      const res = await api.post("compile", withTeam(team, { game: "icecream", prompt }));
      if (res.refused) {
        setRefusal(res.reason);
        setCompiled(null);
      } else {
        setCompiled(res);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!compiled) return;
    setBusy("save");
    setErr(null);
    try {
      const savedName = name.trim() || "untitled";
      const res = await api.post(
        "strategy",
        withTeam(team, { game: "icecream", name, prompt, code: compiled.code, explain: compiled.explain, summary: compiled.summary })
      );
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      setName("");
      const list = await refresh();
      const justSaved = (list ?? []).find((s) => s.id === res.id) ?? { id: res.id, name: savedName, code: compiled.code, prompt, explain: compiled.explain, summary: compiled.summary };
      setSelected(justSaved);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function del(id, e) {
    e.stopPropagation();
    try {
      await api.post("delete-strategy", withTeam(team, { strategyId: id }));
      if (selected?.id === id) setSelected(null);
      refresh();
    } catch (er) {
      setErr(er.message);
    }
  }

  async function run() {
    if (!activeReady) return;
    setBusy("run");
    setErr(null);
    setRunResult(null);
    try {
      const label = activeName ?? (prompt.trim().slice(0, 24).replace(/[\s,.;:!-]+$/, "")) ?? null;
      const res = await api.post("ice/run", withTeam(team, { code: active.code, name: label }));
      setRunResult(res);
      setChartCurrent(0);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function downloadTraining() {
    setBusy("training");
    setErr(null);
    try {
      const res = await api.get("ice/training");
      downloadText("sunset-scoops-training.csv", res.csv ?? "");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  function downloadMoves() {
    const r = runResult?.run;
    if (!r?.days?.length) return;
    const priceCols = PRICE_KEYS.map(([k]) => `price_${k}`);
    const header = ["date", "dow", "forecastHigh", "tempHigh", "precip", "rained", ...priceCols, "mtm", "settled", "hedgePnl", "openContracts", "revenue", "profit", "cum", "reserves", "billed", "bankrupt", "trades"];
    // trades → "contract@offset:from>to@price; ..." in one quoted cell.
    const tradeStr = (d) =>
      (d.trades ?? [])
        .map((t) => `${t.contract}@${t.offset}:${t.from}>${t.to}@${t.price}`)
        .join("; ");
    const rows = r.days.map((d) => {
      const cells = [
        d.date,
        d.dow ?? "",
        d.forecastHigh ?? "",
        d.tempHigh ?? "",
        d.precip ?? "",
        d.rained ? 1 : 0,
        ...PRICE_KEYS.map(([k]) => d.prices?.[k] ?? ""),
        d.mtm ?? "",
        d.settled ?? "",
        d.hedgePnl ?? "",
        d.openContracts ?? 0,
        d.revenue ?? "",
        d.profit ?? "",
        d.cum ?? "",
        d.reserves ?? "",
        d.billed ? 1 : 0,
        d.bankrupt ? 1 : 0,
        `"${tradeStr(d)}"`,
      ];
      return cells.join(",");
    });
    downloadText("sunset-scoops-my-moves.csv", [header.join(","), ...rows].join("\n"));
  }

  const shown = selected ?? compiled;
  const runData = runResult?.run;
  const heroDay = runData ? runData.days[Math.min(chartCurrent, runData.days.length - 1)] : null;

  return (
    <>
      <RulesPanel game="icecream" />
      <Hero day={heroDay} />

      {/* ── COMPILE LAB ─────────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-title">STRATEGY LAB <span className="tag">describe → compile → run</span></div>

        <div className="lab-grid">
          <div className="chatbox">
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (refusal) setRefusal(null);
                if (selected) setSelected(null);
              }}
              placeholder={`describe your hedging plan — e.g. "${EXAMPLES[0]}"`}
            />

            <Info label="HOW TO WRITE A GOOD PLAN">
              The AI codes <b>exactly what you describe</b> — it won't improve it, and it refuses
              "just make me win" / "never go bankrupt" asks. Each day your bot sees a rolling{" "}
              <b>8-day forecast market</b> (today + 7 days ahead); you hold contracts keyed like{" "}
              <span className="ex">under_70@3</span> (the high is under 70° three days out). Trading is
              on margin and marked to market daily, so buying a contract cheap and selling once it rises{" "}
              <b>locks in the gain</b>. It's a fair market — hedging changes your risk, not your average.
              Get your plan across in plain English — you don't have to cover every case.
              <div style={{ marginTop: 10 }}>
                for example:{" "}
                {EXAMPLES.map((ex, k) => (
                  <React.Fragment key={k}>
                    {k > 0 && " · "}
                    <span className="ex">"{ex}"</span>
                  </React.Fragment>
                ))}
              </div>
            </Info>

            <Info label="WHAT YOU CAN TRADE">
              Ten contracts, on any of eight days. Each pays <b>$1</b> if it comes true.
              <div className="ic-keys">
                {PRICE_KEYS.map(([k, label]) => (
                  <span className="ic-key" key={k}>
                    <span className="ex">{k}</span> <i>{label}</i>
                  </span>
                ))}
              </div>
              Add <span className="ex">@0</span>–<span className="ex">@7</span> to pick the day:{" "}
              <span className="ex">@0</span> is today, <span className="ex">@7</span> a week out — so{" "}
              <span className="ex">over_75@2</span> is "the high is 75°+ two days from now". A bare key
              means today. Quantities are whole numbers and can be negative (a short); everything you
              hold is capped at 60,000 contracts, and anything you don't list gets sold.
              <div style={{ marginTop: 8 }}>
                To <b>hedge</b>, buy the side that pays when sales are bad — the{" "}
                <span className="ex">under_*</span> (cold) and <span className="ex">rain_yes</span> contracts.
                The <span className="ex">over_*</span> and <span className="ex">rain_no</span> sides pay on
                good days, which is a bet on sunshine, not protection.
              </div>
            </Info>

            <div className="row">
              <PxButton variant="blue" onClick={compile} disabled={busy !== null || prompt.trim().length < 3}>
                {busy === "compile" ? <Spinner text="COMPILING" /> : "⚙ COMPILE"}
              </PxButton>
            </div>

            {busy === "compile" && (
              <div className="ai-writing">
                <div className="ai-writing-label">✍ THE AI IS WRITING YOUR BOT…</div>
                <div className="ai-bar"><span /></div>
              </div>
            )}

            {refusal && (
              <div className="err" style={{ borderColor: "#7c5a14", background: "#2a1f08", color: "var(--gold)" }}>
                🚫 The AI wouldn't compile that: {refusal}
              </div>
            )}

            {shown && (
              <div className="readback">
                <div className="rb-title">{selected ? `SAVED: ${selected.name}` : "YOUR BOT"}</div>
                <p style={{ margin: 0, color: "var(--ink)", lineHeight: 1.6 }}>{shown.explain || shown.summary || "(no description)"}</p>
                {!selected && compiled?.note && <div className="note">⚠ {compiled.note}</div>}
                <div className="row mt">
                  <PxButton variant="ghost" small onClick={() => setShowCode(!showCode)}>
                    {showCode ? "HIDE CODE" : "VIEW CODE"}
                  </PxButton>
                </div>
                {showCode && <pre className="codeview mt">{shown.code ?? "// (code unavailable)"}</pre>}
              </div>
            )}

            <div className="ic-actionrow">
              <PxButton onClick={run} disabled={busy !== null || !activeReady}>
                {busy === "run" ? <Spinner text="RUNNING 10 YRS" /> : "▸ RUN"}
              </PxButton>
              {compiled && !selected && (
                <>
                  <input
                    type="text"
                    placeholder="name it"
                    value={name}
                    maxLength={32}
                    onChange={(e) => setName(e.target.value)}
                    style={{ maxWidth: 170 }}
                  />
                  <PxButton variant="ghost" onClick={save} disabled={busy !== null || !name.trim()}>
                    {busy === "save" ? <Spinner text="SAVING" /> : savedFlash ? "✓ SAVED" : "💾 SAVE"}
                  </PxButton>
                </>
              )}
            </div>

            {err && <div className="err">{err}</div>}
          </div>

          <div>
            <label className="field-label">SAVED</label>
            <div className="strat-list">
              {saved.length === 0 && <div className="hint">Nothing saved yet.</div>}
              {saved.map((s) => (
                <div
                  key={s.id}
                  className={`strat-item ${selected?.id === s.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelected(selected?.id === s.id ? null : s);
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="nm">{s.name}</div>
                    <div className="sub">{s.summary || (s.prompt ? `“${s.prompt.slice(0, 34)}${s.prompt.length > 34 ? "…" : ""}”` : "custom")}</div>
                  </div>
                  <PxButton variant="red" small onClick={(e) => del(s.id, e)} style={{ marginLeft: "auto", flexShrink: 0 }}>✕</PxButton>
                </div>
              ))}
            </div>

            <div className="mt">
              <PxButton variant="green" onClick={downloadTraining} disabled={busy === "training"} style={{ width: "100%" }}>
                {busy === "training" ? <Spinner text="FETCHING" /> : "⬇ TRAINING DATA (CSV)"}
              </PxButton>
              <Info label="WHAT'S THE TRAINING DATA?">
                5 years of daily weather + sales history to train your bot on. Strategies are then
                scored over a separate 10 years (3653 days) your bot has never seen.
              </Info>
            </div>
          </div>
        </div>
      </section>

      {/* ── RESULTS ─────────────────────────────────────────────────────── */}
      {runData && (
        <section className="panel">
          <div className="panel-title">RESULTS <span className="tag">10-year backtest</span></div>

          {runResult.newBestBankruptcies && (
            <div className="newbest" style={{ marginBottom: 12 }}>
              ★ NEW TEAM BEST · FEWEST BANKRUPTCIES ★
            </div>
          )}

          <div className="result-stats">
            <div className="stat-tile">
              <div className="v">{runData.sharpe != null ? runData.sharpe.toFixed(2) : "—"}</div>
              <div className="k">Sharpe ratio</div>
            </div>
            <div className="stat-tile">
              <div className="v" style={{ color: runData.bankruptcies > 0 ? "var(--red)" : "var(--green)" }}>{runData.bankruptcies ?? 0}</div>
              <div className="k">bankruptcies</div>
            </div>
            <div className="stat-tile">
              <div className={`v dim`} style={{ color: (runData.meanDaily ?? 0) >= 0 ? "var(--ink)" : "var(--red)" }}>{signed(runData.meanDaily)}</div>
              <div className="k">mean daily profit</div>
            </div>
            <div className="stat-tile">
              <div className="v dim" style={{ color: (runData.totalProfit ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>{money(runData.totalProfit)}</div>
              <div className="k">total profit</div>
            </div>
          </div>

          <Info label="WHAT DO THESE MEAN?">
            <b>Sharpe</b> is mean daily profit divided by its day-to-day swing — steady earners beat
            lucky-but-wild ones (higher is better). <b>Bankruptcies</b> count days you couldn't pay the
            $1,800/14-day bill; the bank resets you to $2,000 and you start over (fewer is better).
            Over the run: {runData.testDays ?? runData.days.length} days, {runData.cycles ?? "—"} billing cycles,
            final reserves {money(runData.finalReserves)}.
          </Info>

          {/* cumulative profit graph */}
          <div className="mt">
            <label className="field-label">CUMULATIVE PROFIT · 10 YEARS</label>
            <ProfitChart days={runData.days} current={chartCurrent} onScrub={setChartCurrent} />
          </div>

          {/* day-by-day visualizer */}
          <div className="mt">
            <label className="field-label">DAY-BY-DAY</label>
            <Visualizer run={runData} />
          </div>

          <div className="ic-actionrow mt">
            <PxButton variant="ghost" onClick={downloadMoves}>⬇ MY MOVES (CSV)</PxButton>
          </div>
        </section>
      )}

      {/* ── LEADERBOARDS ────────────────────────────────────────────────── */}
      <IceLeaderboards team={team} />
    </>
  );
}

/* ── the two leaderboards, polling every 8s ─────────────────────────────── */

function IceLeaderboards({ team }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get("leaderboard?game=icecream");
        if (alive) setData(res);
      } catch {}
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="ic-boards">
      <section className="panel board">
        <div className="panel-title">🛡 FEWEST BANKRUPTCIES <span className="tag">ties broken by total profit</span></div>
        <Board
          rows={data?.bankruptcies}
          me={team.teamId}
          crown
          columns={[
            { key: "score", label: "BANKR.", cls: "score", fmt: (v) => (v == null ? "—" : v) },
            { key: "totalProfit", label: "PROFIT", cls: "dim", fmt: (v) => (v == null ? "—" : "$" + Math.round(v).toLocaleString()) },
            { key: "stratName", label: "STRATEGY", cls: "dim", fmt: (v) => v ?? "—" },
          ]}
        />
      </section>
    </div>
  );
}
