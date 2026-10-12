/**
 * The draw: one small cell per hidden number, filling left to right as they
 * are drawn, with the running sum beside them. Compact on the floor (a strip
 * across the top), big on the projector.
 *
 *   a cell that has just landed flips over, flares, and throws sparks
 *   the sum rolls up to its new value rather than jumping
 *   the border lights chase for a moment
 *   a two-note chime, if sound is on
 *
 * Which cell is which team is nobody's business: cells fill in the order the
 * numbers came out, and that order is secret until the end.
 */
import React, { useEffect, useRef, useState } from "react";

export default function Draw({ round, big = false, sound = false }) {
  const N = round?.N ?? 0;
  const revealed = round?.revealed ?? [];
  const count = revealed.length;
  const prev = useRef(count);
  const [flash, setFlash] = useState(null);
  const [sparks, setSparks] = useState([]);
  const [chase, setChase] = useState(false);

  useEffect(() => {
    if (count > prev.current) {
      const i = count - 1;
      setFlash(i);
      setChase(true);
      const n = big ? 18 : 10;
      setSparks(Array.from({ length: n }, (_, k) => ({ id: `${i}-${k}`, a: (k / n) * 360, d: (big ? 40 : 22) + ((k * 37) % (big ? 50 : 26)) })));
      if (sound) chime(revealed[i]);
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
  }, [count, big, sound, revealed]);

  useEffect(() => {
    if (count === 0) prev.current = 0;
  }, [round?.roundId, count]);

  if (!round) return null;
  const settled = round.status === "settled";
  const lobby = round.status === "lobby";
  const autoIn = round.auto?.on && round.status === "live" && round.auto.nextAt != null ? Math.max(0, Math.ceil((round.auto.nextAt - round.serverNow) / 1000)) : null;

  return (
    <div className={`draw ${big ? "big" : ""} ${chase ? "chase" : ""} ${settled ? "settled" : ""}`}>
      <div className="draw-lights" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${(i % 6) * 120}ms` }} />
        ))}
      </div>

      <div className="draw-sum">
        <i>{settled ? "S · FINAL" : lobby ? "TEAMS" : "SUM SO FAR"}</i>
        <Odometer value={lobby ? N : round.sum} big={big} />
      </div>

      <div className="draw-facts">
        <span>
          <i>{lobby ? "EACH HOLDS" : settled ? "DRAWN" : "DRAWN"}</i>
          <b>{lobby ? "0 – 10" : `${count} / ${N}`}</b>
        </span>
        <span>
          <i>{settled ? "FINAL" : "STILL POSSIBLE"}</i>
          <b>{lobby ? `0 – ${round.Smax}` : settled ? round.settleS : `${round.lo} – ${round.hi}`}</b>
        </span>
        <span>
          <i>STRIKE K</i>
          <b className="gold">{round.K}</b>
        </span>
        {autoIn != null && (
          <span>
            <i>NEXT</i>
            <b>{autoIn}s</b>
          </span>
        )}
      </div>

      <div className="draw-cells">
        {Array.from({ length: N }, (_, i) => {
          const n = i < count ? revealed[i] : null;
          const landed = n != null;
          return (
            <div key={`${round.roundId}-${i}`} className={`cell ${landed ? `in v${n}` : "out"} ${flash === i ? "flash" : ""} ${lobby ? "lobby" : ""}`}>
              <span className="cell-face">{landed ? n : lobby ? "•" : "?"}</span>
              {flash === i && sparks.map((s) => <span key={s.id} className="spark" style={{ "--a": `${s.a}deg`, "--d": `${s.d}px` }} />)}
            </div>
          );
        })}
        {!N && <span className="hint">No teams yet.</span>}
      </div>
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
    const base = 523.25;
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
    /* no audio */
  }
}
