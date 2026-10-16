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
