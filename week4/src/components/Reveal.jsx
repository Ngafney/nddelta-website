import React, { useEffect, useState } from "react";
import { PxButton, money } from "./PixelBits.jsx";
import CorridorMap from "./CorridorMap.jsx";

/**
 * Where it actually landed.
 *
 * The payoff here is not a simulation finishing — it is that the thing was
 * real. A rock was spotted, a warning went out, people argued about a corridor,
 * and then it arrived exactly where it was always going to. So the reveal shows
 * the ellipse the room was trading against, drops the true point onto it, and
 * then gets out of the way and tells the story.
 *
 * Three beats, once, and then it sits still.
 */
const MAP_MS = 2600;
const VERDICT_MS = 1400;

export default function Reveal({ data, onNext }) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const a = setTimeout(() => setBeat(1), MAP_MS);
    const b = setTimeout(() => setBeat(2), MAP_MS + VERDICT_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  const t = data.truth;
  const north = data.winner === "north";
  // The last solution the room actually saw.
  const shown = Math.max(1, data.shown || data.releases.length);
  const last = data.releases[shown - 1] ?? data.releases[data.releases.length - 1];

  const solution = {
    nominalLat: last.nominalLat,
    nominalLon: last.nominalLon,
    azimuthDeg: data.corridor.azimuthDeg,
    covarianceKm2: covFrom(last.sigmaKm),
    lineDeg: data.lineDeg,
  };

  return (
    <div className="reveal">
      <div className="reveal-head">
        <span className="verdict-kicker">THIS ACTUALLY HAPPENED</span>
        <h2>
          {t.name}
          {t.nick ? ` · ${t.nick}` : ""}
        </h2>
        <p className="dim">
          {new Date(t.when).toUTCString().replace("GMT", "UTC")} · {t.where}
        </p>
      </div>

      <div className="reveal-map">
        <CorridorMap
          solution={solution}
          truth={beat >= 1 ? { lat: t.lat, lon: t.lon } : null}
          releases={beat >= 1 ? data.releases.slice(0, shown) : null}
        />
      </div>

      {beat >= 1 && (
        <div className={`reveal-verdict ${data.winner}`}>
          <h1>{north ? "NORTH" : "SOUTH"}</h1>
          <p>
            It came down at <b>{fmt(t.lat)}</b>, {fmtLon(t.lon)} — {Math.abs(t.lat - data.lineDeg).toFixed(2)}°{" "}
            {north ? "north" : "south"} of the {fmt(data.lineDeg)} line.{" "}
            <b>{north ? "NORTH" : "SOUTH"} pays $100</b>.
          </p>
        </div>
      )}

      {beat >= 2 && (
        <>
          <div className="physics-note">
            <div className="panel-title">WHAT IT WAS</div>
            <ul>
              <li>
                Discovered <b>{t.leadHours.toFixed(1)} hours</b> before it arrived, travelling{" "}
                <b>{t.speedKms} km/s</b>.
              </li>
              <li>
                About <b>{t.diameterM[0]}–{t.diameterM[1]} m</b> across, and it let go roughly{" "}
                <b>{t.impactKt} kilotons</b> of energy.
              </li>
              <li>{t.story}</li>
            </ul>
          </div>

          {data.others?.length > 0 && (
            <div className="others">
              <div className="panel-title">AND THE OTHERS</div>
              <p className="dim">
                Eleven asteroids have been caught on the way in. The rest of them:
              </p>
              <div className="otherlist">
                {data.others.map((o) => (
                  <span key={o.name}>
                    <b>{o.name}</b> {o.where} · {o.leadHours}h
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="reveal-board">
            <div className="panel-title">FINAL STANDINGS</div>
            {data.leaderboard.slice(0, 10).map((x) => (
              <div key={x.id} className={`lbrow p${x.rank}`}>
                <span className="rk">{x.rank}</span>
                <span className="nm">{x.name}</span>
                <span className="vl">{money(x.valueC)}</span>
                <span className={`dl ${x.valueC - x.startC >= 0 ? "up" : "down"}`}>
                  {x.valueC - x.startC >= 0 ? "+" : ""}
                  {money(x.valueC - x.startC)}
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

const fmt = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;

/**
 * Rebuild a release's covariance from its sigma.
 *
 * The reveal only needs the ellipse to draw at the right size and tilt, and
 * the ratio and tilt are fixed for a round, so carrying the whole matrix
 * through the payload would be three numbers of duplication.
 */
function covFrom(sigmaKm, ratio = 6, tiltDeg = 12) {
  const a = sigmaKm;
  const b = sigmaKm / ratio;
  const t = (tiltDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [a * a * c * c + b * b * s * s, (a * a - b * b) * c * s],
    [(a * a - b * b) * c * s, a * a * s * s + b * b * c * c],
  ];
}
