/**
 * Week 1's team and admin tokens are hashes of SESSION_SECRET. The shared
 * solo env makes a fresh secret on every page load, which would void every
 * token after a reload. Keep one secret per tab session instead, so a reload
 * resumes the same game with the same credentials. Imported before env.js.
 */
const g = globalThis;
g.process ??= { env: {} };
g.process.env ??= {};
try {
  let s = sessionStorage.getItem("solo-w1:secret");
  if (!s) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    s = "solo-w1-" + [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem("solo-w1:secret", s);
  }
  g.process.env.SESSION_SECRET = s;
} catch {
  /* storage blocked: env.js makes a per-load secret and a reload starts over */
}
