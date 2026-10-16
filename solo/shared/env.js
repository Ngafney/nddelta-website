/**
 * Import this FIRST in every solo entry: the game servers read process.env at
 * module load. A fresh signing secret per tab is all solo needs.
 */
const g = globalThis;
if (!g.process) g.process = { env: {} };
if (!g.process.env) g.process.env = {};
if (!g.process.env.SESSION_SECRET) {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  g.process.env.SESSION_SECRET = "solo-" + [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
g.process.env.KV_FORCE_MEMORY = "1";
g.process.cwd ??= () => "/";
