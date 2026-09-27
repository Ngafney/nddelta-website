import React, { useMemo } from "react";

/**
 * The corridor, the uncertainty, and the line — drawn to scale.
 *
 * A local flat-Earth projection centred on the nominal point. Over the few
 * hundred kilometres an impact corridor spans that is accurate to well under a
 * pixel, and it keeps the picture honest about the one thing that matters:
 * how the ellipse sits relative to the line.
 *
 * The ellipse is drawn from the covariance rather than from the two sigmas, so
 * its TILT is visible. A team that notices the ellipse is not square to the
 * corridor has already understood why the components have to be drawn
 * together.
 */
const W = 640;
const H = 300;

export default function CorridorMap({ solution, truth = null, releases = null }) {
  const s = solution;
  const view = useMemo(() => {
    const kmPerDegLat = 111.32;
    const kmPerDegLon = 111.32 * Math.cos((s.nominalLat * Math.PI) / 180);
    // Fit three sigma of the long axis, with room to breathe.
    const span = Math.max(240, 3.4 * Math.sqrt(s.covarianceKm2[0][0]));
    const scale = (W / 2 - 30) / span;
    return {
      kmPerDegLat,
      kmPerDegLon,
      scale,
      // km east/north of the nominal point → pixels
      px: (e, n) => [W / 2 + e * scale, H / 2 - n * scale],
      latToN: (lat) => (lat - s.nominalLat) * kmPerDegLat,
    };
  }, [s]);

  // The corridor direction in east/north components.
  const az = (s.azimuthDeg * Math.PI) / 180;
  const dirE = Math.sin(az);
  const dirN = Math.cos(az);
  const rightE = Math.sin(az + Math.PI / 2);
  const rightN = Math.cos(az + Math.PI / 2);

  const along = (km) => view.px(dirE * km, dirN * km);
  const corridorLen = 3.6 * Math.sqrt(s.covarianceKm2[0][0]);
  const [x1, y1] = along(-corridorLen);
  const [x2, y2] = along(corridorLen);

  // The 1σ and 2σ ellipses, from the covariance's eigen-decomposition.
  const ell = useMemo(() => eigen2(s.covarianceKm2), [s]);
  const ellipse = (k) => {
    // Axes are in the (along, cross) frame; rotate into east/north.
    const a = k * ell.a;
    const b = k * ell.b;
    const th = ell.angle; // radians, from the along-axis
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      const u = a * Math.cos(t);
      const v = b * Math.sin(t);
      // rotate within the corridor frame, then into east/north
      const alongKm = u * Math.cos(th) - v * Math.sin(th);
      const crossKm = u * Math.sin(th) + v * Math.cos(th);
      const e = dirE * alongKm + rightE * crossKm;
      const n = dirN * alongKm + rightN * crossKm;
      pts.push(view.px(e, n).join(","));
    }
    return pts.join(" ");
  };

  const lineY = view.px(0, view.latToN(s.lineDeg))[1];
  const lineOnScreen = lineY > 6 && lineY < H - 6;

  return (
    <div className="cmapwrap">
      <svg className="cmap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="impact corridor and uncertainty">
        <rect x="0" y="0" width={W} height={H} className="cmap-bg" />

        {/* the line of latitude — the whole question */}
        {lineOnScreen && (
          <>
            <line x1="0" y1={lineY} x2={W} y2={lineY} className="cmap-line" />
            <text x="8" y={lineY - 6} className="cmap-lbl gold">
              {Math.abs(s.lineDeg).toFixed(1)}°{s.lineDeg >= 0 ? "N" : "S"}
            </text>
            <text x={W - 8} y={lineY - 6} className="cmap-lbl gold" textAnchor="end">
              NORTH ↑
            </text>
            <text x={W - 8} y={lineY + 14} className="cmap-lbl gold" textAnchor="end">
              SOUTH ↓
            </text>
          </>
        )}

        {/* the corridor */}
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="cmap-corridor" />
        <polygon points={ellipse(2)} className="cmap-e2" />
        <polygon points={ellipse(1)} className="cmap-e1" />

        {/* earlier solutions walking in, on the reveal */}
        {releases?.map((r, i) => {
          const n = (r.nominalLat - s.nominalLat) * view.kmPerDegLat;
          const e = (r.nominalLon - s.nominalLon) * view.kmPerDegLon;
          const [cx, cy] = view.px(e, n);
          return <circle key={i} cx={cx} cy={cy} r="2.5" className="cmap-prev" />;
        })}

        {/* the nominal point */}
        <circle cx={W / 2} cy={H / 2} r="4" className="cmap-nom" />
        <text x={W / 2 + 9} y={H / 2 + 4} className="cmap-lbl">
          NOMINAL
        </text>

        {/* and, at the reveal, where it really landed */}
        {truth && (
          <>
            {(() => {
              const n = (truth.lat - s.nominalLat) * view.kmPerDegLat;
              const e = (truth.lon - s.nominalLon) * view.kmPerDegLon;
              const [cx, cy] = view.px(e, n);
              const inside = cx > 4 && cx < W - 4 && cy > 4 && cy < H - 4;
              if (!inside) return null;
              return (
                <g>
                  <circle cx={cx} cy={cy} r="12" className="cmap-hit-ring" />
                  <circle cx={cx} cy={cy} r="5" className="cmap-hit" />
                  <text x={cx + 14} y={cy + 4} className="cmap-lbl red">
                    IT LANDED HERE
                  </text>
                </g>
              );
            })()}
          </>
        )}

        <text x="8" y={H - 8} className="cmap-lbl dim">
          {Math.round(2 * Math.sqrt(s.covarianceKm2[0][0]))} km per 2σ along the corridor
        </text>
      </svg>
    </div>
  );
}

/**
 * Eigen-decomposition of a symmetric 2×2 — the ellipse's axes and its tilt.
 * Closed form; no library, no iteration.
 */
function eigen2(C) {
  const [a, b] = [C[0][0], C[0][1]];
  const d = C[1][1];
  const tr = a + d;
  const det = a * d - b * b;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(1e-9, tr / 2 - disc);
  const angle = Math.abs(b) < 1e-12 ? 0 : Math.atan2(l1 - a, b);
  return { a: Math.sqrt(l1), b: Math.sqrt(l2), angle };
}
