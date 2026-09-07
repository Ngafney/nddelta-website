/**
 * One server, one port: serves the built Week 1 app AND its API on the
 * same origin, bound to 0.0.0.0 so it can be tunneled / reached off-box.
 *   node serve.js            → http://0.0.0.0:8080/week1/
 * Loads week1/.env (SESSION_SECRET, OPENAI_API_KEY, …) like dev-server.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Load .env before importing modules that read env at import time.
(function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(here, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
})();

const { nodeHandler } = await import("./server/handler.js");
const { KV_MODE } = await import("./server/kv.js");
const { llmAvailable } = await import("./server/llm.js");

const PORT = process.env.PORT || 8080;
const STATIC_DIR = path.join(here, "..", "public", "week1"); // vite build output

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
  // hashed asset filenames can cache hard; html should not
  res.setHeader("Cache-Control", ext === ".html" ? "no-store" : "public, max-age=86400");
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let pathname = decodeURIComponent(url.pathname);

    // API
    if (pathname.startsWith("/api/week1/")) {
      const route = pathname.replace(/^\/api\/week1\//, "").replace(/\/$/, "");
      return nodeHandler(req, res, route);
    }
    // Convenience: bare / → the app
    if (pathname === "/" || pathname === "/week1") {
      res.statusCode = 302;
      res.setHeader("Location", "/week1/");
      return res.end();
    }
    // Static app under /week1/
    if (pathname.startsWith("/week1/")) {
      let rel = pathname.slice("/week1/".length);
      // Guard against path traversal
      const file = path.join(STATIC_DIR, rel);
      if (!file.startsWith(STATIC_DIR)) {
        res.statusCode = 403;
        return res.end("forbidden");
      }
      if (rel && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return sendFile(res, file);
      }
      // SPA fallback (board, admin, deep links) → index.html
      return sendFile(res, path.join(STATIC_DIR, "index.html"));
    }
    res.statusCode = 404;
    res.end("not found — try /week1/");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`week1 → http://0.0.0.0:${PORT}/week1/`);
    console.log(`storage  → ${KV_MODE}`);
    console.log(`compiler → ${llmAvailable() ? `AI (${process.env.OPENAI_MODEL || "gpt-5.6-terra"})` : "offline (no OPENAI_API_KEY)"}`);
    console.log(`secret   → ${process.env.SESSION_SECRET ? "set" : "MISSING (set SESSION_SECRET)"}`);
  });
