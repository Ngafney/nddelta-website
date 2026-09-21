/**
 * The simulation panel — everything a player knows about the coin.
 *
 *   lobby / sims   choose how many flips to buy. Only an order: nothing is
 *                  charged or flipped until the window closes, so you can
 *                  change your mind freely and nobody can peek first.
 *   live           your flips, and what they say about p two ways — the
 *                  frequentist's heads / flips, and the Bayesian's posterior
 *                  starting from the prior this round was drawn from. The
 *                  lecture, on your own data.
 *   settled        the same, next to the truth.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PxButton, Spinner, money, num } from "./PixelBits.jsx";

const QUICK = [0, 5, 10, 20, 40, 100];

export default function SimPanel({ round, me, prior, onOrder, onLate, onExtra, busy }) {
  const phase = round.status;
  if ((phase === "lobby" || phase === "sims") && !me.sims) {
    return <Chooser round={round} me={me} onOrder={onOrder} busy={busy} />;
  }
  if (me.canBuyLate) return <LateBuy round={round} me={me} onLate={onLate} busy={busy} />;
  return <Results round={round} me={me} prior={prior} onExtra={onExtra} busy={busy} />;
}

/* ── choosing ─────────────────────────────────────────────────────────── */

function Chooser({ round, me, onOrder, busy }) {
  const cost = round.simCostC;
  const most = Math.min(round.maxSims, cost > 0 ? Math.floor(me.cashC / cost) : round.maxSims);
  const [n, setN] = useState(me.simOrder ?? 0);
  const [dirty, setDirty] = useState(false);
  const timer = useRef(null);

  // Follow the server until the player touches the control, then keep theirs.
  useEffect(() => {
    if (!dirty) setN(me.simOrder ?? 0);
  }, [me.simOrder, dirty]);

  // Save shortly after the slider stops, so dragging is not forty requests.
  const choose = (v) => {
    const clamped = Math.max(0, Math.min(most, Math.round(v)));
    setN(clamped);
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await onOrder(clamped);
      setDirty(false);
    }, 350);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const spend = n * cost;
  const saved = !dirty && n === (me.simOrder ?? 0);

  return (
    <div className="panel">
      <div className="panel-title">
        STEP 1 · HOW MANY FLIPS?
        <span className="right">{money(cost)} each · up to {most}</span>
      </div>

      <div className="simpick">
        <div className="simpick-n">
          <b>{n}</b>
          <span>flip{n === 1 ? "" : "s"}</span>
        </div>
        <input
          type="range"
          min={0}
          max={most}
          step={1}
          value={n}
          onChange={(e) => choose(Number(e.target.value))}
          aria-label="number of flips to buy"
        />
        <div className="sizepick">
          {QUICK.filter((q) => q <= most).map((q) => (
            <button key={q} className={n === q ? "on" : ""} onClick={() => choose(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>

      <div className="stats mt">
        <div className="stat">
          <i>YOU SPEND</i>
          <b style={{ color: spend ? "var(--red)" : undefined }}>{money(spend)}</b>
          <small>gone for good, win or lose</small>
        </div>
        <div className="stat">
          <i>LEFT TO TRADE WITH</i>
          <b>{money(me.cashC - spend)}</b>
          <small>
            {n === most && most > 0 ? "nothing left to quote with!" : `of ${money(me.cashC)}`}
          </small>
        </div>
      </div>

      <div className={saved ? "good" : "note"}>
        {phase(round) === "lobby"
          ? saved
            ? `Saved: ${n} flips. The window hasn't opened yet — you can still change this.`
            : "Saving…"
          : saved
            ? `Locked in when the clock runs out: ${n} flip${n === 1 ? "" : "s"}. Change it as often as you like until then.`
            : "Saving…"}
        {busy === "sims" && <Spinner text="" />}
      </div>
      <div className="hint">
        Nothing is charged and nothing is flipped until the clock at the top runs out. Then every flip happens at once,
        you see your heads and tails, and trading opens.
      </div>
    </div>
  );
}

const phase = (round) => round.status;

/* ── joined late ──────────────────────────────────────────────────────── */

function LateBuy({ round, me, onLate, busy }) {
  const cost = round.simCostC;
  const most = Math.min(round.maxSims, cost > 0 ? Math.floor(me.spendableC / cost) : round.maxSims);
  const [n, setN] = useState(Math.min(10, most));
  return (
    <div className="panel">
      <div className="panel-title">YOU MISSED THE FLIP WINDOW</div>
      <div className="hint" style={{ marginTop: 0 }}>
        You joined after the simulation clock ran out, so you get one purchase of your own — right now, before you
        trade. {money(cost)} a flip.
      </div>
      <div className="simpick mt">
        <div className="simpick-n">
          <b>{n}</b>
          <span>flips · {money(n * cost)}</span>
        </div>
        <input type="range" min={0} max={most} value={n} onChange={(e) => setN(Number(e.target.value))} />
      </div>
      <div className="mt">
        <PxButton variant="gold" disabled={busy === "sims"} onClick={() => onLate(n)}>
          {busy === "sims" ? <Spinner text="FLIPPING" /> : `FLIP ${n} TIME${n === 1 ? "" : "S"}`}
        </PxButton>
      </div>
    </div>
  );
}

/* ── what the flips say ───────────────────────────────────────────────── */

function Results({ round, me, prior, onExtra, busy }) {
  const s = me.sims ?? { n: 0, heads: 0, flips: "" };
  const settled = round.status === "settled";
  const a = prior?.a ?? 1;
  const b = prior?.b ?? 1;
  const post = useMemo(() => betaSummary(a + s.heads, b + s.n - s.heads), [a, b, s.heads, s.n]);
  const freq = s.n ? (100 * s.heads) / s.n : null;
  const truth = settled && round.p != null ? round.p * 100 : null;

  return (
    <div className="panel">
      <div className="panel-title">
        YOUR FLIPS
        <span className="right">
          {s.n} flip{s.n === 1 ? "" : "s"}
          {s.extra ? ` (${s.extra} bought mid-trade)` : ""}
        </span>
      </div>

      {s.n === 0 ? (
        <div className="note" style={{ marginTop: 0 }}>
          You bought no flips — you are trading on the prior alone. Everyone else knows at least as much as you.
        </div>
      ) : (
        <div className="coins" aria-label={`${s.heads} heads out of ${s.n}`}>
          {[...s.flips].map((f, i) => (
            <span key={i} className={`coin ${f === "H" ? "h" : "t"}`} title={`flip ${i + 1}: ${f === "H" ? "heads" : "tails"}`}>
              {f}
            </span>
          ))}
        </div>
      )}

      <div className="stats mt">
        <div className="stat">
          <i>HEADS</i>
          <b>
            {s.heads} / {s.n}
          </b>
          <small>{s.n - s.heads} tails</small>
        </div>
        <div className="stat">
          <i>FREQUENTIST · HEADS ÷ FLIPS</i>
          <b>{freq == null ? "—" : num(freq, 1)}</b>
          <small>{freq == null ? "no data, no estimate" : "on the 0–100 ladder"}</small>
        </div>
        <div className="stat">
          <i>BAYESIAN · POSTERIOR MEAN</i>
          <b style={{ color: "var(--gold)" }}>{num(post.mean * 100, 1)}</b>
          <small>
            prior {prior?.name ?? "uniform"} + your flips
          </small>
        </div>
        <div className="stat">
          <i>90% CREDIBLE INTERVAL</i>
          <b>
            {num(post.lo * 100, 0)} – {num(post.hi * 100, 0)}
          </b>
          <small>where p probably is</small>
        </div>
      </div>

      <IntervalBar lo={post.lo * 100} hi={post.hi * 100} mean={post.mean * 100} freq={freq} truth={truth} />

      {round.status === "live" && onExtra && (
        <div className="row mt">
          <PxButton
            variant="gold"
            small
            disabled={busy === "extra" || me.spendableC < round.liveFlipCostC}
            onClick={onExtra}
          >
            {busy === "extra" ? <Spinner text="FLIPPING" /> : `🪙 ONE MORE FLIP · ${money(round.liveFlipCostC)}`}
          </PxButton>
          <span className="hint" style={{ margin: 0 }}>
            {me.spendableC < round.liveFlipCostC
              ? "not enough free cash — pull some orders first"
              : "costs more now than before trading — is the next flip worth it?"}
          </span>
        </div>
      )}

      {settled && truth != null && (
        <div className="good">
          The coin was <b>p = {num(truth, 2)}</b>
          {round.settlement === "flip" ? (
            <>
              {" "}
              — and the final flip came up <b>{round.finalHeads ? "HEADS" : "TAILS"}</b>, so every share paid{" "}
              {money(round.settleC)}.
            </>
          ) : (
            <>, so every share paid {money(round.settleC)}.</>
          )}{" "}
          {truth >= post.lo * 100 && truth <= post.hi * 100
            ? "It landed inside your interval."
            : "It landed outside your interval — it happens one time in ten."}
        </div>
      )}

      {!settled && (
        <div className="hint">
          How p was drawn this round: <b>{prior?.name ?? "—"}</b> — {prior?.blurb}{" "}
          {round.settlement === "flip"
            ? "At the bell the coin is flipped once more: a share pays $100 on heads, $0 on tails."
            : "At the bell every share pays 100 × p."}
        </div>
      )}
    </div>
  );
}

/** A 0–100 strip: the credible interval, both estimates, and — at the end — the truth. */
function IntervalBar({ lo, hi, mean, freq, truth }) {
  return (
    <div className="ivbar" aria-hidden="true">
      <div className="ivbar-track">
        <div className="ivbar-band" style={{ left: `${lo}%`, width: `${Math.max(0.6, hi - lo)}%` }} />
        {freq != null && <div className="ivbar-mark freq" style={{ left: `${freq}%` }} title="heads ÷ flips" />}
        <div className="ivbar-mark mean" style={{ left: `${mean}%` }} title="posterior mean" />
        {truth != null && <div className="ivbar-mark truth" style={{ left: `${truth}%` }} title="the true p" />}
      </div>
      <div className="ivbar-scale">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
      <div className="ivbar-key">
        <span className="k mean">■ posterior mean</span>
        {freq != null && <span className="k freq">■ heads ÷ flips</span>}
        <span className="k band">■ 90% interval</span>
        {truth != null && <span className="k truth">■ the truth</span>}
      </div>
    </div>
  );
}

/**
 * Mean and central 90% interval of Beta(a, b), numerically. A 4,000-point grid
 * on the log density is plenty for two decimal places and handles a, b < 1,
 * where the density piles up at the edges.
 */
export function betaSummary(a, b, level = 0.9) {
  const N = 4000;
  const xs = [];
  const logs = [];
  let maxL = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N;
    const l = (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x);
    xs.push(x);
    logs.push(l);
    if (l > maxL) maxL = l;
  }
  const w = logs.map((l) => Math.exp(l - maxL));
  const total = w.reduce((s, v) => s + v, 0);
  const tail = (1 - level) / 2;
  let acc = 0;
  let lo = 0;
  let hi = 1;
  let loSet = false;
  for (let i = 0; i < N; i++) {
    acc += w[i] / total;
    if (!loSet && acc >= tail) {
      lo = xs[i];
      loSet = true;
    }
    if (acc >= 1 - tail) {
      hi = xs[i];
      break;
    }
  }
  return { mean: a / (a + b), lo, hi };
}
