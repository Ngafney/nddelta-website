/**
 * Drop-in for week1/src/api.js, for solo mode.
 *
 * Week 1 is team-based: the original keeps one team credential ("w1team") in
 * localStorage. Solo keeps it in the solo seats instead (solo/shared/api.js),
 * so a solo game never touches a live-meeting login on the same browser.
 * Both seats of "me + a friend" hold the same team; the top bar switches whose
 * screen (and whose scratch-pad draft) you're looking at.
 */

import { local } from "../shared/local.js";
import { getSeats, currentSeat, savePlayer } from "../shared/api.js";

export const api = {
  get: (path) => local.get(path),
  post: (path, body) => local.post(path, body ?? {}),
};

const NAMES = "solo-w1:names"; // teamId → team name
const ARCHIVE = "solo-w1:archive"; // team name → credentials, like the original's "w1teams"

function names() {
  try {
    return JSON.parse(sessionStorage.getItem(NAMES)) ?? {};
  } catch {
    return {};
  }
}

export function loadTeam() {
  const s = getSeats()[currentSeat()];
  if (!s?.playerId || !s?.token) return null;
  return { teamId: s.playerId, token: s.token, name: names()[s.playerId] ?? s.name };
}

export function saveTeam(team) {
  const seat = getSeats()[currentSeat()];
  savePlayer({ playerId: team.teamId, token: team.token, name: seat?.name ?? team.name });
  try {
    const n = names();
    n[team.teamId] = team.name;
    sessionStorage.setItem(NAMES, JSON.stringify(n));
    const all = JSON.parse(sessionStorage.getItem(ARCHIVE) ?? "{}");
    all[team.name.trim().toLowerCase()] = { teamId: team.teamId, token: team.token };
    sessionStorage.setItem(ARCHIVE, JSON.stringify(all));
  } catch {}
}

export function tokenForName(name) {
  try {
    const all = JSON.parse(sessionStorage.getItem(ARCHIVE) ?? "{}");
    const hit = all[name.trim().toLowerCase()];
    if (hit) return hit.token;
    // The team made at setup: rejoin it by name too.
    const n = names();
    const id = Object.keys(n).find((k) => n[k].trim().toLowerCase() === name.trim().toLowerCase());
    const seat = getSeats().find((s) => s.playerId === id);
    return seat?.token ?? null;
  } catch {
    return null;
  }
}

export function clearTeam() {
  // SWITCH TEAM: forget this seat's team for now. The seat list keeps the
  // others; typing the team's name again rejoins it.
  const seat = getSeats()[currentSeat()];
  if (seat) savePlayer({ playerId: "", token: "", name: seat.name });
}

export function withTeam(team, body = {}) {
  return { ...body, teamId: team.teamId, token: team.token };
}
