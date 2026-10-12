/**
 * The pot: N cells, filling one by one as the numbers come out, and the
 * running sum above them. This is the show, so it is allowed to be loud.
 *
 *   a cell that has just landed flips over, flares, and throws sparks
 *   the sum rolls up to its new value rather than jumping
 *   the border lights chase for a moment
 *   a two-note chime, if sound is on
 *
 * Which cell is which team is nobody's business: cells fill left to right in
 * the order the numbers came out, and that order is secret until the end.
 * Pure on render — every effect is keyed off `revealedCount` changing.
 */
import React, { useEffect, useRef, useState } from "react";

export default function Pot({ round, big = false, sound = false, onJustRevealed = null }) {
  const N = round?.N ?? 0;
  const revealed = round?.revealed ?? [];
  const count = revealed.length;
  const prev = useRef(count);
  const [flash, setFlash] = useState(null); // index of the cell that just landed
  const [sparks, setSparks] = useState([]);
  const [chase, setChase] = useState(false);

  useEffect(() => {
    if (count > prev.current) {
      const i = count - 1;
      setFlash(i);
      setChase(true);
      setSparks(Array.from({ length: big ? 18 : 12 }, (_, k) => ({ id: `${i}-${k}`, a: (k / (big ? 18 : 12)) * 360, d: 40 + ((k * 37) % 50) })));
      if (sound) chime(revealed[i]);
      onJustRevealed?.(i, revealed[i]);
      const t1 = setTimeout(() => setFlash(null), 1600);
      const t2 = setTimeout(() => setChase(false), 2200);
      const t3 = setTimeout(() => setSparks([]), 1400);
      prev.current = count;
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
    prev.current = count;
    return undefined;
  }, [count, big, sound, revealed, onJustRevealed]);

  // Reset the memory when a new round starts with an empty pot.
  useEffect(() => {
    if (count === 0) prev.current = 0;
  }, [round?.roundId, count]);

  if (!round) return null;
  const settled = round.status === "settled";
  const lobby = round.status === "lobby";
  const cols = N <= 6 ? N || 1 : N <= 12 ? 6 : N <= 20 ? Math.ceil(N / 2) : Math.ceil(N / 3);

  return (
    <div className={`pot ${big ? "big" : ""} ${chase ? "chase" : ""} ${settled ? "settled" : ""}`}>
      <div className="pot-lights" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${(i % 6) * 120}ms` }} />
        ))}
      </div>

      <div className="pot-top">
        <div className="pot-sum">
          <i>{settled ? "S · THE SUM" : lobby ? "IN THE POT" : "SUM SO FAR"}</i>
          <Odometer value={lobby ? N : round.sum} big={big} />
          {!lobby && (
            <em>
              {settled ? `every number is out` : `${count} of ${N} out · ${round.left} still in`}
            </em>
          )}
          {lobby && <em>{N === 1 ? "team" : "teams"} so far · each holds 0–10</em>}
        </div>
        <div className="pot-facts">
          <div className="pot-fact">
            <i>{settled ? "FINAL" : "STILL POSSIBLE"}</i>
            <b>{lobby ? `0 – ${round.Smax}` : settled ? round.settleS : `${round.lo} – ${round.hi}`}</b>
          </div>
          <div className="pot-fact">
            <i>STRIKE K</i>
            <b className="gold">{round.K}</b>
          </div>
          <div className="pot-fact">
            <i>NUMBERS</i>
            <b>{N}</b>
          </div>
        </div>
      </div>

      <div className="pot-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: N }, (_, i) => {
          const n = i < count ? revealed[i] : null;
          const landed = n != null;
          return (
            <div key={`${round.roundId}-${i}`} className={`cell ${landed ? `in v${n}` : "out"} ${flash === i ? "flash" : ""} ${lobby ? "lobby" : ""}`}>
              <span className="cell-face">{landed ? n : lobby ? "•" : "?"}</span>
              {flash === i &&
                sparks.map((s) => (
                  <span
                    key={s.id}
                    className="spark"
                    style={{ "--a": `${s.a}deg`, "--d": `${s.d}px` }}
                  />
                ))}
            </div>
          );
        })}
        {!N && <div className="hint" style={{ gridColumn: "1 / -1", textAlign: "center" }}>No teams yet.</div>}
      </div>

      {round.auto?.on && round.status === "live" && round.auto.nextAt != null && (
        <div className="pot-auto">AUTO · next number in {Math.max(0, Math.ceil((round.auto.nextAt - round.serverNow) / 1000))}s</div>
      )}
    </div>
  );
}

/** A number that rolls to its new value instead of jumping. */
export function Odometer({ value, big = false }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return undefined;
    const t0 = performance.now();
    const dur = 650;
    let raf = 0;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * e));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <b className={`odo ${big ? "big" : ""} ${shown !== value ? "rolling" : ""}`}>{shown}</b>;
}

/* ── the chime ────────────────────────────────────────────────────────── */

let audioCtx = null;

/** Two quick notes, the second pitched by the number: a 10 rings higher than a 0. */
export function chime(n) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    const base = 523.25; // C5
    const notes = [base, base * Math.pow(2, (4 + (n ?? 5)) / 12)];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.55);
    });
  } catch {
    /* no audio — fine */
  }
}
