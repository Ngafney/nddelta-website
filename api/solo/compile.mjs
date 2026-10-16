/**
 * The AI strategy compiler for the SOLO builds (nddelta.com/solo/week1/ and
 * /solo/week3/). Solo games run their server in the browser, which must never
 * hold the OpenAI key, so the one step that needs the AI comes here: the same
 * compile() and the same prompts the live meeting uses, nothing else.
 *
 *   POST /api/solo/compile  { week: 1, game: "pd" | "icecream", prompt }
 *   POST /api/solo/compile  { week: 3, prompt }                 (bandit lab)
 *
 * Returns what compile() returns ({ code, explain, summary } or { refused,
 * reason }). The browser checks and sandboxes the code exactly as the live
 * server does. If this fails, solo falls back to its offline reader.
 *
 * Guard rails, since it spends the club's API credit: POST only, prompts
 * capped at 2,000 characters, and a per-IP limit (best effort: per warm
 * function instance).
 */
import { compile as compileW1, llmAvailable as w1Ready } from "../../week1/server/llm.js";
import { compile as compileW3, llmAvailable as w3Ready } from "../../week3/server/llm.js";

const hits = new Map();
function limited(ip, max = 8, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "?").split(",")[0].trim();
  if (limited(ip)) return send(res, 429, { error: "slow down a moment, then try again" });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 400, { error: "bad JSON" });
  }
  const prompt = String(body.prompt ?? "").trim();
  if (prompt.length < 3) return send(res, 400, { error: "describe your strategy first" });
  if (prompt.length > 2000) return send(res, 400, { error: "that's too long; keep it under 2,000 characters" });

  try {
    if (Number(body.week) === 1) {
      if (!["pd", "icecream"].includes(body.game)) return send(res, 400, { error: "unknown game" });
      if (!w1Ready()) return send(res, 503, { error: "the AI isn't configured", code: "no-llm" });
      return send(res, 200, await compileW1(body.game, prompt));
    }
    if (Number(body.week) === 3) {
      if (!w3Ready()) return send(res, 503, { error: "the AI isn't configured", code: "no-llm" });
      return send(res, 200, await compileW3(prompt));
    }
    return send(res, 400, { error: "unknown week" });
  } catch (e) {
    return send(res, 502, { error: e?.message ?? "the AI call failed" });
  }
}
