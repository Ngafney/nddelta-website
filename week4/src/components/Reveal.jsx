import React, { useEffect, useRef, useState } from "react";
import { PxButton, money } from "./PixelBits.jsx";

/**
 * The answer, in three beats.
 *
 * 1. The true path is drawn, fast, from the start of the record to impact —
 *    including the swing past the Sun everyone could only infer.
 * 2. The globe turns up and the strike lands on it, north or south of a very
 *    obvious equator.
 * 3. The board.
 *
 * It plays once and then sits still. Nothing here loops: a reveal that keeps
 * re-animating stops being a reveal and becomes wallpaper.
 */
const FLIGHT_MS = 4200;
const LAND_MS = 1500;

export default function Reveal({ data, onNext }) {
  const [beat, setBeat] = useState(0); // 0 flight, 1 landing, 2 board
  const canvasRef = useRef(null);
  const raf = useRef(0);
  const started = useRef(0);

  useEffect(() => {
    const a = setTimeout(() => setBeat(1), FLIGHT_MS);
    const b = setTimeout(() => setBeat(2), FLIGHT_MS + LAND_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !data?.track?.length) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const track = data.track;
    let R = 0.2;
    for (const t of track) {
      R = Math.max(R, Math.hypot(t[3], t[4]), Math.hypot(t[6], t[7]));
    }
    const scale = (Math.min(w, h) / 2 - 24) / R;
    const X = (x) => w / 2 + x * scale;
    const Y = (y) => h / 2 - y * scale;

    started.current = performance.now();
    const draw = (now) => {
      const t = Math.min(1, (now - started.current) / FLIGHT_MS);
      const upto = Math.max(1, Math.floor(t * (track.length - 1)));

      g.fillStyle = "#04060d";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,0.3)";
      for (let s = 0; s < 90; s++) {
        g.fillRect(((s * 2654435761) % 1000) / 1000 * w, ((s * 40503) % 1000) / 1000 * h, 1, 1);
      }

      // Earth's orbit, then the asteroid's real path.
      line(g, track, upto, 3, 4, X, Y, "rgba(90,170,255,0.5)");
      line(g, track, upto, 6, 7, X, Y, "rgba(255,150,70,0.95)");

      const sx = X(track[upto][0]);
      const sy = Y(track[upto][1]);
      const glow = g.createRadialGradient(sx, sy, 0, sx, sy, 26);
      glow.addColorStop(0, "rgba(255,232,130,0.95)");
      glow.addColorStop(1, "rgba(255,180,40,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(sx, sy, 26, 0, Math.PI * 2);
      g.fill();

      dot(g, X(track[upto][3]), Y(track[upto][4]), 4, "#5aa9ff");
      dot(g, X(track[upto][6]), Y(track[upto][7]), 3.5, "#ffb060");

      if (t < 1) raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [data]);

  const north = data.winner === "north";
  const lat = data.latDeg;

  return (
    <div className="reveal">
      <div className="reveal-stage">
        <canvas ref={canvasRef} className="reveal-canvas" />
        {beat >= 1 && <Globe latDeg={lat} />}
      </div>

      {beat >= 1 && (
        <div className={`reveal-verdict ${data.winner}`}>
          <span className="verdict-kicker">IT LANDED</span>
          <h1>{north ? "NORTH" : "SOUTH"}</h1>
          <p>
            {Math.abs(lat).toFixed(2)}° {north ? "north" : "south"} of the equator ·{" "}
            <b>{north ? "NORTH" : "SOUTH"} pays $100</b>, {north ? "SOUTH" : "NORTH"} pays nothing
          </p>
        </div>
      )}

      {beat >= 2 && (
        <>
          <Physics p={data.physics} />
          <div className="reveal-board">
            <div className="panel-title">FINAL STANDINGS</div>
            {data.leaderboard.slice(0, 10).map((t) => (
              <div key={t.id} className={`lbrow p${t.rank}`}>
                <span className="rk">{t.rank}</span>
                <span className="nm">{t.name}</span>
                <span className="vl">{money(t.valueC)}</span>
                <span className={`dl ${t.valueC - t.startC >= 0 ? "up" : "down"}`}>
                  {t.valueC - t.startC >= 0 ? "+" : ""}
                  {money(t.valueC - t.startC)}
                </span>
              </div>
            ))}
          </div>
          <PxButton variant="green" onClick={onNext}>
            NEXT
          </PxButton>
        </>
      )}
    </div>
  );
}

/**
 * What the room could not have known, and the one thing worth saying out loud
 * afterwards: a Newtonian model of this system gets the answer wrong.
 */
function Physics({ p }) {
  if (!p) return null;
  return (
    <div className="physics-note">
      <div className="panel-title">WHAT IT ACTUALLY DID</div>
      <ul>
        <li>
          Passed <b>{p.perihelionSolarRadii.toFixed(1)} solar radii</b> from the Sun,{" "}
          <b>{p.passes}</b> times.
        </li>
        <li>
          General relativity moved it <b>{Math.round(p.relativisticDriftKm).toLocaleString()} km</b> by impact day.
        </li>
        <li>
          {p.newtonianMisses ? (
            <>
              With Newtonian gravity alone it would have <b>missed the Earth entirely</b>, by{" "}
              {Math.round(p.newtonianMissKm).toLocaleString()} km.
            </>
          ) : (
            <>
              With Newtonian gravity alone it would have landed at{" "}
              <b>{p.newtonianLatDeg?.toFixed(2)}°</b> instead.
            </>
          )}
        </li>
      </ul>
    </div>
  );
}

/** A wireframe globe with the strike marked, so the answer is a place. */
function Globe({ latDeg }) {
  const r = 78;
  const y = -Math.sin((latDeg * Math.PI) / 180) * r;
  const x = Math.cos((latDeg * Math.PI) / 180) * r * 0.32;
  return (
    <svg className="globe" viewBox="-100 -100 200 200" role="img" aria-label="impact location">
      <circle cx="0" cy="0" r={r} className="globe-body" />
      {[-60, -30, 30, 60].map((L) => {
        const yy = -Math.sin((L * Math.PI) / 180) * r;
        const rx = Math.cos((L * Math.PI) / 180) * r;
        return <ellipse key={L} cx="0" cy={yy} rx={rx} ry={rx * 0.16} className="globe-par" />;
      })}
      <ellipse cx="0" cy="0" rx={r} ry={r * 0.16} className="globe-eq" />
      <text x="0" y={-r - 10} className="globe-lbl" textAnchor="middle">
        N
      </text>
      <text x="0" y={r + 18} className="globe-lbl" textAnchor="middle">
        S
      </text>
      <circle cx={x} cy={y} r="6" className="globe-hit" />
      <circle cx={x} cy={y} r="13" className="globe-ring" />
    </svg>
  );
}

function line(g, track, upto, ix, iy, X, Y, color) {
  g.strokeStyle = color;
  g.lineWidth = 1.6;
  g.beginPath();
  for (let k = 0; k <= upto; k++) {
    const x = X(track[k][ix]);
    const y = Y(track[k][iy]);
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

function dot(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}
