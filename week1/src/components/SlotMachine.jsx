/**
 * One slot machine cabinet: sprite, animated reel window, floating payoff
 * numbers, coin bursts, and the running stats readout underneath.
 */
import React, { useEffect, useState } from "react";
import { PixelSprite, CoinBurst } from "./PixelBits.jsx";
import { SLOT_MACHINE, SLOT_WINDOW, slotPalette, REEL_SYMBOLS } from "./sprites.js";

export default function SlotMachine({ index, color, name, stats, truth, isBestTruth, locked, spinning, lastResult, onPull, scale = 4, soFarBest = false }) {
  const SCALE = scale;
  const [symbols, setSymbols] = useState(["Δ", "★", "7"]);
  const [bulbsLit, setBulbsLit] = useState(true);

  // Marquee bulbs chase while the reels spin.
  useEffect(() => {
    if (!spinning) {
      setBulbsLit(true);
      return;
    }
    const t = setInterval(() => setBulbsLit((b) => !b), 240);
    return () => clearInterval(t);
  }, [spinning]);

  // While spinning, the reels cycle fast; when a result lands they settle
  // on a face that matches the mood of the payoff.
  useEffect(() => {
    if (!spinning) return;
    const t = setInterval(() => {
      setSymbols([rand(), rand(), rand()]);
    }, 75);
    return () => clearInterval(t);
  }, [spinning]);

  useEffect(() => {
    if (!lastResult) return;
    const { payoff } = lastResult;
    if (payoff >= 12) setSymbols(["7", "7", "7"]);
    else if (payoff > 0) setSymbols(["★", "Δ", "★"]);
    else setSymbols([rand(), rand(), rand()]);
  }, [lastResult]);

  const win = {
    left: SLOT_WINDOW.x * SCALE,
    top: SLOT_WINDOW.y * SCALE,
    width: SLOT_WINDOW.w * SCALE,
    height: SLOT_WINDOW.h * SCALE,
    fontSize: Math.round(SCALE * 3.4), // sized to the 4-row window; shrinks with the cabinet
  };

  const bigWin = lastResult && lastResult.payoff >= 15;

  return (
    <div
      className={`machine ${locked ? "locked" : ""} ${spinning ? "spinning" : ""} ${isBestTruth ? "besttruth" : ""}`}
      style={{ width: 22 * SCALE }} // never wider than the cabinet — captions wrap inside, not into the neighbor
      onClick={() => !locked && onPull(index)}
      title={locked ? "" : `pull ${name}`}
    >
      <div
        className={bigWin ? "cab bigwin" : "cab"}
        key={bigWin ? `bw${lastResult.key}` : "cab"}
        style={{
          position: "relative",
          display: "inline-block",
          filter: `drop-shadow(0 ${SCALE * 2}px ${SCALE * 5}px ${color}30)`, // each cabinet glows its own color
        }}
      >
        <PixelSprite grid={SLOT_MACHINE} palette={slotPalette(color, bulbsLit)} scale={SCALE} />
        <div className="reels" style={win}>
          {symbols.map((s, i) => (
            <span key={i}>{s}</span>
          ))}
        </div>
        {lastResult && (
          <div key={lastResult.key} className={`float-pay ${lastResult.payoff >= 0 ? "pos" : "neg"}`}>
            {lastResult.payoff >= 0 ? "+" : ""}
            {lastResult.payoff.toFixed(1)}
          </div>
        )}
        {lastResult && lastResult.payoff > 0 && <CoinBurst key={`c${lastResult.key}`} n={Math.min(10, 3 + Math.round(lastResult.payoff / 4))} />}
      </div>
      <div className="machine-stats">
        <div style={{ fontFamily: "var(--px)", fontSize: SCALE >= 3 ? 8 : 7, color }}>{name}</div>
        <div>{SCALE >= 3 ? `${stats.plays} ${stats.plays === 1 ? "pull" : "pulls"}` : `${stats.plays}×`}</div>
        <div>
          {stats.plays > 0 ? (
            <>
              avg <b className="avg">{(stats.sum / stats.plays).toFixed(1)}</b>
              {soFarBest && <span style={{ color: "var(--gold)" }} title="best average so far"> ▲</span>}
            </>
          ) : (
            "—"
          )}
        </div>
        {truth !== undefined && (
          <>
            <div className="truth">{SCALE >= 3 ? "true avg" : "truth"}</div>
            <div className="truth">
              {truth.toFixed(1)}
              {isBestTruth ? (SCALE >= 4 ? " ◄ BEST" : " ◄") : ""}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const rand = () => REEL_SYMBOLS[Math.floor(Math.random() * REEL_SYMBOLS.length)];
