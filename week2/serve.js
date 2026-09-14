/**
 * One server, one port: serves the built Week 2 app AND its API on the same
 * origin, bound to 0.0.0.0 so it can be tunneled / reached off-box.
 *   node serve.js            → http://0.0.0.0:8081/week2/
 *
 * This is the recommended way to run an actual round for a room of people:
 * one node process means the market lives in memory, every transaction is
 * atomic for free, polling costs nothing, and there is no Redis bill.
 * Loads week2/.env (SESSION_SECRET, …) like dev-server.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

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

const PORT = process.env.PORT || 8081;
const STATIC_DIR = path.join(here, "..", "public", "week2"); // vite build output

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
  res.setHeader("Cache-Control", ext === ".html" ? "no-store" : "public, max-age=86400");
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/week2/")) {
      const route = pathname.replace(/^\/api\/week2\//, "").replace(/\/$/, "");
      return nodeHandler(req, res, route);
    }
    if (pathname === "/" || pathname === "/week2") {
      res.statusCode = 302;
      res.setHeader("Location", "/week2/");
      return res.end();
    }
    if (pathname.startsWith("/week2/")) {
      const rel = pathname.slice("/week2/".length);
      const file = path.join(STATIC_DIR, rel);
      if (!file.startsWith(STATIC_DIR)) {
        res.statusCode = 403;
        return res.end("forbidden");
      }
      if (rel && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file);
      return sendFile(res, path.join(STATIC_DIR, "index.html")); // SPA fallback
    }
    res.statusCode = 404;
    res.end("not found — try /week2/");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`week2    → http://0.0.0.0:${PORT}/week2/`);
    console.log(`admin    → http://0.0.0.0:${PORT}/week2/admin`);
    console.log(`board    → http://0.0.0.0:${PORT}/week2/board`);
    console.log(`storage  → ${KV_MODE}`);
    console.log(`secret   → ${process.env.SESSION_SECRET ? "set" : "MISSING (set SESSION_SECRET)"}`);
  });
