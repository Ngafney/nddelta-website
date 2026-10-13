/**
 * The draw: one small cell per hidden number, filling left to right as they
 * are drawn, with the running sum beside them. Compact on the floor (a strip
 * across the top), big on the projector.
 *
 *   a cell that has just landed flips over, flares, and throws sparks
 *   the sum rolls up to its new value rather than jumping
 *   the border lights chase for a moment (and idle slowly while live)
 *   the whole screen flashes on a big draw, gold for a 10, cold for a 0
 *   the last seconds before an auto draw tick
 *   settlement: a fanfare and confetti
 *
 * Which cell is which team is nobody's business: cells fill in the order the
 * numbers came out, and that order is secret until the end.
 */
import React, { useEffect, useRef, useState } from "react";
import * as sfx from "./sfx.js";

export default function Draw({ round, big = false, sound = false }) {
  const N = round?.N ?? 0;
  const revealed = round?.revealed ?? [];
  const count = revealed.length;
  const prev = useRef(count);
  const prevStatus = useRef(round?.status);
  const [flash, setFlash] = useState(null);
  const [sparks, setSparks] = useState([]);
  const [chase, setChase] = useState(false);
  const [screen, setScreen] = useState(null); // "gold" | "cold" | "win"
  const [confetti, setConfetti] = useState([]);
  const lastTick = useRef(null);

  // Every click on the page is the gesture that lets sound start.
  useEffect(() => {
    const on = () => sfx.unlock();
    document.addEventListener("pointerdown", on, { passive: true });
    document.addEventListener("keydown", on);
    return () => {
      document.removeEventListener("pointerdown", on);
      document.removeEventListener("keydown", on);
    };
  }, []);

  /* a number landed */
  useEffect(() => {
    if (count > prev.current) {
      const i = count - 1;
      const n = revealed[i];
      setFlash(i);
      setChase(true);
      const k = big ? 22 : 12;
      setSparks(Array.from({ length: k }, (_, j) => ({ id: `${i}-${j}`, a: (j / k) * 360, d: (big ? 46 : 24) + ((j * 37) % (big ? 60 : 30)) })));
      if (n === 10) setScreen("gold");
      else if (n === 0) setScreen("cold");
      else if (n >= 8) setScreen("warm");
      if (sound) sfx.draw(n);
      const t1 = setTimeout(() => setFlash(null), 1600);
      const t2 = setTimeout(() => setChase(false), 2200);
      const t3 = setTimeout(() => setSparks([]), 1400);
      const t4 = setTimeout(() => setScreen(null), 900);
      prev.current = count;
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
      };
    }
    prev.current = count;
    return undefined;
  }, [count, big, sound, revealed]);

  /* the bell */
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = round?.status;
    if (round?.status === "settled" && was && was !== "settled") {
      if (sound) sfx.settle();
      setScreen("win");
      const m = big ? 140 : 80;
      setConfetti(Array.from({ length: m }, (_, j) => ({ id: j, x: Math.random() * 100, d: 2.4 + Math.random() * 2.2, w: 0.6 + Math.random() * 1.6, h: Math.random() * 360, r: Math.random() * 720 - 360 })));
      const t1 = setTimeout(() => setScreen(null), 1200);
      const t2 = setTimeout(() => setConfetti([]), 5200);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    return undefined;
  }, [round?.status, sound, big]);

  useEffect(() => {
    if (count === 0) prev.current = 0;
  }, [round?.roundId, count]);

  const autoIn = round?.auto?.on && round.status === "live" && round.auto.nextAt != null ? Math.max(0, Math.ceil((round.auto.nextAt - round.serverNow) / 1000)) : null;

  /* the countdown ticks */
  useEffect(() => {
    if (autoIn == null || autoIn > 3 || autoIn < 1) return;
    const key = `${round?.auto?.nextAt}-${autoIn}`;
    if (lastTick.current === key) return;
    lastTick.current = key;
    if (sound) sfx.tick(autoIn);
  }, [autoIn, sound, round?.auto?.nextAt]);

  if (!round) return null;
  const settled = round.status === "settled";
  const lobby = round.status === "lobby";
  const live = round.status === "live";
  const last = count ? revealed[count - 1] : null;
  const streak = count >= 2 ? (revealed[count - 1] >= 8 && revealed[count - 2] >= 8 ? "hot" : revealed[count - 1] <= 2 && revealed[count - 2] <= 2 ? "cold" : null) : null;

  return (
    <div className={`draw ${big ? "big" : ""} ${chase ? "chase" : ""} ${live ? "live" : ""} ${settled ? "settled" : ""} ${autoIn != null && autoIn <= 3 ? "arming" : ""}`}>
      {screen && <div className={`screenflash ${screen}`} aria-hidden="true" />}
      {confetti.length > 0 && (
        <div className="confetti" aria-hidden="true">
          {confetti.map((c) => (
            <i key={c.id} style={{ left: `${c.x}%`, animationDuration: `${c.d}s`, width: `${c.w * 6}px`, height: `${c.w * 10}px`, background: `hsl(${c.h} 90% 60%)`, "--r": `${c.r}deg` }} />
          ))}
        </div>
      )}
      <div className="draw-lights" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${(i % 6) * 120}ms`, "--i": i }} />
        ))}
      </div>

      <div className="draw-sum">
        <i>{settled ? "S · FINAL" : lobby ? "TEAMS" : "SUM SO FAR"}</i>
        <Odometer value={lobby ? N : round.sum} big={big} />
      </div>

      <div className="draw-facts">
        <span>
          <i>DRAWN</i>
          <b>{lobby ? "0 – 10 EACH" : `${count} / ${N}`}</b>
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
          <span className={autoIn <= 3 ? "arming" : ""}>
            <i>NEXT</i>
            <b>{autoIn}s</b>
          </span>
        )}
        {streak && (
          <span className={`streak ${streak}`}>
            <i>STREAK</i>
            <b>{streak === "hot" ? "🔥 HOT" : "🧊 COLD"}</b>
          </span>
        )}
        {!streak && last != null && !settled && (last === 10 || last === 0) && (
          <span className={`streak ${last === 10 ? "hot" : "cold"}`}>
            <i>LAST</i>
            <b>{last === 10 ? "💥 TEN" : "🫥 ZERO"}</b>
          </span>
        )}
      </div>

      <div className="draw-cells">
        {Array.from({ length: N }, (_, i) => {
          const n = i < count ? revealed[i] : null;
          const landed = n != null;
          return (
            <div key={`${round.roundId}-${i}`} className={`cell ${landed ? `in v${n}` : "out"} ${flash === i ? "flash" : ""} ${lobby ? "lobby" : ""} ${live && !landed && i === count ? "next" : ""}`}>
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

export const chime = sfx.draw;
