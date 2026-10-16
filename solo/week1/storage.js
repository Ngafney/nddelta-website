/**
 * The original Week 1 app keeps drafts, "rules seen" and "reveal played"
 * flags in localStorage under w1… keys, which the live meeting app on the
 * same site uses too. Solo gives them their own names so a solo game never
 * touches a live-meeting draft, and gives each seat (you, your friend) its
 * own scratch-pad draft while the team's saved bots stay shared.
 */
import { currentSeat } from "@solo/api.js";

const SOLO_KEY = /^w1(ipd:|lab:|rules:|shownReveals)/;
const PER_SEAT = /^w1(ipd:|lab:)/;

function soloKey(k) {
  return `solo:${k}${PER_SEAT.test(k) ? `:s${currentSeat()}` : ""}`;
}

if (typeof Storage !== "undefined" && typeof localStorage !== "undefined") {
  const P = Storage.prototype;
  for (const fn of ["getItem", "setItem", "removeItem"]) {
    const orig = P[fn];
    P[fn] = function (key, ...rest) {
      const k = String(key);
      return orig.call(this, this === localStorage && SOLO_KEY.test(k) ? soloKey(k) : k, ...rest);
    };
  }
  // Old games' drafts (they can hold a whole ten-year ice cream run) are dead weight.
  try {
    const meta = JSON.parse(sessionStorage.getItem("solo-w1:meta") ?? "null");
    const live = meta?.extra?.teamId;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (/^solo:w1(ipd|lab):/.test(k ?? "") && (!live || !k.includes(live))) localStorage.removeItem(k);
    }
  } catch {}
}
