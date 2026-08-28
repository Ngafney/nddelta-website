/**
 * The strategy DSL: a small declarative spec that an LLM writes and a
 * human can verify at a glance.
 *
 * A spec is:  { game, rules: [ { if: COND, then: ACTION }, ... ] }
 * Rules are checked top-down each turn; THE FIRST MATCHING RULE FIRES.
 * The last rule must be unconditional ({ if: true }) so the bot always
 * has a move.
 *
 * This file owns validation and condition evaluation for all three games.
 * Executing a spec lives in bandit.js / matrix.js, which call into here.
 *
 * WHY A DSL AND NOT GENERATED JAVASCRIPT: running model-written JS
 * server-side needs a real sandbox; a JSON spec needs a schema check.
 * And the whole point is that a team can read their bot and believe it.
 */

import { ACTIONS, BANDIT } from "./rules.js";

const COMPARE_OPS = ["lt", "lte", "gt", "gte", "eq", "neq"];
const LOGIC_OPS = ["and", "or", "not"];

export const BANDIT_SELECTORS = [
  "highestMean", // best observed average (unplayed machines count as untried-first)
  "leastPlayed", // machine with fewest pulls so far
  "random", // uniform random machine
  "highestLastPayoff", // machine whose most recent payoff was largest
  "thompson", // sample each machine's plausible mean, play the best sample
  "stay", // keep playing the same machine you just played (random on the first pull)
];

/* ── numeric state references ──────────────────────────────────────────── */

const BANDIT_REFS = new Set(["spinsUsed", "spinsLeft", "total", "lastPayoff", "lastMachine"]);
const MATRIX_REFS = new Set(["round", "myScore", "oppScore"]);

/* =====================================================================
 * Validation
 * =================================================================== */

export function validateSpec(raw) {
  const errors = [];
  const spec = typeof raw === "string" ? tryParse(raw, errors) : raw;
  if (!spec || typeof spec !== "object") {
    return { ok: false, errors: errors.length ? errors : ["spec is not an object"] };
  }
  const game = spec.game;
  if (!["bandit", "chicken", "pd"].includes(game)) {
    return { ok: false, errors: [`unknown game "${game}"`] };
  }
  if (!Array.isArray(spec.rules) || spec.rules.length === 0) {
    return { ok: false, errors: ["rules must be a non-empty array"] };
  }
  if (spec.rules.length > 20) {
    return { ok: false, errors: ["at most 20 rules"] };
  }
  spec.rules.forEach((rule, i) => {
    if (!rule || typeof rule !== "object" || !("if" in rule) || !("then" in rule)) {
      errors.push(`rule ${i + 1}: must have "if" and "then"`);
      return;
    }
    validateCond(rule.if, game, `rule ${i + 1} if`, errors, 0);
    validateAction(rule.then, game, `rule ${i + 1} then`, errors);
  });
  const last = spec.rules[spec.rules.length - 1];
  if (last && last.if !== true) {
    errors.push('the last rule must be unconditional ("if": true) so the bot always has a move');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, spec: { game, rules: spec.rules } };
}

function tryParse(str, errors) {
  try {
    return JSON.parse(str);
  } catch (e) {
    errors.push(`invalid JSON: ${e.message}`);
    return null;
  }
}

function validateCond(cond, game, where, errors, depth) {
  if (cond === true || cond === false) return;
  if (depth > 4) {
    errors.push(`${where}: conditions nest too deep`);
    return;
  }
  if (!cond || typeof cond !== "object") {
    errors.push(`${where}: condition must be true/false or an operator object`);
    return;
  }
  const keys = Object.keys(cond);
  if (keys.length !== 1) {
    errors.push(`${where}: condition must have exactly one operator, got {${keys.join(",")}}`);
    return;
  }
  const op = keys[0];
  const arg = cond[op];
  if (LOGIC_OPS.includes(op)) {
    if (op === "not") validateCond(arg, game, `${where}.not`, errors, depth + 1);
    else if (Array.isArray(arg))
      arg.forEach((c, i) => validateCond(c, game, `${where}.${op}[${i}]`, errors, depth + 1));
    else errors.push(`${where}: ${op} takes an array of conditions`);
    return;
  }
  if (COMPARE_OPS.includes(op)) {
    if (!Array.isArray(arg) || arg.length !== 2) {
      errors.push(`${where}: ${op} takes [left, right]`);
      return;
    }
    arg.forEach((operand) => validateOperand(operand, game, where, errors));
    return;
  }
  errors.push(`${where}: unknown operator "${op}"`);
}

function validateOperand(x, game, where, errors) {
  if (typeof x === "number") {
    if (!Number.isFinite(x)) errors.push(`${where}: numbers must be finite`);
    return;
  }
  if (typeof x === "string") {
    const refs = game === "bandit" ? BANDIT_REFS : MATRIX_REFS;
    // In matrix games, strings may also be action literals or myLast/oppLast.
    if (refs.has(x)) return;
    // "NONE" is the value myLast/oppLast take before round 0's first move —
    // the engine emits it, so a spec comparing against it must validate
    // (e.g. {"eq":["oppLast","NONE"]} to detect the opening round).
    if (game !== "bandit" && (x === "myLast" || x === "oppLast" || x === "NONE" || ACTIONS[game].includes(x))) return;
    errors.push(`${where}: unknown reference "${x}"`);
    return;
  }
  if (x && typeof x === "object") {
    const keys = Object.keys(x);
    if (keys.length !== 1) {
      errors.push(`${where}: bad operand ${JSON.stringify(x)}`);
      return;
    }
    const k = keys[0];
    if (game === "bandit") {
      const mIdx = (v) => Number.isInteger(v) && v >= 0 && v < BANDIT.machines;
      // Single-machine metrics: {plays:i},{mean:i},{sum:i},{last:i},{max:i},{min:i},{countPos:i}
      if (["plays", "mean", "sum", "last", "max", "min", "countPos"].includes(k) && mIdx(x[k])) return;
      // Threshold counts: {countAbove:[i, x]}, {countBelow:[i, x]}
      if ((k === "countAbove" || k === "countBelow") && Array.isArray(x[k]) && x[k].length === 2 && mIdx(x[k][0]) && Number.isFinite(x[k][1])) return;
    } else {
      if (["oppCount", "myCount", "oppStreak", "myStreak"].includes(k) && ACTIONS[game].includes(x[k])) return;
    }
    errors.push(`${where}: unknown operand ${JSON.stringify(x)}`);
    return;
  }
  errors.push(`${where}: bad operand ${JSON.stringify(x)}`);
}

function validateAction(act, game, where, errors) {
  if (game === "bandit") {
    if (act && typeof act === "object" && !Array.isArray(act)) {
      const keys = Object.keys(act);
      if (keys.length === 1) {
        const k = keys[0];
        if (k === "play") {
          const sel = act.play;
          if (typeof sel === "string" && BANDIT_SELECTORS.includes(sel)) return;
          if (sel && typeof sel === "object") {
            const sk = Object.keys(sel);
            if (sk.length === 1) {
              if (sk[0] === "fixed" && Number.isInteger(sel.fixed) && sel.fixed >= 0 && sel.fixed < BANDIT.machines) return;
              if (sk[0] === "epsilonGreedy" && Number.isFinite(sel.epsilonGreedy) && sel.epsilonGreedy >= 0 && sel.epsilonGreedy <= 1) return;
              if (sk[0] === "ucb" && Number.isFinite(sel.ucb) && sel.ucb >= 0 && sel.ucb <= 1e6) return;
              // {best:metric}/{worst:metric} — play the machine that maximises/minimises a metric.
              if ((sk[0] === "best" || sk[0] === "worst") && ["mean", "plays", "sum", "last", "max", "min", "countPos"].includes(sel[sk[0]])) return;
            }
          }
        }
      }
    }
    errors.push(`${where}: bandit actions look like {"play":"highestMean"} — got ${JSON.stringify(act)}`);
    return;
  }
  // matrix games
  const acts = ACTIONS[game];
  if (typeof act === "string" && acts.includes(act)) return;
  if (act && typeof act === "object") {
    const keys = Object.keys(act);
    if (keys.length === 1) {
      const k = keys[0];
      if ((k === "mirror" || k === "opposite") && act[k] === "oppLast") return;
      if (k === "chance") {
        const c = act.chance;
        if (
          Array.isArray(c) && c.length === 3 &&
          typeof c[0] === "number" && c[0] >= 0 && c[0] <= 1 &&
          acts.includes(c[1]) && acts.includes(c[2])
        )
          return;
      }
    }
  }
  errors.push(
    `${where}: actions are "${acts[0]}", "${acts[1]}", {"mirror":"oppLast"}, {"opposite":"oppLast"} or {"chance":[p,"${acts[0]}","${acts[1]}"]} — got ${JSON.stringify(act)}`
  );
}

/* =====================================================================
 * Condition evaluation (shared by both engines)
 * `lookup(ref)` resolves a state reference to a number or action string.
 * =================================================================== */

export function evalCond(cond, lookup) {
  if (cond === true) return true;
  if (cond === false) return false;
  const op = Object.keys(cond)[0];
  const arg = cond[op];
  switch (op) {
    case "and":
      return arg.every((c) => evalCond(c, lookup));
    case "or":
      return arg.some((c) => evalCond(c, lookup));
    case "not":
      return !evalCond(arg, lookup);
    default: {
      const a = resolve(arg[0], lookup);
      const b = resolve(arg[1], lookup);
      switch (op) {
        case "lt": return a < b;
        case "lte": return a <= b;
        case "gt": return a > b;
        case "gte": return a >= b;
        case "eq": return a === b;
        case "neq": return a !== b;
        default: return false;
      }
    }
  }
}

function resolve(x, lookup) {
  if (typeof x === "number") return x;
  return lookup(x);
}
