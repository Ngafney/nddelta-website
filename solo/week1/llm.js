/**
 * The strategy compiler, for solo play: the meeting's AI via /api/solo/compile, with an offline reader as the fallback.
 *
 * At the meeting, week1/server/llm.js sends your English to a language model
 * that writes the bot. A solo game runs in your browser with no key and no
 * server, so this file stands in for it: a rule reader that turns the common
 * ways people describe a plan into the same kind of code, plus the plain
 * read-back ("this is exactly what your bot will do").
 *
 * It follows the real compiler's two promises:
 *   • it is FAITHFUL: it codes what you said, never a better idea;
 *   • it REFUSES "just win" requests that name an outcome and no method.
 * And one of its own: anything it could not read is named in the read-back,
 * never silently guessed. You can also paste JavaScript (a function body that
 * returns a move / a portfolio) and it runs as written.
 */

import { preparePdCode } from "../../week1/shared/pdCode.js";
import { prepareIceCode } from "../../week1/shared/iceCode.js";

export function llmAvailable() {
  return true;
}

/**
 * The same AI the meeting uses, through nddelta.com's /api/solo/compile (the
 * key stays on the server). If that can't be reached (offline, rate-limited,
 * not configured), the built-in reader below takes over, and says so.
 */
export async function compile(game, prompt) {
  const text = String(prompt ?? "").slice(0, 2000);
  if (game !== "pd" && game !== "icecream") throw new Error(`unknown game: ${game}`);
  try {
    const res = await fetch("/api/solo/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week: 1, game, prompt: text }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && (data.code || data.refused)) return data;
    if (res.status === 502 && data?.error) throw Object.assign(new Error(data.error), { fromAi: true });
  } catch (e) {
    if (e?.fromAi) throw e; // the AI answered but couldn't make a valid bot: same message as the meeting
  }
  return game === "pd" ? compilePd(text) : compileIce(text);
}

const OFFLINE = "offline";

/* ── shared helpers ────────────────────────────────────────────────────── */

const WORDNUM = { a: 1, an: 1, one: 1, once: 1, single: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, few: 3, couple: 2 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, other: 2 };
const NUM = String.raw`(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|few|couple)`;

function toNum(s, dflt = null) {
  if (s == null) return dflt;
  s = String(s).trim().toLowerCase().replace(/,/g, "");
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s in WORDNUM) return WORDNUM[s];
  const o = s.replace(/(st|nd|rd|th)$/, "");
  if (/^\d+$/.test(o)) return Number(o);
  if (s in ORD) return ORD[s];
  return dflt;
}

const looksLikeCode = (t, v) => /\breturn\b/.test(t) && new RegExp(`\\b${v}\\.`).test(t) && /[;{}()=]/.test(t);

const OUTCOME_ONLY =
  /\b(win|winning|beat (everyone|everybody|them all|the others)|the best (strategy|bot|plan|move)|best possible|optimal|optimi[sz]e|maximi[sz]e|most (points|money|profit)|never (lose|go bankrupt)|no bankruptc|zero bankruptc|whatever (works|is best|wins)|make (me|it) (the )?(win|best))\b/;

/** Track which parts of the text a rule used, so the rest can be reported. */
class Reader {
  constructor(text) {
    this.raw = text;
    this.t = normalize(text);
    this.used = new Array(this.t.length).fill(false);
  }
  /** First match of re (global flag added), marking it used. Returns the match or null. */
  take(re) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = g.exec(this.t))) {
      if (m[0].length === 0) {
        g.lastIndex++;
        continue;
      }
      if (this.overlap(m.index, m[0].length) > 0.4) continue;
      this.mark(m.index, m[0].length);
      return m;
    }
    return null;
  }
  overlap(i, n) {
    let u = 0;
    for (let k = i; k < i + n; k++) if (this.used[k]) u++;
    return n ? u / n : 0;
  }
  /** Every match, all marked. */
  takeAll(re) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const out = [];
    let m;
    while ((m = g.exec(this.t))) {
      if (m[0].length === 0) {
        g.lastIndex++;
        continue;
      }
      if (this.overlap(m.index, m[0].length) > 0.4) continue;
      this.mark(m.index, m[0].length);
      out.push(m);
    }
    return out;
  }
  test(re) {
    return re.test(this.t);
  }
  mark(i, n) {
    for (let k = i; k < i + n && k < this.used.length; k++) this.used[k] = true;
  }
  /** Leftover phrases with real content words. */
  leftovers(stop) {
    let cur = "";
    const parts = [];
    for (let i = 0; i < this.t.length; i++) {
      if (this.used[i]) {
        if (cur) parts.push(cur), (cur = "");
      } else cur += this.t[i];
    }
    if (cur) parts.push(cur);
    return parts
      .map((p) => p.replace(/[^a-z0-9%°$_.\- ]+/g, " ").replace(/\s+/g, " ").trim())
      .filter((p) => p.split(" ").filter((w) => w.length > 2 && !stop.has(w)).length >= 2);
  }
}

function normalize(t) {
  return (
    " " +
    String(t)
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/–|—/g, "-")
      .replace(/co-?operat(e|es|ed|ing|ion)/g, "cooperat$1")
      .replace(/\bdon't\b/g, "do not")
      .replace(/\bdidn't\b/g, "did not")
      .replace(/\bdoesn't\b/g, "does not")
      .replace(/\bhaven't\b/g, "have not")
      .replace(/\bhasn't\b/g, "has not")
      .replace(/\bwon't\b/g, "will not")
      .replace(/\bisn't\b/g, "is not")
      .replace(/\bthey've\b/g, "they have")
      .replace(/\bi'm\b/g, "i am")
      .replace(/\s+/g, " ") +
    " "
  );
}

const STOP = new Set(
  "the and then that this with from they them their have has had will would should could just also every each round rounds match game when what whatever your mine bot opponent opponents always never only like make sure still else otherwise time times move moves play plays playing want wants going keep keeps start starting first last after before until unless which there here been being were into onto over under than more most less some any all for but not are was its it's i'm you you're our out about".split(
    " "
  )
);

const quote = (s) => `“${s.length > 70 ? s.slice(0, 67) + "…" : s}”`;

/* ══ PRISONER'S DILEMMA ═══════════════════════════════════════════════════ */

const COOPW = String.raw`(?:cooperat\w*|coop|be nice|play nice|nice|trust(?:ing)?|split|share|collaborat\w*)`;
const DEFW = String.raw`(?:defect\w*|betray\w*|steal\w*|cheat\w*|backstab\w*|rat(?: them)? out|snitch\w*|attack\w*|be mean|mean|punish\w*|retaliat\w*|stab\w*)`;
const MOVE = `(${COOPW}|${DEFW})`;
/** The move word nearest the end of a phrase ("cooperate, but defect on the last 5" → defect). */
const lastMove = (str) => {
  const all = [...str.matchAll(new RegExp(MOVE, "g"))];
  return all.length ? moveOf(all[all.length - 1][1]) : null;
};
const moveOf = (w) => (new RegExp(`^${COOPW}$`).test(w.trim()) ? "C" : "D");
const THEY = String.raw`(?:they|the opponent|opponent|the other (?:bot|team|side|player)|the other one|them)`;

export function compilePd(text) {
  if (!text || text.trim().length < 3) return { refused: true, reason: "Describe how your bot should play: when it cooperates and when it defects." };

  if (looksLikeCode(text, "state")) {
    const prep = preparePdCode(text);
    if (!prep.ok) throw httpish(`your code didn't run: ${prep.error}`);
    return { code: text, explain: "Your own JavaScript, run exactly as written.", summary: "Custom code", source: OFFLINE };
  }

  const R = new Reader(text);
  const plan = {
    end: null, // { n, move }
    opening: null, // { n, move }
    rounds: [], // { at (0-based), move }
    every: null, // { n, move }
    probe: null, // { at }
    exploitAfter: null, // round index from which a never-defected opponent gets defected on
    giveUp: null, // { after, rate } defect if their defect rate is at least rate
    core: null,
    forgive: null,
    sneak: null,
    punishN: null,
  };

  /* endgame: "defect on the last 3 rounds", "on the final round defect" */
  let m =
    R.take(new RegExp(String.raw`${MOVE}(?: (?:on|in|for|during|at))? (?:the |each |every )?(?:very )?(?:last|final) ${NUM}? ?(?:rounds?|turns?|moves?)(?: of (?:the|each|every) (?:match|game))?`)) ||
    R.take(new RegExp(String.raw`(?:on|in|for|during|at) (?:the )?(?:very )?(?:last|final) ${NUM}? ?(?:rounds?|turns?|moves?)(?: of (?:the|each|every) (?:match|game))?,? (?:i |we |it |just |always )?(?:will |should )?${MOVE}`));
  if (m) {
    const words = m.slice(1).filter(Boolean);
    const n = toNum(words.find((w) => toNum(w) != null && !new RegExp(`^${MOVE}$`).test(w)), 1);
    plan.end = { n: Math.max(1, Math.min(199, n)), move: lastMove(m[0]) ?? "D" };
  }

  /* opening: "start by cooperating", "defect on the first 5 rounds", "for the first ten rounds, cooperate" */
  m =
    R.take(new RegExp(String.raw`${MOVE}(?: (?:on|in|for|during))? (?:the )?first ${NUM}? ?(?:rounds?|turns?|moves?)`)) ||
    R.take(new RegExp(String.raw`(?:on|in|for|during) (?:the )?first ${NUM}? ?(?:rounds?|turns?|moves?),? (?:i |we |it |just |always )?(?:will |should )?${MOVE}`)) ||
    R.take(new RegExp(String.raw`(?:start|open|begin|lead)(?:s|ing)?(?: off| out)?(?: the match| each match| every match)?(?: by| with)? ${MOVE}`)) ||
    R.take(new RegExp(String.raw`first (?:move|round|turn)(?: is| should be|:)? ?${MOVE}`)) ||
    R.take(new RegExp(String.raw`${MOVE} (?:first|to start|to begin|at the start)\b`));
  if (m) {
    const words = m.slice(1).filter(Boolean);
    const n = toNum(words.find((w) => toNum(w) != null && !new RegExp(`^${MOVE}$`).test(w)), 1);
    plan.opening = { n: Math.max(1, Math.min(199, n)), move: lastMove(m[0]) };
  }

  /* probe: "defect once on round 5 as a test", "test them on round 3"; and what to do if they don't react */
  m =
    R.take(new RegExp(String.raw`(?:${DEFW}|test|probe|check)\w* (?:them |the opponent )?(?:once |one time )?(?:by defecting )?(?:on|in|at) (?:round|turn|move) (\d+)(?: as a (?:test|probe|check))?`)) ||
    R.take(new RegExp(String.raw`(?:${DEFW}) once (?:early|at the start)?\s?(?:as a|to) (?:test|probe|check|see)`));
  if (m && /test|probe|check|see|once/.test(m[0])) {
    const at = m[1] ? Math.max(1, toNum(m[1], 3)) - 1 : 2;
    plan.probe = { at: Math.min(150, at) };
  } else if (m) {
    // "defect on round 5" with no test wording: a fixed round
    plan.rounds.push({ at: Math.max(1, toNum(m[1], 1)) - 1, move: "D" });
  }
  // "if they never defect back / do not retaliate / are a pushover, defect for the rest"
  m =
    R.take(new RegExp(String.raw`if ${THEY} (?:have |has |did |do |does )?(?:not|never) (?:defect\w*|retaliat\w*|punish\w*|react\w*|fight\w*|respond\w*|hit)(?: back)?(?: at all)?[^.;]{0,30}?,? (?:then )?(?:i |we |it )?(?:will |should )?(?:keep |just )?(?:${DEFW}|exploit\w*|take advantage)(?:[^.;]{0,30}?(?:rest|forever|remaining|from then on|after that|every round))?`)) ||
    R.take(new RegExp(String.raw`if ${THEY} (?:have |has )?(?:always|only ever) cooperat\w*(?: so far)?(?: after (?:round|turn) (\d+))?,? (?:then )?(?:i |we |it )?(?:will |should )?(?:${DEFW}|exploit\w*|take advantage)[^.;]{0,30}`)) ||
    R.take(new RegExp(String.raw`(?:${DEFW}|exploit\w*) (?:against |on )?(?:anyone|bots?|opponents?|them)? ?(?:who|that|if they) (?:never defect\w*|always cooperat\w*|are pushovers?|do not fight back)`)) ||
    R.take(/exploit\w* (?:the )?(?:pushovers?|suckers?|nice (?:ones|bots))/);
  if (m) plan.exploitAfter = plan.probe ? plan.probe.at + 4 : m[1] ? toNum(m[1], 10) : 10;

  // "if they always defect / never cooperate, defect" — giving up on a defector
  m =
    R.take(new RegExp(String.raw`if ${THEY} (?:have |has )?(?:never cooperat\w*|always defect\w*|keep defecting|only defect\w*)(?: so far)?[^.;]{0,20}?,? (?:then )?(?:i |we |it )?(?:will |should )?(?:just )?(?:${DEFW})[^.;]{0,30}`)) ||
    R.take(new RegExp(String.raw`if ${THEY} (?:have )?defect\w* (?:more than|over|at least) (\d+) ?(?:%|percent)(?: of the (?:time|rounds))?[^.;]{0,25}?,? (?:then )?(?:i |we |it )?(?:will |should )?(?:just )?(?:${DEFW})[^.;]{0,30}`));
  if (m) plan.giveUp = { rate: m[1] ? Math.min(1, toNum(m[1], 50) / 100) : 1, after: plan.probe ? plan.probe.at + 4 : 5 };

  /* forgiveness: "forgive 10% of the time", "sometimes forgive" */
  m =
    R.take(/forgiv\w*(?: them| a defection| defections| it)?(?: about| roughly)? (\d+) ?(?:%|percent)(?: of the time)?/) ||
    R.take(/(\d+) ?(?:%|percent) (?:chance )?(?:of the time )?(?:to |i |we )?forgiv\w*/) ||
    R.take(/(?:sometimes|occasionally|now and then|once in a while|randomly) forgiv\w*|forgiv\w* (?:them )?(?:sometimes|occasionally|now and then|once in a while|randomly)|(?:a bit|a little|slightly) forgiving|generous/);
  if (m) plan.forgive = m[1] ? Math.min(1, toNum(m[1], 10) / 100) : 0.1;

  /* sneaky defections: "defect 10% of the time at random when they cooperate" */
  m = R.take(new RegExp(String.raw`(?:sneak\w* in|throw in|randomly|occasionally|sometimes)[^.;]{0,15}?${DEFW}[^.;]{0,30}?(\d+) ?(?:%|percent)|(?:${DEFW}) (?:at random |randomly )?(\d+) ?(?:%|percent) of the time (?:when|if|after) ${THEY} cooperat\w*`));
  if (m && (plan.core === null)) plan.sneak = Math.min(1, toNum(m[1] ?? m[2], 10) / 100);

  /* punish n: "defect twice after each defection", "punish each defection with 3 defections" */
  m =
    R.take(new RegExp(String.raw`(?:${DEFW})(?: back)? (?:${NUM} times?|(twice|thrice)|for ${NUM} rounds?) (?:after|for|when|whenever|if) (?:each|every|a|any|they) ?(?:time they )?defect\w*`)) ||
    R.take(new RegExp(String.raw`punish\w* (?:each|every|a) defection with ${NUM} defections?`));
  if (m) plan.punishN = Math.max(1, Math.min(20, toNum(m[1] ?? m[2] ?? m[3], 2)));

  /* every nth round */
  m =
    R.take(new RegExp(String.raw`${MOVE}[^.;]{0,15}?(?:on )?every (\d+(?:st|nd|rd|th)?|other|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) (?:round|turn|move)`)) ||
    R.take(new RegExp(String.raw`every (\d+(?:st|nd|rd|th)?|other|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) (?:round|turn|move),? (?:i |we |it )?(?:will |should )?${MOVE}`));
  if (m) {
    const ws = m.slice(1).filter(Boolean);
    const mv = ws.find((w) => new RegExp(`^${MOVE}$`).test(w));
    const nW = ws.find((w) => !new RegExp(`^${MOVE}$`).test(w));
    plan.every = { n: Math.max(2, toNum(nW, 2)), move: moveOf(mv) };
  }

  /* specific rounds: "defect on round 7 and round 20", "cooperate on rounds 3, 5" */
  for (const mm of R.takeAll(new RegExp(String.raw`${MOVE} (?:only )?(?:on|in|at) rounds? ((?:\d+(?:,? (?:and |or )?)?)+)`))) {
    const mv = moveOf(mm[1]);
    for (const n of mm[2].match(/\d+/g) ?? []) plan.rounds.push({ at: Math.max(1, Number(n)) - 1, move: mv });
  }

  /* even/odd rounds */
  m = R.take(new RegExp(String.raw`${MOVE}[^.;]{0,10}? on (even|odd)(?:-numbered)? rounds?(?:[^.;]{0,10}?(?:and|,) ${MOVE} on (?:the )?(even|odd)(?:-numbered)? (?:rounds?|ones))?`));
  if (m) {
    const firstMove = moveOf(m[1]);
    const parity = m[2]; // human counting: round 1 is odd
    plan.core = { kind: "parity", move: firstMove, parity };
  }

  /* ── the core ───────────────────────────────────────────────────────── */
  const core = (kind, extra = {}) => {
    if (!plan.core) plan.core = { kind, ...extra };
  };

  if (R.take(/tit[- ]?for[- ]?two[- ]?tats?|tf2t/) || R.take(new RegExp(String.raw`(?:only )?(?:${DEFW})\w*(?: back)? (?:only )?(?:if|when|after) ${THEY} (?:have )?defect\w* (?:twice|two times|two rounds) in a row|forgiv\w* (?:one|a single|the first|a) defection`))) core("tf2t");
  if (R.take(/pavlov|win[- ]?stay[,]? ?lose[- ]?(?:shift|switch)|win stay lose shift/)) core("pavlov");
  if (R.take(/\bgrim\b|grim trigger|never forgiv\w*|hold (?:a|the) grudge|grudger?/) ||
      R.take(new RegExp(String.raw`(?:${COOPW}) (?:until|as long as|till) ${THEY} (?:ever )?(?:defect\w*|have not defected|never defect\w*)[^.;]{0,40}?(?:then )?(?:${DEFW})?[^.;]{0,30}?(?:forever|rest of the (?:match|game)|from then on|every round after)?`)) ||
      R.take(new RegExp(String.raw`(?:if|once|after|when) ${THEY} (?:ever )?defect\w*(?: even)?(?: once)?,? (?:then )?(?:i |we |it )?(?:will |should )?(?:${DEFW})[^.;]{0,10}?(?:forever|for the rest of the (?:match|game)|for good|from then on|every round after)`))) core("grim");
  if (R.take(/majority|(?:what|whatever|whichever) (?:they|the opponent) (?:do|did|play|played|has done) (?:most|more)(?: often)?|(?:more|most) often/) ||
      R.take(new RegExp(String.raw`(?:${COOPW}) (?:as long as|if|while) ${THEY} (?:have )?cooperat\w* (?:at least as (?:often|much|many times)|more(?: often)?) (?:as|than) ${THEY} (?:have )?defect\w*`))) core("majority");
  if (R.take(/tit[- ]?for[- ]?tat|\btft\b|copy\w*(?: whatever| what)? (?:their|the opponent'?s?|they|them)|mirror\w*|imitat\w*|same (?:move )?as (?:they|them|their|the opponent)|(?:do|play|make) (?:what|whatever) (?:they|the opponent) (?:did|played|just did|do)|repeat (?:their|what they|the opponent)|reciprocat\w*|eye for an eye|match (?:their|what they)/)) core("tft");
  {
    // "if they cooperate, cooperate; if they defect, defect" (either order) → copy
    const pairs = [];
    for (const mm of R.takeAll(new RegExp(String.raw`if ${THEY} (?:just |last )?(?:have )?${MOVE}(?: last (?:round|time|turn))?,? (?:then )?(?:i |we |it )?(?:will |should )?(?:also )?${MOVE}(?: back| too| them)?`)))
      pairs.push([moveOf(mm[1]), moveOf(mm[2])]);
    for (const mm of R.takeAll(new RegExp(String.raw`${MOVE}(?: back| too)? (?:if|when|whenever|after) ${THEY} (?:just |last )?(?:have )?${MOVE}`)))
      pairs.push([moveOf(mm[2]), moveOf(mm[1])]);
    if (pairs.length) {
      const map = Object.fromEntries(pairs);
      if (map.D === "D" && map.C !== "D") core("tft");
      else if (map.D === "C" && map.C === "D") core("opposite");
      else if (map.D === "C" && (map.C ?? "C") === "C") core("always", { move: "C" });
      else if (map.C === "D" && (map.D ?? "D") === "D") core("always", { move: "D" });
    }
  }
  if (R.take(/opposite|contrarian|reverse of (?:what|their)/)) core("opposite");
  if (R.take(new RegExp(String.raw`alternat\w*(?: between ${MOVE} and ${MOVE})?(?:,? starting with ${MOVE})?|switch(?:ing)? (?:every|each) (?:round|turn)|take turns|flip[- ]?flop`))) core("alternate", { startsWith: R.test(new RegExp(String.raw`alternat\w* (?:starting|beginning) with ${DEFW}`)) ? "D" : "C" });
  m = R.take(new RegExp(String.raw`(?:${MOVE} )?(?:whenever |when |if |while )?(?:(?:my |your |our )?score is (?:behind|lower than|less than|below)|(?:i am |we are )?(?:behind|losing|trailing))(?: (?:the opponent'?s?|theirs|them|their score|the other (?:bot|team)'?s?))?(?: score)?(?:,? (?:otherwise|else|and)? ?${MOVE}(?: when (?:level|tied|ahead|winning)[^.;]{0,15})?)?`));
  if (m && /score|behind|losing|trailing/.test(m[0])) core("behind");
  m = R.take(new RegExp(String.raw`(?:random(?:ly)?|coin(?: flip| toss)?|flip a coin|50[ -/]?50|by chance|at random)(?:[^.;]{0,30}?(\d+) ?(?:%|percent))?`));
  if (m && !plan.core) {
    const pctM = R.take(new RegExp(String.raw`(\d+) ?(?:%|percent)(?: of the time| chance)?[^.;]{0,15}?${MOVE}|${MOVE}[^.;]{0,15}?(\d+) ?(?:%|percent)`));
    let pC = 0.5;
    const pct = m[1] ?? pctM?.[1] ?? pctM?.[4];
    const mv = pctM?.[2] ?? pctM?.[3];
    if (pct != null) pC = Math.min(1, toNum(pct, 50) / 100);
    if (mv && moveOf(mv) === "D") pC = 1 - pC;
    core("random", { pC });
  } else if (!plan.core) {
    const pctM = R.take(new RegExp(String.raw`(\d+) ?(?:%|percent) of the time,? ${MOVE}|${MOVE} (\d+) ?(?:%|percent) of the time`));
    if (pctM) {
      const pct = toNum(pctM[1] ?? pctM[4], 50) / 100;
      const mv = moveOf(pctM[2] ?? pctM[3]);
      core("random", { pC: mv === "C" ? pct : 1 - pct });
    }
  }
  m =
    R.take(new RegExp(String.raw`(?:always|only|just|every (?:single )?round|all the time|each round|the whole (?:time|match|game)|no matter what|unconditionally)[^.;]{0,12}?${MOVE}`)) ||
    R.take(new RegExp(String.raw`${MOVE}[^.;]{0,12}?(?:always|every (?:single )?round|all the time|each round|the whole (?:time|match|game)|no matter what|unconditionally|every time|forever)`)) ||
    R.take(new RegExp(String.raw`never ${MOVE}`));
  if (m && !plan.core) {
    const neg = /never/.test(m[0]);
    const mv = moveOf(m[1]);
    core("always", { move: neg ? (mv === "C" ? "D" : "C") : mv });
  } else if (m && plan.core) {
    // "always defect on the last round" etc. was already read; nothing to add.
  }
  const structured = plan.end || plan.opening || plan.rounds.length || plan.every || plan.probe || plan.exploitAfter != null || plan.giveUp;
  if (!plan.core && structured) {
    // "then cooperate for the rest", "otherwise defect", "cooperate the rest of the time"
    m =
      R.take(new RegExp(String.raw`(?:then|otherwise|else|after that|the rest of the (?:time|match|game)|for the rest(?: of the (?:match|game))?|from then on|rest of the time),? (?:i |we |it )?(?:will |should )?(?:just )?${MOVE}`)) ||
      R.take(new RegExp(String.raw`${MOVE}(?: for| on)? (?:the rest(?: of the (?:time|match|game|rounds))?|otherwise|after that|from then on|the remaining rounds|all other rounds)`));
    if (m) core("always", { move: moveOf(m[1]) });
  }
  if (!plan.core) {
    // A bare move word with nothing else ("cooperate"; "be nice").
    const only = R.take(new RegExp(String.raw`^\s*(?:just |i |we )?(?:will |want to |should )?${MOVE}\s*\.?\s*$`));
    if (only) core("always", { move: moveOf(only[1]) });
  }

  const found = plan.core || plan.end || plan.opening || plan.rounds.length || plan.every || plan.probe || plan.exploitAfter != null || plan.giveUp || plan.punishN;
  if (!found) {
    if (OUTCOME_ONLY.test(R.t))
      return { refused: true, reason: "Tell me HOW you want to play — when to cooperate and when to defect — and I'll code exactly that. I won't pick the strategy for you." };
    return {
      refused: true,
      reason:
        "I couldn't find a plan in that. Say when your bot cooperates and when it defects, e.g. “cooperate first, then copy their last move”, “defect on the last 5 rounds”, “if they defect twice in a row, defect”, or “cooperate 70% of the time at random”.",
    };
  }
  if (plan.punishN && (!plan.core || plan.core.kind === "always")) plan.core = { kind: "punish", n: plan.punishN };
  else if (plan.punishN && plan.core?.kind === "tft") plan.core = { kind: "punish", n: plan.punishN };

  const defaulted = !plan.core;
  if (!plan.core) plan.core = { kind: "always", move: plan.opening?.move === "D" && !plan.probe && plan.exploitAfter == null ? "C" : "C" };

  return buildPd(plan, defaulted, R.leftovers(STOP));
}

function httpish(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

const MV = { C: '"COOPERATE"', D: '"DEFECT"' };
const WORD = { C: "cooperates", D: "defects" };
const nth = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

function buildPd(plan, defaulted, unread) {
  const lines = [];
  const say = [];

  if (plan.end) {
    lines.push(`if (state.round >= state.rounds - ${plan.end.n}) return ${MV[plan.end.move]};`);
    say.push(`On the last ${plan.end.n === 1 ? "round" : `${plan.end.n} rounds`} of every match it ${WORD[plan.end.move]}, no matter what.`);
  }
  for (const r of plan.rounds) {
    lines.push(`if (state.round === ${r.at}) return ${MV[r.move]};`);
    say.push(`On the ${nth(r.at + 1)} round it ${WORD[r.move]}.`);
  }
  if (plan.every) {
    lines.push(`if ((state.round + 1) % ${plan.every.n} === 0) return ${MV[plan.every.move]};`);
    say.push(`On every ${plan.every.n === 2 ? "second" : nth(plan.every.n)} round it ${WORD[plan.every.move]}.`);
  }
  if (plan.opening) {
    lines.push(`if (state.round < ${plan.opening.n}) return ${MV[plan.opening.move]};`);
    say.push(plan.opening.n === 1 ? `On the first round it ${WORD[plan.opening.move]}.` : `On the first ${plan.opening.n} rounds it ${WORD[plan.opening.move]}.`);
  }
  if (plan.probe) {
    const a = plan.probe.at;
    if (!plan.opening || plan.opening.n <= a) {
      lines.push(`if (state.round < ${a}) return ${MV.C};`);
    }
    lines.push(`if (state.round === ${a}) return ${MV.D};`);
    lines.push(`if (state.round < ${a + 4}) return ${MV.C};`);
    say.push(`It cooperates up to round ${a + 1}, where it defects once as a test, then cooperates for three rounds.`);
  }
  if (plan.exploitAfter != null) {
    lines.push(`if (state.round >= ${plan.exploitAfter} && state.oppDefects === 0) return ${MV.D};`);
    say.push(`From round ${plan.exploitAfter + 1} on, if the opponent has never defected, it defects every round.`);
  }
  if (plan.giveUp) {
    if (plan.giveUp.rate >= 1) {
      lines.push(`if (state.round >= ${plan.giveUp.after} && state.oppCoops === 0) return ${MV.D};`);
      say.push(`From round ${plan.giveUp.after + 1} on, if the opponent has never cooperated, it defects.`);
    } else {
      lines.push(`if (state.round >= ${plan.giveUp.after} && state.oppDefects > ${plan.giveUp.rate} * state.round) return ${MV.D};`);
      say.push(`From round ${plan.giveUp.after + 1} on, if the opponent has defected on more than ${Math.round(plan.giveUp.rate * 100)}% of rounds, it defects.`);
    }
  }

  const c = plan.core;
  const firstC = !plan.opening && !plan.probe;
  const fg = plan.forgive;
  const sn = plan.sneak;
  const tail = [];
  switch (c.kind) {
    case "always":
      lines.push(`return ${MV[c.move]};`);
      say.push(defaulted ? `Every other round it ${WORD[c.move]} (you didn't say, so that's the default).` : `${say.length ? "Otherwise" : "Every round"} it ${WORD[c.move]}.`);
      break;
    case "tft":
      if (firstC) lines.push(`if (state.round === 0) return ${MV.C};`);
      if (fg) lines.push(`if (state.oppLast === ${MV.D} && state.rng() < ${fg}) return ${MV.C};`);
      if (sn) lines.push(`if (state.oppLast === ${MV.C} && state.rng() < ${sn}) return ${MV.D};`);
      lines.push(`return state.oppLast ?? ${MV.C};`);
      say.push(`${firstC ? "It cooperates on the first round, then" : "Otherwise it"} plays whatever the opponent played on the previous round${fg ? `, except that after a defection it still cooperates ${Math.round(fg * 100)}% of the time` : ""}${sn ? `, and after a cooperation it defects ${Math.round(sn * 100)}% of the time anyway` : ""}.`);
      break;
    case "tf2t":
      lines.push(`const last2 = state.oppMoves.slice(-2);`);
      lines.push(`if (last2.length === 2 && last2[0] === ${MV.D} && last2[1] === ${MV.D}) return ${MV.D};`);
      lines.push(`return ${MV.C};`);
      say.push(`${say.length ? "Otherwise it" : "It"} cooperates, unless the opponent defected on both of the previous two rounds; then it defects.`);
      break;
    case "grim":
      lines.push(`if (state.oppDefects > 0) return ${MV.D};`);
      lines.push(`return ${MV.C};`);
      say.push(`${say.length ? "Otherwise it" : "It"} cooperates until the opponent defects even once; after that it defects for the rest of the match.`);
      break;
    case "pavlov":
      if (firstC) lines.push(`if (state.round === 0) return ${MV.C};`);
      lines.push(`if (state.oppLast === ${MV.C}) return state.myLast ?? ${MV.C};`);
      lines.push(`return state.myLast === ${MV.C} ? ${MV.D} : ${MV.C};`);
      say.push(`${firstC ? "It cooperates on the first round. After that, " : "Otherwise, "}if the opponent cooperated last round it repeats its own last move; if they defected it switches to the other move.`);
      break;
    case "opposite":
      if (firstC) lines.push(`if (state.round === 0) return ${MV.C};`);
      lines.push(`return state.oppLast === ${MV.C} ? ${MV.D} : ${MV.C};`);
      say.push(`${firstC ? "It cooperates on the first round, then" : "Otherwise it"} plays the opposite of the opponent's last move.`);
      break;
    case "alternate":
      lines.push(`return state.round % 2 === 0 ? ${MV[c.startsWith]} : ${MV[c.startsWith === "C" ? "D" : "C"]};`);
      say.push(`${say.length ? "Otherwise it" : "It"} alternates: it ${WORD[c.startsWith]} on the 1st, 3rd, 5th… rounds and ${c.startsWith === "C" ? "defects" : "cooperates"} on the 2nd, 4th, 6th….`);
      break;
    case "parity": {
      // Rounds counted from 1, as people count: round 1 is odd.
      const other = c.move === "C" ? "D" : "C";
      lines.push(`return (state.round + 1) % 2 === ${c.parity === "even" ? 0 : 1} ? ${MV[c.move]} : ${MV[other]};`);
      say.push(`It ${WORD[c.move]} on ${c.parity}-numbered rounds (counting the first round as round 1) and ${WORD[other]} on the others.`);
      break;
    }
    case "majority":
      lines.push(`if (state.oppCoops >= state.oppDefects) return ${MV.C};`);
      lines.push(`return ${MV.D};`);
      say.push(`${say.length ? "Otherwise it" : "It"} cooperates while the opponent has cooperated at least as often as they have defected, and defects when they have defected more.`);
      break;
    case "behind":
      lines.push(`return state.myScore < state.oppScore ? ${MV.D} : ${MV.C};`);
      say.push(`${say.length ? "Otherwise it" : "It"} defects whenever its score is behind the opponent's, and cooperates when level or ahead.`);
      break;
    case "random":
      lines.push(`return state.rng() < ${Math.round(c.pC * 1000) / 1000} ? ${MV.C} : ${MV.D};`);
      say.push(`${say.length ? "Otherwise, each" : "Each"} round it cooperates with probability ${Math.round(c.pC * 100)}% and defects otherwise, ignoring what the opponent does.`);
      break;
    case "punish":
      lines.push(`const recent = state.oppMoves.slice(-${c.n});`);
      lines.push(`if (recent.includes(${MV.D})) return ${MV.D};`);
      lines.push(`return ${MV.C};`);
      say.push(`${say.length ? "Otherwise it" : "It"} cooperates, but answers each defection with ${c.n} rounds of defection (it defects if the opponent defected in any of the last ${c.n} rounds).`);
      break;
    default:
      lines.push(`return ${MV.C};`);
  }
  if (fg && c.kind !== "tft") tail.push(`(“Forgive” only applies to a copy-their-move plan, so it was not used here.)`);

  const code = lines.join("\n");
  const prep = preparePdCode(code);
  if (!prep.ok) throw httpish(`the built-in compiler made a bad bot (${prep.error}) — try rephrasing`);

  let explain = [...say, ...tail].join(" ");
  if (unread.length) explain += ` I couldn't use: ${unread.slice(0, 2).map(quote).join(", ")}.`;
  const summary = summarize(plan);
  return { code, explain, summary, source: OFFLINE };
}

function summarize(p) {
  const k = {
    always: p.core.move === "C" ? "Always cooperate" : "Always defect",
    tft: "Copy their last move",
    tf2t: "Defect after two defections",
    grim: "Never forgive",
    pavlov: "Win-stay, lose-shift",
    opposite: "Opposite of their move",
    alternate: "Alternate",
    parity: "Even/odd rounds",
    majority: "Follow their majority",
    behind: "Defect when behind",
    random: `Random ${Math.round((p.core.pC ?? 0.5) * 100)}% cooperate`,
    punish: `Punish ×${p.core.n}`,
  }[p.core.kind];
  const bits = [k];
  if (p.probe) bits.unshift("Probe");
  if (p.end) bits.push(`last ${p.end.n}`);
  return bits.join(", ").slice(0, 40);
}

/* ══ SUNSET SCOOPS ════════════════════════════════════════════════════════ */

const DIGIT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

export function compileIce(text) {
  if (!text || text.trim().length < 3) return { refused: true, reason: "Describe your hedge: which contracts, for which day, and how many." };

  if (looksLikeCode(text, "day")) {
    const prep = prepareIceCode(text);
    if (!prep.ok) throw httpish(`your code didn't run: ${prep.error}`);
    return { code: text, explain: "Your own JavaScript, run exactly as written.", summary: "Custom code", source: OFFLINE };
  }

  const t0 = normalize(text);
  if (/\b(do not|don't|no|never|zero) hedg\w*|hold nothing|no contracts|just run the shop/.test(t0) && !/under|below|rain|cold|over|above/.test(t0.replace(/no contracts/, ""))) {
    return { code: "return {};", explain: "Holds no contracts at all.", summary: "No hedge", source: OFFLINE };
  }

  // One leg per sentence-ish chunk that names a contract.
  const chunks = t0
    .split(/[.;\n]+|\b(?:and also|also|plus|in addition)\b|\band (?=(?:buy |hold |get )?\d[\d,]{2,})/)
    .map((s) => s.trim())
    .filter(Boolean);
  const legs = [];
  const unread = [];
  const notes = [];
  let sellNext = /\b(sell|close|dump|get out)\w*[^.;]{0,25}?(next day|after (?:a|one) day|the day after|right away|immediately|each day)|do not hold|don't hold/.test(t0);
  let sellDay = null;
  const sd = t0.match(/(?:sell|close)\w*[^.;]{0,20}?(\d+|one|two|three|four|five|six) days? (?:later|after|before)/);
  if (sd) sellDay = toNum(sd[1]);

  // Shared context: conditions/sizes said once, outside a contract sentence.
  for (const ch of chunks) {
    const leg = readLeg(ch, notes);
    if (leg) legs.push(leg);
    else if (ch.split(" ").filter((w) => w.length > 2 && !STOP.has(w)).length >= 3 && !/sell|hold|keep|settle/.test(ch)) unread.push(ch);
  }
  // A size or condition said in its own sentence applies to the one leg.
  if (legs.length === 1) {
    const L = legs[0];
    if (L.qty == null) {
      const q = findQty(t0);
      if (q) L.qty = q;
    }
    if (!L.cond) {
      const c = findCond(t0, L);
      if (c) L.cond = c;
    }
  }

  if (!legs.length) {
    if (OUTCOME_ONLY.test(t0))
      return { refused: true, reason: "Tell me your hedging rule — which contracts to hold and when — and I'll code exactly that. I can't pick the winning strategy for you." };
    return {
      refused: true,
      reason:
        "I couldn't find a contract in that. Name one and a day, e.g. “every day hold 1,500 under-70 contracts 6 days out until they settle”, or “if rain chance 4 days out is above 40%, hold 800 rain contracts for that day”.",
    };
  }
  for (const L of legs) {
    if (L.qty == null) {
      L.qty = { kind: "fixed", n: 1000 };
      notes.push(`You didn't say how many ${label(L.c)} contracts, so it holds 1,000.`);
    }
    if (L.offsets == null) {
      L.offsets = [5];
      notes.push(`You didn't say which day for ${label(L.c)}, so it buys 5 days out.`);
    }
  }
  return buildIce(legs, { sellNext, sellDay }, notes, unread);
}

const CONTRACT_RES = [
  [/(?:under|below|less than|colder than|cooler than|lower than|<)[ _-]?(65|70|75|80)(?:°|f| ?degrees?)?/, (m) => `under_${m[1]}`],
  [/(?:over|above|more than|warmer than|hotter than|at least|higher than|>)[ _-]?(65|70|75|80)(?:°|f| ?degrees?)?/, (m) => `over_${m[1]}`],
  [/rain[ _-]?no\b|no[ -]rain|dry[ -]day|rain_no/, () => "rain_no"],
  [/rain[ _-]?yes|rain contracts?|rainy[ -]day|on rain\b|rain_yes|(?:wet|rain) (?:days?|insurance|hedge)|for rain\b|that it rains|it will rain/, () => "rain_yes"],
  [/cold (?:days?|weather|contracts?|insurance|hedge)|\bcold\b/, () => "under_70"],
];

function readLeg(ch, notes) {
  // Which contract? (Skip numbers that are clearly a forecast condition: "forecast below 68".)
  let c = null;
  let cm = null;
  const cleaned = ch.replace(/(?:forecast|high|temp\w*|temperature)(?: high)?(?: is| was| looks| comes in)? (?:below|under|less than|above|over|more than) (\d+)/, (s) => " ".repeat(s.length));
  for (const [re, f] of CONTRACT_RES) {
    const m = cleaned.match(re);
    if (m) {
      c = f(m);
      cm = m;
      break;
    }
  }
  if (!c) return null;
  if (cm && /\bcold\b/.test(cm[0]) && !/\d/.test(cm[0])) notes.push(`“Cold” was read as the under-70° contract.`);

  const L = { c, offsets: findOffsets(ch), qty: findQty(ch), cond: null };
  L.cond = findCond(ch, L);
  return L;
}

function findOffsets(s) {
  let m = s.match(/(?:from |between |for )?(\d|one|two|three|four|five|six|seven) (?:to|through|-|and) (\d|one|two|three|four|five|six|seven) days? (?:out|ahead|away|from now|in advance)/);
  if (m) {
    const a = Math.max(0, Math.min(7, toNum(m[1]) ?? DIGIT_WORDS[m[1]]));
    const b = Math.max(0, Math.min(7, toNum(m[2]) ?? DIGIT_WORDS[m[2]]));
    const out = [];
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) out.push(k);
    return out;
  }
  if (/(?:every|each|all) (?:day|one) of the (?:next )?(?:week|7 days|seven days)|all (?:7|seven|eight|8) days|the whole week|each of the next (?:7|seven) days/.test(s)) return [1, 2, 3, 4, 5, 6, 7];
  m = s.match(/(\d+|one|two|three|four|five|six|seven) days? (?:out|ahead|away|from now|in advance|before|early|early)|@(\d)|offset (\d)|(?:in|for) (\d+|one|two|three|four|five|six|seven) days(?:' time)?/);
  if (m) {
    const k = toNum(m[1] ?? m[2] ?? m[3] ?? m[4]);
    return [Math.max(0, Math.min(7, k ?? 5))];
  }
  if (/(?:a|one|1) week (?:out|ahead|away|from now|in advance)|a week before|furthest|farthest|as far (?:out|ahead) as (?:possible|you can)|longest|max(?:imum)? (?:lead|horizon)/.test(s)) return [7];
  if (/\btomorrow\b|next day|day ahead|day before/.test(s)) return [1];
  if (/\btoday\b|same day|tonight/.test(s)) return [0];
  return null;
}

function findQty(s0) {
  // Contract names and day counts carry numbers too ("under-70", "7 days"); hide them first.
  const s = s0
    .replace(/(?:under|below|less than|colder than|cooler than|lower than|over|above|more than|warmer than|hotter than|at least|higher than)[ _-]?(?:65|70|75|80)(?:°|f| ?degrees?)?(?! (?:contracts? )?(?:for each|per|every|a) degree)/g, " ctr ")
    .replace(/\b\d+ (?:to|through|-|and) \d+ days?/g, " ")
    .replace(/\b\d+ days?\b/g, " ")
    .replace(/@\d/g, " ");
  // "N per degree below T"
  let m = s0.match(/(\d[\d,]*) (?:contracts? )?(?:for each|per|every|a) degree (?:the forecast is )?(?:below|under) (\d+)/);
  if (m) return { kind: "perDegree", n: toNum(m[1]), T: toNum(m[2]) };
  // "sized to the rain chance", "N times the rain probability"
  m = s.match(/(\d[\d,]*)?(?: contracts)?[^.;]{0,20}?(?:times|scaled by|sized to|in proportion to|proportional to|× ?)(?: the)? (?:rain (?:chance|probability|odds)|chance of rain)/);
  if (m) return { kind: "rainScaled", n: m[1] ? toNum(m[1]) : 2000 };
  // "double when reserves are below $1000"
  const res = s.match(/(?:double|twice as many|(\d[\d,]*)(?: contracts)?) (?:when|if) (?:my |our |the )?(?:reserves|cash)(?: are| is)? (?:below|under|less than) \$?(\d[\d,]*)/);
  // Plain count: a number followed by contracts/of them, or "hold/buy N".
  m =
    s.match(/(\d[\d,]*) (?:of (?:the |those |them)?)?(?:[a-z_ -]{0,25}?)(?:contracts?|ctr)/) ||
    s.match(/(?:hold|buy|own|keep|get|purchase|go long) (\d[\d,]*)(?!\s*(?:days?|°|degrees|%|percent))/) ||
    s.match(/(\d[\d,]*) (?:under|over|rain|cold)/);
  if (m) {
    const n = toNum(m[1]);
    if (n != null && n > 7 && n <= 100000) {
      if (res) {
        const big = res[1] ? toNum(res[1]) : n * 2;
        return { kind: "reserves", n, big, below: toNum(res[2]) };
      }
      return { kind: "fixed", n };
    }
  }
  return null;
}

function findCond(s, L) {
  let m = s.match(/(?:if|when|whenever|only when|only if)[^.;]{0,40}?(?:forecast|high|temp\w*|temperature)[^.;]{0,25}?(below|under|less than|colder than|above|over|more than|warmer than|hotter than) (\d+)/);
  if (m) {
    const below = /below|under|less|colder/.test(m[1]);
    return { kind: "temp", below, T: toNum(m[2]) };
  }
  m = s.match(/(?:if|when|whenever|only when|only if)[^.;]{0,40}?(?:rain (?:chance|probability|odds)|chance of rain|rain looks likely|likely to rain)(?:[^.;]{0,15}?(above|over|more than|at least|below|under|less than) (\d+) ?(?:%|percent)?)?/);
  if (m) {
    const below = m[1] ? /below|under|less/.test(m[1]) : false;
    const p = m[2] ? toNum(m[2]) / 100 : 0.4;
    return { kind: "rain", below, p, guessed: !m[2] };
  }
  m = s.match(/(?:if|when|whenever|only when|only if)[^.;]{0,20}?(?:reserves|cash)(?: are| is)? (?:below|under|less than) \$?(\d[\d,]*)/);
  if (m) return { kind: "reserves", below: toNum(m[1]) };
  m = s.match(/(?:if|when|whenever|only when|only if)[^.;]{0,20}?(?:bill|billing)[^.;]{0,15}?(?:within|in less than|less than|in) (\d+) days?/);
  if (m) return { kind: "bill", within: toNum(m[1]) };
  return null;
}

function label(c) {
  if (c === "rain_yes") return "rain";
  if (c === "rain_no") return "no-rain";
  const [side, n] = c.split("_");
  return `${side} ${n}°`;
}

function buildIce(legs, { sellNext, sellDay }, notes, unread) {
  const keep = sellNext ? [] : [...new Set(legs.map((l) => l.c))];
  const lines = ["const o = {};"];
  const say = [];
  if (keep.length) {
    if (sellDay) {
      lines.push(`const keep = ${JSON.stringify(keep)};`);
      lines.push(`day.positions.forEach((p) => { if (keep.includes(p.contract) && p.offset > ${Math.max(0, Math.min(...legs.flatMap((l) => l.offsets)) - sellDay)}) o[p.contract + "@" + p.offset] = p.qty; });`);
    } else {
      lines.push(`const keep = ${JSON.stringify(keep)};`);
      lines.push(`day.positions.forEach((p) => { if (keep.includes(p.contract)) o[p.contract + "@" + p.offset] = p.qty; });`);
    }
  }
  for (const L of legs) {
    const ks = JSON.stringify(L.offsets);
    const cond = condCode(L.cond);
    const qty = qtyCode(L.qty);
    lines.push(`${ks}.forEach((k) => { const m = day.markets[k]; if (!m) return; ${cond ? `if (!(${cond})) return; ` : ""}const q = ${qty}; if (q !== 0) o["${L.c}@" + k] = q; });`);
    say.push(`Every day, ${condSay(L.cond)}holds ${qtySay(L.qty, label(L.c))} ${daysSay(L.offsets)}.`);
  }
  lines.push("return o;");
  if (sellNext) say.push("It does not carry anything: whatever it bought yesterday is sold today unless it buys it again.");
  else if (sellDay) say.push(`It sells each contract ${sellDay} day${sellDay > 1 ? "s" : ""} after buying it.`);
  else say.push("It keeps every contract it buys until that day settles.");

  const code = lines.join("\n");
  const prep = prepareIceCode(code);
  if (!prep.ok) throw httpish(`the built-in compiler made a bad bot (${prep.error}) — try rephrasing`);
  let explain = [...say, ...notes].join(" ");
  if (unread.length) explain += ` I couldn't use: ${unread.slice(0, 2).map(quote).join(", ")}.`;
  const summary = legs.map((l) => `${label(l.c)} ${l.offsets.length > 1 ? `@${l.offsets[0]}-${l.offsets[l.offsets.length - 1]}` : `@${l.offsets[0]}`}`).join(" + ").slice(0, 40);
  return { code, explain, summary, source: OFFLINE };
}

function condCode(c) {
  if (!c) return null;
  if (c.kind === "temp") return `m.tempMean ${c.below ? "<" : ">"} ${c.T}`;
  if (c.kind === "rain") return `m.pRain ${c.below ? "<" : ">"} ${c.p}`;
  if (c.kind === "reserves") return `day.reserves < ${c.below}`;
  if (c.kind === "bill") return `day.daysUntilBill <= ${c.within}`;
  return null;
}
function condSay(c) {
  if (!c) return "";
  if (c.kind === "temp") return `if that day's forecast high is ${c.below ? "below" : "above"} ${c.T}°, `;
  if (c.kind === "rain") return `if that day's rain chance is ${c.below ? "below" : "above"} ${Math.round(c.p * 100)}%${c.guessed ? " (you didn't give a number, so “likely” means above 40%)" : ""}, `;
  if (c.kind === "reserves") return `while reserves are below $${c.below.toLocaleString()}, `;
  if (c.kind === "bill") return `when the bill is due within ${c.within} days, `;
  return "";
}
function qtyCode(q) {
  if (q.kind === "fixed") return String(q.n);
  if (q.kind === "perDegree") return `Math.max(0, Math.round(${q.n} * (${q.T} - m.tempMean)))`;
  if (q.kind === "rainScaled") return `Math.round(${q.n} * m.pRain)`;
  if (q.kind === "reserves") return `day.reserves < ${q.below} ? ${q.big} : ${q.n}`;
  return "0";
}
function qtySay(q, lab) {
  const c = `“${lab}” contracts`;
  if (q.kind === "fixed") return `${q.n.toLocaleString()} ${c}`;
  if (q.kind === "perDegree") return `${q.n.toLocaleString()} ${c} for every degree that day's forecast high is below ${q.T}°`;
  if (q.kind === "rainScaled") return `${c}, ${q.n.toLocaleString()} × that day's rain chance of them,`;
  if (q.kind === "reserves") return `${q.n.toLocaleString()} ${c} (${q.big.toLocaleString()} while reserves are below $${q.below.toLocaleString()})`;
  return "0";
}
function daysSay(ks) {
  const one = (k) => (k === 0 ? "for today" : k === 1 ? "for tomorrow" : k === 7 ? "for the day a week out" : `for the day ${k} days out`);
  if (ks.length === 1) return one(ks[0]);
  return `for each day ${ks[0]} to ${ks[ks.length - 1]} days out`;
}
