/**
 * The strategy lab: describe your logic in English, we compile it to a
 * small readable spec, you verify it, name it, save it, and race it.
 *
 * Shared by all three games. For the bandit the run button plays 10,000
 * worlds; for the matrix games it tests you against the current champion
 * and a separate button submits your bot to the tournament.
 */
import React, { useCallback, useEffect, useState } from "react";
import { api, withTeam } from "../api.js";
import { PxButton, Spinner } from "./PixelBits.jsx";

/**
 * Example phrasings — shown as inspiration, NOT click-to-fill. Everyone
 * types their own plan; the AI codes exactly what they describe, and
 * refuses "just make me win"-style requests. These only teach the shape.
 */
// Deliberately plain, NON-optimal examples — they teach the *shape* of a
// valid instruction (fixed choices, round conditions, reacting to a move)
// without handing anyone a strategy worth using. The good plays are yours
// to invent.
const EXAMPLES = {
  bandit: [
    "play machine 1 for your first ten pulls, then switch to machine 2 for the rest",
    "keep pulling the same machine until it pays less than zero, then move to the next one",
  ],
  chicken: [
    "swerve for the first three rounds, then stay for the rest",
    "stay on round one, then flip a coin every round after that",
  ],
  pd: [
    "split on the first round, then steal on every third round",
    "steal whenever your score is behind the opponent's, otherwise split",
  ],
};

/** Plain-words answer to "what does my bot actually know?" */
const BOT_SEES = {
  bandit:
    "Your bot can see: how many pulls it has used, each machine's average so far, and the last payoffs. It can NOT see the machines' true odds — nobody can.",
  chicken:
    "Your bot can see: the round number, every move both sides have made this match, and both scores. Each new match starts with a blank memory.",
  pd:
    "Your bot can see: the round number, every move both sides have made this match, and both scores. Each new match starts with a blank memory.",
};

export default function StrategyLab({ team, game, onScored, renderExhibition }) {
  // Drafts survive a reload — an accidental pull-to-refresh on a phone
  // shouldn't eat a strategy someone spent five minutes wording.
  const draftKey = `w1lab:${game}:${team.teamId}`;
  const draft = (() => {
    try {
      return JSON.parse(localStorage.getItem(draftKey)) ?? {};
    } catch {
      return {};
    }
  })();
  const [prompt, setPrompt] = useState(draft.prompt ?? "");
  const [compiled, setCompiled] = useState(draft.compiled ?? null); // {spec, readback, note, source}
  const [showCode, setShowCode] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState([]);
  const [submittedId, setSubmittedId] = useState(null);
  const [selected, setSelected] = useState(null); // a saved strat, or null = use compiled
  const [busy, setBusy] = useState(null); // 'compile' | 'run' | 'save' | 'submit'
  const [err, setErr] = useState(null);
  const [refusal, setRefusal] = useState(null); // the AI declined a generic/abuse request
  // Results survive a tab-switch (which unmounts this component) and a
  // reload — a 10k run that finishes while you're on another tab must be
  // waiting for you, not silently gone.
  const [runResult, setRunResult] = useState(draft.runResult ?? null);
  const [exhibition, setExhibition] = useState(draft.exhibition ?? null);
  const [savedFlash, setSavedFlash] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get(`strategies?teamId=${team.teamId}&token=${team.token}&game=${game}`);
      setSaved(res.strategies);
      setSubmittedId(res.submitted?.[game] ?? null);
      return res.strategies;
    } catch {
      return null;
    }
  }, [team, game]);

  useEffect(() => {
    refresh();
    // Poll so "your bot is LIVE" self-corrects if an admin removes the
    // entry, and so standings the player just changed reconcile.
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ prompt, compiled, runResult, exhibition }));
    } catch {}
  }, [draftKey, prompt, compiled, runResult, exhibition]);

  // A strategy is a spec (chicken/split-or-steal) OR JS code (bandit).
  const active = selected ?? compiled; // {spec|code, explain, summary}
  const activeReady = game === "bandit" ? !!active?.code : !!active?.spec;
  const activeName = selected ? selected.name : name.trim() || null;

  async function compile() {
    setBusy("compile");
    setErr(null);
    setRefusal(null);
    setSelected(null);
    setRunResult(null);
    setExhibition(null);
    try {
      const res = await api.post("compile", withTeam(team, { game, prompt }));
      if (res.refused) {
        // The AI declined — a generic/outcome-only request. Keep the box,
        // clear any old compiled spec, and tell them what to add.
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
        withTeam(team, { game, name, prompt, spec: compiled.spec, code: compiled.code, explain: compiled.explain, summary: compiled.summary })
      );
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      setName("");
      const list = await refresh();
      // Auto-select what you just saved, so RUN / SUBMIT act on it with no
      // extra click. (The server may have auto-suffixed the name on a
      // duplicate, so prefer the returned id.)
      const justSaved = (list ?? []).find((s) => s.id === res.id) ?? { id: res.id, name: savedName, spec: compiled.spec, prompt, game, explain: compiled.explain };
      setSelected(justSaved);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!activeReady) return;
    setBusy("run");
    setErr(null);
    setRunResult(null);
    setExhibition(null);
    try {
      if (game === "bandit") {
        // Unnamed runs still get a readable board label from the prompt.
        const label = activeName ?? (selected ? null : prompt.trim().slice(0, 24).replace(/[\s,.;:!-]+$/, "")) ?? null;
        const res = await api.post("bandit/run", withTeam(team, { code: active.code, name: label }));
        setRunResult(res);
        onScored?.();
      } else {
        const res = await api.post("exhibition", withTeam(team, { game, spec: active.spec }));
        setExhibition(res);
      }
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
      await api.post("submit", withTeam(team, { game, strategyId: selected.id }));
      setSubmittedId(selected.id);
      onScored?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  const shown = selected ?? compiled; // what the verify pane displays
  const shownExplain = shown?.explain; // the AI's own plain-English description

  return (
    <>
      <div className="lab-grid">
        <div className="chatbox">
          <label className="field-label">STEP 1 · DESCRIBE YOUR STRATEGY IN PLAIN ENGLISH</label>
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (refusal) setRefusal(null);
              // Typing a new plan means you're no longer running the saved
              // one — leaving it selected here silently ignored the edit.
              if (selected) setSelected(null);
            }}
            placeholder={`spell out how to play — e.g. "${EXAMPLES[game][0]}"`}
          />
          <div className="hint" style={{ marginTop: 0 }}>
            {BOT_SEES[game]} The AI codes <b>exactly what you describe</b> — it won't improve it. You don't
            have to cover every case, just get your plan across. It'll only push back if you ask it to
            pick the strategy for you ("just win", "make the best bot").
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            for example:{" "}
            {EXAMPLES[game].map((ex, i) => (
              <React.Fragment key={i}>
                {i > 0 && " · "}
                <span style={{ color: "var(--muted)" }}>"{ex}"</span>
              </React.Fragment>
            ))}
          </div>
          <div className="row">
            <PxButton variant="blue" onClick={compile} disabled={busy !== null || prompt.trim().length < 3}>
              {busy === "compile" ? <Spinner text="COMPILING" /> : "⚙ STEP 2 · COMPILE"}
            </PxButton>
            <span className="hint grow">the AI turns your words into a bot — then you verify it does what you meant</span>
          </div>

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

          {shown && (
            <div className="readback">
              <div className="rb-title">
                {selected ? `SAVED STRATEGY: ${selected.name}` : "STEP 3 · CHECK IT — THIS IS EXACTLY WHAT YOUR BOT WILL DO"}
              </div>
              <p style={{ margin: 0, color: "var(--ink)", lineHeight: 1.6 }}>
                {shownExplain || "(no description)"}
              </p>
              {!selected && compiled?.note && <div className="note">⚠ {compiled.note}</div>}
              <div className="row mt">
                <PxButton variant="ghost" small onClick={() => setShowCode(!showCode)}>
                  {showCode ? "HIDE CODE" : "VIEW CODE"}
                </PxButton>
                {compiled && !selected && (
                  <span className="hint">
                    {compiled.source === "llm" ? "written by the AI, faithfully, from your words" : "written by the built-in quick compiler from your words"}
                  </span>
                )}
              </div>
              {showCode && (
                <pre className="codeview mt">
                  {game === "bandit"
                    ? (shown.code ?? "// (code unavailable)")
                    : JSON.stringify(shown.spec, null, 2)}
                </pre>
              )}
            </div>
          )}

          <div className="row">
            <PxButton onClick={run} disabled={busy !== null || !activeReady}>
              {busy === "run" ? (
                <Spinner text={game === "bandit" ? "SIMULATING" : "FIGHTING"} />
              ) : !activeReady ? (
                game === "bandit" ? "▸ RUN 10,000 GAMES" : "▸ TEST VS CHAMPION"
              ) : selected ? (
                // Name what actually runs — never ambiguous.
                `▸ STEP 4 · ${game === "bandit" ? "RUN" : "TEST"} SAVED: ${Array.from(selected.name).slice(0, 14).join("").toUpperCase()}`
              ) : game === "bandit" ? (
                "▸ STEP 4 · RUN 10,000 GAMES"
              ) : (
                "▸ STEP 4 · TEST VS CHAMPION"
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
              <PxButton variant="ghost" onClick={save} disabled={busy !== null || !name.trim()}>
                {busy === "save" ? <Spinner text="SAVING" /> : savedFlash ? "✓ SAVED" : game === "bandit" ? "💾 SAVE (OPTIONAL)" : "💾 STEP 5 · NAME & SAVE"}
              </PxButton>
            </div>
          )}

          {game !== "bandit" && (
            <div className="row">
              <PxButton variant="green" onClick={submit} disabled={busy !== null || !selected || submittedId === selected?.id}>
                {busy === "submit" ? <Spinner text="ENTERING" /> : submittedId === selected?.id ? "✓ IN TOURNAMENT" : "⚔ STEP 6 · SUBMIT TO TOURNAMENT"}
              </PxButton>
            </div>
          )}
          {game !== "bandit" &&
            (submittedId ? (
              <div className="hint" style={{ color: "var(--green)" }}>
                ✓ Your bot <b>{saved.find((s) => s.id === submittedId)?.name ?? ""}</b> is LIVE in the
                tournament. Submit a different saved strategy any time to replace it.
              </div>
            ) : (
              <div className="hint" style={{ color: "var(--gold)", borderLeft: "3px solid var(--gold-deep)", paddingLeft: 10 }}>
                ⚠ YOUR TEAM HAS NO BOT IN THE TOURNAMENT YET. Testing doesn't count — to enter: save
                your strategy (step 5), click it in your saved list, then submit (step 6).
              </div>
            ))}
          {err && <div className="err">{err}</div>}
        </div>

        <div>
          <label className="field-label">YOUR TEAM'S STRATEGIES</label>
          <div className="strat-list">
            {saved.length === 0 && <div className="hint">Nothing saved yet — compile one and name it.</div>}
            {saved.map((s) => (
              <div
                key={s.id}
                className={`strat-item ${selected?.id === s.id ? "selected" : ""}`}
                onClick={() => {
                  setSelected(selected?.id === s.id ? null : s);
                  setRunResult(null);
                  setExhibition(null);
                }}
              >
                <div>
                  <div className="nm">{s.name}</div>
                  <div className="sub">{s.summary || (s.prompt ? `“${s.prompt.slice(0, 40)}${s.prompt.length > 40 ? "…" : ""}”` : "custom")}</div>
                </div>
                {submittedId === s.id && <span className="live">LIVE</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {runResult && game === "bandit" && (
        <div>
          <div className="result-stats">
            <div className="stat-tile">
              <div className="v">{runResult.stats.avg.toFixed(1)}</div>
              <div className="k">avg / game</div>
            </div>
            <div className="stat-tile">
              <div className="v dim">{runResult.stats.oraclePct.toFixed(0)}%</div>
              <div className="k">of a psychic who always picks the best machine (avg {runResult.stats.avgOracle.toFixed(0)})</div>
            </div>
            <div className="stat-tile">
              <div className="v dim">{runResult.stats.best.toFixed(0)}</div>
              <div className="k">best game</div>
            </div>
            <div className="stat-tile">
              <div className="v dim">{runResult.stats.worst.toFixed(0)}</div>
              <div className="k">worst game</div>
            </div>
            <div className="stat-tile">
              <div className="v dim">±{runResult.stats.sd.toFixed(0)}</div>
              <div className="k">typical swing per game</div>
            </div>
          </div>
          {runResult.newBest && <div className="newbest">★ NEW TEAM BEST — ON THE BOARD ★</div>}
        </div>
      )}

      {exhibition && renderExhibition && renderExhibition(exhibition)}
    </>
  );
}

