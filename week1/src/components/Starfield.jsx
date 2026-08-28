/**
 * The night behind the arcade: a fixed field of pixel stars twinkling at
 * their own tempos. Seeded, so the sky is the same one every visit —
 * random-looking, never random.
 */
import React, { useMemo } from "react";
import { mulberry32 } from "../../shared/rng.js";

const COLORS = ["#f5c542", "#60a5fa", "#e8eefb", "#a78bfa", "#8ea3c8"];

export default function Starfield({ count = 90 }) {
  const stars = useMemo(() => {
    const rand = mulberry32(0xdeb7a);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: rand() * 100,
      y: rand() * 100,
      size: rand() < 0.75 ? 2 : 3,
      color: COLORS[Math.floor(rand() * COLORS.length)],
      dur: 2 + rand() * 5,
      delay: rand() * 6,
      dim: rand() < 0.5, // half the sky stays faint even at peak
    }));
  }, [count]);

  return (
    <div className="starfield" aria-hidden="true">
      {stars.map((s) => (
        <i
          key={s.id}
          className={`star ${s.dim ? "dim" : ""}`}
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            background: s.color,
            animationDuration: `${s.dur}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
