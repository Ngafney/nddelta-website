/**
 * Vercel entry point for the whole Week 1 API. Everything routes through
 * week1/server/handler.js — the same module the local dev server mounts.
 */
import { nodeHandler } from "../../week1/server/handler.js";

export default async function (req, res) {
  const url = new URL(req.url, "http://x");
  const route = url.pathname.replace(/^\/api\/week1\//, "").replace(/\/$/, "");
  return nodeHandler(req, res, route);
}
