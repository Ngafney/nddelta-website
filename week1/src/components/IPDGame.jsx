/**
 * IPDGame — the "Split or Steal" (Iterated Prisoner's Dilemma) tab.
 *
 * Deliberately spare: a textarea, a handful of short buttons, the replay,
 * the standings, and your results. Every scrap of explanatory copy — how
 * it works, what your bot can (and can't) see, the example phrasings —
 * lives behind a toggle, collapsed by default. The whole hook of the game
 * is that a strategy never sees WHO it's playing, only their moves, so the
 * page keeps quiet and lets the moves do the talking.
 *
 * Self-contained: fetches its own strategies, standings, and results via
 * the shared `api`. Replaces MatchGame for the pd tab.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api, withTeam } from "../api.js";
import RulesPanel from "./RulesPanel.jsx";
import PDReplay from "./PDReplay.jsx";
import { Board } from "./Leaderboards.jsx";
import { PxButton, Spinner } from "./PixelBits.jsx";
import "./IPDGame.css";

/** Example phrasings — inspiration only, never click-to-fill. They teach
 *  the SHAPE of an instruction (react to a move, count something, set a
 *  condition), not a strategy worth stealing. Folded away by default. */
const EXAMPLES = [
  "cooperate on even-numbered rounds and defect on odd ones",
  "defect for the first ten rounds, then cooperate for the rest of the match",
  "cooperate unless my score is a multiple of 7, then defect once",
];

/** Map a `mine`/matchup round ({you,them,youPts,themPts}) to the shape the
 *  replay components speak ({a,b,pa,pb}). Exhibition rounds already match. */
const toReplay = (rounds) =>
  rounds.map((r) => ({ a: r.you, b: r.them, pa: r.youPts, pb: r.themPts }));

export default function IPDGame({ team }) {
  // Drafts survive a reload — a stray refresh shouldn't eat five minutes of
  // wording. Distinct key so it never collides with the shared lab.
  const draftKey = `w1ipd:${team.teamId}`;
  const draft = (() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey)) ?? {};
    } catch {
      return {};
    }
  })();

  const [prompt, setPrompt] = useState(draft.prompt ?? "");
  const [compiled, setCompiled] = useState(draft.compiled ?? null); // {code,explain,summary,source}
  const [exhibition, setExhibition] = useState(draft.exhibition ?? null); // {opponent,rounds,yourScore,theirScore}
  const [showCode, setShowCode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const [name, setName] = useState("");
  const [saved, setSaved] = useState([]);
  const [submittedId, setSubmittedId] = useState(null);
  const [selected, setSelected] = useState(null); // a saved strat, or null = use compiled

  const [busy, setBusy] = useState(null); // 'compile' | 'test' | 'save' | 'submit'
  const [err, setErr] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const [standings, setStandings] = useState(null);
  const [mine, setMine] = useState(null); // {me, breakdown, opponents}

  // results replay viewer selection
  const [oppIdx, setOppIdx] = useState(0);
  const [matchIdx, setMatchIdx] = useState(0);
  // A 200-round match is far too big to ship with the standings, so the
  // selected one is recomputed on demand (it's seeded — the replay is real).
  const [replay, setReplay] = useState(null);

  /* ── data ────────────────────────────────────────────────────────────── */

  const refresh = useCallback(async () => {
    try {
      const res = await api.get(`strategies?teamId=${team.teamId}&token=${team.token}&game=pd`);
      setSaved(res.strategies);
      setSubmittedId(res.submitted?.pd ?? null);
      return res;
    } catch {
      return null;
    }
  }, [team]);

  const pollStandings = useCallback(async () => {
    try {
      const res = await api.get("leaderboard?game=pd");
      setStandings(res.standings);
    } catch {}
  }, []);

  const fetchMine = useCallback(async () => {
    try {
      const res = await api.get(`pd/mine?teamId=${team.teamId}&token=${team.token}`);
      if (res.standings) setStandings(res.standings);
      setMine(res.mine ?? null);
    } catch {}
  }, [team]);

  // initial load
  useEffect(() => {
    (async () => {
      const res = await refresh();
      pollStandings();
      if (res?.submitted?.pd) fetchMine();
    })();
  }, [refresh, pollStandings, fetchMine]);

  // standings + saved-list poll (self-corrects if an admin edits either)
  useEffect(() => {
    const t = setInterval(() => {
      pollStandings();
      refresh();
    }, 8000);
    return () => clearInterval(t);
  }, [pollStandings, refresh]);

  // persist draft
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ prompt, compiled, exhibition }));
    } catch {}
  }, [draftKey, prompt, compiled, exhibition]);

  /* ── what's active ───────────────────────────────────────────────────── */

  const active = selected ?? compiled; // {code, explain, summary}
  const activeReady = !!active?.code;
  const shownExplain = active?.explain;

  /* ── actions ─────────────────────────────────────────────────────────── */

  async function compile() {
    setBusy("compile");
    setErr(null);
    setRefusal(null);
    setSelected(null);
    setExhibition(null);
    try {
      const res = await api.post("compile", withTeam(team, { game: "pd", prompt }));
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
        withTeam(team, {
          game: "pd",
          name,
          prompt,
          code: compiled.code,
          explain: compiled.explain,
          summary: compiled.summary,
        })
      );
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      setName("");
      const listRes = await refresh();
      const list = listRes?.strategies ?? [];
      // Auto-select what we just saved so TEST / SUBMIT act on it with no
      // extra click (server may auto-suffix a duplicate name → trust the id).
      const justSaved =
        list.find((s) => s.id === res.id) ?? {
          id: res.id,
          name: savedName,
          code: compiled.code,
          prompt,
          game: "pd",
          explain: compiled.explain,
          summary: compiled.summary,
        };
      setSelected(justSaved);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    if (!activeReady) return;
    setBusy("test");
    setErr(null);
    setExhibition(null);
    try {
      const res = await api.post("exhibition", withTeam(team, { game: "pd", code: active.code }));
      setExhibition(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!selected) return;
    setBusy("submit");
    setErr(null);
    try {
      const res = await api.post("submit", withTeam(team, { game: "pd", strategyId: selected.id }));
      setSubmittedId(selected.id);
      if (res.standings) setStandings(res.standings);
      if (res.mine) {
        setMine(res.mine);
        setOppIdx(0);
        setMatchIdx(0);
      } else {
        fetchMine();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  function downloadCSV() {
    if (!mine?.breakdown?.length) return;
    const header = ["opponent", "matches", "your_avg", "their_avg", "result", "your_coop_rate_pct", "your_defects"];
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const b of mine.breakdown) {
      lines.push(
        [
          esc(b.opponent),
          esc(b.matches),
          esc(b.avgFor?.toFixed?.(1) ?? b.avgFor),
          esc(b.avgAgainst?.toFixed?.(1) ?? b.avgAgainst),
          esc(b.result),
          esc(b.myCoopRate ?? ""),
          esc(b.myDefects),
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${team.name.replace(/[^\w-]+/g, "_") || "team"}_prisoners-dilemma_results.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /* ── derived ─────────────────────────────────────────────────────────── */

  const submittedName = saved.find((s) => s.id === submittedId)?.name ?? "";
  const matchups = mine?.opponents ?? [];
  const curOpp = matchups[oppIdx] ?? null;
  const curMatch = curOpp?.matches?.[matchIdx] ?? null;

  // Fetch the selected match's rounds whenever the selection changes.
  useEffect(() => {
    let alive = true;
    setReplay(null);
    if (!curOpp) return;
    (async () => {
      try {
        const r = await api.get(`pd/replay?teamId=${team.teamId}&token=${team.token}&opponentId=${encodeURIComponent(curOpp.opponentId)}&match=${matchIdx}`);
        if (alive) setReplay(r);
      } catch { /* selection changed or tournament moved on */ }
    })();
    return () => { alive = false; };
  }, [curOpp?.opponentId, matchIdx, team.teamId, team.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const resultCls = (r) => (r === "win" ? "res-win" : r === "loss" ? "res-loss" : "res-tie");

  /* ── render ──────────────────────────────────────────────────────────── */

  return (
    <>
      <RulesPanel game="pd" />

      <section className="panel">
        <div className="lab-grid">
          <div className="chatbox">
            <label className="field-label">DESCRIBE YOUR BOT</label>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (refusal) setRefusal(null);
                if (selected) setSelected(null);
              }}
              placeholder={`e.g. "${EXAMPLES[0]}"`}
            />

            <div className="ipd-lead">
              <PxButton variant="blue" onClick={compile} disabled={busy !== null || prompt.trim().length < 3}>
                {busy === "compile" ? <Spinner text="COMPILING" /> : "⚙ COMPILE"}
              </PxButton>
              <button className="pxbtn pxbtn--ghost pxbtn--sm" onClick={() => setShowHelp((v) => !v)}>
                {showHelp ? "▾ HELP" : "▸ HELP"}
              </button>
            </div>

            {showHelp && (
              <div className="ipd-reveal">
                <div className="hint" style={{ marginTop: 0 }}>
                  You never see <b>who</b> you're playing — only their moves. Each match is 10 rounds; memory
                  wipes between matches. The AI codes <b>exactly what you describe</b> and won't improve it —
                  it only pushes back if you ask it to pick the strategy for you ("just win").
                </div>
                <div className="hint">
                  for example:{" "}
                  {EXAMPLES.map((ex, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && " · "}
                      <span style={{ color: "var(--muted)" }}>"{ex}"</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {busy === "compile" && (
              <div className="ai-writing">
                <div className="ai-writing-label">✍ THE AI IS WRITING YOUR BOT…</div>
                <div className="ai-bar">
                  <span />
                </div>
              </div>
            )}

            {refusal && (
              <div className="err" style={{ borderColor: "#7c5a14", background: "#2a1f08", color: "var(--gold)" }}>
                🚫 The AI wouldn't compile that: {refusal}
              </div>
            )}

            {active && (
              <div className="readback">
                <div className="rb-title">{selected ? `SAVED · ${selected.name}` : "THIS IS EXACTLY WHAT YOUR BOT WILL DO"}</div>
                <p style={{ margin: 0, color: "var(--ink)", lineHeight: 1.6 }}>{shownExplain || "(no description)"}</p>
                <div className="row mt">
                  <PxButton variant="ghost" small onClick={() => setShowCode(!showCode)}>
                    {showCode ? "HIDE CODE" : "VIEW CODE"}
                  </PxButton>
                  {compiled && !selected && (
                    <span className="hint">
                      {compiled.source === "llm" ? "written by the AI, faithfully, from your words" : "written from your words"}
                    </span>
                  )}
                </div>
                {showCode && <pre className="codeview mt">{active.code ?? "// (code unavailable)"}</pre>}
              </div>
            )}

            {compiled && !selected && (
              <div className="row">
                <input
                  type="text"
                  placeholder="name it"
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                  style={{ maxWidth: 220 }}
                />
                <PxButton variant="ghost" onClick={save} disabled={busy !== null || !name.trim()}>
                  {busy === "save" ? <Spinner text="SAVING" /> : savedFlash ? "✓ SAVED" : "💾 SAVE"}
                </PxButton>
              </div>
            )}

            <div className="row">
              <PxButton onClick={test} disabled={busy !== null || !activeReady}>
                {busy === "test" ? <Spinner text="FIGHTING" /> : "▸ TEST"}
              </PxButton>
              <PxButton
                variant="green"
                onClick={submit}
                disabled={busy !== null || !selected || submittedId === selected?.id}
              >
                {busy === "submit" ? <Spinner text="ENTERING" /> : submittedId === selected?.id ? "✓ IN TOURNAMENT" : "⚔ SUBMIT"}
              </PxButton>
              <span className="hint">TEST is practice · SUBMIT enters a saved bot</span>
            </div>

            {submittedId ? (
              <div className="hint ipd-live">
                ✓ Your bot <b>{submittedName}</b> is LIVE. Submit another saved bot any time to replace it.
              </div>
            ) : (
              <div className="hint" style={{ color: "var(--gold)", borderLeft: "3px solid var(--gold-deep)", paddingLeft: 10 }}>
                ⚠ No bot in the tournament yet — save one, select it, then SUBMIT.
              </div>
            )}

            {err && <div className="err">{err}</div>}
          </div>

          <div>
            <label className="field-label">YOUR BOTS</label>
            <div className="strat-list">
              {saved.length === 0 && <div className="hint">Nothing saved yet.</div>}
              {saved.map((s) => (
                <div
                  key={s.id}
                  className={`strat-item ${selected?.id === s.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelected(selected?.id === s.id ? null : s);
                    setExhibition(null);
                  }}
                >
                  <div>
                    <div className="nm">{s.name}</div>
                    <div className="sub">
                      {s.summary || (s.prompt ? `“${s.prompt.slice(0, 40)}${s.prompt.length > 40 ? "…" : ""}”` : "custom")}
                    </div>
                  </div>
                  {submittedId === s.id && <span className="live">LIVE</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {exhibition && (
        <section className="panel">
          <div className="panel-title">
            ⚔ TEST VS CHAMPION — {exhibition.opponent.name} <span className="tag">not scored · practice</span>
          </div>
          <PDReplay
            rounds={exhibition.rounds}
            nameA={team.name}
            nameB={exhibition.opponent.name}
            scoreA={exhibition.yourScore}
            scoreB={exhibition.theirScore}
          />
        </section>
      )}

      <section className="panel board">
        <div className="panel-title">🏆 STANDINGS</div>
        <Board
          rows={standings?.map((s, i) => ({ rank: i + 1, teamId: s.id.replace(/^team:/, ""), ...s }))}
          me={team.teamId}
          crown
          columns={[
            { key: "avg", label: "AVG / MATCH", cls: "score", fmt: (v) => v.toFixed(1) },
            { key: "wins", label: "W", cls: "dim" },
            { key: "losses", label: "L", cls: "dim" },
            { key: "draws", label: "D", cls: "dim" },
          ]}
        />
      </section>

      {mine?.breakdown?.length > 0 && (
        <section className="panel board ipd-results">
          <div className="panel-title">
            YOUR RESULTS VS EVERY OPPONENT
            <span className="tag">avg points per match · every bot plays every bot ×5</span>
          </div>

          <table>
            <thead>
              <tr>
                <th>OPPONENT</th>
                <th style={{ textAlign: "right" }}>YOUR AVG</th>
                <th style={{ textAlign: "right" }}>THEIR AVG</th>
                <th>RESULT</th>
                <th style={{ textAlign: "right" }}>COOP %</th>
                <th style={{ textAlign: "right" }}>DEFECTS</th>
              </tr>
            </thead>
            <tbody>
              {mine.breakdown.map((b, i) => (
                <tr key={i}>
                  <td className="teamcell">{b.opponent}</td>
                  <td className="num">{b.avgFor?.toFixed?.(1) ?? b.avgFor}</td>
                  <td className="num">{b.avgAgainst?.toFixed?.(1) ?? b.avgAgainst}</td>
                  <td className={resultCls(b.result)}>{(b.result ?? "").toUpperCase()}</td>
                  <td className="num">{b.myCoopRate == null ? "—" : `${b.myCoopRate}%`}</td>
                  <td className="num">{b.myDefects ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="row mt">
            <PxButton variant="ghost" small onClick={downloadCSV}>
              ⬇ DOWNLOAD RESULTS CSV
            </PxButton>
          </div>

          {matchups.length > 0 && (
            <div className="mt">
              <label className="field-label">REPLAY — SEE HOW YOUR BOT PLAYED</label>

              <div className="ipd-chips">
                {matchups.map((m, i) => (
                  <div
                    key={m.opponentId ?? i}
                    className={`ipd-chip ${i === oppIdx ? "on" : ""}`}
                    onClick={() => {
                      setOppIdx(i);
                      setMatchIdx(0);
                    }}
                  >
                    {m.opponent}
                    {m.seed && <span className="seedtag">HOUSE</span>}
                  </div>
                ))}
              </div>

              {curOpp && curOpp.matches?.length > 1 && (
                <div className="ipd-chips">
                  {curOpp.matches.map((_, i) => (
                    <div
                      key={i}
                      className={`ipd-chip ${i === matchIdx ? "on" : ""}`}
                      onClick={() => setMatchIdx(i)}
                    >
                      MATCH {i + 1}
                    </div>
                  ))}
                </div>
              )}

              {replay && (
                <div className="mt">
                  <PDReplay
                    key={`${oppIdx}-${matchIdx}`}
                    rounds={replay.rounds.map((r) => ({ a: r.you, b: r.them, pa: r.youPts, pb: r.themPts }))}
                    nameA={team.name}
                    nameB={replay.opponent.name}
                    scoreA={replay.yourScore}
                    scoreB={replay.theirScore}
                  />
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
