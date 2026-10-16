/**
 * Build every solo week that exists (solo/weekN/index.html) into
 * public/solo/weekN. Run from the repo root's `npm run build`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const weeks = fs
  .readdirSync(here)
  .map((d) => d.match(/^week(\d+)$/)?.[1])
  .filter((w) => w && fs.existsSync(path.join(here, `week${w}`, "index.html")))
  .sort((a, b) => a - b);

const vite = path.join(here, "node_modules", "vite", "bin", "vite.js");
for (const w of weeks) {
  console.log(`\n── solo week ${w} ──`);
  const r = spawnSync(process.execPath, [vite, "build", "--config", path.join(here, "vite.config.js")], {
    cwd: here,
    stdio: "inherit",
    env: { ...process.env, SOLO_WEEK: w },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Guard: no database credential may reach a public bundle.
const bad = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(js|html|json|mjs)$/.test(f.name) && /upstash\.io|sk-(proj-)?[A-Za-z0-9_-]{20,}/.test(fs.readFileSync(p, "utf8"))) bad.push(p);
  }
};
walk(path.join(here, "..", "public", "solo"));
if (bad.length) {
  console.error("REFUSING: a solo bundle contains what looks like a credential:", bad);
  process.exit(1);
}
