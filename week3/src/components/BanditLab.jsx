/**
 * The bandit lab — week 1's strategy lab, rebuilt around five coins.
 *
 *   1  describe a strategy in plain English
 *   2  COMPILE — the AI writes it as code, faithfully, and says in its own
 *      words what the code does
 *   3  check that is what you meant
 *   4  RUN — 10,000 games on the same coins as every other team
 *   5  save it to the team library (optional) and iterate
 *
 * The team's best average is its score. A replay of one of the 10,000 games
 * shows exactly which coins the code chose and what came up.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api, withPlayer } from "../api.js";
import { PxButton, Spinner, money, num } from "./PixelBits.jsx";

// Plain, NON-optimal examples: they teach the shape of an instruction without
// handing anyone a strategy worth using.
const EXAMPLES = [
  "flip coin A for the first 20 flips, then coin B for the rest",
  "keep flipping the same coin until it comes up tails twice in a row, then move to the next coin",
];

export default function BanditLab({ player, team, open, llm }) {
  // Drafts survive a reload: a pull-to-refresh on a phone must not eat a
  // strategy someone spent five minutes wording.
  const draftKey = `w3lab:${team?.id ?? "none"}`;
  const draft = (() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey)) ?? {};
    } catch {
      return {};
    }
  })();
  const [prompt, setPrompt] = useState(draft.prompt ?? "");
  const [compiled, setCompiled] = useState(draft.compiled ?? null);
  const [runResult, setRunResult] = useState(draft.runResult ?? null);
  const [showCode, setShowCode] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState([]);
  const [selected, setSelected] = useState(null);
  const [board, setBoard] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [view, setView] = useState("lab");

  const refresh = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        api.get("bandit/strategies", withPlayer(player)),
        api.get("bandit/board"),
      ]);
      setSaved(s.strategies);
      setBoard(b.board);
      return s.strategies;
    } catch {
      return null;
    }
  }, [player]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ prompt, compiled, runResult }));
    } catch {}
  }, [draftKey, prompt, compiled, runResult]);

  const active = selected ?? compiled;
  const mine = board.find((r) => r.teamId === team?.id) ?? null;

  async function doCompile() {
    setBusy("compile");
    setErr(null);
    setRefusal(null);
    setSelected(null);
    setRunResult(null);
    try {
      const res = await api.post("bandit/compile", withPlayer(player, { prompt }));
      if (res.refused) {
        setRefusal(res.reason);
        setCompiled(null);
      } else {
        setCompiled(res);
        setShowCode(false);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function doSave() {
    if (!compiled) return;
    setBusy("save");
    setErr(null);
    try {
      const res = await api.post(
        "bandit/save",
        withPlayer(player, {
          name,
          prompt,
          code: compiled.code,
          sig: compiled.sig,
          explain: compiled.explain,
          summary: compiled.summary,
        })
      );
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      setName("");
      await refresh();
      setSelected(res.strategy);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function doRun() {
    if (!active) return;
    setBusy("run");
    setErr(null);
    setRunResult(null);
    try {
      const body = selected
        ? { strategyId: selected.id }
        : { code: compiled.code, sig: compiled.sig, name: prompt.trim().slice(0, 24).replace(/[\s,.;:!-]+$/, "") };
      const res = await api.post("bandit/run", withPlayer(player, body));
      setRunResult(res);
      refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(s) {
    setBusy("delete");
    try {
      await api.post("bandit/delete", withPlayer(player, { strategyId: s.id }));
      if (selected?.id === s.id) setSelected(null);
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <nav className="tabbar">
        <button className={`tab ${view === "lab" ? "active" : ""}`} onClick={() => setView("lab")}>
          <span className="ico">🧪</span>LAB
        </button>
        <button className={`tab ${view === "board" ? "active" : ""}`} onClick={() => setView("board")}>
          <span className="ico">🏆</span>LEADERBOARD
        </button>
      </nav>

      {!open && (
        <div className="banner red">The bandit lab is closed right now. Your saved strategies are still here.</div>
      )}

      {view === "board" && <BanditBoard rows={board} myTeamId={team?.id} />}

      {view === "lab" && (
        <>
          <div className="panel panel--tight">
            <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <div className="stat">
                <i>THE GAME</i>
                <b>5 coins · 100 flips</b>
                <small>$100 a heads · each coin's p ~ Uniform(0, 1)</small>
              </div>
              <div className="stat">
                <i>RANDOM PLAY</i>
                <b>≈ $5,000</b>
                <small>what flipping blindly averages</small>
              </div>
              <div className="stat">
                <i>A PSYCHIC</i>
                <b>≈ $8,333</b>
                <small>always flips the best coin</small>
              </div>
              <div className="stat">
                <i>YOUR TEAM'S BEST</i>
                <b style={{ color: mine ? "var(--gold)" : undefined }}>{mine ? money(Math.round(mine.avg * 100)) : "—"}</b>
                <small>{mine ? `#${mine.rank} · ${mine.stratName}` : "run something to get on the board"}</small>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">
              BANDIT LAB
              <span className="right">{llm ? "the AI writes your code" : "offline quick-compiler (no AI key set)"}</span>
            </div>
            <div className="lab-grid">
              <div className="chatbox">
                <label className="field-label" style={{ margin: 0 }}>
                  STEP 1 · DESCRIBE YOUR STRATEGY IN PLAIN ENGLISH
                </label>
                <textarea
                  value={prompt}
                  rows={4}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    if (refusal) setRefusal(null);
                    if (selected) setSelected(null);
                  }}
                  placeholder={`spell out how to choose coins — e.g. "${EXAMPLES[0]}"`}
                />
                <div className="hint" style={{ marginTop: 0 }}>
                  Your code sees how many flips it has used, and every result from every coin so far. It can NOT see
                  any coin's true probability — nobody can. The AI codes <b>exactly what you describe</b>; it won't
                  improve it, and it will push back if you ask it to pick the strategy for you.
                </div>
                <div className="hint" style={{ marginTop: 0 }}>
                  for example:{" "}
                  {EXAMPLES.map((ex, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && " · "}
                      <span style={{ color: "var(--muted)" }}>"{ex}"</span>
                    </React.Fragment>
                  ))}
                </div>
                <div className="row">
                  <PxButton variant="blue" onClick={doCompile} disabled={!open || busy !== null || prompt.trim().length < 3}>
                    {busy === "compile" ? <Spinner text="COMPILING" /> : "⚙ STEP 2 · COMPILE"}
                  </PxButton>
                </div>

                {busy === "compile" && (
                  <div className="ai-writing">
                    <div className="ai-writing-label">✍ THE AI IS WRITING YOUR STRATEGY…</div>
                    <div className="ai-bar">
                      <span />
                    </div>
                  </div>
                )}

                {refusal && <div className="note">🚫 The AI wouldn't compile that: {refusal}</div>}

                {active && (
                  <div className="readback">
                    <div className="rb-title">
                      {selected ? `SAVED STRATEGY: ${selected.name}` : "STEP 3 · CHECK IT — THIS IS EXACTLY WHAT IT WILL DO"}
                    </div>
                    <p style={{ margin: 0, color: "var(--ink)", lineHeight: 1.6 }}>{active.explain || "(no description)"}</p>
                    {!selected && compiled?.note && <div className="note">⚠ {compiled.note}</div>}
                    <div className="row mt">
                      <PxButton variant="ghost" small onClick={() => setShowCode(!showCode)}>
                        {showCode ? "HIDE CODE" : "VIEW CODE"}
                      </PxButton>
                      {!selected && (
                        <span className="hint" style={{ margin: 0 }}>
                          {compiled?.source === "llm" ? "written by the AI from your words" : "written by the built-in quick compiler"}
                        </span>
                      )}
                    </div>
                    {showCode && <pre className="codeview mt">{active.code}</pre>}
                  </div>
                )}

                <div className="row">
                  <PxButton variant="green" onClick={doRun} disabled={!open || busy !== null || !active}>
                    {busy === "run" ? (
                      <Spinner text="PLAYING 10,000 GAMES" />
                    ) : selected ? (
                      `▸ STEP 4 · RUN SAVED: ${Array.from(selected.name).slice(0, 14).join("").toUpperCase()}`
                    ) : (
                      "▸ STEP 4 · RUN 10,000 GAMES"
                    )}
                  </PxButton>
                </div>

                {compiled && !selected && (
                  <div className="row">
                    <input
                      type="text"
                      placeholder="name this strategy"
                      value={name}
                      maxLength={32}
                      onChange={(e) => setName(e.target.value)}
                      style={{ maxWidth: 260 }}
                    />
                    <PxButton variant="ghost" onClick={doSave} disabled={busy !== null || !name.trim()}>
                      {busy === "save" ? <Spinner text="SAVING" /> : savedFlash ? "✓ SAVED" : "💾 SAVE TO TEAM"}
                    </PxButton>
                  </div>
                )}
                {err && <div className="err">{err}</div>}
              </div>

              <div>
                <label className="field-label" style={{ marginTop: 0 }}>
                  YOUR TEAM'S STRATEGIES
                </label>
                <div className="strat-list">
                  {saved.length === 0 && <div className="hint">Nothing saved yet — compile one and name it.</div>}
                  {saved.map((s) => (
                    <div
                      key={s.id}
                      className={`strat-item ${selected?.id === s.id ? "selected" : ""}`}
                      onClick={() => {
                        setSelected(selected?.id === s.id ? null : s);
                        setRunResult(null);
                        setShowCode(false);
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="nm">{s.name}</div>
                        <div className="sub">
                          {s.best != null ? `best ${money(Math.round(s.best * 100))} · ` : ""}
                          {s.by ? `by ${s.by}` : ""}
                        </div>
                      </div>
                      <button
                        className="pxbtn pxbtn--ghost pxbtn--sm"
                        title="delete from the team library"
                        disabled={busy !== null}
                        onClick={(e) => {
                          e.stopPropagation();
                          doDelete(s);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {runResult && <RunResult res={runResult} />}
        </>
      )}
    </>
  );
}

function RunResult({ res }) {
  const s = res.stats;
  const maxB = Math.max(1, ...s.buckets);
  return (
    <div className="panel">
      <div className="panel-title">
        {res.stratName?.toUpperCase() || "YOUR STRATEGY"} · 10,000 GAMES
        <span className="right">{s.ms} ms</span>
      </div>
      {res.newBest && <div className="newbest">★ NEW TEAM BEST — ON THE BOARD ★</div>}
      <div className="result-stats">
        <div className="stat-tile">
          <div className="v">{money(Math.round(s.avg * 100))}</div>
          <div className="k">average per game</div>
        </div>
        <div className="stat-tile">
          <div className="v dim">{num(s.oraclePct, 1)}%</div>
          <div className="k">of a psychic (avg {money(Math.round(s.avgOracle * 100))})</div>
        </div>
        <div className="stat-tile">
          <div className="v dim">±{money(Math.round(s.sd * 100))}</div>
          <div className="k">typical swing per game</div>
        </div>
        <div className="stat-tile">
          <div className="v dim">{money(s.best * 100)}</div>
          <div className="k">best game</div>
        </div>
        <div className="stat-tile">
          <div className="v dim">{money(s.worst * 100)}</div>
          <div className="k">worst game</div>
        </div>
      </div>
      {s.faultRate > 0 && (
        <div className="note">
          Your code errored or returned something that isn't a coin on {num(s.faultRate * 100, 1)}% of flips — those
          flips went to the least-flipped coin instead.
        </div>
      )}

      <span className="field-label mt">WHERE YOUR 10,000 GAMES LANDED</span>
      <div className="hist">
        {s.buckets.map((c, i) => (
          <i key={i} style={{ height: `${(c / maxB) * 100}%` }} title={`$${i * 500}–$${i * 500 + 499}: ${c} games`} />
        ))}
      </div>
      <div className="hist-scale">
        <span>$0</span>
        <span>$5,000</span>
        <span>$10,000</span>
      </div>

      {res.sample && <Replay sample={res.sample} />}
    </div>
  );
}

/** One of the 10,000 games, flip by flip, with the coins' true odds shown. */
function Replay({ sample }) {
  const names = ["A", "B", "C", "D", "E"];
  const best = sample.ps.indexOf(Math.max(...sample.ps));
  return (
    <>
      <span className="field-label mt">ONE GAME, REPLAYED · {money(sample.total * 100)}</span>
      <div className="replay">
        {sample.ps.map((p, c) => {
          const mine = sample.log.filter((f) => f.coin === c);
          const heads = mine.reduce((s, f) => s + f.heads, 0);
          return (
            <div key={c} className={`replay-row ${c === best ? "best" : ""}`}>
              <span className="rn">
                COIN {names[c]}
                <small>true p {num(p * 100, 0)}%</small>
              </span>
              <span className="rt">
                {sample.log.map((f) => (
                  <i key={f.t} className={f.coin !== c ? "x" : f.heads ? "h" : "t"} />
                ))}
              </span>
              <span className="rs">
                {heads}/{mine.length}
              </span>
            </div>
          );
        })}
      </div>
      <div className="hint">
        Each column is one flip, left to right; gold is heads. The green coin was the best one this game — how quickly
        did your strategy find it?
      </div>
    </>
  );
}

export function BanditBoard({ rows, myTeamId, limit = 60, big = false }) {
  if (!rows?.length) return <div className="panel hint">No team has run a strategy yet.</div>;
  return (
    <div className="panel">
      <div className="panel-title">
        BANDIT LAB · BEST AVERAGE OVER 10,000 GAMES
        <span className="right">random ≈ $5,000 · psychic ≈ $8,333</span>
      </div>
      <div className="lb">
        {rows.slice(0, limit).map((r) => (
          <div key={r.teamId} className={`lbrow ${r.teamId === myTeamId ? "me" : ""} p${r.rank}`} style={big ? { fontSize: 20 } : undefined}>
            <span className="rk">{r.rank}</span>
            <span className="nm">
              {r.teamName}
              <small>
                "{r.stratName}" · by {r.by} · {r.runs} run{r.runs === 1 ? "" : "s"}
              </small>
            </span>
            <span>
              <span className="vl">{money(Math.round(r.avg * 100))}</span>
              <span className="dl">
                <br />
                {num(r.oraclePct, 1)}% of psychic
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
