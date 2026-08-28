/**
 * The chicken replay: two pixel cars, ten rounds, real outcomes.
 *
 * Each round plays as a little scene — the cars charge from the edges,
 * and depending on the two secret choices they crash (screen shake,
 * explosion), one veers off, or both chicken out. The data is the actual
 * seeded match, so what you watch is exactly what was scored.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { PixelSprite, CoinBurst } from "./PixelBits.jsx";
import { CAR_RIGHT, carPalette, flipGrid, BOOM_FRAMES, BOOM_PALETTE } from "./sprites.js";
import { mulberry32, hash32 } from "../../shared/rng.js";

const CAR_LEFT_GRID = CAR_RIGHT;
const CAR_RIGHT_GRID = flipGrid(CAR_RIGHT);
const GOLD = carPalette("#f5c542", "#a87b00");
const BLUE = carPalette("#52a7f0", "#265f96");

const ROUND_MS = 2100; // one full round scene
const DRIVE_MS = 850; // matches the CSS transition

export default function ReplayChicken({ rounds, nameA, nameB, autoLoop = false, big = false }) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState("enter"); // enter → drive → result
  const [playing, setPlaying] = useState(true);
  const [finished, setFinished] = useState(false); // held on the final frame
  const [boomFrame, setBoomFrame] = useState(-1);
  const timers = useRef([]);

  // The board page re-fetches every few seconds, handing us a NEW array
  // with the SAME match in it. Keying resets on content — not identity —
  // is what lets a replay survive live polling. Use the FULL action words:
  // STAY/SWERVE (and SPLIT/STEAL) share a first letter, so a first-letter
  // signature is constant and the reset never fires.
  const sig = rounds.map((r) => `${r.a}${r.b}`).join("|");

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const after = (ms, fn) => timers.current.push(setTimeout(fn, ms));

  // The per-round scene state machine. The rare cinematic wreck slows
  // the whole round down — longer approach, longer aftermath. Pausing or
  // finishing FREEZES the current frame (no reset to "enter") — that's
  // what keeps the final score and the paused explosion on screen.
  useEffect(() => {
    clearTimers();
    if (!playing || finished) return;
    setBoomFrame(-1);
    setPhase("enter");
    const r0 = rounds[idx];
    const isCrash = r0.a === "STAY" && r0.b === "STAY";
    const mega = isCrash && crashInfo.mega;
    const driveMs = mega ? 1900 : DRIVE_MS;
    const roundMs = mega ? 3700 : ROUND_MS;
    // Two rAF-ish ticks so the "enter" position paints before transitioning.
    after(60, () => {
      setPhase("drive");
      after(driveMs - 80, () => {
        setPhase("result");
        if (isCrash) {
          const step = mega ? 160 : 110;
          [0, 1, 2, 3].forEach((f) => after(f * step, () => setBoomFrame(f)));
          after(mega ? 1200 : 700, () => setBoomFrame(-1));
        }
      });
      after(roundMs, () => {
        if (idx < rounds.length - 1) setIdx(idx + 1);
        else if (autoLoop) setIdx(0);
        else setFinished(true); // freeze on round 10's result, full score shown
      });
    });
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, playing, finished, sig, autoLoop]);

  // Reset only when a genuinely different match arrives.
  useEffect(() => {
    setIdx(0);
    setPlaying(true);
    setFinished(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Play/pause button: restart from the top once a replay has finished.
  const toggle = () => {
    if (finished) {
      setFinished(false);
      setIdx(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };
  const scrubTo = (i) => {
    setFinished(false);
    setIdx(i);
    setPlaying(true);
  };

  const r = rounds[idx];
  const crash = r.a === "STAY" && r.b === "STAY";

  // No two crashes look alike: each crashing round draws one of six
  // wreck choreographies — and ~7% of crashes go CINEMATIC: letterboxed
  // slow-motion approach, both cars blasted off the top of the screen,
  // triple explosion, coins raining out of the sky. Seeded, so a replay
  // always re-crashes exactly the way it crashed before.
  const crashInfo = useMemo(() => {
    const rand = mulberry32(0xcafe ^ (hash32(sig) + idx * 131));
    const mega = rand() < 0.07;
    return { mega, variant: mega ? 6 : Math.floor(rand() * 6), flipA: rand() < 0.5 };
  }, [sig, idx]);

  const wreckClass = (side) => {
    if (!(phase === "result" && crash)) return "";
    const dir = side === "A" ? "l" : "r";
    switch (crashInfo.variant) {
      case 1: {
        // one car gets launched, flipping over the other
        const flips = side === "A" ? crashInfo.flipA : !crashInfo.flipA;
        return flips ? `wreck-flip-${dir}` : `wreck-recoil-${dir}`;
      }
      case 2:
        return `wreck-spin-${dir}`; // both whirl apart
      case 3:
        return `wreck-launch-${dir}`; // both thrown up, tumble, bounce
      case 4:
        return `wreck-rico-${dir}`; // pinball ricochet back to the edges
      case 5:
        return `wreck-crumple-${dir}`; // accordion — locked nose to nose
      case 6:
        return `wreck-mega-${dir}`; // gone. into the sky.
      default:
        return `wreck-recoil-${dir}`;
    }
  };
  const cinematic = phase !== "enter" && crash && crashInfo.mega;
  const scoreA = rounds.slice(0, idx + (phase === "result" ? 1 : 0)).reduce((s, x) => s + x.pa, 0);
  const scoreB = rounds.slice(0, idx + (phase === "result" ? 1 : 0)).reduce((s, x) => s + x.pb, 0);

  // Where each car ends up this round. Cars grow with the road.
  const scale = big ? 5 : typeof window !== "undefined" && window.innerWidth >= 860 ? 4 : 3;
  const posA = carPos(r.a, r.b, phase, "A");
  const posB = carPos(r.b, r.a, phase, "B");
  // Swerving cars bank into the lane change while driving.
  const rotA = phase === "drive" && r.a === "SWERVE" ? -9 : 0;
  const rotB = phase === "drive" && r.b === "SWERVE" ? 9 : 0;
  const aHeld = r.a === "STAY" && r.b === "SWERVE";
  const bHeld = r.b === "STAY" && r.a === "SWERVE";

  return (
    <div className="replay">
      <div className={`road ${phase === "result" && crash ? "shake" : ""} ${cinematic ? "cine" : ""}`}>
        <div className="edge top" />
        <div className="lane-dash" />
        <div className="edge bot" />
        {phase === "drive" && <div className="speedlines" />}
        {cinematic && (
          <>
            <div className="letterbox lb-top" />
            <div className="letterbox lb-bot" />
          </>
        )}
        <div className="round-banner">ROUND {idx + 1} / {rounds.length}</div>

        <div
          className={`car ${phase === "enter" ? "jump" : ""} ${wreckClass("A")}`}
          style={{
            left: `${posA.x}%`,
            transform: `translateY(calc(-50% + ${posA.dy * scale}px)) rotate(${rotA}deg)`,
            transitionDuration: cinematic ? "1.9s" : undefined,
          }}
        >
          <PixelSprite grid={CAR_LEFT_GRID} palette={GOLD} scale={scale} />
          {phase === "drive" && <Exhaust side="A" />}
          {phase === "result" && aHeld && <CoinBurst n={6} />}
        </div>
        <div
          className={`car ${phase === "enter" ? "jump" : ""} ${wreckClass("B")}`}
          style={{
            left: `${posB.xRight}%`,
            transform: `translateY(calc(-50% + ${posB.dy * scale}px)) rotate(${rotB}deg)`,
            transitionDuration: cinematic ? "1.9s" : undefined,
          }}
        >
          <PixelSprite grid={CAR_RIGHT_GRID} palette={BLUE} scale={scale} />
          {phase === "drive" && <Exhaust side="B" />}
          {phase === "result" && bHeld && <CoinBurst n={6} />}
        </div>

        {phase === "result" && crash && <div key={`f${idx}`} className="impact-flash" />}
        {phase === "result" && crash && <Debris seed={idx} count={crashInfo.mega ? 34 : 16} spread={crashInfo.mega ? 1.7 : crashInfo.variant === 5 ? 0.7 : 1} />}
        {phase === "result" && crash && <Smoke seed={idx} />}
        {phase === "result" && crash && crashInfo.variant === 5 && <Smoke seed={idx + 99} />}
        {phase === "result" && crash && crashInfo.mega && <CoinRain seed={idx} />}

        {boomFrame >= 0 && (
          <div className="boom">
            <PixelSprite grid={BOOM_FRAMES[Math.min(boomFrame, 3)]} palette={BOOM_PALETTE} scale={big ? 7 : 5} />
          </div>
        )}
        {crashInfo.variant === 1 && boomFrame >= 1 && (
          <div className="boom boom2">
            <PixelSprite grid={BOOM_FRAMES[Math.min(boomFrame - 1, 3)]} palette={BOOM_PALETTE} scale={big ? 5 : 4} />
          </div>
        )}
        {crashInfo.mega && boomFrame >= 1 && (
          <div className="boom" style={{ left: "37%", top: "32%" }}>
            <PixelSprite grid={BOOM_FRAMES[Math.min(boomFrame - 1, 3)]} palette={BOOM_PALETTE} scale={big ? 6 : 5} />
          </div>
        )}
        {crashInfo.mega && boomFrame >= 2 && (
          <div className="boom" style={{ left: "63%", top: "64%" }}>
            <PixelSprite grid={BOOM_FRAMES[Math.min(boomFrame - 2, 3)]} palette={BOOM_PALETTE} scale={big ? 5 : 4} />
          </div>
        )}

        {phase === "result" && (
          <div className={`outcome-flash ${crash && crashInfo.mega ? "mega" : ""}`} style={{ color: crash && crashInfo.mega ? "var(--gold)" : outcomeColor(r) }}>
            {crash && crashInfo.mega ? "★ TOTALED ★" : outcomeText(r, nameA, nameB)}
          </div>
        )}
      </div>

      <div className="replay-hud">
        <div className="names">
          <span className="you">■ {nameA}</span>{"  vs  "}
          <span className="them">■ {nameB}</span>
        </div>
        <div className="rounds">
          {rounds.map((_, i) => (
            <i
              key={i}
              className={i === idx ? "cur" : i < idx ? "done" : ""}
              onClick={() => scrubTo(i)}
            >
              {i + 1}
            </i>
          ))}
        </div>
        <div className="replay-score">
          <span className="you">{scoreA}</span>
          <span className="them">{scoreB}</span>
        </div>
        <button className="pxbtn pxbtn--ghost pxbtn--sm" onClick={toggle} title={finished ? "replay from the start" : playing ? "pause" : "play"}>
          {finished ? "↺" : playing ? "❚❚" : "▶"}
        </button>
      </div>
    </div>
  );
}

/**
 * Car choreography. STAY drives straight for the centre; SWERVE pulls
 * into the outer lane and the cars slide past each other. Final
 * positions stay ON the road — the result phase should read as a
 * tableau, not an empty street.
 */
function carPos(mine, theirs, phase, side) {
  if (phase === "enter") return side === "A" ? { x: -8, dy: 0 } : { xRight: 82, dy: 0 };

  const crash = mine === "STAY" && theirs === "STAY";
  // dy is a GENTLE lane shift (× sprite scale ≈ 28px) — a swerver eases into
  // the outer lane and slides past, it does NOT fly off the road. (The old
  // dy of ±36 × scale ≈ 150px launched the car clean off the top/bottom.)
  if (side === "A") {
    if (crash) return { x: 36, dy: 0 };
    if (mine === "STAY") return { x: 74, dy: 0 }; // they swerved; barrel through
    return { x: 70, dy: -7 }; // I swerve: ease up into the top lane and slide past
  } else {
    if (crash) return { xRight: 47, dy: 0 };
    if (mine === "STAY") return { xRight: 12, dy: 0 };
    return { xRight: 16, dy: 7 }; // ease down into the bottom lane
  }
}

/** Exhaust puffs trailing a driving car. */
function Exhaust({ side }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          className={`puff ${side === "A" ? "puff-l" : "puff-r"}`}
          style={{ animationDelay: `${i * 0.16}s`, "--px": side === "A" ? "-18px" : "18px" }}
        />
      ))}
    </>
  );
}

/** Crash debris: car-colored shrapnel arcing out of the impact, seeded per round. */
function Debris({ seed, count = 16, spread = 1 }) {
  const pieces = useMemo(() => {
    const rand = mulberry32(0xc0ffee + seed);
    const colors = ["#f5c542", "#52a7f0", "#e0525e", "#8b98ad", "#2a2f3a", "#fff3d6"];
    return Array.from({ length: count }, (_, i) => {
      const ang = rand() * Math.PI * 2;
      const dist = (40 + rand() * 90) * spread;
      return {
        id: i,
        color: colors[i % colors.length],
        size: 4 + Math.floor(rand() * 5),
        dx: `${Math.cos(ang) * dist}px`,
        dy: `${Math.sin(ang) * dist * 0.7 + 24}px`, // biased downward — gravity, roughly
        rot: `${Math.floor(rand() * 720 - 360)}deg`,
        delay: `${Math.floor(rand() * 120)}ms`,
      };
    });
  }, [seed, count, spread]);
  return (
    <div className="debris">
      {pieces.map((p) => (
        <i
          key={p.id}
          style={{
            background: p.color,
            width: p.size,
            height: p.size,
            "--dx": p.dx,
            "--dy": p.dy,
            "--rot": p.rot,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
}

/** Smoke columns rising off the wreck. */
function Smoke({ seed }) {
  const puffs = useMemo(() => {
    const rand = mulberry32(0x50f7 + seed);
    return Array.from({ length: 7 }, (_, i) => ({
      id: i,
      x: `${(rand() - 0.5) * 60}px`,
      sx: `${(rand() - 0.5) * 30}px`,
      size: 7 + Math.floor(rand() * 7),
      delay: `${i * 130 + Math.floor(rand() * 80)}ms`,
    }));
  }, [seed]);
  return (
    <div className="smoke">
      {puffs.map((p) => (
        <i
          key={p.id}
          style={{
            marginLeft: p.x,
            width: p.size,
            height: p.size,
            "--sx": p.sx,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
}

/** The cinematic wreck's coin rain — the pot falls out of the sky. */
function CoinRain({ seed }) {
  const coins = useMemo(() => {
    const rand = mulberry32(0x901d + seed);
    return Array.from({ length: 14 }, (_, i) => ({
      id: i,
      x: `${6 + rand() * 88}%`,
      delay: `${Math.floor(rand() * 900)}ms`,
      dur: `${0.9 + rand() * 0.7}s`,
    }));
  }, [seed]);
  return (
    <div className="coinrain">
      {coins.map((c) => (
        <i key={c.id} style={{ left: c.x, animationDelay: c.delay, animationDuration: c.dur }} />
      ))}
    </div>
  );
}

function outcomeText(r, nameA, nameB) {
  if (r.a === "STAY" && r.b === "STAY") return "💥 CRASH! −50 / −50";
  if (r.a === "SWERVE" && r.b === "SWERVE") return "BOTH CHICKEN −10 / −10";
  // Name the nerve-holder so "which car is me" answers itself.
  if (r.a === "STAY") return `${short(nameA)} HOLDS NERVE +${r.pa}`;
  return `${short(nameB)} HOLDS NERVE +${r.pb}`;
}

// Slice by code points, never mid-emoji — a bare surrogate renders as "�".
const short = (n) => {
  const cp = Array.from(n);
  return cp.length > 14 ? cp.slice(0, 13).join("") + "…" : n;
};

function outcomeColor(r) {
  if (r.a === "STAY" && r.b === "STAY") return "var(--red)";
  if (r.a === "SWERVE" && r.b === "SWERVE") return "var(--muted)";
  return "var(--gold)";
}
