/**
 * The one storage interface, two backings:
 *
 *   - Upstash Redis over REST when the env vars exist (production on
 *     Vercel — add the integration and they appear automatically).
 *   - An in-memory store persisted to week1/.data/dev-kv.json otherwise,
 *     so local dev needs no accounts and survives a restart.
 *
 * Only the handful of commands the app uses are implemented. ZADD here is
 * always GT semantics — leaderboards keep your best, never your latest.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORE_CONFIG } from "./store-config.mjs";

// Env vars win (the proper way). Fall back to the committed store-config for
// this deploy, where we can't set Vercel env vars. Empty strings stay falsy,
// so an unfilled config leaves us in memory mode exactly as before.
const REST_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || STORE_CONFIG.UPSTASH_REDIS_REST_URL || "";
const REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || STORE_CONFIG.UPSTASH_REDIS_REST_TOKEN || "";

export const KV_MODE = REST_URL && REST_TOKEN ? "upstash" : "memory";

// On Vercel, memory mode means every invocation starts blank — scores would
// silently vanish. Shout about it here and surface it in /health and /config
// so the admin panel can show a banner instead of anyone debugging ghosts.
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

const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data", "dev-kv.json");

const mem = { str: new Map(), hash: new Map(), zset: new Map() };
let loaded = false;
let saveTimer = null;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    for (const [k, v] of Object.entries(raw.str ?? {})) mem.str.set(k, v);
    for (const [k, v] of Object.entries(raw.hash ?? {})) mem.hash.set(k, new Map(Object.entries(v)));
    for (const [k, v] of Object.entries(raw.zset ?? {})) mem.zset.set(k, new Map(Object.entries(v)));
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
      const out = {
        str: Object.fromEntries(mem.str),
        hash: Object.fromEntries([...mem.hash].map(([k, v]) => [k, Object.fromEntries(v)])),
        zset: Object.fromEntries([...mem.zset].map(([k, v]) => [k, Object.fromEntries(v)])),
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(out));
    } catch (e) {
      console.warn("[kv] persist failed:", e.message);
    }
  }, 250);
}

/* ── the interface ────────────────────────────────────────────────────── */

export async function get(key) {
  if (KV_MODE === "upstash") return upstash(["GET", key]);
  load();
  return mem.str.get(key) ?? null;
}

export async function set(key, value) {
  if (KV_MODE === "upstash") return upstash(["SET", key, value]);
  load();
  mem.str.set(key, value);
  scheduleSave();
}

export async function del(key) {
  if (KV_MODE === "upstash") return upstash(["DEL", key]);
  load();
  mem.str.delete(key);
  mem.hash.delete(key);
  mem.zset.delete(key);
  scheduleSave();
}

export async function hget(key, field) {
  if (KV_MODE === "upstash") return upstash(["HGET", key, field]);
  load();
  return mem.hash.get(key)?.get(field) ?? null;
}

export async function hset(key, field, value) {
  if (KV_MODE === "upstash") return upstash(["HSET", key, field, value]);
  load();
  if (!mem.hash.has(key)) mem.hash.set(key, new Map());
  mem.hash.get(key).set(field, value);
  scheduleSave();
}

export async function hdel(key, field) {
  if (KV_MODE === "upstash") return upstash(["HDEL", key, field]);
  load();
  mem.hash.get(key)?.delete(field);
  scheduleSave();
}

export async function hgetall(key) {
  if (KV_MODE === "upstash") {
    const flat = await upstash(["HGETALL", key]);
    const obj = {};
    for (let i = 0; i < flat.length; i += 2) obj[flat[i]] = flat[i + 1];
    return obj;
  }
  load();
  return Object.fromEntries(mem.hash.get(key) ?? []);
}

/** ZADD with GT: only ever raises a member's score. */
export async function zaddGT(key, score, member) {
  if (KV_MODE === "upstash") return upstash(["ZADD", key, "GT", "CH", String(score), member]);
  load();
  if (!mem.zset.has(key)) mem.zset.set(key, new Map());
  const z = mem.zset.get(key);
  const cur = z.get(member);
  if (cur === undefined || score > cur) {
    z.set(member, score);
    scheduleSave();
    return 1;
  }
  return 0;
}

/** Top-N of a sorted set, highest first: [{member, score}]. */
export async function ztop(key, n = 100) {
  if (KV_MODE === "upstash") {
    const flat = await upstash(["ZRANGE", key, "0", String(n - 1), "REV", "WITHSCORES"]);
    const out = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ member: flat[i], score: parseFloat(flat[i + 1]) });
    return out;
  }
  load();
  return [...(mem.zset.get(key) ?? [])]
    .map(([member, score]) => ({ member, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export async function zrem(key, member) {
  if (KV_MODE === "upstash") return upstash(["ZREM", key, member]);
  load();
  mem.zset.get(key)?.delete(member);
  scheduleSave();
}

/** TTL in seconds. Memory mode ignores it — dev data is cheap. */
export async function expire(key, seconds) {
  if (KV_MODE === "upstash") return upstash(["EXPIRE", key, String(seconds)]);
}

/* JSON conveniences */
export async function getJSON(key) {
  const raw = await get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function setJSON(key, obj) {
  return set(key, JSON.stringify(obj));
}
