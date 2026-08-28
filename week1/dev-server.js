/**
 * Local stand-in for the Vercel functions: `npm run api` in week1/.
 * Mounts the exact same handler at http://localhost:3100/api/week1/*.
 * Vite's dev server proxies /api here.
 */
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load week1/.env (no dependency) BEFORE importing modules that read env.
// Shell vars still win — only fills what isn't already set.
(function loadEnv() {
  try {
    const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env — fine, falls back to offline compiler */
  }
})();

const { nodeHandler } = await import("./server/handler.js");
const { KV_MODE } = await import("./server/kv.js");
const { llmAvailable } = await import("./server/llm.js");

const PORT = process.env.PORT || 3100;

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/api/week1/")) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const route = url.pathname.replace(/^\/api\/week1\//, "").replace(/\/$/, "");
    nodeHandler(req, res, route);
  })
  .listen(PORT, () => {
    console.log(`week1 api  → http://localhost:${PORT}/api/week1/health`);
    console.log(`storage    → ${KV_MODE}${KV_MODE === "memory" ? " (persisted to week1/.data/dev-kv.json)" : ""}`);
    console.log(`compiler   → ${llmAvailable() ? `AI (${process.env.OPENAI_MODEL || "gpt-5.6-terra"})` : "offline parser (set OPENAI_API_KEY to enable the AI)"}`);
  });
