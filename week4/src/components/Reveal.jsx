import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { Spinner, money } from "./PixelBits.jsx";
import OrbitMap from "./OrbitMap.jsx";

/**
 * How close it actually came, and which sightings were lying.
 *
 * Two beats. First the number: the miss distance against the Earth's radius,
 * because on a marginal encounter those two are within a few hundred
 * kilometres of each other and seeing that is the point. Then the sightings,
 * with the bad ones finally marked — a team that spotted them gets to be right
 * out loud, and a team that fitted everything gets to see what it cost.
 */
export default function Reveal({ round }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .get("reveal")
      .then((x) => live && setD(x))
      .catch((e) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!d) return undefined;
    const t = setTimeout(() => setBeat((b) => Math.min(b + 1, 2)), 1400);
    return () => clearTimeout(t);
  }, [d, beat]);

  if (err) return <div className="panel"><p className="hint">{err}</p></div>;
  if (!d) return <Spinner text="FINDING OUT" />;

  const t = d.truth;
  const hit = t.hit;
  const bad = (d.sightings ?? []).filter((s) => s.bad);

  return (
    <section className={`panel reveal ${hit ? "north" : "south"}`}>
      <div className="panel-title">IMPACT</div>

      <div className={`reveal-verdict ${hit ? "north" : "south"}`}>
        <h1>{hit ? "IT HIT" : "IT MISSED"}</h1>
        <p>
          Closest approach <b>{t.missKm.toLocaleString()} km</b> from the Earth's centre, on day{" "}
          {t.tDays}. The Earth's radius is <b>{t.earthRadiusKm.toLocaleString()} km</b>.
        </p>
        <p className="dim">
          {hit
            ? `It came inside the surface by ${(t.earthRadiusKm - t.missKm).toLocaleString()} km.`
            : `It cleared the surface by ${(t.missKm - t.earthRadiusKm).toLocaleString()} km.`}
        </p>
      </div>

      {beat >= 1 && (
        <>
          <OrbitMap obs={d.sightings} au={3.2} encounter={null} earthTrail={null} astTrail={null} cloud={null} />
          <div className="hint">
            {bad.length === 0 ? (
              <>Every sighting in this round was honest. The noise alone was enough.</>
            ) : (
              <>
                <b>
                  {bad.length} of {d.sightings.length} sightings were wrong
                </b>{" "}
                — not noisy, wrong: number{bad.length > 1 ? "s" : ""}{" "}
                {bad.map((b) => b.i + 1).join(", ")}. If you fitted them, they dragged your orbit.
              </>
            )}
          </div>
        </>
      )}

      {beat >= 2 && (
        <>
          <div className="panel-title" style={{ marginTop: 18 }}>
            WHAT THE MARKET SHOULD HAVE SAID
          </div>
          <div className="releases">
            {(d.releases ?? []).map((r) => (
              <div key={r.index} className={`relrow ${r.index <= d.shown ? "out" : ""}`}>
                <span className="relidx">{r.index}</span>
                <span>
                  {r.sightings} sightings · {r.arcDays} days
                </span>
                <span className="relconf">
                  {r.pHit == null ? "—" : `${Math.round(r.pHit * 100)}%`}
                  <em> hit</em>
                </span>
                <span className="dim">
                  {r.medianMissKm == null ? "" : `median miss ${Math.round(r.medianMissKm).toLocaleString()} km`}
                </span>
                <span className="relstate">{r.index <= d.shown ? "RELEASED" : "held"}</span>
              </div>
            ))}
          </div>

          <div className="panel-title" style={{ marginTop: 18 }}>
            LEADERBOARD
          </div>
          <div className="lb">
            {(d.leaderboard ?? []).map((row, i) => (
              <div key={row.id} className="lbrow">
                <span className="lbrank">{i + 1}</span>
                <span className="lbname">{row.name}</span>
                <span className="lbval">{money(row.valueC)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
