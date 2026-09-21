/**
 * Client API, device identity, and the player session.
 *
 * One account per device is enforced on the server, but the server can only be
 * as good as the id it is handed, so this file works fairly hard to give the
 * same browser the same id back:
 *   - localStorage, which survives reloads and most things,
 *   - a long-lived cookie, which survives localStorage being cleared,
 *   - and a coarse fingerprint sent alongside, which the admin panel uses to
 *     FLAG lookalikes. It never blocks on its own: two identical phones on one
 *     lecture-hall network legitimately look the same, and locking a real
 *     student out of the game is worse than one person having two windows.
 */

const BASE = "/api/week3";

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
    e.code = data.code ?? null;
    throw e;
  }
  return data;
}

export const api = {
  get: (path, params) => request("GET", params ? `${path}?${new URLSearchParams(params)}` : path),
  post: (path, body) => request("POST", path, body ?? {}),
};

/* ── device identity ──────────────────────────────────────────────────── */

const DEVICE_KEY = "w3device";
const COOKIE = "w3device";

function readCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name, value) {
  try {
    const tenYears = 60 * 60 * 24 * 3650;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${tenYears}; samesite=lax`;
  } catch {}
}

function randomId() {
  const a = new Uint8Array(16);
  (window.crypto ?? window.msCrypto).getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable per-browser id: localStorage and a cookie back each other up. */
export function deviceId() {
  let id = null;
  try {
    id = localStorage.getItem(DEVICE_KEY);
  } catch {}
  if (!id) id = readCookie(COOKIE);
  if (!id || id.length < 8) id = randomId();
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {}
  writeCookie(COOKIE, id);
  return id;
}

/** A coarse, non-identifying signature of the machine. Advisory only. */
export function fingerprint() {
  const bits = [
    navigator.userAgent,
    navigator.language,
    navigator.hardwareConcurrency,
    screen.width,
    screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.maxTouchPoints,
  ].join("|");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bits.length; i++) {
    h ^= bits.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/* ── session ──────────────────────────────────────────────────────────── */

const KEY = "w3player";

export function loadPlayer() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    return p?.playerId && p?.token ? p : null;
  } catch {
    return null;
  }
}

export function savePlayer(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ playerId: p.playerId, token: p.token, name: p.name }));
  } catch {
    /* private mode — the session just will not survive a reload */
  }
}

export function clearPlayer() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/** Attach player credentials to a payload. */
export function withPlayer(player, body = {}) {
  return { ...body, playerId: player.playerId, token: player.token };
}
