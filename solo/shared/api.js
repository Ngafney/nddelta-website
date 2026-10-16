/**
 * Drop-in for weekN/src/api.js (weeks 2–6 share its exports), for solo mode.
 *
 * `api` talks to the in-tab server instead of /api/weekN. The session is the
 * current SEAT: solo has one, "play with a friend" has two on the same team,
 * and the shell switches between them. Sessions live in sessionStorage under
 * solo-only keys, so a solo game never disturbs a live-meeting login.
 */

import { local } from "./local.js";

export const api = local;

let ns = "solo";
let seats = [];
let current = 0;
const listeners = new Set();

export function bindSession(namespace) {
  ns = namespace;
  try {
    const raw = JSON.parse(sessionStorage.getItem(`${ns}:seats`));
    seats = Array.isArray(raw?.seats) ? raw.seats : [];
    current = Math.min(raw?.current ?? 0, Math.max(0, seats.length - 1));
  } catch {
    seats = [];
    current = 0;
  }
}

function persist() {
  try {
    sessionStorage.setItem(`${ns}:seats`, JSON.stringify({ seats, current }));
  } catch {}
  for (const f of listeners) f();
}

export function setSeats(list) {
  seats = list.map((p) => ({ playerId: p.playerId, token: p.token, name: p.name }));
  current = 0;
  persist();
}
export function getSeats() {
  return seats.slice();
}
export function currentSeat() {
  return current;
}
export function switchSeat(i) {
  if (i >= 0 && i < seats.length) {
    current = i;
    persist();
  }
}
export function onSeatChange(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/* ── the original module's surface ─────────────────────────────────────── */

let deviceSeq = 0;
export function deviceId() {
  // The player's own device id; bots get their own from the bot runner.
  return `${ns}-you-${current}-${deviceSeq}`;
}
export function fingerprint() {
  return "solo0000";
}

export function loadPlayer() {
  const p = seats[current];
  return p?.playerId && p?.token ? { ...p } : null;
}
export function savePlayer(p) {
  if (!p?.playerId) return;
  seats[current] = { playerId: p.playerId, token: p.token, name: p.name };
  persist();
}
export function clearPlayer() {
  // A 401 in solo means the round was rebuilt without this seat; the shell re-seats.
  seats.splice(current, 1);
  current = 0;
  deviceSeq++;
  persist();
}
export function withPlayer(player, body = {}) {
  return { ...body, playerId: player.playerId, token: player.token };
}
