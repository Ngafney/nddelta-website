import React from "react";

/**
 * The round seen from above the ecliptic: the Sun at the origin, the Earth
 * going round it, and the rock coming in.
 *
 * The point of the picture is the fan. Every faint gold thread is one Monte
 * Carlo draw from the observation errors, flown all the way to encounter, so
 * the width of the fan IS the uncertainty — not a number in a box, but the
 * spread of futures the data still allows. A team that has bought more
 * observations watches the fan close around the bright line; a team that has
 * not sees a fan wide enough to miss the Earth entirely, or not. That is the
 * whole trade, drawn.
 *
 * Everything arrives in AU and is projected once, so the only place the axis
 * flip lives is px().
 */

const W = 460;
const H = 460;
const M = 38; // breathing room, so trails and the encounter label never touch the edge

export default function OrbitMap({ earthTrail, astTrail, cloud, encounter, obs, au }) {
  // A missing or nonsense half-width shows up from a half-loaded round more
  // often than one would like; fall back rather than divide the world by zero.
  const span = Number.isFinite(au) && au > 0 ? au : 4;
  const s = (Math.min(W, H) / 2 - M) / span; // pixels per AU
  const cx = W / 2;
  const cy = H / 2;

  // The one place the flip happens: AU y grows up, SVG y grows down.
  const px = (x, y) => [cx + x * s, cy - y * s];

  // A single non-finite sample kills an entire SVG polyline silently, so drop
  // them here rather than trusting whatever the propagator handed us.
  const poly = (pts) =>
    Array.isArray(pts)
      ? pts
          .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map((p) => px(p[0], p[1]).join(","))
          .join(" ")
      : "";
  const drawable = (str) => str.indexOf(" ") > 0; // two points or more

  const earthPts = poly(earthTrail);
  const astPts = poly(astTrail);
  const cloudPts = (Array.isArray(cloud) ? cloud : []).map(poly).filter(drawable);

  const dots = (Array.isArray(obs) ? obs : []).filter(
    (o) => o && Number.isFinite(o.x) && Number.isFinite(o.y)
  );

  const enc =
    encounter && Number.isFinite(encounter.x) && Number.isFinite(encounter.y) ? encounter : null;
  const [encX, encY] = enc ? px(enc.x, enc.y) : [0, 0];
  // The label flips to the far side near the right edge and is clamped on both
  // axes, because the encounter is exactly the point that likes to sit in a corner.
  const flip = encX > W * 0.62;
  const labelX = clamp(encX + (flip ? -14 : 14), 6, W - 6);
  const labelY = clamp(encY - 12, 20, H - 40);

  // Range rings every whole AU: cheaper to read than a grid, and they hand the
  // eye a ruler without competing with the trails.
  const rings = [];
  for (let r = 1; r <= Math.floor(span); r++) rings.push(r);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="auto"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Orbit map: Earth, the asteroid's best-fit path, and the Monte Carlo uncertainty fan"
    >
      <defs>
        <radialGradient id="om-sun-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e9b949" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#e9b949" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#e9b949" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width={W} height={H} fill="#0a1120" stroke="none" />

      {/* axes and range rings — the frame that survives when every prop is empty */}
      <line
        x1={M / 2}
        y1={cy}
        x2={W - M / 2}
        y2={cy}
        fill="none"
        stroke="#6b7280"
        strokeWidth="1"
        strokeOpacity="0.28"
      />
      <line
        x1={cx}
        y1={M / 2}
        x2={cx}
        y2={H - M / 2}
        fill="none"
        stroke="#6b7280"
        strokeWidth="1"
        strokeOpacity="0.28"
      />
      {rings.map((r) => (
        <circle
          key={r}
          cx={cx}
          cy={cy}
          r={r * s}
          fill="none"
          stroke="#6b7280"
          strokeWidth="1"
          strokeOpacity="0.18"
          strokeDasharray="2 6"
        />
      ))}

      {/* the fan first and faintest, so the best fit reads as the line THROUGH it */}
      {cloudPts.map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke="#e9b949"
          strokeWidth="1"
          strokeOpacity="0.14"
          strokeLinejoin="round"
        />
      ))}

      {/* Earth's orbit: thin, cool, and never the thing being argued about */}
      {drawable(earthPts) && (
        <polyline
          points={earthPts}
          fill="none"
          stroke="#6fc0ff"
          strokeWidth="1.2"
          strokeOpacity="0.85"
          strokeLinejoin="round"
        />
      )}

      {/* the best fit */}
      {drawable(astPts) && (
        <polyline
          points={astPts}
          fill="none"
          stroke="#e9b949"
          strokeWidth="2"
          strokeOpacity="0.95"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {/* the observations the fit was bought with */}
      {dots.map((o, i) => {
        const [ox, oy] = px(o.x, o.y);
        return (
          <circle key={i} cx={ox} cy={oy} r="2" fill="#e5e7eb" fillOpacity="0.8" stroke="none" />
        );
      })}

      {/* the Sun: glow first, disc on top */}
      <circle cx={cx} cy={cy} r="26" fill="url(#om-sun-glow)" stroke="none" />
      <circle cx={cx} cy={cy} r="5.5" fill="#e9b949" stroke="#0c1526" strokeWidth="1" />

      {/* closest approach */}
      {enc && (
        <g>
          <circle
            cx={encX}
            cy={encY}
            r="9"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
          <circle cx={encX} cy={encY} r="3" fill="#e5e7eb" stroke="#0a1120" strokeWidth="0.75" />
          <text
            x={labelX}
            y={labelY}
            textAnchor={flip ? "end" : "start"}
            fontSize="13"
            fontWeight="600"
            fill="#e5e7eb"
            stroke="none"
          >
            {fmtKm(enc.missKm)} km
          </text>
          {Number.isFinite(enc.tDays) && (
            <text
              x={labelX}
              y={labelY + 14}
              textAnchor={flip ? "end" : "start"}
              fontSize="11"
              fill="#6b7280"
              stroke="none"
            >
              {`T+${Math.round(enc.tDays)} d`}
            </text>
          )}
        </g>
      )}

      {/* scale bar */}
      <g>
        <line
          x1={M}
          y1={H - 20}
          x2={M + s}
          y2={H - 20}
          fill="none"
          stroke="#6b7280"
          strokeWidth="1.5"
        />
        <line x1={M} y1={H - 24} x2={M} y2={H - 16} fill="none" stroke="#6b7280" strokeWidth="1.5" />
        <line
          x1={M + s}
          y1={H - 24}
          x2={M + s}
          y2={H - 16}
          fill="none"
          stroke="#6b7280"
          strokeWidth="1.5"
        />
        <text x={M} y={H - 28} fontSize="11" fill="#6b7280" stroke="none">
          1 AU
        </text>
      </g>

      {/* legend — three rows, because three strokes is all the picture uses */}
      <g>
        <line x1="14" y1="22" x2="34" y2="22" fill="none" stroke="#6fc0ff" strokeWidth="1.2" />
        <text x="40" y="26" fontSize="11" fill="#6b7280" stroke="none">
          Earth
        </text>
        <line x1="14" y1="40" x2="34" y2="40" fill="none" stroke="#e9b949" strokeWidth="2" />
        <text x="40" y="44" fontSize="11" fill="#6b7280" stroke="none">
          best fit
        </text>
        <line
          x1="14"
          y1="58"
          x2="34"
          y2="58"
          fill="none"
          stroke="#e9b949"
          strokeWidth="1"
          strokeOpacity="0.3"
        />
        <text x="40" y="62" fontSize="11" fill="#6b7280" stroke="none">
          {cloudPts.length > 0 ? `${cloudPts.length} samples` : "samples"}
        </text>
      </g>
    </svg>
  );
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Thousands separators without Intl — the same string on every browser and locale. */
function fmtKm(v) {
  if (!Number.isFinite(v)) return "—";
  return Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
