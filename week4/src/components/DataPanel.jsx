import React, { useEffect, useState } from "react";
import { api, withPlayer } from "../api.js";
import { PxButton, Spinner } from "./PixelBits.jsx";

/**
 * The sightings, and what they are.
 *
 * There is deliberately no picture here. Drawing the orbit is most of the work
 * and all of the insight - a team that plots its own fit sees immediately that
 * one sighting is off the curve, and a team handed the plot learns nothing. The
 * only drawing in this round is at the reveal, when it can no longer help.
 *
 * What the panel does owe a human is an explanation. A bare table of twelve
 * significant figures tells a student nothing about what they are holding, so
 * the numbers come with the question, the physics, and what is uncertain,
 * written out rather than left in a prompt to be pasted somewhere else.
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
        <div className="panel-title">THE SIGHTINGS</div>
        <p className="hint">Nothing released yet. The operator opens the first batch when the round starts.</p>
      </section>
    );
  }
  if (err) {
    return (
      <section className="panel">
        <div className="panel-title">THE SIGHTINGS</div>
        <p className="hint">{err}</p>
      </section>
    );
  }
  if (!d) return <Spinner text="READING THE SIGHTINGS" />;

  const href = `/api/week4/data.csv?${new URLSearchParams(withPlayer(player))}`;
  const more = d.release < d.of;
  const sigmaAu = d.sightingSigmaKm / d.auKm;

  return (
    <section className="panel datapanel">
      <div className="panel-title">
        THE SIGHTINGS <span className="dim">· batch {d.release} of {d.of}</span>
      </div>

      {/* ── what you are being asked ───────────────────────────────── */}
      <div className="explain">
        <h3>What you are being asked</h3>
        <p>
          An asteroid has been photographed <b>{d.sightings.length} times</b> over{" "}
          <b>{d.arcDays} days</b>. Each photograph gives you where it was. Somewhere around{" "}
          <b>day {d.tEncounter}</b> it passes the Earth. Does it come within one Earth radius of
          the Earth's centre — a <b>HIT</b> — or go past — a <b>MISS</b>?
        </p>

        <h3>What one row is</h3>
        <p>
          A time in <b>days</b> from the epoch, and the asteroid's position in <b>AU</b>, measured
          from the Sun, in the plane of the Earth's orbit. Two numbers and a clock. That is all
          anybody has.
        </p>

        <h3>How wrong each row is</h3>
        <p>
          Every position is out by about <b>{d.sightingSigmaKm} km</b>, one sigma, independently in
          x and in y. In the units of the table that is <b>{sigmaAu.toExponential(2)} AU</b> — six
          decimal places in, which is why the table shows eight.
        </p>
        <p className="dim">
          That sounds small. One Earth radius is {d.earthRadiusKm.toLocaleString()} km, and the
          encounter is {d.tEncounter} days after the last thing you can see. A position error
          becomes a velocity error, and a velocity error has a year to grow.
        </p>

        <h3>The physics, in full</h3>
        <p>
          Newton, twice. The Sun pulls the asteroid and the Earth pulls the asteroid; the asteroid
          pulls nothing back that matters.
        </p>
        <pre className="code">{`a = -GM_sun * r / |r|^3  -  GM_earth * (r - r_earth) / |r - r_earth|^3`}</pre>
        <p>
          The Earth runs on its own fixed Kepler ellipse, below. Solve Kepler's equation for where
          it is at time t, then integrate the asteroid.
        </p>

        <h3>What else is uncertain</h3>
        <p>
          The Earth's own position is known to about <b>{d.earthEphemSigmaKm} km</b>. The Sun's GM
          to about <b>{d.gmSunRelSigma}</b> of itself. One of those matters more than it looks.
        </p>
      </div>

      {/* ── the constants ──────────────────────────────────────────── */}
      <div className="panel-title sub">THE CONSTANTS</div>
      <div className="factgrid">
        <Fact label="GM SUN" value={d.gmSun} sub="AU³ / day²" />
        <Fact label="GM EARTH" value={d.gmEarth} sub="AU³ / day²" />
        <Fact label="EARTH RADIUS" value={`${d.earthRadiusKm.toFixed(0)} km`} sub={`${d.earthRadiusAu.toExponential(4)} AU`} />
        <Fact label="1 AU" value={`${d.auKm.toLocaleString()} km`} sub="for converting" />
        <Fact label="EARTH ORBIT" value={`a = ${d.earth.aAu}`} sub={`e = ${d.earth.e}`} />
        <Fact label="EARTH PERIOD" value={`${d.earth.periodDays} d`} sub={`peri ${d.earth.peri} rad, M₀ ${d.earth.M0}`} />
        <Fact label="ENCOUNTER" value={`~ day ${d.tEncounter}`} sub={`integrate out to ${d.tEnd}`} />
        <Fact label="SIGHTING ERROR" value={`${d.sightingSigmaKm} km`} sub="1σ, x and y, independent" />
      </div>

      {/* ── the data itself ────────────────────────────────────────── */}
      <div className="panel-title sub">THE DATA</div>
      <div className="tablewrap tall">
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
          {copied ? "COPIED" : "COPY IT ALL AS TEXT"}
        </PxButton>
      </div>

      {/* ── when the next batch lands ──────────────────────────────── */}
      <div className={`nextbatch ${more ? "" : "done"}`}>
        {more ? (
          <>
            <b>
              Batch {d.release + 1} of {d.of} is coming.
            </b>{" "}
            It will add <b>{d.nextAdds} more sightings</b>, taking the arc from {d.arcDays} to{" "}
            <b>{d.nextArcDays} days</b>. The ones you already have will not change — new nights are
            appended to the same campaign. The operator releases it when they choose.
          </>
        ) : (
          <>
            <b>This is the last batch.</b> Nothing further is coming. {d.sightings.length} sightings
            over {d.arcDays} days is everything anyone will ever have about this object.
          </>
        )}
      </div>

      <p className="hint">{d.note}</p>
      <p className="hint">{d.modelNote}</p>
    </section>
  );
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
