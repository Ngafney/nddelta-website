import React, { useEffect, useRef, useState } from "react";
import { api, withPlayer } from "../api.js";
import { Spinner } from "./PixelBits.jsx";

/**
 * Watch the three bodies move.
 *
 * What is drawn is the OBSERVED record — the same noisy numbers in the
 * download, not the truth — because that is all anyone has until the bell.
 * The scatter you can see at the asteroid is the error bar, honestly rendered,
 * and it is exactly why the question is hard.
 */
export default function Orrery({ player, round }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [playing, setPlaying] = useState(true);
  const [i, setI] = useState(0);
  const [trails, setTrails] = useState(true);
  const canvasRef = useRef(null);
  const released = round?.released ?? 0;

  useEffect(() => {
    let gone = false;
    api
      .get("data", withPlayer(player))
      .then((d) => !gone && (setRows(d.rows), setErr(null)))
      .catch((e) => !gone && setErr(e.message));
    return () => {
      gone = true;
    };
  }, [player, released]);

  // The clock. One frame per row, wrapping at the end.
  useEffect(() => {
    if (!playing || !rows?.length) return;
    const h = setInterval(() => setI((v) => (v + 1) % rows.length), 45);
    return () => clearInterval(h);
  }, [playing, rows]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !rows?.length) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // Fit every body that has been observed into the frame, once, so the view
    // does not jump about as the animation runs.
    let R = 0.2;
    for (const r of rows) {
      for (const p of [r.sun, r.earth, r.ast]) R = Math.max(R, Math.hypot(p[0], p[1]));
    }
    const pad = 26;
    const scale = (Math.min(w, h) / 2 - pad) / R;
    const cx = w / 2;
    const cy = h / 2;
    const X = (p) => cx + p[0] * scale;
    const Y = (p) => cy - p[1] * scale;

    g.fillStyle = "#04060d";
    g.fillRect(0, 0, w, h);

    // A few fixed stars, seeded off nothing in particular, purely for depth.
    g.fillStyle = "rgba(255,255,255,0.35)";
    for (let s = 0; s < 70; s++) {
      const a = (s * 2654435761) % 1000;
      const b = (s * 40503) % 1000;
      g.fillRect((a / 1000) * w, (b / 1000) * h, 1, 1);
    }

    if (trails) {
      for (const [key, color] of [
        ["earth", "rgba(90,170,255,0.55)"],
        ["ast", "rgba(255,150,70,0.55)"],
      ]) {
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.beginPath();
        for (let k = 0; k <= i; k++) {
          const p = rows[k][key];
          const x = X(p);
          const y = Y(p);
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }

    const now = rows[i];
    // The Sun, with a little corona so the sungrazing pass reads.
    const sx = X(now.sun);
    const sy = Y(now.sun);
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 22);
    glow.addColorStop(0, "rgba(255,230,120,0.95)");
    glow.addColorStop(1, "rgba(255,180,40,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(sx, sy, 22, 0, Math.PI * 2);
    g.fill();
    dot(g, sx, sy, 4.5, "#ffe98a");

    dot(g, X(now.earth), Y(now.earth), 4, "#5aa9ff");
    dot(g, X(now.ast), Y(now.ast), 3, "#ff9c46");

    g.font = "8px 'Press Start 2P', monospace";
    g.fillStyle = "#5aa9ff";
    g.fillText("EARTH", X(now.earth) + 7, Y(now.earth) - 6);
    g.fillStyle = "#ff9c46";
    g.fillText("ASTEROID", X(now.ast) + 7, Y(now.ast) - 6);

    // How far apart they are right now — the number that decides the game.
    const sep = Math.hypot(now.ast[0] - now.earth[0], now.ast[1] - now.earth[1], now.ast[2] - now.earth[2]);
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fillText(`DAY ${now.day.toFixed(0)}`, 10, 16);
    g.fillText(`SEPARATION ${sep.toFixed(3)} AU`, 10, 30);
  }, [rows, i, trails]);

  if (err) {
    return (
      <div className="panel">
        <div className="dead-note">
          NOTHING TO PLOT YET
          <br />
          <span style={{ color: "var(--dim)", fontSize: 9 }}>{err}</span>
        </div>
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="panel">
        <Spinner text="LOADING THE SKY" />
      </div>
    );
  }

  return (
    <div className="panel orrery">
      <canvas ref={canvasRef} className="orrery-canvas" />
      <div className="orrery-controls">
        <button className={playing ? "on" : ""} onClick={() => setPlaying((v) => !v)}>
          {playing ? "❚❚ PAUSE" : "▶ PLAY"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, rows.length - 1)}
          value={i}
          onChange={(e) => {
            setPlaying(false);
            setI(Number(e.target.value));
          }}
          aria-label="scrub the record"
        />
        <button className={trails ? "on" : ""} onClick={() => setTrails((v) => !v)}>
          TRAILS
        </button>
      </div>
      <p className="dim orrery-note">
        These are the measured positions, not the true ones. The wobble is the error bar.
      </p>
    </div>
  );
}

function dot(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}
