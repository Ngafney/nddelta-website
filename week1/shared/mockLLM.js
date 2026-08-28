/**
 * The offline strategy compiler.
 *
 * When no ANTHROPIC_API_KEY is set, this deterministic parser stands in
 * for the model so the entire flow — type English, compile, verify, run —
 * works end to end today. It handles the common phrasings; anything it
 * can't read produces a sensible default WITH A VISIBLE NOTE, never a
 * silent guess presented as understanding.
 */

export function mockCompile(game, prompt) {
  const p = prompt.toLowerCase();
  return game === "bandit" ? compileBandit(p) : compileMatrix(game, p);
}

function num(re, p, fallback) {
  const m = p.match(re);
  return m ? parseFloat(m[1]) : fallback;
}

/* ── bandit ───────────────────────────────────────────────────────────── */

function compileBandit(p) {
  const rules = [];
  let note = null;

  if (/epsilon|ε|\d+\s*%\s*(of the time|random|explore)/.test(p)) {
    let eps = num(/epsilon[^\d]*([\d.]+)/, p, null);
    if (eps === null) eps = num(/(\d+)\s*%/, p, 10) / 100;
    if (eps > 1) eps = eps / 100;
    rules.push({ if: true, then: { play: { epsilonGreedy: eps } } });
  } else if (/ucb|upper confidence/.test(p)) {
    const c = num(/(?:ucb|constant)[^\d]*([\d.]+)/, p, 2);
    rules.push({ if: true, then: { play: { ucb: c } } });
  } else if (/thompson|sampling|bayes/.test(p)) {
    rules.push({ if: true, then: { play: "thompson" } });
  } else if (/always.*machine\s*(\d)/.test(p) || /only.*machine\s*(\d)/.test(p)) {
    const m = parseInt(p.match(/machine\s*(\d)/)[1], 10);
    rules.push({ if: true, then: { play: { fixed: Math.min(Math.max(m - 1, 0), 4) } } });
  } else if (/random/.test(p) && !/then|after/.test(p)) {
    rules.push({ if: true, then: { play: "random" } });
  } else if (/(try|play|test|sample|explore).*(each|every|all).*(once|twice|machine|time)/.test(p) || /explore.*then|then.*(best|highest|exploit)|first \d+/.test(p)) {
    // "try every machine N times, then play the best" — the classic. Read an
    // explicit exploration budget in EITHER form: "N times [each]" (per
    // machine, ×5) or "N pulls/spins exploring / first N" (total).
    let exploreSpins;
    const perMachine = p.match(/(\d+)\s*times|(\d+)\s*(?:pulls?|spins?)\s*(?:each|per)|twice/);
    const totalExplore = p.match(/(\d+)\s*(?:pulls?|spins?)(?!\s*each)|spend (\d+)|first (\d+)|explore (?:for )?(\d+)/);
    if (/twice/.test(p)) exploreSpins = 10;
    else if (perMachine) exploreSpins = Math.min(parseInt(perMachine[1] || perMachine[2], 10) * 5, 45);
    else if (totalExplore) exploreSpins = Math.min(parseInt(totalExplore[1] || totalExplore[2] || totalExplore[3] || totalExplore[4], 10), 45);
    else exploreSpins = 5;
    rules.push(
      { if: { lt: ["spinsUsed", exploreSpins] }, then: { play: "leastPlayed" } },
      { if: true, then: { play: "highestMean" } }
    );
  } else if (/best|highest|greedy|max/.test(p)) {
    rules.push({ if: true, then: { play: "highestMean" } });
  } else {
    note =
      "Couldn't read that — compiled the classic explore-then-exploit instead. Talk about machines, pulls, and averages (e.g. \"try each machine twice, then play the best average\"), or edit the code directly.";
    rules.push(
      { if: { lt: ["spinsUsed", 5] }, then: { play: "leastPlayed" } },
      { if: true, then: { play: "highestMean" } }
    );
  }
  return { spec: { game: "bandit", rules }, note };
}

/* ── chicken / split-or-steal ─────────────────────────────────────────── */

function compileMatrix(game, p) {
  const [AGG, COOP] = game === "chicken" ? ["STAY", "SWERVE"] : ["STEAL", "SPLIT"];
  const other = (m) => (m === AGG ? COOP : AGG);

  // Word → move. Synonyms matter: students say "cooperate/defect/betray/nice",
  // not just the literal move words. Order: cooperative first, then aggressive.
  const COOP_WORDS = game === "chicken"
    ? ["swerve", "chicken", "yield", "back down", "back off", "dodge", "veer", "avoid", "coward", "safe"]
    : ["split", "share", "cooperate", "coop", "trust", "fair", "nice", "honest", "kind", "give"];
  const AGG_WORDS = game === "chicken"
    ? ["stay", "hold", "straight", "nerve", "brave", "tough", "don't swerve", "dont swerve", "never swerve", "commit"]
    : ["steal", "defect", "betray", "greedy", "grab", "cheat", "take it all", "take all", "screw", "backstab"];
  const moveIn = (s) => {
    for (const w of COOP_WORDS) if (s.includes(w)) return COOP;
    for (const w of AGG_WORDS) if (s.includes(w)) return AGG;
    return null;
  };
  // The move mentioned FIRST anywhere in a phrase (for opener detection).
  const firstMove = (s) => {
    let best = null, at = Infinity;
    for (const w of [...COOP_WORDS, ...AGG_WORDS]) {
      const i = s.indexOf(w);
      if (i >= 0 && i < at) { at = i; best = COOP_WORDS.includes(w) ? COOP : AGG; }
    }
    return best;
  };

  const opener = () => {
    // The opening move is whatever's named before the first "then"/comma
    // ("swerve first, then …", "stay to start, then …"); else the first
    // move word anywhere; else cooperate.
    const head = p.split(/,|\bthen\b/)[0];
    return moveIn(head) ?? firstMove(p) ?? COOP;
  };
  const WORD_RE = [...COOP_WORDS, ...AGG_WORDS].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const wordMove = (w) => (COOP_WORDS.some((c) => w.includes(c)) ? COOP : AGG);
  // The opponent's move named right after "they"/"opponent" — used as the
  // trigger, so "if they STEAL" reads STEAL even when the sentence also
  // mentions the response move elsewhere.
  const triggerAfterThey = () => {
    const m = p.match(new RegExp(`(?:they|opponent)\\s+(?:just |always |last |already |ever |have |has |had |did )*?(${WORD_RE})`));
    return m ? wordMove(m[1]) : null;
  };
  // Extract (trigger, response) reaction pairs for mirror/opposite detection.
  const reactionPairs = () => {
    const pairs = [];
    let m;
    // Form A: "<response> if they <trigger>" — clause-bounded so it never
    // bridges a comma into the next reaction.
    let re = new RegExp(`(${WORD_RE})[^,.;]*?\\bif\\b[^,.;]*?(?:they|opponent)\\s+(?:just |last )?(${WORD_RE})`, "g");
    while ((m = re.exec(p))) pairs.push({ resp: wordMove(m[1]), trig: wordMove(m[2]) });
    if (pairs.length) return pairs;
    // Form B (only if A found nothing): "if they <trigger>[,/then] <response>".
    re = new RegExp(`\\bif\\b[^,.;]*?(?:they|opponent)\\s+(?:just |last )?(${WORD_RE})[^a-z]*(?:then |,\\s*)(${WORD_RE})`, "g");
    while ((m = re.exec(p))) pairs.push({ trig: wordMove(m[1]), resp: wordMove(m[2]) });
    return pairs;
  };
  const rules = [];
  let note = null;
  const streakN = () => (/(twice|two|2)\b/.test(p) ? 2 : /(thrice|three|3)\b/.test(p) ? 3 : num(/(\d+)\s*(?:times|in a row|consecutive)/, p, 2));

  if (/\bopposite\b|contrarian|reverse|anti.?mirror|whatever they (?:did ?n['o]t|don'?t)/.test(p)) {
    // "swerve first, then the OPPOSITE of their last move" (MIND GAMES).
    rules.push({ if: { eq: ["round", 0] }, then: opener() }, { if: true, then: { opposite: "oppLast" } });
  } else if (/tit.?for.?tat|mirror|copy|match (?:them|their|what)|same as (?:them|they)|do what they|whatever they (?:do|did)|reciprocat/.test(p)) {
    rules.push({ if: { eq: ["round", 0] }, then: COOP }, { if: true, then: { mirror: "oppLast" } });
  } else if (/(?:last|final|end)\s*(?:\d+\s*)?(?:round|turn|few)/.test(p) && /every|each|until|then|but|except|otherwise/.test(p) && moveIn(p)) {
    // Endgame: "split every round but steal on the last round" — base move
    // is what's played "every round", the twist is in the last-round clause.
    const segs = p.split(/,|\bbut\b|except|otherwise|\bthen\b/);
    const endMove = moveIn(segs.find((s) => /last|final|end/.test(s)) || "") ?? AGG;
    const base = moveIn(segs.find((s) => /every|each/.test(s)) || "") ?? other(endMove);
    const lastN = num(/last (\d+)|(\d+) rounds?|last (\d+) turns?/, p, 1);
    rules.push({ if: { gte: ["round", 10 - lastN] }, then: endMove }, { if: true, then: base });
  } else if (/grim|never forgive|hold a grudge|grudge|forever/.test(p) || (/\buntil\b/.test(p) && !/in a row|streak|consecutive|twice|\d+\s*times/.test(p))) {
    // Grim / "split until they steal, then steal forever".
    rules.push({ if: { gte: [{ oppCount: AGG }, 1] }, then: AGG }, { if: true, then: COOP });
  } else if (/in a row|streak|consecutive|twice in|two times in/.test(p)) {
    // Streak reaction: "swerve if they stay twice in a row, otherwise stay".
    const [head] = splitReaction(p);
    const trigger = triggerAfterThey() ?? AGG; // the opponent's repeated move
    const response = moveIn(head) ?? other(trigger);
    rules.push({ if: { gte: [{ oppStreak: trigger }, streakN()] }, then: response }, { if: true, then: other(response) });
  } else if (/(if|when|whenever).*(they|opponent)/.test(p) && /\d+\s*times|\bcount|total|number of/.test(p)) {
    // Count threshold: "if they've stolen 3 times, steal".
    const [head] = splitReaction(p);
    const trigger = triggerAfterThey() ?? AGG;
    const response = moveIn(head) ?? other(trigger);
    const n = num(/(\d+)\s*times|(\d+)/, p, 3);
    rules.push({ if: { gte: [{ oppCount: trigger }, n] }, then: response }, { if: true, then: other(response) });
  } else if (/(if|when|whenever)\s+(?:they|the opponent|opponent|you)/.test(p)) {
    // Last-move reaction. Pair-extract so "steal if they steal, split if
    // they split" reads as two self-maps → mirror, "X if they Y" (X≠Y) →
    // opposite, and a single "if they Y, X" → an explicit oppLast rule.
    const pairs = reactionPairs();
    if (pairs.length >= 1 && pairs.every((q) => q.resp === q.trig)) {
      rules.push({ if: { eq: ["round", 0] }, then: COOP }, { if: true, then: { mirror: "oppLast" } });
    } else if (pairs.length >= 1 && pairs.every((q) => q.resp === other(q.trig))) {
      rules.push({ if: { eq: ["round", 0] }, then: opener() }, { if: true, then: { opposite: "oppLast" } });
    } else if (pairs.length >= 1) {
      const { trig, resp } = pairs[0];
      rules.push({ if: { eq: ["oppLast", trig] }, then: resp }, { if: true, then: other(resp) });
    } else {
      const trigger = triggerAfterThey();
      if (trigger) {
        const resp = moveIn(splitReaction(p)[0]) ?? AGG;
        rules.push({ if: { eq: ["oppLast", trigger] }, then: resp }, { if: true, then: other(resp) });
      } else {
        note = fallbackNote(game);
        pushFallback(rules, game, AGG, COOP);
      }
    }
  } else if (/random|coin|50.?50|flip|chance|maybe/.test(p)) {
    const pct = num(/(\d+)\s*%/, p, 50) / 100;
    rules.push({ if: true, then: { chance: [pct, AGG, COOP] } });
  } else if (moveIn(p) && /always|every|only|just|all the time/.test(p)) {
    rules.push({ if: true, then: moveIn(p) });
  } else if (/never\s+(swerve|split|steal|stay|cooperate|defect)/.test(p)) {
    // "never swerve" → always the other move.
    const m = p.match(/never\s+(\w+)/);
    rules.push({ if: true, then: other(moveIn(m[1]) ?? COOP) });
  } else if (moveIn(p)) {
    // A bare move word with no qualifier — take it literally.
    rules.push({ if: true, then: moveIn(p) });
  } else {
    note = fallbackNote(game);
    pushFallback(rules, game, AGG, COOP);
  }
  return { spec: { game, rules }, note };
}

/** Split a reaction sentence into (response-clause, trigger-clause). */
function splitReaction(p) {
  // "<response> if they <trigger> [otherwise/else …]" OR
  // "if they <trigger> (then) <response> [otherwise …]"
  const io = p.search(/\b(if|when|whenever)\b/);
  if (io > 3) {
    // response stated before the "if"
    return [p.slice(0, io), p.slice(io)];
  }
  // "if they <trigger>, <response>" — trigger is the clause right after they,
  // response after the first comma/then.
  const m = p.split(/,|\bthen\b|\botherwise\b|\belse\b/);
  return [m.slice(1).join(" "), m[0] ?? p];
}

function fallbackNote(game) {
  return `Couldn't read that clearly — compiled a solid default (${game === "chicken" ? "swerve, then do the opposite of them" : "tit-for-tat"}). In ${game === "chicken" ? "Chicken your moves are STAY or SWERVE" : "Split or Steal your moves are SPLIT or STEAL"}; rephrase with those words, or edit the JSON.`;
}

/** Chicken's fallback is Reactive-Yielder-shaped (mirror is the WORST bot in
 *  chicken — it crashes 9× against a stayer). PD's fallback is tit-for-tat. */
function pushFallback(rules, game, AGG, COOP) {
  if (game === "chicken") {
    rules.push({ if: { eq: ["round", 0] }, then: COOP }, { if: true, then: { opposite: "oppLast" } });
  } else {
    rules.push({ if: { eq: ["round", 0] }, then: COOP }, { if: true, then: { mirror: "oppLast" } });
  }
}
