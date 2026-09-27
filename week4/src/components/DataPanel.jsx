import React, { useEffect, useState } from "react";
import { api, withPlayer } from "../api.js";
import { PxButton, Spinner } from "./PixelBits.jsx";
import CorridorMap from "./CorridorMap.jsx";

/**
 * The published impact solution: the numbers, the picture, and the block you
 * hand to an AI.
 *
 * The prompt is built on the SERVER from the same object that fills the table
 * above it, so the two can never disagree. A team that copies it, argues with
 * a model about the five assumptions, and runs what comes back has done the
 * round — which is the point.
 */
export default function DataPanel({ player, round }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const released = round?.released ?? 0;

  useEffect(() => {
    let gone = false;
    api
      .get("data", withPlayer(player))
      .then((x) => !gone && (setD(x), setErr(null)))
      .catch((e) => !gone && (setErr(e.message), setD(null)));
    return () => {
      gone = true;
    };
  }, [player, released]);

  if (err) {
    return (
      <div className="panel">
        <div className="dead-note">
          NOTHING RELEASED YET
          <br />
          <span style={{ color: "var(--dim)", fontSize: 9 }}>{err}</span>
        </div>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="panel">
        <Spinner text="READING THE SOLUTION" />
      </div>
    );
  }

  const href = `/api/week4/data.csv?${new URLSearchParams(withPlayer(player))}`;
  const C = d.covarianceKm2;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be refused; the textarea below is always selectable.
      setCopied(false);
    }
  };

  return (
    <div className="panel datapanel">
      <div className="data-head">
        <div>
          <h3>IMPACT SOLUTION {d.release} OF {d.of}</h3>
          <p className="dim">
            {d.eventName} · nominal point <b>{fmt(d.nominalLat)}</b>, <b>{fmtLon(d.nominalLon)}</b> ·
            corridor bearing <b>{d.azimuthDeg.toFixed(0)}°</b>
            {d.geometry === "modelled" && <em className="tag"> corridor modelled</em>}
          </p>
        </div>
        <a className="pxbtn pxbtn--green pxbtn--big" href={href} download>
          ⭳ CSV
        </a>
      </div>

      <CorridorMap solution={d} />

      <div className="data-grid">
        <Fact label="THE LINE" value={fmt(d.lineDeg)} hint="north of it, or south" />
        <Fact label="σ ALONG" value={`${Math.round(d.sigmaAlongKm)} km`} hint="down the corridor" />
        <Fact label="σ ACROSS" value={`${Math.round(d.sigmaCrossKm)} km`} hint="either side of it" />
        <Fact label="GROUND SPEED" value={`${d.groundSpeedKms.toFixed(1)} km/s`} />
      </div>

      <div className="covbox">
        <div className="panel-title">COVARIANCE, km² — [along, cross]</div>
        <table className="covmat">
          <tbody>
            {C.map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j} className={i !== j ? "offdiag" : ""}>
                    {v.toFixed(1)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dim">
          The off-diagonal terms are not zero. Draw the two components together — a Cholesky factor,
          or <code>numpy.random.multivariate_normal</code> — or your answer will be wrong in a way
          that looks fine.
        </p>
      </div>

      <div className="askai">
        <div className="panel-title">HAND THIS TO AN AI</div>
        <p className="dim">
          Everything needed is below, including the assumptions worth arguing about. Paste it into
          whatever model you like, push back on anything that looks wrong, and run what it gives you.
        </p>
        <div className="askai-actions">
          <PxButton variant={copied ? "green" : "gold"} onClick={copy}>
            {copied ? "COPIED ✓" : "COPY THE PROMPT"}
          </PxButton>
        </div>
        <textarea className="promptbox" readOnly value={d.prompt} onFocus={(e) => e.target.select()} rows={18} />
      </div>

      <p className="dim data-note">{d.note}</p>
      {d.modelNote && <p className="model-note">{d.modelNote}</p>}
    </div>
  );
}

const fmt = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;

function Fact({ label, value, hint }) {
  return (
    <div className="fact">
      <i>{label}</i>
      <b>{value}</b>
      {hint && <em>{hint}</em>}
    </div>
  );
}
