/**
 * Sunset Scoops — the weather-hedging simulation.
 *
 * A team's bot is a REAL JavaScript function the AI writes for them — the body
 * of `decide(day)` that returns how many of each weather contract to buy today.
 * Each day it sees the forecast, every contract price, the calendar, its current
 * reserves and days-until-billing, the full history so far, and the 2 months of
 * training data — so it can build any hedging model within reason.
 *
 * The sim then steps the shop day-by-day across the 10-month test period:
 * revenue lands daily, costs are billed every 14 days (miss it → bankrupt, reset
 * to $2000), and after each billing the bank skims reserves back down to $2000.
 * Profit (for the Sharpe leaderboard) is pure operating + hedging P&L — the skim
 * and bankruptcy resets never count. Everyone gets the identical weather/prices.
 *
 * SAFETY — same lockdown as the other sandboxes: static denylist before compile,
 * strict mode with only `day`/`lib` in scope, seeded rng, validated return.
 */

import { ICE } from "./rules.js";
import { rngFrom } from "./rng.js";
import { ICE_DATA } from "./ice-data.js";

const TRAIN = ICE_DATA.train;
const TEST = ICE_DATA.test;
const KEYS = ICE.contracts.map((c) => c.key);
const MAX_CONTRACTS = 10000; // total contracts/day — hedging is on margin (no cash outlay), but bounded so a bot can't buy a giant lottery ticket

const DENY = [
  "\\bfor\\b", "\\bwhile\\b", "\\bdo\\b", "\\bfunction\\b",
  "\\bthis\\b", "\\barguments\\b", "\\bconstructor\\b", "__proto__", "\\bprototype\\b",
  "\\bimport\\b", "\\brequire\\b", "\\bprocess\\b", "\\bglobal\\b", "\\bglobalThis\\b",
  "\\beval\\b", "\\bFunction\\b", "\\bReflect\\b", "\\bProxy\\b", "\\bSymbol\\b",
  "\\bfetch\\b", "\\bXMLHttpRequest\\b", "\\bWebAssembly\\b", "\\bAtomics\\b",
  "\\bSharedArrayBuffer\\b", "\\bBuffer\\b", "\\bmodule\\b", "\\bexports\\b",
  "\\basync\\b", "\\bawait\\b", "\\byield\\b",
  "\\bsetTimeout\\b", "\\bsetInterval\\b", "\\bsetImmediate\\b", "\\bqueueMicrotask\\b",
  "\\bPromise\\b", "\\.\\s*random", "\\.\\s*constructor",
];
const DENY_RE = new RegExp(DENY.join("|"), "i");

const LIB = Object.freeze({
  max: Math.max, min: Math.min, abs: Math.abs, floor: Math.floor,
  ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, log: Math.log,
  pow: Math.pow, exp: Math.exp, sign: Math.sign,
  clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
  mean: (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0),
});

const round2 = (x) => Math.round(x * 100) / 100;

export function validateIceCode(src) {
  if (typeof src !== "string" || !src.trim()) return { ok: false, error: "empty code" };
  if (src.length > 5000) return { ok: false, error: "code is too long" };
  if (/[`]/.test(src)) return { ok: false, error: "template literals (backticks) aren't allowed" };
  const m = src.match(DENY_RE);
  if (m) return { ok: false, error: `"${m[0].trim()}" isn't allowed — use array methods over day.history / day.training instead of loops, and day.rng() instead of Math.random.` };
  return { ok: true };
}

export function compileIceCode(src) {
  // eslint-disable-next-line no-new-func
  const raw = new Function("day", "lib", `"use strict";\n${src}`);
  return (day) => raw(day, LIB);
}

/** Contract prices for a day (from the forecast-implied market probabilities). */
function pricesFor(d) {
  const p = {};
  for (const c of ICE.contracts) {
    const neg = c.priceFrom.startsWith("!");
    const field = neg ? c.priceFrom.slice(1) : c.priceFrom;
    let v = d[field];
    if (neg) v = 1 - v;
    p[c.key] = round2(v);
  }
  return p;
}

/** Turn whatever the strategy returned into a clean {key: integer qty>=0}. */
function sanitizeBets(out) {
  const bets = {};
  if (out && typeof out === "object") {
    for (const k of KEYS) {
      const q = out[k];
      if (Number.isFinite(q) && q > 0) bets[k] = Math.floor(q);
    }
  }
  return bets;
}

/** Public copy of the training data for the bot (frozen, plain records). */
function trainingView() {
  return TRAIN.map((d) => ({
    date: d.date, dow: d.dow, weekend: d.weekend, holiday: d.holiday,
    temp_high: d.temp_high, rained: d.rained, revenue: d.revenue,
    forecast_high: d.forecast_high,
    p_below_65: d.p_below_65, p_below_70: d.p_below_70,
    p_below_75: d.p_below_75, p_below_80: d.p_below_80, p_rain: d.p_rain,
  }));
}

/**
 * Run one compiled strategy over the full test period.
 * Returns leaderboard numbers plus a full per-day log (the visualizer + CSV).
 */
export function simulateIce(fn) {
  const training = trainingView();
  let cash = ICE.startReserves;
  let bankruptcies = 0, billAccrued = 0, dayInCycle = 0, cum = 0;
  const profits = [];
  const history = [];
  const days = [];
  let errored = false;

  for (let t = 0; t < TEST.length; t++) {
    const d = TEST[t];
    const prices = pricesFor(d);
    const rng = rngFrom(`ice|day${t}`);
    const day = {
      t, daysTotal: TEST.length,
      date: d.date, dow: d.dow, weekend: d.weekend, holiday: d.holiday,
      forecastHigh: d.forecast_high,
      prices,
      cash, reserves: cash,
      daysUntilBill: ICE.billEveryDays - dayInCycle,
      billAccrued,
      history, training,
      dailyCost: ICE.dailyCost,
      rng,
    };

    let raw;
    try { raw = fn(day); } catch { raw = null; errored = true; }
    let bets = sanitizeBets(raw);

    // Hedging is on MARGIN — no cash outlay to open a position — but the total
    // position is capped so nobody can buy a giant lottery ticket.
    let totalQty = KEYS.reduce((s, k) => s + (bets[k] || 0), 0);
    if (totalQty > MAX_CONTRACTS) {
      const scale = MAX_CONTRACTS / totalQty;
      const scaled = {};
      for (const k of Object.keys(bets)) {
        const q = Math.floor(bets[k] * scale);
        if (q > 0) scaled[k] = q;
      }
      bets = scaled;
      totalQty = KEYS.reduce((s, k) => s + (bets[k] || 0), 0);
    }

    // Revenue lands; each contract settles same-day for its NET pnl
    // (payout − price), because it was opened on margin.
    cash += d.revenue;
    let hedgePnl = 0;
    for (const c of ICE.contracts) {
      const q = bets[c.key] || 0;
      if (q) hedgePnl += q * ((c.wins(d) ? 1 : 0) - prices[c.key]);
    }
    cash += hedgePnl;

    const profit = d.revenue - ICE.dailyCost + hedgePnl;
    cum += profit;
    profits.push(profit);

    billAccrued += ICE.dailyCost;
    dayInCycle++;
    let billed = false, bankrupt = false;
    if (dayInCycle === ICE.billEveryDays) {
      cash -= billAccrued;
      if (cash < 0) { bankruptcies++; cash = ICE.startReserves; bankrupt = true; }
      else if (cash > ICE.reserveCap) { cash = ICE.reserveCap; }
      billAccrued = 0; dayInCycle = 0; billed = true;
    }

    const entry = {
      t, date: d.date, dow: d.dow,
      forecastHigh: d.forecast_high, tempHigh: d.temp_high, precip: d.precip, rained: d.rained,
      prices, bets, contracts: totalQty,
      hedgePnl: round2(hedgePnl),
      revenue: d.revenue, profit: round2(profit), cum: round2(cum),
      reserves: round2(cash), billed, bankrupt,
    };
    days.push(entry);
    history.push({
      date: d.date, tempHigh: d.temp_high, rained: d.rained,
      revenue: d.revenue, profit: round2(profit), reserves: round2(cash),
      hedgePnl: round2(hedgePnl), bets,
    });
  }

  const mean = profits.reduce((a, b) => a + b, 0) / profits.length;
  const sd = Math.sqrt(profits.reduce((a, b) => a + (b - mean) ** 2, 0) / profits.length);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(365) : 0;

  return {
    sharpe: round2(sharpe),
    bankruptcies,
    meanDaily: round2(mean),
    sd: round2(sd),
    totalProfit: round2(cum),
    finalReserves: round2(cash),
    testDays: TEST.length,
    cycles: Math.floor(TEST.length / ICE.billEveryDays),
    days,
    errored,
  };
}

/** Compile + smoke test. Returns { ok, run } or { ok:false, error }. */
export function prepareIceCode(src) {
  const v = validateIceCode(src);
  if (!v.ok) return v;
  let fn;
  try { fn = compileIceCode(src); } catch (e) { return { ok: false, error: `syntax error: ${e.message}` }; }
  try {
    const probe = {
      t: 0, daysTotal: TEST.length, date: "2025-03-01", dow: "Saturday", weekend: 1, holiday: 0,
      forecastHigh: 70, prices: pricesFor(TEST[0]), cash: ICE.startReserves, reserves: ICE.startReserves,
      daysUntilBill: 14, billAccrued: 0, history: [], training: trainingView(), dailyCost: ICE.dailyCost,
      rng: rngFrom("smoke"),
    };
    const out = fn(probe);
    if (out !== undefined && out !== null && typeof out !== "object") {
      return { ok: false, error: "decide(day) must return an object of contracts to buy, e.g. { under_70: 5, rain_yes: 3 } (or {} to sit out)" };
    }
  } catch (e) {
    return { ok: false, error: `the code crashed when run: ${e.message}` };
  }
  return { ok: true, run: fn };
}

/** The 2-month training data as CSV text (for the download button). */
export function trainingCsv() {
  const cols = ["date", "dow", "weekend", "holiday", "temp_high", "precip", "rained", "forecast_high", "p_below_65", "p_below_70", "p_below_75", "p_below_80", "p_rain", "revenue"];
  const lines = [cols.join(",")];
  for (const d of TRAIN) lines.push(cols.map((c) => d[c]).join(","));
  return lines.join("\n");
}

export const ICE_INFO = { trainDays: TRAIN.length, testDays: TEST.length };
