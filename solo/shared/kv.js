/**
 * The store, for solo: the same interface every week's server/kv.js exports
 * (the union of all six), backed by a Map that lives in this tab. It is saved
 * to sessionStorage so a reload resumes the game instead of wiping it.
 *
 * Single-threaded JS makes every call here atomic, which is all casSet needs.
 */

export const KV_MODE = "memory";
export const KV_PERSISTENT = true;
export const KV = { mode: KV_MODE };

let mem = new Map();
let storageKey = null;
let saveTimer = null;

/** Called by the solo shell before the game starts. */
export function bindStorage(key) {
  // Already bound (setup then play, in one page load): keep what is in memory.
  if (storageKey === key) return;
  storageKey = key;
  mem = new Map();
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) mem.set(k, v);
  } catch {}
}

export function wipe() {
  clearTimeout(saveTimer);
  saveTimer = null;
  mem.clear();
  if (storageKey) {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
  }
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!storageKey) return;
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(mem)));
  } catch {
    /* quota or private mode: the game still runs, it just will not survive a reload */
  }
}

function save() {
  if (!storageKey || saveTimer) return;
  saveTimer = setTimeout(flush, 400);
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flush);

export async function get(key) {
  return mem.get(key) ?? null;
}
export async function set(key, value) {
  mem.set(key, value);
  save();
}
export async function del(...keys) {
  for (const k of keys.flat()) mem.delete(k);
  save();
}
export async function mget(keys) {
  return keys.map((k) => mem.get(k) ?? null);
}
export async function getJSON(key) {
  const raw = mem.get(key);
  if (raw == null) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
export async function setJSON(key, obj) {
  mem.set(key, JSON.stringify(obj));
  save();
}
export async function expire() {}

export async function casSet(valueKey, versionKey, expected, value, nextVersion) {
  const cur = mem.get(versionKey) ?? "";
  if (cur !== String(expected ?? "")) return { ok: false, value: mem.get(valueKey) ?? null, version: cur };
  mem.set(valueKey, value);
  mem.set(versionKey, String(nextVersion));
  save();
  return { ok: true, value, version: String(nextVersion) };
}
export async function casGet(valueKey, versionKey) {
  return { value: mem.get(valueKey) ?? null, version: mem.get(versionKey) ?? "" };
}

export async function pushCapped(key, obj, cap) {
  const list = JSON.parse(mem.get(key) ?? "[]");
  list.unshift(obj);
  mem.set(key, JSON.stringify(list.slice(0, cap)));
  save();
}
export async function listAll(key) {
  return JSON.parse(mem.get(key) ?? "[]");
}

/* hashes (week 1) */
const hmap = (key) => {
  const raw = mem.get(key);
  return raw ? JSON.parse(raw) : {};
};
export async function hget(key, field) {
  return hmap(key)[field] ?? null;
}
export async function hset(key, field, value) {
  const h = hmap(key);
  if (field && typeof field === "object") Object.assign(h, field);
  else h[field] = value;
  mem.set(key, JSON.stringify(h));
  save();
}
export async function hdel(key, ...fields) {
  const h = hmap(key);
  for (const f of fields.flat()) delete h[f];
  mem.set(key, JSON.stringify(h));
  save();
}
export async function hgetall(key) {
  return hmap(key);
}

/* sorted sets (week 1 leaderboards) */
const zmap = (key) => {
  const raw = mem.get(key);
  return raw ? JSON.parse(raw) : {};
};
/** ZADD GT: only ever raises a member's score. */
export async function zaddGT(key, score, member) {
  const z = zmap(key);
  const improved = z[member] == null || score > z[member];
  if (improved) z[member] = score;
  mem.set(key, JSON.stringify(z));
  save();
  return improved;
}
export async function ztop(key, n = 10) {
  return Object.entries(zmap(key))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([member, score]) => ({ member, score }));
}
export async function zrem(key, member) {
  const z = zmap(key);
  delete z[member];
  mem.set(key, JSON.stringify(z));
  save();
}
