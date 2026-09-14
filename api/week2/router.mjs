/**
 * Vercel entry for the whole Week 2 API. A vercel.json rewrite sends every
 * /api/week2/* request here — nested paths included — with the sub-path in the
 * ?__path query param, for the same reason week1 does it: the framework preset
 * does not route a [...catch-all] function to multi-segment paths, so
 * /team/create and /admin/auth would hard-404 at the platform. Reading the
 * route from __path (falling back to the pathname) is deterministic.
 */
import { nodeHandler } from "../../week2/server/handler.js";

export default async function (req, res) {
  const url = new URL(req.url, "http://x");
  let route = url.searchParams.get("__path");
  if (route == null) route = url.pathname.replace(/^\/api\/week2\/?/, "");
  route = route.replace(/^\/+/, "").replace(/\/+$/, "");
  return nodeHandler(req, res, route);
}
