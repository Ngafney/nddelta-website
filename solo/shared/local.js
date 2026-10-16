/**
 * The in-process "network". The game's real handler(method, route, body, query)
 * runs in this tab; every caller — the original React components, the bots,
 * the solo control strip — goes through `call`, which behaves like the fetch
 * wrapper in weekN/src/api.js: JSON in, JSON out (deep-copied, so nobody holds
 * a reference into the market document), errors carry .status and .code.
 */

let handler = null;

export function installHandler(handle) {
  handler = handle;
}

const clone = (v) => (v === undefined ? {} : JSON.parse(JSON.stringify(v)));

export async function call(method, pathWithQuery, body) {
  if (!handler) throw Object.assign(new Error("solo server not started"), { status: 503 });
  const [route0, qs] = String(pathWithQuery).split("?");
  const route = route0.replace(/^\/+/, "").replace(/\/+$/, "");
  const query = Object.fromEntries(new URLSearchParams(qs ?? ""));
  query.__ip = "solo";
  try {
    const out = await handler(method, route, method === "GET" ? {} : clone(body ?? {}), query);
    return clone(out);
  } catch (e) {
    const err = new Error(e?.message ?? String(e));
    err.status = e?.status ?? 500;
    err.code = e?.code ?? null;
    if (err.status >= 500) console.error("[solo] server error on", method, route, e);
    throw err;
  }
}

export const local = {
  get: (path, params) => call("GET", params ? `${path}?${new URLSearchParams(params)}` : path),
  post: (path, body) => call("POST", path, body ?? {}),
};
