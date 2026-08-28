/**
 * Small pixel primitives: the sprite renderer, buttons with sound-free
 * juice, and the coin burst.
 */
import React, { useEffect, useRef } from "react";

/** Draw a char-grid sprite to canvas at an integer scale. */
export function PixelSprite({ grid, palette, scale = 4, className, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const h = grid.length;
    const w = grid[0].length;
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = palette[grid[y][x]];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }, [grid, palette, scale]);
  return <canvas ref={ref} className={className} style={{ imageRendering: "pixelated", ...style }} />;
}

export function PxButton({ variant, small, children, ...rest }) {
  const cls = ["pxbtn", variant && `pxbtn--${variant}`, small && "pxbtn--sm"].filter(Boolean).join(" ");
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

/** A burst of pixel coins flying outward — for positive payoffs. */
export function CoinBurst({ n = 8 }) {
  const coins = Array.from({ length: n }, (_, i) => {
    const ang = (Math.PI * (i + 0.5)) / n - Math.PI; // fan upward
    const dist = 34 + (i % 3) * 16;
    return { dx: `${Math.cos(ang) * dist}px`, dy: `${Math.sin(ang) * dist - 20}px`, delay: `${(i % 4) * 40}ms` };
  });
  return (
    <div className="coin-burst">
      {coins.map((c, i) => (
        <i key={i} style={{ "--dx": c.dx, "--dy": c.dy, animationDelay: c.delay }} />
      ))}
    </div>
  );
}

export function Spinner({ text = "WORKING" }) {
  return <span className="spinner">{text}…</span>;
}
