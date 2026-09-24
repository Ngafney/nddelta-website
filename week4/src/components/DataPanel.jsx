import React, { useEffect, useState } from "react";
import { api, withPlayer } from "../api.js";
import { PxButton, Spinner } from "./PixelBits.jsx";

/**
 * The survey record: what the room has, what it is worth, and a button that
 * puts it on disk.
 *
 * The download is a plain link straight at the API rather than a fetch-then-
 * blob dance, so the browser does what browsers do with a Content-Disposition
 * header and the file lands in Downloads with one click and no JavaScript in
 * the way.
 */
export default function DataPanel({ player, round, onToast }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const released = round?.released ?? 0;

  useEffect(() => {
    let gone = false;
    setLoading(true);
    api
      .get("data", withPlayer(player))
      .then((d) => {
        if (gone) return;
        setData(d);
        setErr(null);
      })
      .catch((e) => {
        if (gone) return;
        setErr(e.message);
        setData(null);
      })
      .finally(() => !gone && setLoading(false));
    return () => {
      gone = true;
    };
    // Refetch whenever another batch lands.
  }, [player, released]);

  const href = `/api/week4/data.csv?${new URLSearchParams(withPlayer(player))}`;

  if (loading && !data) {
    return (
      <div className="panel">
        <Spinner text="READING THE RECORD" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="panel">
        <div className="dead-note">
          {err}
          <br />
          <span style={{ color: "var(--dim)", fontSize: 9 }}>
            THE OPERATOR HAS NOT RELEASED ANYTHING YET
          </span>
        </div>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const gap = data ? data.impactDay - data.cutDay : null;
  const sig = rows.length ? [rows[0].sigmaAu, rows[rows.length - 1].sigmaAu] : null;
  const KM = 149597870.7;

  return (
    <div className="panel datapanel">
      <div className="data-head">
        <div>
          <h3>THE SURVEY RECORD</h3>
          <p className="dim">
            Release <b>{released}</b> of {round.releaseCount} · <b>{rows.length}</b> observations ·
            everything up to <b>{gap != null ? Math.round(gap) : "?"} days</b> before impact
          </p>
        </div>
        <a className="pxbtn pxbtn--green pxbtn--big" href={href} download>
          ⭳ DOWNLOAD CSV
        </a>
      </div>

      <div className="data-grid">
        <Fact label="FRAME" value="barycentric, ecliptic J2000" />
        <Fact label="UNITS" value="AU · days" />
        <Fact
          label="ERROR BARS"
          value={sig ? `${(sig[0] * KM).toFixed(0)} → ${(sig[1] * KM).toFixed(0)} km` : "—"}
          hint="every row carries its own"
        />
        <Fact label="IMPACT" value={`day ${Math.round(data.impactDay)}`} />
      </div>

      <div className="masses">
        {["SUN", "EARTH", "ASTEROID"].map((n, i) => (
          <div key={n}>
            <i>{n}</i>
            <b>{data.masses[i].kg.toExponential(4)} kg</b>
            <em>± {(data.masses[i].relError * 100).toPrecision(2)}%</em>
          </div>
        ))}
      </div>

      <p className="dim data-note">{data.note}</p>

      <div className="tablewrap">
        <table className="datatable">
          <thead>
            <tr>
              <th>day</th>
              <th colSpan={3}>sun (AU)</th>
              <th colSpan={3}>earth (AU)</th>
              <th colSpan={3}>asteroid (AU)</th>
              <th>σ (km)</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.day}>
                <td>{r.day.toFixed(1)}</td>
                {[...r.sun, ...r.earth, ...r.ast].map((v, i) => (
                  <td key={i}>{v.toFixed(5)}</td>
                ))}
                <td>{(r.sigmaAu * KM).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 12 && <div className="dim tablemore">…and {rows.length - 12} more rows in the download</div>}
      </div>
    </div>
  );
}

function Fact({ label, value, hint }) {
  return (
    <div className="fact">
      <i>{label}</i>
      <b>{value}</b>
      {hint && <em>{hint}</em>}
    </div>
  );
}
