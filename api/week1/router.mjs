/**
 * Vercel entry for the whole Week 1 API. A vercel.json rewrite sends every
 * /api/week1/* request here — nested paths included — with the sub-path in the
 * ?__path query param. This exists because the framework preset does not route
 * a [...catch-all] function to multi-segment paths (single-segment matched, but
 * /admin/auth, /bandit/manual/start, etc. hard-404'd at the platform). Reading
 * the route from __path (falling back to the pathname) is deterministic.
 */
import { nodeHandler } from "../../week1/server/handler.js";

export default async function (req, res) {
  const url = new URL(req.url, "http://x");
  let route = url.searchParams.get("__path");
  if (route == null) route = url.pathname.replace(/^\/api\/week1\/?/, "");
  route = route.replace(/^\/+/, "").replace(/\/+$/, "");
  return nodeHandler(req, res, route);
}
