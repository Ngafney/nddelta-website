import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One config, one week at a time: SOLO_WEEK=6 builds solo/week6 into
 * public/solo/week6, served at nddelta.com/solo/week6/.
 *
 * The solo build imports the ORIGINAL game — its React components, its shared
 * engine and its server/handler.js — straight out of weekN/, read-only. A
 * resolver swaps the few modules that cannot run in a browser:
 *
 *   weekN/src/api.js                   → in-process calls to the handler
 *   weekN/server/kv.js                 → an in-memory store
 *   weekN/server/llm.js                → solo/weekN/llm.js (if the week has one)
 *   weekN/src/components/StaleBuild    → nothing (it polls the live site's HTML)
 *   node:crypto / fs / path / url      → small browser shims
 *
 * Nothing in weekN/ is edited, so the live meeting version is untouched.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const week = process.env.SOLO_WEEK || "6";
const weekDir = path.join(repo, `week${week}`);
const soloWeek = path.join(here, `week${week}`);
const shared = path.join(here, "shared");

const norm = (p) => path.normalize(p).toLowerCase();

const SWAPS = () => {
  const own = (rel, fallback) => {
    const mine = path.join(soloWeek, rel);
    return fs.existsSync(mine) ? mine : fallback;
  };
  return new Map([
    [norm(path.join(weekDir, "src", "api.js")), own("api.js", path.join(shared, "api.js"))],
    [norm(path.join(weekDir, "server", "kv.js")), own("kv.js", path.join(shared, "kv.js"))],
    [norm(path.join(weekDir, "server", "llm.js")), own("llm.js", path.join(shared, "llm.js"))],
    [norm(path.join(weekDir, "src", "components", "StaleBuild.jsx")), path.join(shared, "NoStale.jsx")],
    // Weeks 1–4 commit event-day store credentials here; a solo/weekN/store-config.mjs keeps them out of the public bundle.
    [norm(path.join(weekDir, "server", "store-config.mjs")), own("store-config.mjs", path.join(shared, "store-config.mjs"))],
  ]);
};

const NODE_SHIMS = {
  "node:crypto": path.join(shared, "node-crypto.js"),
  crypto: path.join(shared, "node-crypto.js"),
  "node:fs": path.join(shared, "node-stub.js"),
  fs: path.join(shared, "node-stub.js"),
  "node:path": path.join(shared, "node-stub.js"),
  "node:url": path.join(shared, "node-stub.js"),
};

function soloRemap() {
  let swaps;
  return {
    name: "delta-solo-remap",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (NODE_SHIMS[source]) return normalizePath(NODE_SHIMS[source]);
      if (!importer || !(source.startsWith(".") || source.startsWith("/"))) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r) return null;
      swaps ??= SWAPS();
      const hit = swaps.get(norm(r.id.split("?")[0]));
      return hit ? normalizePath(hit) : null;
    },
  };
}

export default defineConfig({
  root: soloWeek,
  base: `/solo/week${week}/`,
  plugins: [soloRemap(), react()],
  define: {
    // The handler reads process.env at import time; solo/shared/env.js installs a real object too.
    "process.env.VERCEL": JSON.stringify(""),
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": "globalThis.process.env",
  },
  resolve: {
    // The original components import react from weekN/node_modules; one copy only.
    dedupe: ["react", "react-dom"],
    alias: {
      "@solo": shared,
      "@week": weekDir,
    },
  },
  server: {
    port: 5190 + Number(week),
    fs: { allow: [repo] },
  },
  build: {
    outDir: path.join(repo, "public", "solo", `week${week}`),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
