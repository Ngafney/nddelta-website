/**
 * The bandit tab: manual lever-pulling on one side, the strategy lab on
 * the other, each with its own leaderboard — one run of luck and ten
 * thousand runs of skill are different sports.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, withTeam } from "../api.js";
import { BANDIT } from "../../shared/rules.js";
import RulesPanel from "./RulesPanel.jsx";
import SlotMachine from "./SlotMachine.jsx";
import StrategyLab from "./StrategyLab.jsx";
import { Board } from "./Leaderboards.jsx";
import { PxButton, Spinner } from "./PixelBits.jsx";
import { MACHINE_COLORS, MACHINE_NAMES } from "./sprites.js";

export default function BanditGame({ team }) {
  const [sub, setSubState] = useState(() => {
    try {
      return localStorage.getItem("w1sub") || "manual";
    } catch {
      return "manual";
    }
  });
  const setSub = (s) => {
    setSubState(s);
    try {
      localStorage.setItem("w1sub", s);
    } catch {}
  };
  const [boards, setBoards] = useState(null);

  const refreshBoards = useCallback(async () => {
    try {
      setBoards(await api.get("leaderboard?game=bandit"));
    } catch {}
  }, []);

  useEffect(() => {
    refreshBoards();
  }, [refreshBoards]);

  return (
    <>
      <RulesPanel game="bandit" />
      <div className="subtabs">
        <button className={`subtab ${sub === "manual" ? "active" : ""}`} onClick={() => setSub("manual")}>
          🕹 MANUAL
        </button>
        <button className={`subtab ${sub === "algo" ? "active" : ""}`} onClick={() => setSub("algo")}>
          🤖 ALGORITHM
        </button>
      </div>

      {sub === "manual" ? (
        <ManualPlay team={team} onScored={refreshBoards} />
      ) : (
        <section className="panel">
          <div className="panel-title">STRATEGY LAB</div>
          <StrategyLab team={team} game="bandit" onScored={refreshBoards} />
        </section>
      )}

      <section className="panel board">
        <div className="panel-title">
          {sub === "manual" ? "🏆 MANUAL LEADERBOARD" : "🏆 ALGORITHM LEADERBOARD"}
          <span className="tag">{sub === "manual" ? "best run · by % of oracle" : "avg of 10,000 games"}</span>
        </div>
        <Board
          rows={boards?.[sub === "manual" ? "manual" : "algo"]}
          me={team.teamId}
          columns={
            sub === "manual"
              ? [
                  { key: "oraclePct", label: "% ORACLE", cls: "score", fmt: (v) => (v == null ? "—" : `${v.toFixed(0)}%`) },
                  { key: "points", label: "POINTS", cls: "dim", fmt: (v) => (v == null ? "—" : v.toFixed(1)) },
                ]
              : [
                  { key: "score", label: "AVG", cls: "score", fmt: (v) => v.toFixed(1) },
                  { key: "oraclePct", label: "% ORACLE", cls: "dim", fmt: (v) => (v == null ? "—" : `${v.toFixed(0)}%`) },
                  { key: "stratName", label: "STRATEGY", cls: "dim", fmt: (v) => v ?? "—" },
                ]
          }
        />
      </section>
    </>
  );
}

/* ── manual play ──────────────────────────────────────────────────────── */

function freshStats() {
  return Array.from({ length: BANDIT.machines }, () => ({ plays: 0, sum: 0 }));
}

/**
 * Cabinet size follows the space that actually exists: all five machines
 * MUST share one row — the game is unplayable if the machine you're
 * comparing against has wrapped out of sight. We measure the real
 * container (padding, borders and all already excluded) and take the
 * largest integer sprite scale that fits. Integer only: fractional scales
 * land pixels on half-pixels and blur.
 */
const SPRITE_W = 22; // slot machine grid width in pixels
const N = BANDIT.machines;
/**
 * Fit the cabinets to the real container. Prefer ONE row of all N at the
 * biggest crisp integer scale; when N cabinets won't fit one row on a
 * narrow phone (8 at a tappable size can't), fall back to a balanced grid
 * of a few rows — bigger cabinets across two rows beats a cramped 7+1
 * wrap. Returns the scale, the gap, and how many columns to lay out.
 */
function useFitScale(ref) {
  const [fit, setFit] = useState({ scale: 3, gap: 12, cols: N });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const mobile = window.innerWidth < 640;
      const avail = el.clientWidth + (mobile ? 24 : 0); // mobile row bleeds 12px/side
      const gap = mobile ? 6 : N > 6 ? 12 : 18;
      const fitsAt = (cols, s) => cols * SPRITE_W * s + (cols - 1) * gap <= avail;
      const bestScale = (cols) => [4, 3, 2].find((s) => fitsAt(cols, s));
      // Try one row of everything first.
      const oneRow = bestScale(N);
      if (oneRow) return setFit({ scale: oneRow, gap, cols: N });
      // Otherwise split into the fewest rows whose per-row count fits at
      // scale ≥ 2, at the largest such scale.
      for (let rows = 2; rows <= N; rows++) {
        const perRow = Math.ceil(N / rows);
        const s = bestScale(perRow);
        if (s) return setFit({ scale: s, gap, cols: perRow });
      }
      setFit({ scale: 2, gap, cols: Math.ceil(N / 2) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return fit;
}

function ManualPlay({ team, onScored }) {
  const measureRef = useRef(null);
  const { scale: machineScale, gap: machineGap, cols: machineCols } = useFitScale(measureRef);
  const [attempt, setAttempt] = useState(null); // {attemptId}
  const [stats, setStats] = useState(freshStats);
  const [spinsUsed, setSpinsUsed] = useState(0);
  const [total, setTotal] = useState(0);
  const [anim, setAnim] = useState({}); // machine -> {spinning, lastResult}
  const [busy, setBusy] = useState(false);
  const [finish, setFinish] = useState(null); // finish response
  const [err, setErr] = useState(null);
  const spinKey = useRef(0);

  // A reload must not eat a run in progress — restore it. The server
  // already holds the authoritative spin history; this restores the
  // client's view of it.
  const runKey = `w1manual:${team.teamId}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(runKey));
      if (saved?.attempt && saved.spinsUsed < BANDIT.spins && !saved.finish) {
        setAttempt(saved.attempt);
        setStats(saved.stats);
        setSpinsUsed(saved.spinsUsed);
        setTotal(saved.total);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  useEffect(() => {
    if (!attempt) return;
    try {
      localStorage.setItem(runKey, JSON.stringify({ attempt, stats, spinsUsed, total, finish: !!finish }));
    } catch {}
  }, [runKey, attempt, stats, spinsUsed, total, finish]);

  async function start() {
    setErr(null);
    setBusy(true);
    try {
      const a = await api.post("bandit/manual/start", withTeam(team));
      setAttempt(a);
      setStats(freshStats());
      setSpinsUsed(0);
      setTotal(0);
      setAnim({});
      setFinish(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pull(m) {
    if (busy || !attempt || finish || spinsUsed >= BANDIT.spins) return;
    setBusy(true);
    setErr(null);
    setAnim({ [m]: { spinning: true } });
    const t0 = Date.now();
    try {
      const res = await api.post("bandit/manual/spin", { attemptId: attempt.attemptId, machine: m });
      // Let the reels actually spin for a beat before the reveal.
      const wait = Math.max(0, 550 - (Date.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
      spinKey.current++;
      setAnim({ [m]: { spinning: false, lastResult: { payoff: res.payoff, key: spinKey.current } } });
      setStats((s) => s.map((st, i) => (i === m ? { plays: st.plays + 1, sum: st.sum + res.payoff } : st)));
      setSpinsUsed(res.spinsUsed);
      setTotal((t) => t + res.payoff);
      if (res.spinsLeft === 0) {
        const fin = await api.post("bandit/manual/finish", { attemptId: attempt.attemptId });
        setFinish(fin);
        onScored();
      }
    } catch (e) {
      setAnim({});
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const bestTruth = finish ? Math.max(...finish.truth.mu) : null;

  // Mid-run "best so far" marker — only once there's something to compare.
  const triedCount = stats.filter((s) => s.plays > 0).length;
  const bestSoFar =
    !finish && triedCount >= 2
      ? stats.reduce((best, s, i) => (s.plays > 0 && (best === -1 || s.sum / s.plays > stats[best].sum / stats[best].plays) ? i : best), -1)
      : -1;

  return (
    <section className="panel">
      {/* Always-rendered measuring surface — the machine row sizes off this. */}
      <div ref={measureRef}>
      <div className="panel-title">
        THE FLOOR <span className="tag">{BANDIT.spins} pulls · fresh machines every attempt</span>
      </div>

      {!attempt ? (
        <div style={{ textAlign: "center", padding: "26px 0" }}>
          <PxButton onClick={start} disabled={busy}>
            {busy ? <Spinner text="DRAWING MACHINES" /> : "▸ INSERT COIN — START A RUN"}
          </PxButton>
          <div className="hint mt">
            Five machines, fifty pulls. Nobody knows which machines are hot — that's the point.
          </div>
        </div>
      ) : (
        <>
          <div className="spin-meter">
            <span className="label">PULLS LEFT</span>
            <span className="meterbar">
              <span className="fill" style={{ width: `${((BANDIT.spins - spinsUsed) / BANDIT.spins) * 100}%` }} />
            </span>
            <span className="count">{BANDIT.spins - spinsUsed}</span>
          </div>

          {spinsUsed === 0 && !finish && (
            <div className="hint" style={{ textAlign: "center", color: "var(--gold)", animation: "blink 1.4s steps(2) infinite" }}>
              ▼ TAP A MACHINE TO PULL ITS LEVER ▼
            </div>
          )}

          <div className="run-total">
            <span className="lbl">TOTAL</span>
            <span className={total >= 0 ? "pos" : "neg"}>{total.toFixed(1)}</span>
          </div>

          <div
            className="machine-row"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${machineCols}, auto)`,
              gap: machineGap,
              justifyContent: "center",
            }}
          >
            {MACHINE_COLORS.map((c, i) => (
              <SlotMachine
                key={i}
                index={i}
                color={c}
                name={MACHINE_NAMES[i]}
                stats={stats[i]}
                truth={finish ? finish.truth.mu[i] : undefined}
                isBestTruth={finish ? finish.truth.mu[i] === bestTruth : false}
                locked={busy || !!finish || spinsUsed >= BANDIT.spins}
                spinning={!!anim[i]?.spinning}
                lastResult={anim[i]?.lastResult}
                onPull={pull}
                scale={machineScale}
                soFarBest={i === bestSoFar}
              />
            ))}
          </div>

          {finish && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <div className="result-stats" style={{ maxWidth: 560, margin: "0 auto" }}>
                <div className="stat-tile">
                  <div className="v">{finish.total.toFixed(1)}</div>
                  <div className="k">final score</div>
                </div>
                <div className="stat-tile">
                  <div className="v dim">{finish.oraclePct == null ? "—" : `${finish.oraclePct.toFixed(0)}%`}</div>
                  <div className="k">
                    of a psychic who knew the best machine from pull one (they'd score {finish.truth.oracle.toFixed(0)})
                  </div>
                </div>
              </div>
              {finish.newBest && <div className="newbest">★ NEW TEAM BEST — ON THE BOARD ★</div>}
              <div className="mt">
                <PxButton variant="blue" onClick={start} disabled={busy}>
                  ▸ NEW ATTEMPT
                </PxButton>
              </div>
            </div>
          )}
        </>
      )}
      {err && <div className="err">{err}</div>}
      </div>
    </section>
  );
}
