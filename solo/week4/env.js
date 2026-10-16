/**
 * Imported before @solo/env.js: one signing secret per TAB rather than per
 * page load, so a reload keeps every token (yours, the bots', the host's)
 * valid and the round resumes where it was.
 */
const g = globalThis;
if (!g.process) g.process = { env: {} };
if (!g.process.env) g.process.env = {};
try {
  let s = sessionStorage.getItem("solo-w4:secret");
  if (!s) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    s = "solo-w4-" + [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem("solo-w4:secret", s);
  }
  g.process.env.SESSION_SECRET = s;
} catch {
  /* no sessionStorage: @solo/env.js makes a per-load one */
}
