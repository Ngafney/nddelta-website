import React, { useEffect, useState } from "react";
import { api, withPlayer } from "../api.js";
import { PxButton, Spinner } from "./PixelBits.jsx";
import OrbitMap from "./OrbitMap.jsx";

/**
 * The sightings, the constants, and the block a team hands to an assistant.
 *
 * Deliberately plain: a table of numbers. There is no clever summary of the
 * data because working out what the data means is the exercise, and a panel
 * that pre-digests it would be doing the interesting part for them.
 *
 * The one thing it does help with is the download and the prompt, because
 * retyping thirty-two coordinate pairs teaches nobody anything.
 */
export default function DataPanel({ player, round }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const released = round?.released ?? 0;

  useEffect(() => {
    if (!released) return undefined;
    let live = true;
    api
      .get("data", withPlayer(player))
      .then((x) => live && (setD(x), setErr(null)))
      .catch((e) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [released, player]);

  if (!released) {
    return (
      <section className="panel">
        <div className="panel-title">SIGHTINGS</div>
        <p className="hint">Nothing released yet. The operator opens the first batch when the round starts.</p>
      </section>
    );
  }
  if (err) {
    return (
      <section className="panel">
        <div className="panel-title">SIGHTINGS</div>
        <p className="hint">{err}</p>
      </section>
    );
  }
  if (!d) return <Spinner text="READING THE SIGHTINGS" />;

  const href = `/api/week4/data.csv?${new URLSearchParams(withPlayer(player))}`;

  return (
    <section className="panel">
      <div className="panel-title">
        SIGHTINGS <span className="dim">· batch {d.release} of {d.of}</span>
      </div>
      <p className="hint">
        {d.sightings.length} positions over {d.arcDays} days. Each is 1σ <b>{d.sightingSigmaKm} km</b> in
        x and in y. About one in twenty-five is a blunder rather than noise — nobody will tell you which.
      </p>

      <OrbitMap
        obs={d.sightings}
        au={Math.max(2.2, ...d.sightings.map((s) => Math.hypot(s.x, s.y) * 1.25))}
        earthTrail={earthRing(d.earth)}
        encounter={null}
        astTrail={null}
        cloud={null}
      />

      <div className="factgrid">
        <Fact label="GM SUN" value={d.gmSun} sub="AU³/day²" />
        <Fact label="GM EARTH" value={d.gmEarth} sub="AU³/day²" />
        <Fact label="EARTH RADIUS" value={`${d.earthRadiusKm.toFixed(0)} km`} sub={`${d.earthRadiusAu.toExponential(4)} AU`} />
        <Fact label="ENCOUNTER" value={`~day ${d.tEncounter}`} sub={`integrate to ${d.tEnd}`} />
        <Fact label="EARTH ORBIT" value={`a ${d.earth.aAu}  e ${d.earth.e}`} sub={`period ${d.earth.periodDays} d`} />
        <Fact label="EARTH POSITION" value={`± ${d.earthEphemSigmaKm} km`} sub="its ephemeris is not perfect either" />
      </div>

      <div className="tablewrap">
        <table className="obstable">
          <thead>
            <tr>
              <th>#</th>
              <th>t (days)</th>
              <th>x (AU)</th>
              <th>y (AU)</th>
            </tr>
          </thead>
          <tbody>
            {d.sightings.map((s, i) => (
              <tr key={i}>
                <td className="dim">{i + 1}</td>
                <td className="num">{s.t}</td>
                <td className="num">{s.x.toFixed(8)}</td>
                <td className="num">{s.y.toFixed(8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="datarow">
        <a className="pxbtn dl" href={href}>
          ↓ DOWNLOAD CSV
        </a>
        <PxButton
          onClick={() => {
            navigator.clipboard
              .writeText(d.prompt)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              })
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "COPIED" : "COPY THE PROMPT"}
        </PxButton>
        <span className="dim">…or just open the DELTAGPT tab, which already has all of this.</span>
      </div>

      <textarea className="promptbox" readOnly value={d.prompt} rows={12} />
      <p className="hint">{d.note}</p>
      <p className="hint">{d.modelNote}</p>
    </section>
  );
}

/** The Earth's ellipse, for the picture. Kepler, same as everywhere else. */
function earthRing(e) {
  if (!e) return [];
  const out = [];
  for (let i = 0; i <= 180; i++) {
    const M = (2 * Math.PI * i) / 180;
    let E = M + e.e * Math.sin(M);
    for (let k = 0; k < 8; k++) E -= (E - e.e * Math.sin(E) - M) / (1 - e.e * Math.cos(E));
    const px = e.aAu * (Math.cos(E) - e.e);
    const py = e.aAu * Math.sqrt(1 - e.e * e.e) * Math.sin(E);
    const c = Math.cos(e.peri);
    const s = Math.sin(e.peri);
    out.push([px * c - py * s, px * s + py * c]);
  }
  return out;
}

function Fact({ label, value, sub }) {
  return (
    <div className="fact">
      <i>{label}</i>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}
