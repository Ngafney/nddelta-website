/**
 * Storage, two backings — the same shape as week1's, plus the one thing this
 * game needs that week1 did not: an ATOMIC compare-and-swap.
 *
 *   - Upstash Redis over REST when the env vars exist (production on Vercel).
 *   - An in-memory store persisted to week4/.data/dev-kv.json otherwise, so
 *     local dev needs no accounts and survives a restart.
 *
 * Why CAS. The market is one JSON document — book, balances, positions, tape —
 * because an order that trades has to move four things at once or none of them.
 * Sixty people clicking at once means concurrent read-modify-write, and on
 * serverless those are separate processes, so "read, edit, write" silently
 * loses trades. Every write therefore goes through casSet(), which bumps a
 * version key in the SAME Redis round trip as the value and refuses if the
 * version moved underneath it. A refusal hands back the fresh document so the
 * caller can replay its change against it instead of paying for another read.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORE_CONFIG } from "./store-config.mjs";

const REST_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || STORE_CONFIG.UPSTASH_REDIS_REST_URL || "";
const REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || STORE_CONFIG.UPSTASH_REDIS_REST_TOKEN || "";

// Tests and offline runs must never touch the shared store, whatever is
// configured — one flag, checked before anything else.
const FORCE_MEMORY = process.env.KV_FORCE_MEMORY === "1";

export const KV_MODE = !FORCE_MEMORY && REST_URL && REST_TOKEN ? "upstash" : "memory";

// On Vercel, memory mode means every invocation starts blank — a live round
// would silently reset. Shout about it here and surface it in /health so the
// admin panel can show a banner instead of anyone debugging ghosts.
export const KV_PERSISTENT = KV_MODE === "upstash" || !process.env.VERCEL;
if (!KV_PERSISTENT) {
  console.warn(
    "[kv] NO UPSTASH CREDENTIALS ON VERCEL — storage is per-invocation memory and nothing will persist. Add the Upstash integration."
  );
}

/* ── Upstash backing ──────────────────────────────────────────────────── */

async function upstash(cmd) {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.error) throw new Error(`upstash: ${data.error}`);
  return data.result;
}

/* ── in-memory backing with file persistence ──────────────────────────── */

// KV_DATA_FILE lets a test run beside a live local server without the two
// sharing (and clobbering) one file.
const DATA_FILE =
  process.env.KV_DATA_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data", "dev-kv.json");

const mem = new Map();
let loaded = false;
let saveTimer = null;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    for (const [k, v] of Object.entries(raw)) mem.set(k, v);
  } catch {
    /* first run — nothing on disk */
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(Object.fromEntries(mem)));
    } catch (e) {
      console.warn("[kv] persist failed:", e.message);
    }
  }, 300);
}

/* ── the interface ────────────────────────────────────────────────────── */

export async function get(key) {
  if (KV_MODE === "upstash") return upstash(["GET", key]);
  load();
  return mem.get(key) ?? null;
}

export async function set(key, value) {
  if (KV_MODE === "upstash") return upstash(["SET", key, value]);
  load();
  mem.set(key, value);
  scheduleSave();
}

export async function del(...keys) {
  if (KV_MODE === "upstash") return upstash(["DEL", ...keys]);
  load();
  for (const k of keys) mem.delete(k);
  scheduleSave();
}

/** One round trip, several keys. */
export async function mget(keys) {
  if (KV_MODE === "upstash") {
    const out = await upstash(["MGET", ...keys]);
    return keys.map((_, i) => out?.[i] ?? null);
  }
  load();
  return keys.map((k) => mem.get(k) ?? null);
}

export async function getJSON(key) {
  const raw = await get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function setJSON(key, obj) {
  return set(key, JSON.stringify(obj));
}

/**
 * Atomic compare-and-swap on (valueKey, versionKey).
 *
 * Writes `value` and sets the version to `nextVersion` only if the stored
 * version still equals `expected` (use "" for "the key should not exist yet").
 * On failure it returns the CURRENT value and version, so a caller can retry
 * without another read.
 *
 * Returns { ok, value, version }.
 */
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[2])
if cur == false then cur = '' end
if cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('SET', KEYS[2], ARGV[3])
  return {1, '', ARGV[3]}
end
local val = redis.call('GET', KEYS[1])
if val == false then val = '' end
return {0, val, cur}
`;

export async function casSet(valueKey, versionKey, expected, value, nextVersion) {
  if (KV_MODE === "upstash") {
    const res = await upstash(["EVAL", CAS_SCRIPT, "2", valueKey, versionKey, String(expected ?? ""), value, String(nextVersion)]);
    const ok = Number(res?.[0]) === 1;
    return { ok, value: ok ? value : res?.[1] || null, version: String(res?.[2] ?? "") };
  }
  // Node is single-threaded: this whole function body is already atomic.
  load();
  const cur = mem.get(versionKey) ?? "";
  if (cur !== String(expected ?? "")) {
    return { ok: false, value: mem.get(valueKey) ?? null, version: cur };
  }
  mem.set(valueKey, value);
  mem.set(versionKey, String(nextVersion));
  scheduleSave();
  return { ok: true, value, version: String(nextVersion) };
}

/** Read a CAS-managed document and its version in one round trip. */
export async function casGet(valueKey, versionKey) {
  const [value, version] = await mget([valueKey, versionKey]);
  return { value: value ?? null, version: version ?? "" };
}

/** TTL in seconds. Memory mode ignores it — dev data is cheap. */
export async function expire(key, seconds) {
  if (KV_MODE === "upstash") return upstash(["EXPIRE", key, String(seconds)]);
}

/** Append to a capped list of JSON strings (round history). Newest first. */
export async function pushCapped(key, obj, cap) {
  if (KV_MODE === "upstash") {
    await upstash(["LPUSH", key, JSON.stringify(obj)]);
    return upstash(["LTRIM", key, "0", String(cap - 1)]);
  }
  load();
  const list = JSON.parse(mem.get(key) ?? "[]");
  list.unshift(obj);
  mem.set(key, JSON.stringify(list.slice(0, cap)));
  scheduleSave();
}

export async function listAll(key) {
  if (KV_MODE === "upstash") {
    const rows = await upstash(["LRANGE", key, "0", "-1"]);
    return (rows ?? []).map((r) => JSON.parse(r));
  }
  load();
  return JSON.parse(mem.get(key) ?? "[]");
}
