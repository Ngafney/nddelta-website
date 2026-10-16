/**
 * Week 4, solo: a new rock.
 *
 * The meeting's `POST admin/round` builds a round in two halves. The cheap
 * half draws the true orbit and the whole observing campaign (makeTruth and
 * makeCampaign from week4/shared/round.js, used here unchanged). The dear half
 * prices every release for the control room, at 15 refits each, and takes
 * over a minute — fine on a server, a frozen tab in a browser.
 *
 * So solo does the cheap half with the week's own functions and the dear
 * half with solo/week4/sky.js, in a worker, from exactly the data each release
 * will publish. room.js then installs the round into the store the same way
 * buildRound does. Nothing a player sees depends on which code priced it: the
 * reference prices only appear on the reveal, after the bell.
 */

import { makeTruth, makeCampaign, visible, gaussFrom, RELEASE_COUNTS, RELEASE_ARCS, SIGHTING_SIGMA_KM, EARTH_EPHEM_SIGMA_KM, T_END } from "../../week4/shared/round.js";
import { AU_KM, GM_SUN, GM_EARTH, EARTH, EARTH_RADIUS_AU, EARTH_RADIUS_KM } from "../../week4/shared/orbit.js";
import { mulberry, physics, cleanFit, sampleMisses, pHit } from "./sky.js";

/** The block `GET data` would hand out at release r, for a campaign. */
export function blockFor(campaign, r) {
  return {
    release: r,
    of: RELEASE_COUNTS.length,
    sightings: visible(campaign, r).map((o) => ({ t: o.t, x: o.x, y: o.y })),
    sightingSigmaKm: SIGHTING_SIGMA_KM,
    earthEphemSigmaKm: EARTH_EPHEM_SIGMA_KM,
    gmSun: GM_SUN,
    gmEarth: GM_EARTH,
    earth: EARTH,
    earthRadiusAu: EARTH_RADIUS_AU,
    earthRadiusKm: EARTH_RADIUS_KM,
    auKm: AU_KM,
    tEnd: T_END,
  };
}

/**
 * The secret half of a round. `refits` per release for the reference price
 * (the meeting's server uses 15; more is cheap here).
 */
export function buildSpec(seed, { refits = 80 } = {}) {
  const rand = mulberry(`w4solo|${seed}`);
  const gauss = gaussFrom(rand);
  const truth = makeTruth(rand);
  const campaign = makeCampaign(truth, rand, gauss);
  const releases = RELEASE_COUNTS.map((count, i) => {
    const d = blockFor(campaign, i + 1);
    const seen = visible(campaign, i + 1);
    const P = physics(d);
    const f = cleanFit(P, d.sightings, SIGHTING_SIGMA_KM / AU_KM, 5);
    const xs = f ? sampleMisses(d, f, refits, mulberry(`house|${seed}|${i}`)) : null;
    const km = xs ? xs.map((x) => x.km).sort((a, b) => a - b) : [];
    return {
      index: i + 1,
      sightings: count,
      arcDays: RELEASE_ARCS[i],
      pHit: xs ? pHit(xs) : null,
      medianMissKm: km.length ? km[Math.floor(km.length / 2)] : null,
      suspect: f ? f.dropped.length : 0,
      bad: seen.filter((o) => o.bad).length,
    };
  });
  return {
    truth: { hit: truth.hit, missKm: truth.missAu * AU_KM, tDays: truth.tDays, state: truth.state },
    campaign,
    releases,
    earthTrail: null,
  };
}
