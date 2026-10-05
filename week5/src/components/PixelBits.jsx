/**
 * Small pixel primitives shared across Week 3 — the same philosophy as week1:
 * sprites are AUTHORED as character grids and rendered to canvas at integer
 * scale, so they stay crisp at any zoom.
 */
import React, { useEffect, useRef, useState } from "react";

/** 16×14 delta, the club mark. */
export const DELTA = [
  ".......gg.......",
  ".......gg.......",
  "......g..g......",
  "......g..g......",
  ".....g....g.....",
  ".....g....g.....",
  "....g......g....",
  "....g......g....",
  "...g........g...",
  "...g........g...",
  "..g..........g..",
  "..g..........g..",
  ".g............g.",
  ".gggggggggggggg.",
];

export const DELTA_PALETTE = { g: "#f5c542" };

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

export function Spinner({ text = "WORKING" }) {
  return <span className="spinner">{text}…</span>;
}

/**
 * Live answer to a media query. Used where a layout decision has to be made in
 * JavaScript rather than CSS — the order book measures its own rows to place
 * them, so it has to know how tall a row is on this screen.
 */
export function useMedia(query, fallback = false) {
  const [match, setMatch] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return fallback;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [query]);
  return match;
}

/** True on phone-sized screens. One definition, used everywhere. */
export const NARROW = "(max-width: 760px)";

/** mm:ss for a millisecond remainder. */
export function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Cents → $1,234.56. The only place money is formatted for a human. */
export function money(cents, { sign = false } = {}) {
  if (cents == null || Number.isNaN(cents)) return "—";
  const neg = cents < 0;
  const v = Math.abs(cents) / 100;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "−" : sign ? "+" : ""}$${s}`;
}

/** Cents → $1.2k / $12.3k, for tight spaces. */
export function moneyShort(cents) {
  if (cents == null) return "—";
  const neg = cents < 0;
  const v = Math.abs(cents) / 100;
  const s = v >= 10000 ? `${(v / 1000).toFixed(1)}k` : v >= 1000 ? `${(v / 1000).toFixed(2)}k` : v.toFixed(0);
  return `${neg ? "−" : ""}$${s}`;
}

export function num(v, dp = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
