/**
 * Import this FIRST in every solo entry: the game servers read process.env at
 * module load. A fresh signing secret per tab is all solo needs.
 */
const g = globalThis;
if (!g.process) g.process = { env: {} };
if (!g.process.env) g.process.env = {};
if (!g.process.env.SESSION_SECRET) {
  // One secret per tab, kept beside the saved game: a reload resumes the game,
  // and every token in it (yours, the bots', the host's) must still verify.
  let s = null;
  try {
    s = sessionStorage.getItem("solo:secret");
  } catch {}
  if (!s) {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    s = "solo-" + [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
    try {
      sessionStorage.setItem("solo:secret", s);
    } catch {}
  }
  g.process.env.SESSION_SECRET = s;
}
g.process.env.KV_FORCE_MEMORY = "1";
g.process.cwd ??= () => "/";
