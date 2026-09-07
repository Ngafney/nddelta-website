/**
 * The house bots: three per game, always in the tournament, so the first
 * team to submit has opponents and the leaderboard is never empty.
 *
 * Their NAMES and BLURBS are deliberately opaque — a house bot's whole job
 * is to be a wall you have to figure out by watching it play, not a
 * strategy handed to you by its label. The powerful, non-obvious plays
 * (especially the reciprocal ones) must not be given away by a name like
 * "Tit for Tat" or a blurb that spells out the rule. Their specs live here
 * server-side and are never exposed by any API.
 */

export const SEED_BOTS = {
  chicken: [
    {
      id: "seed:flint",
      name: "FLINT",
      seedBot: true,
      blurb: "A house bot. Watch it to learn it.",
      spec: {
        game: "chicken",
        rules: [{ if: true, then: "STAY" }],
      },
    },
    {
      id: "seed:vesper",
      name: "VESPER",
      seedBot: true,
      blurb: "A house bot. Watch it to learn it.",
      spec: {
        game: "chicken",
        rules: [
          { if: { eq: ["round", 0] }, then: "SWERVE" },
          { if: true, then: { opposite: "oppLast" } },
        ],
      },
    },
    {
      id: "seed:static",
      name: "STATIC",
      seedBot: true,
      blurb: "A house bot. Watch it to learn it.",
      spec: {
        game: "chicken",
        rules: [{ if: true, then: { chance: [0.5, "STAY", "SWERVE"] } }],
      },
    },
  ],
  // Iterated Prisoner's Dilemma: exactly ONE house bot — a coin-flipper that
  // splits or steals at random. It runs as executable strategy code (like a
  // student's bot) so the tournament always has an opponent.
  pd: [
    {
      id: "seed:coin",
      name: "COIN",
      seedBot: true,
      blurb: "A house bot that flips a coin every round.",
      code: `return state.rng() < 0.5 ? "SPLIT" : "STEAL";`,
    },
  ],
};
