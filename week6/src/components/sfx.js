/**
 * The sounds. Everything is synthesised on the spot with WebAudio, so there
 * is nothing to download and nothing to license. Browsers refuse to start an
 * AudioContext before a user gesture, so `unlock()` is wired to the first
 * click on the page and every player becomes a gesture the moment they
 * touch anything.
 *
 *   draw(n)   a number landed: two notes, pitched by n; a 10 gets a rising
 *             arpeggio and shimmer, a 0 a low thud
 *   fill()    you traded: a short blip, up for a buy, down for a sell
 *   tick()    the last seconds before an auto draw
 *   settle()  the bell: a fanfare
 */

let ctx = null;

function ac() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Call once from a user gesture so the context may start. */
export function unlock() {
  ac();
}

export function isUnlocked() {
  return !!ctx && ctx.state === "running";
}

function tone(c, { f, t0, dur, gain = 0.16, type = "triangle", slide = null }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(c, { t0, dur, gain = 0.08 }) {
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 3000;
  src.connect(hp).connect(g).connect(c.destination);
  src.start(t0);
}

const C5 = 523.25;
const semis = (n) => C5 * Math.pow(2, n / 12);

export function draw(n) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  if (n === 10) {
    // a rising major arpeggio with a shimmer on top
    [0, 4, 7, 12, 16].forEach((s, i) => tone(c, { f: semis(s), t0: t + i * 0.07, dur: 0.55, gain: 0.17 }));
    tone(c, { f: semis(24), t0: t + 0.4, dur: 0.9, gain: 0.07, type: "sine" });
    noise(c, { t0: t + 0.35, dur: 0.6, gain: 0.05 });
    return;
  }
  if (n === 0) {
    tone(c, { f: 160, t0: t, dur: 0.5, gain: 0.2, type: "sawtooth", slide: 55 });
    tone(c, { f: 80, t0: t + 0.05, dur: 0.6, gain: 0.14, type: "sine", slide: 40 });
    return;
  }
  tone(c, { f: C5, t0: t, dur: 0.45, gain: 0.16 });
  tone(c, { f: semis(4 + n), t0: t + 0.09, dur: 0.55, gain: 0.16 });
  if (n >= 8) noise(c, { t0: t + 0.1, dur: 0.35, gain: 0.04 });
}

export function fill(side) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const up = side === "B";
  tone(c, { f: up ? 660 : 520, t0: t, dur: 0.09, gain: 0.1, type: "square", slide: up ? 990 : 330 });
}

export function tick(n) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  tone(c, { f: n <= 1 ? 1320 : 880, t0: t, dur: 0.06, gain: 0.09, type: "square" });
}

export function settle() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  // a fanfare: two quick stabs then a held chord
  [[0, 0], [7, 0.14], [12, 0.28]].forEach(([s, dt]) => tone(c, { f: semis(s), t0: t + dt, dur: 0.22, gain: 0.18 }));
  [0, 4, 7, 12].forEach((s) => tone(c, { f: semis(s), t0: t + 0.5, dur: 1.4, gain: 0.12 }));
  [0, 4, 7, 12].forEach((s) => tone(c, { f: semis(s) / 2, t0: t + 0.5, dur: 1.4, gain: 0.06, type: "sine" }));
  noise(c, { t0: t + 0.5, dur: 1.0, gain: 0.06 });
}
