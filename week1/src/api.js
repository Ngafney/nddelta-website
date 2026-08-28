/**
 * Client API + team session. The token lives in localStorage; every
 * mutating call carries it so the server can refuse impostors.
 */

const BASE = "/api/week1";

async function request(method, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error ?? `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body ?? {}),
};

/* ── team session ─────────────────────────────────────────────────────── */

const KEY = "w1team";
const ARCHIVE = "w1teams"; // name → credentials, for every team this browser has ever joined

export function loadTeam() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY));
    return t?.teamId && t?.token ? t : null;
  } catch {
    return null;
  }
}

export function saveTeam(team) {
  try {
    localStorage.setItem(KEY, JSON.stringify(team));
    // Archive by name so SWITCH is always reversible — typing an old
    // team name from this browser rejoins it instead of hitting
    // "name is taken" with no way back.
    const all = JSON.parse(localStorage.getItem(ARCHIVE) ?? "{}");
    all[team.name.trim().toLowerCase()] = { teamId: team.teamId, token: team.token };
    localStorage.setItem(ARCHIVE, JSON.stringify(all));
  } catch {
    /* private mode — session just won't persist */
  }
}

/** The stored token for a team name this browser has joined before. */
export function tokenForName(name) {
  try {
    const all = JSON.parse(localStorage.getItem(ARCHIVE) ?? "{}");
    return all[name.trim().toLowerCase()]?.token ?? null;
  } catch {
    return null;
  }
}

export function clearTeam() {
  try {
    localStorage.removeItem(KEY); // the archive deliberately survives
  } catch {}
}

/** Attach team credentials to a payload. */
export function withTeam(team, body = {}) {
  return { ...body, teamId: team.teamId, token: team.token };
}
