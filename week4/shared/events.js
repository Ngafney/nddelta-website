/**
 * Asteroids that were spotted on the way in, and then actually hit.
 *
 * Eleven objects have ever been detected before striking the atmosphere. Four
 * of them have a full pre-entry velocity vector published by CNEOS, which is
 * what a ground track needs, so those four are the ones a round can be built
 * on. The rest are listed underneath for the story.
 *
 * WHERE THE NUMBERS COME FROM
 *   impact time, latitude, longitude, altitude, speed, and the velocity
 *   components  →  NASA/JPL CNEOS Fireball and Bolide Data
 *                  https://cneos.jpl.nasa.gov/fireballs/
 *   discovery lead time and observation arc
 *                →  the Minor Planet Center circulars and the ESA/NASA
 *                   announcements at the time, via the Wikipedia summary
 *                   "List of predicted asteroid impacts on Earth".
 *
 * WHAT IS REAL AND WHAT IS NOT — read this before quoting any of it.
 *
 *   REAL, and checkable: the object, the date and time to the second, where it
 *   actually hit, the pre-entry speed, the energy, the size estimate, and how
 *   much warning there was.
 *
 *   MODELLED: the uncertainty a round hands out. Nobody published a covariance
 *   for a four-metre rock found nineteen hours before it arrived, so the shape
 *   is taken from what such warnings look like and the scale is solved to hit
 *   the operator's chosen confidence. See the note in corridor.js.
 *
 *   MIXED: the corridor direction. For 2008 TC3 there is a published
 *   trajectory solution — azimuth 101°, 21° above the horizon, 12.38 km/s
 *   ground-relative — and that is what is used. For the other three no
 *   trajectory paper gives an azimuth, so the value here is derived from the
 *   CNEOS velocity components and marked `modelled`. That derivation is worth
 *   distrusting: run it on 2008 TC3, where the answer is known, and it returns
 *   87° against a published 101°, and gets the vertical sign wrong. It is good
 *   enough to put a corridor roughly where the fireball went and no better.
 *
 * The corridor direction does not change what the round teaches — latitude is
 * a curved function of distance along ANY great circle that is not a meridian —
 * so a modelled azimuth costs the exercise nothing. It would cost an astronomer
 * something, which is why it is labelled.
 */

export const EVENTS = [
  {
    key: "2008TC3",
    /** Direction the fireball travelled across the ground, deg from north. */
    azimuthDeg: 101,
    /** Speed of the point on the ground beneath it, km/s. */
    groundSpeedKms: 12.38,
    /** Degrees above the horizon on the way in. */
    entryAngleDeg: 21,
    /** "published" = from a trajectory paper. "modelled" = see the note. */
    geometry: "published",
    name: "2008 TC3",
    nick: "Almahata Sitta",
    when: "2008-10-07T02:45:45Z",
    /** Impact/airburst point, degrees. */
    lat: 20.9,
    lon: 31.4,
    /** Altitude of peak brightness, km. */
    altKm: 38.9,
    /** Pre-entry speed, km/s, and its ECI components. */
    speedKms: 13.3,
    vEci: [-9.0, 9.0, 3.8],
    /** Radiated energy (J × 1e10) and impact energy (kt TNT), as published. */
    energyJ: 39.5,
    impactKt: 1.0,
    diameterM: [3.8, 4.4],
    /** Hours between discovery and impact. */
    leadHours: 20.1,
    where: "the Nubian Desert, northern Sudan",
    story:
      "The first asteroid ever discovered before it hit. Richard Kowalski found it at Mount Lemmon on 6 October 2008; " +
      "it arrived nineteen hours later. Hundreds of fragments were later walked up off the desert floor — the first " +
      "time anyone has held pieces of a rock they watched coming.",
  },
  {
    key: "2018LA",
    /** Direction the fireball travelled across the ground, deg from north. */
    azimuthDeg: 83,
    /** Speed of the point on the ground beneath it, km/s. */
    groundSpeedKms: 15.1,
    /** Degrees above the horizon on the way in. */
    entryAngleDeg: 27,
    /** "published" = from a trajectory paper. "modelled" = see the note. */
    geometry: "modelled",
    name: "2018 LA",
    nick: "Motopi Pan",
    when: "2018-06-02T16:44:12Z",
    lat: -21.2,
    lon: 23.3,
    altKm: 28.7,
    speedKms: 16.9,
    vEci: [0.9, -16.4, 3.9],
    energyJ: 34.6,
    impactKt: 0.91,
    diameterM: [2, 5],
    leadHours: 8.5,
    where: "the Central Kalahari, Botswana",
    story:
      "Eight and a half hours of warning. It came apart over the Kalahari in daylight and was caught on farm security " +
      "cameras; fragments were recovered from the Central Kalahari Game Reserve three weeks later.",
  },
  {
    key: "2019MO",
    /** Direction the fireball travelled across the ground, deg from north. */
    azimuthDeg: 247,
    /** Speed of the point on the ground beneath it, km/s. */
    groundSpeedKms: 7.5,
    /** Degrees above the horizon on the way in. */
    entryAngleDeg: 60,
    /** "published" = from a trajectory paper. "modelled" = see the note. */
    geometry: "modelled",
    name: "2019 MO",
    when: "2019-06-22T21:25:47Z",
    lat: 14.9,
    lon: -66.2,
    altKm: 25.0,
    speedKms: 14.9,
    vEci: [-13.4, 6.0, 2.5],
    energyJ: 294,
    impactKt: 6.0,
    diameterM: [4, 9],
    leadHours: 11.6,
    where: "the Caribbean, south of Puerto Rico",
    story:
      "Found by ATLAS on Mauna Loa with four observations spanning half an hour — barely an arc at all. It burst over " +
      "open water with the energy of six kilotons, and weather satellites caught the flash.",
  },
  {
    key: "2024RW1",
    /** Direction the fireball travelled across the ground, deg from north. */
    azimuthDeg: 273,
    /** Speed of the point on the ground beneath it, km/s. */
    groundSpeedKms: 12.7,
    /** Degrees above the horizon on the way in. */
    entryAngleDeg: 50,
    /** "published" = from a trajectory paper. "modelled" = see the note. */
    geometry: "modelled",
    name: "2024 RW1",
    nick: "CAQTDL2",
    when: "2024-09-04T16:39:32Z",
    lat: 18.0,
    lon: 122.9,
    altKm: 25.0,
    speedKms: 19.7,
    vEci: [3.9, -19.1, 2.6],
    energyJ: 6.2,
    impactKt: 0.2,
    diameterM: [1, 2.5],
    leadHours: 10.9,
    where: "off the coast of Luzon, the Philippines",
    story:
      "Spotted from Kitt Peak about eleven hours out. It lit up the sky over Luzon as a green fireball and was filmed " +
      "from half the island — one of the best-observed predicted impacts on record.",
  },
];

export const EVENT_KEYS = EVENTS.map((e) => e.key);
export const eventByKey = (k) => EVENTS.find((e) => e.key === k) ?? null;

/**
 * The other seven, for the reveal's "this keeps happening" line. No velocity
 * vector was published for these, so a round cannot be built on one.
 */
export const OTHER_IMPACTS = [
  { name: "2014 AA", when: "2014-01-02", where: "the Atlantic", leadHours: 20.8 },
  { name: "2022 EB5", when: "2022-03-11", where: "the Norwegian Sea", leadHours: 2.0 },
  { name: "2022 WJ1", when: "2022-11-19", where: "Lake Ontario", leadHours: 3.6 },
  { name: "2023 CX1", when: "2023-02-13", where: "Normandy", leadHours: 6.7 },
  { name: "2024 BX1", when: "2024-01-21", where: "west of Berlin", leadHours: 2.7 },
  { name: "2024 UQ", when: "2024-10-22", where: "the north Pacific", leadHours: 1.8 },
  { name: "2024 XA1", when: "2024-12-03", where: "northern Siberia", leadHours: 10.3 },
];
