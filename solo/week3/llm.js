/**
 * Week 3's strategy compiler, for solo mode.
 *
 * The live lab sends a team's English to an LLM on the club's key. A solo game
 * runs in the browser and cannot call one, so this file stands in: it is the
 * live game's own offline quick-compiler (week3/server/llm.js, offlineCompile),
 * copied here because the solo build swaps that module out, plus a few more
 * phrasings people reach for once the simple ones are on the board:
 *
 *   "pretend each coin starts with 2 heads and 1 tail, then flip the best"
 *   "keep flipping a coin until it comes up tails twice in a row, then move on"
 *   "explore 10, then the best posterior mean"
 *
 * It stays a FAITHFUL compiler: it codes what it reads, refuses "just win", and
 * says so on screen whenever it had to guess.
 */

import { prepareCode } from "../../week3/shared/bandit.js";
import { BANDIT } from "../../week3/shared/rules.js";

export function llmAvailable() {
  return true;
}

/** Bot teams' prompts never go to the AI: they compile offline, for free. */
const botPrompts = new Set();
export function registerBotPrompt(p) {
  botPrompts.add(String(p));
}

/**
 * The same AI as the meeting, through the site's /api/solo/compile (which
 * holds the key). If it cannot be reached, the built-in reader below steps in.
 * A 502 carrying the AI's own error message is shown, as at the meeting.
 */
export async function compile(prompt) {
  const text = String(prompt).slice(0, 2000);
  if (!botPrompts.has(text) && typeof fetch === "function" && typeof window !== "undefined") {
    let res = null;
    try {
      res = await fetch("/api/solo/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week: 3, prompt: text }) });
    } catch {
      res = null;
    }
    if (res?.ok) {
      const data = await res.json().catch(() => null);
      if (data && (data.refused || data.code)) return data;
    } else if (res?.status === 502) {
      const data = await res.json().catch(() => ({}));
      if (data?.error) throw Object.assign(new Error(data.error), { status: 422 });
    }
  }
  return offlineOnly(text);
}

function offlineOnly(prompt) {
  const out = offlineCompile(String(prompt).slice(0, 2000));
  if (!out.refused) {
    const prep = prepareCode(out.code);
    if (!prep.ok) throw new Error(`the quick compiler wrote something invalid (${prep.error}) — try rephrasing`);
  }
  return out;
}

const K = BANDIT.coins;
const WORD = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const numWord = (s) => (s == null ? null : WORD[s] ?? (Number.isFinite(Number(s)) ? Number(s) : null));
const out = (code, explain, summary, note = null) => ({ code, explain, summary, note, source: "offline" });

const HOW =
  'It reads plans like "explore 10 flips, then the best", "flip each coin twice, then the most heads", "epsilon 5%", "UCB c=0.5", "Thompson sampling", "pretend each coin starts with 1 head and 1 tail, then flip the best", or "stay on a coin until it comes up tails twice in a row, then move to the next".';

/** How many flips to spend exploring round-robin, if the text says. */
function exploreCount(p) {
  const each = p.match(
    /(\d+|once|twice|thrice|one|two|three|four|five|six|ten)\s*(?:times?|flips?)?\s*(?:each|per coin|apiece)|each coin\s*(\d+|once|twice|thrice|one|two|three|four|five)/
  );
  if (each) return (numWord(each[1] ?? each[2]) ?? 1) * K;
  const total = p.match(/(?:first|explore|spend)\D{0,12}(\d+)|(\d+)\s*flips?\s*(?:exploring|to explore|at the (?:start|beginning))/);
  if (total) return Number(total[1] ?? total[2]);
  return null;
}

const coinIdx = (s) => (/\d/.test(s) ? Number(s) - 1 : s.toUpperCase().charCodeAt(0) - 65);

function soloExtras(p) {
  // "coin A for the first 20 flips, then coin B for the rest"
  const plan = p.match(/coin\s*([a-e1-5])\b[^.]*?(?:first|for)\s*(\d+)\s*flips?[^.]*?then[^.]*?coin\s*([a-e1-5])\b/);
  if (plan) {
    const a = coinIdx(plan[1]);
    const b = coinIdx(plan[3]);
    const t = Math.min(BANDIT.flips, Number(plan[2]));
    const A = String.fromCharCode(65 + a);
    const B = String.fromCharCode(65 + b);
    return out(`if (state.flip < ${t}) return ${a};\nreturn ${b};`, `Flips coin ${A} for the first ${t} flips, then coin ${B} for every flip after that.`, `${A} for ${t}, then ${B}`);
  }

  // Stay on a coin until it fails, then move along (win-stay, lose-shift).
  const streak = p.match(/(?:until|after)[^.]*?tails?\s*(\d+|once|twice|thrice|two|three|four|five)\s*(?:times?\s*)?in a row|(\d+|two|three|four|five)\s*tails?\s*in a row/);
  if (streak || /lose.?shift|win.?stay|until (?:it (?:comes up|lands|gets|hits) )?(?:a )?tails?\b/.test(p)) {
    const k = Math.max(1, Math.min(10, numWord(streak?.[1] ?? streak?.[2]) ?? 1));
    return out(
      `const c = state.lastCoin;\nif (c === null) return 0;\nconst tail = state.coins[c].results.slice(-${k});\nif (tail.length === ${k} && tail.every(x => x === 0)) return (c + 1) % ${K};\nreturn c;`,
      `Starts on coin A and keeps flipping it until it comes up tails ${k === 1 ? "once" : `${k} times in a row`}, then moves to the next coin (after E it goes back to A).`,
      k === 1 ? "Stay until tails" : `Stay until ${k} tails in a row`
    );
  }

  // Greedy on a smoothed rate: pretend every coin starts with some heads and tails.
  const pretend = p.match(/(\d+)\s*heads?\D{0,20}?(\d+)\s*tails?/);
  if (/pretend|optimis|posterior mean|laplace|smooth|head start|already (?:has|had|shown)/.test(p) && !/thompson/.test(p)) {
    const a = pretend ? Number(pretend[1]) : 1;
    const b = pretend ? Number(pretend[2]) : 1;
    const e = exploreCount(p);
    const head = e ? `if (state.flip < ${e}) return state.flip % ${K};\n` : "";
    return out(
      `${head}return lib.argmax(state.coins.map(c => (c.heads + ${a}) / (c.flips + ${a + b})));`,
      `${e ? `For the first ${e} flips it goes round the coins in order. ` : ""}Every flip it scores each coin as (heads + ${a}) ÷ (flips + ${a + b}) — as if each coin had already shown ${a} head${a === 1 ? "" : "s"} and ${b} tail${b === 1 ? "" : "s"} — and flips the highest score; ties go to the earlier coin.`,
      `Greedy, +${a}H +${b}T`
    );
  }
  return null;
}

/**
 * The live game's offline compiler (unchanged in substance), behind the solo
 * extras. Anything it cannot read falls back to "explore evenly, then exploit"
 * WITH A VISIBLE NOTE — never a silent guess.
 */
export function offlineCompile(prompt) {
  const p = prompt.toLowerCase();
  const n = (re, fallback) => {
    const m = p.match(re);
    return m ? parseFloat(m[1]) : fallback;
  };

  if (/\b(win|best strategy|optimal|beat everyone|most money)\b/.test(p) && !/\b(then|flip|explore|try)\b/.test(p)) {
    return { refused: true, reason: "Tell me HOW to choose coins — e.g. how many flips to explore, then what to do — and I'll code exactly that." };
  }
  const extra = soloExtras(p);
  if (extra) return extra;

  if (/thompson|bayes/.test(p)) {
    return out(
      "return lib.argmax(state.coins.map(c => state.betaSample(c.heads + 1, c.tails + 1)));",
      "Every flip it draws a random guess of each coin's probability from what it has seen so far (a Beta posterior) and flips the coin with the highest guess.",
      "Thompson sampling"
    );
  }
  if (/ucb|upper confidence/.test(p)) {
    const c = n(/(?:ucb|constant|c\s*=)\D*([\d.]+)/, 2);
    return out(
      `const u = state.coins.map(c => c.flips === 0 ? 1e9 : c.rate + lib.sqrt(${c} * lib.log(state.flip + 1) / c.flips));\nreturn lib.argmax(u);`,
      `Flips every coin once, then each flip picks the coin with the highest heads rate plus a bonus that shrinks the more a coin has been tried (UCB, constant ${c}).`,
      "UCB"
    );
  }
  if (/epsilon|%|percent/.test(p)) {
    let e = n(/(\d+(?:\.\d+)?)\s*%/, null) ?? n(/epsilon\D*([\d.]+)/, 10);
    if (e > 1) e /= 100;
    return out(
      `if (state.rng() < ${e}) return lib.floor(state.rng() * ${K});\nreturn lib.argmax(state.coins.map(c => c.flips === 0 ? 2 : c.rate));`,
      `With probability ${e} it flips a random coin; otherwise it flips the coin with the best heads rate so far (untried coins first).`,
      `Epsilon-greedy ${Math.round(e * 100)}%`
    );
  }
  if (/random/.test(p) && !/then/.test(p)) {
    return out(`return lib.floor(state.rng() * ${K});`, "Every flip it picks one of the five coins at random.", "Pure random");
  }
  const only = p.match(/(?:always|only)\D*coin\s*([a-e1-5])\b/);
  if (only) {
    const c = /\d/.test(only[1]) ? Number(only[1]) - 1 : only[1].toUpperCase().charCodeAt(0) - 65;
    return out(`return ${c};`, `Flips coin ${String.fromCharCode(65 + c)} every single time.`, `Only coin ${String.fromCharCode(65 + c)}`);
  }
  const explore = exploreCount(p);
  const most = /most heads/.test(p);
  if (explore != null || /then|best|highest|greedy/.test(p)) {
    const e = Math.max(0, Math.min(BANDIT.flips, explore ?? 15));
    const metric = most ? "c.heads" : "c.rate";
    return out(
      `if (state.flip < ${e}) return state.flip % ${K};\nreturn lib.argmax(state.coins.map(c => ${metric}));`,
      `For the first ${e} flips it goes round the coins in order, A to E. After that it always flips the coin with the ${most ? "most heads" : "highest heads rate"} so far; ties go to the earlier coin.`,
      `Explore ${e}, then exploit`,
      explore == null ? `The quick compiler didn't catch how long to explore, so it used 15 flips. Say e.g. "first 20 flips" to change it.` : null
    );
  }
  return out(
    `if (state.flip < 15) return state.flip % ${K};\nreturn lib.argmax(state.coins.map(c => c.rate));`,
    "For the first 15 flips it goes round the coins in order, then always flips the coin with the highest heads rate so far.",
    "Explore 15, then exploit",
    `The quick compiler couldn't read that plan, so this is a default. ${HOW}`
  );
}
