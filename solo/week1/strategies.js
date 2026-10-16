/**
 * What the bot teams type, and the code their compiler hands back.
 *
 * Each entry is a plan a student at the meeting actually might write: the
 * English is what the team "typed", the code is what the strategy compiler
 * produced for it, and `explain` is the read-back. Bots save and submit these
 * through the same routes a student uses (POST strategy, POST submit,
 * POST ice/run). Nothing here is shown to the player; they only ever see the
 * standings, their own results, and replays of their own matches.
 *
 * The prisoner's-dilemma field is modelled on the real Week 1 meeting
 * (week1/sim/field.mjs): a bloc of committed defectors, a bloc of
 * reciprocators, a handful of pushovers who cooperate whatever happens, and
 * some coin-flippers. That mix is what makes "read your opponent" pay.
 *
 * NOTE: the sandbox rejects the words for / while / do / function anywhere in
 * the code, comments included.
 */

const C = '"COOPERATE"';
const D = '"DEFECT"';

/* ── prisoner's dilemma ────────────────────────────────────────────────── */

export const PD = {
  allC: {
    name: "Nice Guys",
    prompt: "always cooperate, every single round",
    explain: "Cooperates on every round, whatever the opponent does.",
    summary: "Always cooperate",
    code: `return ${C};`,
  },
  allD: {
    name: "No Mercy",
    prompt: "defect every round",
    explain: "Defects on every round, whatever the opponent does.",
    summary: "Always defect",
    code: `return ${D};`,
  },
  random: (p) => ({
    name: p >= 0.6 ? "Mostly Nice" : p <= 0.4 ? "Chaos" : "Coin Toss",
    prompt: `cooperate ${Math.round(p * 100)}% of the time at random, otherwise defect`,
    explain: `Each round, cooperates with probability ${Math.round(p * 100)}% and defects otherwise, ignoring what the opponent does.`,
    summary: `Random ${Math.round(p * 100)}% cooperate`,
    code: `return state.rng() < ${p} ? ${C} : ${D};`,
  }),
  tft: {
    name: "Copycat",
    prompt: "cooperate on the first round, then copy whatever they did last round",
    explain: "Cooperates on the first round, then plays whatever the opponent played on the previous round.",
    summary: "Copy their last move",
    code: `if (state.round === 0) return ${C};\nreturn state.oppLast;`,
  },
  stft: {
    name: "Trust Issues",
    prompt: "defect on the first round to be safe, then copy their last move",
    explain: "Defects on the first round, then plays whatever the opponent played on the previous round.",
    summary: "Defect first, then copy",
    code: `if (state.round === 0) return ${D};\nreturn state.oppLast;`,
  },
  tf2t: {
    name: "Second Chance",
    prompt: "cooperate unless they defected on both of the last two rounds",
    explain: "Cooperates, except when the opponent defected on both of the previous two rounds; then defects.",
    summary: "Defect after two defections",
    code: `const l = state.oppMoves.slice(-2);\nif (l.length === 2 && l[0] === ${D} && l[1] === ${D}) return ${D};\nreturn ${C};`,
  },
  gtft: (f) => ({
    name: "Forgiver",
    prompt: `copy their last move, but when they defect forgive them ${Math.round(f * 100)}% of the time`,
    explain: `Cooperates on the first round. After that copies the opponent's last move, except that after a defection it still cooperates ${Math.round(f * 100)}% of the time.`,
    summary: "Copy, sometimes forgive",
    code: `if (state.round === 0) return ${C};\nif (state.oppLast === ${D} && state.rng() < ${f}) return ${C};\nreturn state.oppLast;`,
  }),
  grim: {
    name: "Elephant",
    prompt: "cooperate until they defect once, then defect for the rest of the match",
    explain: "Cooperates until the opponent defects even once; from then on defects every round of the match.",
    summary: "Never forgive",
    code: `if (state.oppDefects > 0) return ${D};\nreturn ${C};`,
  },
  pavlov: {
    name: "Pavlov",
    prompt: "win-stay lose-shift: if they cooperated last round keep my move, if they defected switch",
    explain: "Cooperates on the first round. Then, if the opponent cooperated last round it repeats its own last move; if they defected it switches to the other move.",
    summary: "Win-stay, lose-shift",
    code: `if (state.round === 0) return ${C};\nif (state.oppLast === ${C}) return state.myLast;\nreturn state.myLast === ${C} ? ${D} : ${C};`,
  },
  alternate: {
    name: "Zig Zag",
    prompt: "alternate: cooperate on odd rounds and defect on even rounds",
    explain: "Cooperates on the 1st, 3rd, 5th… rounds and defects on the 2nd, 4th, 6th… rounds.",
    summary: "Alternate",
    code: `return state.round % 2 === 0 ? ${C} : ${D};`,
  },
  every3: {
    name: "Three Step",
    prompt: "cooperate, but defect on every third round",
    explain: "Defects on every third round (the 3rd, 6th, 9th…) and cooperates on the rest.",
    summary: "Defect every third round",
    code: `return (state.round + 1) % 3 === 0 ? ${D} : ${C};`,
  },
  majority: {
    name: "Democracy",
    prompt: "cooperate as long as they have cooperated at least as often as they defected",
    explain: "Cooperates while the opponent's cooperations so far are at least as many as their defections; otherwise defects.",
    summary: "Follow their majority",
    code: `if (state.oppCoops >= state.oppDefects) return ${C};\nreturn ${D};`,
  },
  hardRecip: {
    name: "Prove It",
    prompt: "defect unless they cooperated on both of the last two rounds",
    explain: "Defects, except when the opponent cooperated on both of the previous two rounds; then cooperates.",
    summary: "Cooperate after two cooperations",
    code: `const l = state.oppMoves.slice(-2);\nif (l.length === 2 && l[0] === ${C} && l[1] === ${C}) return ${C};\nreturn ${D};`,
  },
  behind: {
    name: "Sore Loser",
    prompt: "defect whenever my score is behind theirs, otherwise cooperate",
    explain: "Defects whenever its score is lower than the opponent's; otherwise cooperates.",
    summary: "Defect when behind",
    code: `return state.myScore < state.oppScore ? ${D} : ${C};`,
  },
  joss: {
    name: "Sneaky",
    prompt: "copy their last move, but sneak in a defection 10% of the time when they cooperated",
    explain: "Cooperates on the first round, then copies the opponent's last move, except that after they cooperate it defects 10% of the time anyway.",
    summary: "Copy, with sneaky defections",
    code: `if (state.round === 0) return ${C};\nif (state.oppLast === ${C} && state.rng() < 0.1) return ${D};\nreturn state.oppLast;`,
  },
  bully: {
    name: "Bully",
    prompt: "defect for the first three rounds, then if they never defected keep defecting, otherwise copy them",
    explain: "Defects on the first three rounds. After that: if the opponent has never defected it keeps defecting; otherwise copies their last move.",
    summary: "Push first, copy if they push back",
    code: `if (state.round < 3) return ${D};\nif (state.oppDefects === 0) return ${D};\nreturn state.oppLast;`,
  },
  tftEnd: (n) => ({
    name: "Closer",
    prompt: `copy their last move (cooperate first), and defect on the last ${n} rounds`,
    explain: `Defects on the last ${n} rounds of the match. Before that, cooperates on the first round and then copies the opponent's last move.`,
    summary: `Copy, defect last ${n}`,
    code: `if (state.round >= state.rounds - ${n}) return ${D};\nif (state.round === 0) return ${C};\nreturn state.oppLast;`,
  }),
  gtftEnd: (f, n) => ({
    name: "Late Knife",
    prompt: `copy their last move but forgive ${Math.round(f * 100)}% of defections, and defect on the final ${n} rounds`,
    explain: `Defects on the final ${n} rounds. Before that, cooperates first, then copies the opponent's last move, forgiving a defection ${Math.round(f * 100)}% of the time.`,
    summary: "Forgiving copy, late defection",
    code: `if (state.round >= state.rounds - ${n}) return ${D};\nif (state.round === 0) return ${C};\nif (state.oppLast === ${D} && state.rng() < ${f}) return ${C};\nreturn state.oppLast;`,
  }),
  /** The reader: one test defection tells a pushover from a reciprocator. */
  probe: (at, end) => ({
    name: "Detective",
    prompt: `cooperate, but defect once on round ${at + 1} as a test. If they never defect back, defect for the rest of the match. If they never cooperate, defect too. Otherwise copy their last move${end ? `, and defect on the last ${end} rounds` : ""}.`,
    explain: `Cooperates, except one test defection on round ${at + 1}. From round ${at + 5} on: if the opponent has never defected it defects every round; if they have never cooperated it defects; otherwise copies their last move.${end ? ` Defects on the last ${end} rounds regardless.` : ""}`,
    summary: end ? "Probe, sort, late defection" : "Probe then sort",
    code:
      (end ? `if (state.round >= state.rounds - ${end}) return ${D};\n` : "") +
      `if (state.round < ${at}) return ${C};\nif (state.round === ${at}) return ${D};\nif (state.round < ${at + 4}) return ${C};\nif (state.oppDefects === 0) return ${D};\nif (state.oppCoops === 0) return ${D};\nreturn state.oppLast;`,
  }),
  /** The reader, forgiving: partners with noisy reciprocators instead of feuding. */
  probeSoft: (at, end, f) => ({
    name: "Profiler",
    prompt: `test them with one defection on round ${at + 1}. If they don't punish it, defect from then on. If they never cooperate, defect. Otherwise copy them but forgive ${Math.round(f * 100)}% of defections, and defect on the last ${end} rounds.`,
    explain: `Cooperates except a test defection on round ${at + 1}. From round ${at + 5}: defects every round if the opponent has never defected, or has never cooperated. Otherwise copies their last move, forgiving a defection ${Math.round(f * 100)}% of the time. Defects on the last ${end} rounds.`,
    summary: "Probe, sort, forgive",
    code:
      `if (state.round >= state.rounds - ${end}) return ${D};\nif (state.round < ${at}) return ${C};\nif (state.round === ${at}) return ${D};\nif (state.round < ${at + 4}) return ${C};\nif (state.oppDefects === 0) return ${D};\nif (state.oppCoops === 0) return ${D};\nif (state.oppLast === ${D} && state.rng() < ${f}) return ${C};\nreturn state.oppLast;`,
  }),
};

/* ── Sunset Scoops ─────────────────────────────────────────────────────── */

/** Hold `q` of a contract `k` days out, every day, and keep each one until it settles. */
function holdLegs(legs, { cond } = {}) {
  const keep = [...new Set(legs.map((l) => l.c))];
  const lines = [
    "const o = {};",
    `const keep = ${JSON.stringify(keep)};`,
    'day.positions.forEach((p) => { if (keep.includes(p.contract)) o[p.contract + "@" + p.offset] = p.qty; });',
  ];
  for (const l of legs) {
    if (cond && l.c.startsWith("under")) lines.push(`if (day.markets[${l.k}] && day.markets[${l.k}].tempMean < ${cond}) o["${l.c}@${l.k}"] = ${l.q};`);
    else lines.push(`if (day.markets[${l.k}]) o["${l.c}@${l.k}"] = ${l.q};`);
  }
  lines.push("return o;");
  return lines.join("\n");
}

const label = (c) => c.replace("under_", "under ").replace("over_", "over ").replace("rain_yes", "rain").replace("rain_no", "no rain") + (c.startsWith("rain") ? "" : "°");
const daysOut = (k) => (k === 1 ? "tomorrow" : k === 7 ? "a week out" : `${k} days out`);

function ice(legs, opts = {}) {
  const parts = legs.map((l) => `${l.q.toLocaleString()} "${label(l.c)}" contracts ${daysOut(l.k)}`);
  const condTxt = opts.cond ? ` when that day's forecast high is below ${opts.cond}°` : "";
  return {
    prompt: `every day buy ${parts.join(" and ")}${condTxt}, and hold them until they settle`,
    explain: `Every day, buys ${parts.join(" plus ")}${condTxt}, and keeps each contract until its day settles.`,
    summary: legs.map((l) => `${label(l.c)} @${l.k}`).join(" + "),
    code: holdLegs(legs, opts),
  };
}

/**
 * Hedges from worst to best, with the bankruptcies each one scores over the
 * ten years (measured; deterministic). The best simple plan we found is about
 * 9, so the board always leaves the player room to beat the room.
 */
export const ICE = {
  none: { prompt: "don't hedge, just run the shop", explain: "Holds no contracts at all.", summary: "No hedge", code: "return {};", score: 58 },
  sunny: { ...ice([{ c: "over_70", k: 5, q: 2000 }]), score: 70 },
  tomorrow: { ...ice([{ c: "under_70", k: 1, q: 2000 }]), score: 48 },
  near: { ...ice([{ c: "under_70", k: 3, q: 2000 }]), score: 30 },
  big75: { ...ice([{ c: "under_75", k: 5, q: 3000 }]), score: 23 },
  mid: { ...ice([{ c: "under_70", k: 5, q: 2000 }]), score: 20 },
  week75: { ...ice([{ c: "under_75", k: 7, q: 2000 }]), score: 18 },
  week70: { ...ice([{ c: "under_70", k: 7, q: 2000 }]), score: 15 },
  weekCond: { ...ice([{ c: "under_70", k: 7, q: 2000 }], { cond: 80 }), score: 14 },
  coldRain: { ...ice([{ c: "under_70", k: 7, q: 2000 }, { c: "rain_yes", k: 7, q: 300 }]), score: 11 },
};

/** Which hedges a bot of each skill tries, in the order it tries them. */
export const ICE_LADDERS = {
  casual: [
    ["none", "tomorrow"],
    ["sunny", "near"],
    ["tomorrow", "near", "big75"],
    ["none"],
    ["near", "mid"],
  ],
  sharp: [
    ["near", "mid", "week75"],
    ["big75", "mid"],
    ["mid", "week70"],
    ["tomorrow", "big75", "week75"],
  ],
  shark: [
    ["mid", "week70", "weekCond"],
    ["week75", "week70", "coldRain"],
    ["week70", "weekCond"],
  ],
};
