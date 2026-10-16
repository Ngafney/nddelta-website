/**
 * Import before @solo/env.js. The game signs every token (yours, the bots',
 * the host's) with SESSION_SECRET, and @solo/env.js makes a fresh one on each
 * page load, so after a reload the saved game came back but nobody in it could
 * sign in. Keep one secret per tab, in sessionStorage next to the game it
 * signs; env.js leaves an existing secret alone.
 */
const g = globalThis;
g.process ??= { env: {} };
g.process.env ??= {};
const KEY = "solo-w5:secret";
try {
  let s = sessionStorage.getItem(KEY);
  if (!s) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    s = "solo-" + [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(KEY, s);
  }
  g.process.env.SESSION_SECRET = s;
} catch {
  /* no storage: env.js makes a per-load secret, and a reload starts over */
}
