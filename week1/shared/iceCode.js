/**
 * Sunset Scoops — the weather-hedging simulation.
 *
 * A team's bot is a REAL JavaScript function the AI writes for them — the body
 * of `decide(day)` that returns the PORTFOLIO it wants to hold today. Each day
 * it sees a rolling 10-day forecast market, its current positions, its reserves
 * and days-until-billing, the history so far, and 5 years of training data.
 *
 * THE MARKET (this is the important part):
 *   • Every day there are contracts on the weather for today plus the next 7
 *     days ("under_70@3" = the high is under 70°F, 3 days from now).
 *   • A contract's price is the forecast probability, and that price MOVES each
 *     day as the forecast sharpens. Positions PERSIST across days and are
 *     marked to market daily, so buying a contract cheap and selling it later
 *     at a higher price LOCKS IN the gain — exactly like real futures.
 *   • Trading is on MARGIN: no cash is needed to open a position. Daily P&L is
 *     qty × (today's price − yesterday's price); on the settlement day the
 *     price becomes the actual outcome (1 or 0).
 *   • The market is FAIR: forecasts are calibrated posteriors, so every
 *     contract has ~zero expected profit. Hedging changes RISK, not average.
 *
 * The shop: revenue lands daily, costs are billed every 14 days (miss it →
 * bankrupt, reserves reset to $2000), and after each billing the bank skims
 * reserves back to $2000. Profit = operating + hedging P&L (never the skim).
 *
 * SAFETY — same lockdown as the other sandboxes: static denylist before
 * compile, strict mode with only `day`/`lib` in scope, seeded rng, validated
 * return.
 */

import { ICE } from "./rules.js";
import { rngFrom } from "./rng.js";
import { ICE_DATA } from "./ice-data.js";

const TRAIN = ICE_DATA.train;
const TEST = ICE_DATA.test;
const KEYS = ICE.contracts.map((c) => c.key);
const HORIZON = 8;            // you can trade today + the next 7 days of weather
const MAX_CONTRACTS = 60000;  // total absolute position across all markets — high
                              // enough that SIZING is a real decision, not a wall you hit

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
const round4 = (x) => Math.round(x * 10000) / 10000;
const clampP = (p) => Math.max(0.01, Math.min(0.99, p));

/* ── the forecast market ──────────────────────────────────────────────── */

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf approximation). */
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Box–Muller from a seeded uniform stream. */
function gauss(rand) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Forecast error grows with lead time but stays realistically SKILFUL: a
// day-ahead high lands within ~1.5°F, a week-ahead high within ~4°F, and the
// rain signal keeps real skill all the way out to a week.
// Tunable via env for offline calibration sweeps only; defaults are the
// shipped values. Near-term stays sharp (accurate day-ahead) and uncertainty
// ramps with lead, so the tradable risk lives further out — which is where a
// hedge can actually transfer risk.
const _n = (v, d) => (v === undefined || v === "" || isNaN(Number(v)) ? d : Number(v));
const _env = (typeof process !== "undefined" && process.env) || {};
const TS_A = _n(_env.ICE_TS_A, 2.0), TS_B = _n(_env.ICE_TS_B, 1.2);
const RS_A = _n(_env.ICE_RS_A, 0.30), RS_B = _n(_env.ICE_RS_B, 0.16);
const tempSigma = (lead) => TS_A + TS_B * lead;   // °F — observation noise
const rainSigma = (lead) => RS_A + RS_B * lead;   // noise on the 0/1 rain signal

// Climatology of the scored period — the PRIOR the forecast shrinks toward at
// long lead. Using the real marginal (not a flat prior) is what makes the
// implied probabilities calibrated, so every contract has ~zero expected P&L.
const _highs = TEST.map((d) => d.temp_high);
const CLIM_MEAN = _highs.reduce((a, b) => a + b, 0) / _highs.length;
const CLIM_VAR = _highs.reduce((a, b) => a + (b - CLIM_MEAN) ** 2, 0) / _highs.length;
const RAIN_BASE = TEST.reduce((a, d) => a + (d.rained ? 1 : 0), 0) / TEST.length;

/**
 * The market's view of TEST day `target`, as seen `lead` days earlier.
 * Deterministic in (target, lead) — identical for every team, every run.
 *
 * Temperature: a noisy observation of the truth, combined with the
 * climatological prior via a normal–normal Bayesian update, so the quoted
 * P(high < X) is a CALIBRATED predictive probability (mean = base rate → zero
 * expected profit). At long lead the noise dominates and the price sits near
 * the climatological base rate; as the day nears it converges on the truth.
 * Rain: the Bayesian posterior from a noisy 0/1 signal against the real rain
 * frequency — calibrated, and it can't leak the answer (the signal is noisy).
 */
function marketView(target, lead) {
  const d = TEST[target];
  if (!d) return null;
  const rand = rngFrom(`ice|fc|${target}|${lead}`);

  // Normal–normal posterior for the high: prior N(CLIM_MEAN, CLIM_VAR),
  // observation obs = truth + N(0, sT²).
  let tempMean, tempSd;
  if (lead === 0) {
    tempMean = d.temp_high; tempSd = 0;
  } else {
    const sT = tempSigma(lead);
    const obs = d.temp_high + sT * gauss(rand);
    const postVar = 1 / (1 / CLIM_VAR + 1 / (sT * sT));
    tempMean = round2(postVar * (CLIM_MEAN / CLIM_VAR + obs / (sT * sT)));
    tempSd = Math.sqrt(postVar);
  }

  let pRain;
  if (lead === 0) {
    pRain = d.rained ? 1 : 0;
  } else {
    const sR = rainSigma(lead);
    const y = d.rained + sR * gauss(rand);
    // posterior ∝ prior × likelihood of y under each hypothesis
    const lo = Math.exp(-((y - 0) ** 2) / (2 * sR * sR)) * (1 - RAIN_BASE);
    const hi = Math.exp(-((y - 1) ** 2) / (2 * sR * sR)) * RAIN_BASE;
    pRain = clampP(hi / (hi + lo));
  }

  const pBelow = (thr) => (lead === 0 ? (d.temp_high < thr ? 1 : 0) : clampP(normCdf((thr - tempMean) / tempSd)));
  const prices = {};
  for (const c of ICE.contracts) {
    if (c.key === "rain_yes") prices[c.key] = round4(pRain);
    else if (c.key === "rain_no") prices[c.key] = round4(1 - pRain);
    else {
      const thr = Number(c.key.split("_")[1]);
      const below = pBelow(thr);
      prices[c.key] = round4(c.key.startsWith("under") ? below : 1 - below);
    }
  }
  return { tempMean, tempSd: round2(tempSd), pRain: round4(pRain), prices };
}

/** What a contract is worth once its day arrives: 1 if it happened, else 0. */
function settleValue(key, d) {
  const c = ICE.contracts.find((x) => x.key === key);
  return c && c.wins(d) ? 1 : 0;
}

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

/**
 * Normalize the strategy's return into desired holdings keyed "key@offset".
 * Accepts { under_70: 500 } (offset 0 shorthand) and { "under_70@3": 500 }.
 * Anything not mentioned is treated as "hold none" — i.e. sold.
 */
function sanitizeDesired(out) {
  const want = new Map();
  if (!out || typeof out !== "object") return want;
  for (const [rawKey, rawQty] of Object.entries(out)) {
    if (!Number.isFinite(rawQty)) continue;
    const [key, offRaw] = String(rawKey).split("@");
    if (!KEYS.includes(key)) continue;
    const off = offRaw === undefined ? 0 : Math.trunc(Number(offRaw));
    if (!Number.isInteger(off) || off < 0 || off >= HORIZON) continue;
    const qty = Math.trunc(rawQty);
    if (qty === 0) continue;
    want.set(`${key}@${off}`, qty);
  }
  return want;
}

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
 * Returns leaderboard numbers plus a full per-day log (visualizer + CSV).
 */
export function simulateIce(fn) {
  const training = trainingView();
  let cash = ICE.startReserves;
  let bankruptcies = 0, billAccrued = 0, dayInCycle = 0, cum = 0;
  const profits = [];
  const history = [];
  const days = [];
  let errored = false;

  // Open positions: Map "key|targetIndex" → { key, target, qty, mark }
  const book = new Map();

  for (let t = 0; t < TEST.length; t++) {
    const d = TEST[t];

    // Today's quotes for every tradable date (offset 0 = today, settles tonight).
    const markets = [];
    for (let off = 0; off < HORIZON; off++) {
      const mv = marketView(t + off, off);
      if (mv) markets.push({ offset: off, date: TEST[t + off].date, tempMean: mv.tempMean, tempSd: mv.tempSd, pRain: mv.pRain, prices: mv.prices });
    }
    const priceOf = (key, off) => markets[off]?.prices[key];

    // 1) MARK TO MARKET — carry P&L from every open position as prices moved.
    let mtm = 0;
    for (const p of book.values()) {
      const off = p.target - t;
      const now = off >= 0 && off < HORIZON ? priceOf(p.key, off) : p.mark;
      if (now != null) { mtm += p.qty * (now - p.mark); p.mark = now; }
    }

    // 2) The bot decides what portfolio it wants to hold today.
    const positions = [...book.values()].map((p) => ({
      contract: p.key, offset: p.target - t, date: TEST[p.target]?.date, qty: p.qty, price: p.mark,
    }));
    const day = {
      t, daysTotal: TEST.length,
      date: d.date, dow: d.dow, weekend: d.weekend, holiday: d.holiday,
      horizon: HORIZON,
      markets,
      prices: markets[0].prices,          // today's market (settles tonight)
      forecastHigh: markets[0].tempMean,  // = today's actual high
      positions,
      cash, reserves: cash,
      daysUntilBill: ICE.billEveryDays - dayInCycle,
      billAccrued, history, training,
      dailyCost: ICE.dailyCost,
      rng: rngFrom(`ice|day${t}`),
    };

    let raw;
    try { raw = fn(day); } catch { raw = null; errored = true; }
    let want = sanitizeDesired(raw);

    // Cap total exposure — scale the whole desired book down if oversized.
    let gross = [...want.values()].reduce((s, q) => s + Math.abs(q), 0);
    if (gross > MAX_CONTRACTS) {
      const scale = MAX_CONTRACTS / gross;
      const scaled = new Map();
      for (const [k, q] of want) {
        const nq = Math.trunc(q * scale);
        if (nq !== 0) scaled.set(k, nq);
      }
      want = scaled;
    }

    // 3) TRADE to the desired book at today's prices. Trades themselves are
    //    cash-neutral (margin); the profit already came from the mark-to-market
    //    above, so selling a risen contract locks that gain in permanently.
    const trades = [];
    for (const [wk, qty] of want) {
      const [key, offStr] = wk.split("@");
      const off = Number(offStr);
      const target = t + off;
      const price = priceOf(key, off);
      if (price == null) continue;
      const id = `${key}|${target}`;
      const cur = book.get(id);
      const prevQty = cur?.qty ?? 0;
      if (qty !== prevQty) trades.push({ contract: key, offset: off, date: TEST[target].date, from: prevQty, to: qty, price });
      if (cur) { cur.qty = qty; cur.mark = price; }
      else book.set(id, { key, target, qty, mark: price });
    }
    // Anything the bot no longer lists is closed out (sold) at today's mark.
    for (const [id, p] of [...book.entries()]) {
      const off = p.target - t;
      const wk = `${p.key}@${off}`;
      if (!want.has(wk)) {
        if (p.qty !== 0) trades.push({ contract: p.key, offset: off, date: TEST[p.target]?.date, from: p.qty, to: 0, price: p.mark });
        book.delete(id);
      }
    }

    // 4) SETTLE everything whose day is today: the price becomes the outcome.
    let settled = 0;
    for (const [id, p] of [...book.entries()]) {
      if (p.target !== t) continue;
      const val = settleValue(p.key, d);
      settled += p.qty * (val - p.mark);
      book.delete(id);
    }

    const hedgePnl = mtm + settled;
    cash += d.revenue + hedgePnl;

    const profit = d.revenue - ICE.dailyCost + hedgePnl;
    cum += profit;
    profits.push(profit);

    billAccrued += ICE.dailyCost;
    dayInCycle++;
    let billed = false, bankrupt = false;
    if (dayInCycle === ICE.billEveryDays) {
      cash -= billAccrued;
      if (cash < 0) { bankruptcies++; cash = ICE.startReserves; bankrupt = true; }
      else if (cash > ICE.reserveCap) cash = ICE.reserveCap;
      billAccrued = 0; dayInCycle = 0; billed = true;
    }

    const openQty = [...book.values()].reduce((s, p) => s + Math.abs(p.qty), 0);
    days.push({
      t, date: d.date, dow: d.dow,
      forecastHigh: markets[0].tempMean, tempHigh: d.temp_high, precip: d.precip, rained: d.rained,
      prices: markets[0].prices,
      markets: markets.map((m) => ({ offset: m.offset, date: m.date, tempMean: m.tempMean, tempSd: m.tempSd, pRain: m.pRain })),
      trades, openContracts: openQty,
      mtm: round2(mtm), settled: round2(settled), hedgePnl: round2(hedgePnl),
      revenue: d.revenue, profit: round2(profit), cum: round2(cum),
      reserves: round2(cash), billed, bankrupt,
    });
    history.push({
      date: d.date, tempHigh: d.temp_high, rained: d.rained,
      revenue: d.revenue, profit: round2(profit), reserves: round2(cash),
      hedgePnl: round2(hedgePnl),
    });
  }

  const mean = profits.reduce((a, b) => a + b, 0) / profits.length;
  const sd = Math.sqrt(profits.reduce((a, b) => a + (b - mean) ** 2, 0) / profits.length);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(365) : 0;

  return {
    sharpe: round2(sharpe), bankruptcies,
    meanDaily: round2(mean), sd: round2(sd),
    totalProfit: round2(cum), finalReserves: round2(cash),
    testDays: TEST.length, cycles: Math.floor(TEST.length / ICE.billEveryDays),
    days, errored,
  };
}

/** Compile + smoke test. Returns { ok, run } or { ok:false, error }. */
export function prepareIceCode(src) {
  const v = validateIceCode(src);
  if (!v.ok) return v;
  let fn;
  try { fn = compileIceCode(src); } catch (e) { return { ok: false, error: `syntax error: ${e.message}` }; }
  try {
    const markets = [];
    for (let off = 0; off < HORIZON; off++) {
      const mv = marketView(off, off);
      markets.push({ offset: off, date: TEST[off].date, tempMean: mv.tempMean, tempSd: mv.tempSd, pRain: mv.pRain, prices: mv.prices });
    }
    const probe = {
      t: 0, daysTotal: TEST.length, date: TEST[0].date, dow: TEST[0].dow, weekend: TEST[0].weekend, holiday: TEST[0].holiday,
      horizon: HORIZON, markets, prices: markets[0].prices, forecastHigh: markets[0].tempMean,
      positions: [], cash: ICE.startReserves, reserves: ICE.startReserves,
      daysUntilBill: 14, billAccrued: 0, history: [], training: trainingView(),
      dailyCost: ICE.dailyCost, rng: rngFrom("smoke"),
    };
    const out = fn(probe);
    if (out !== undefined && out !== null && typeof out !== "object") {
      return { ok: false, error: "decide(day) must return an object of contracts to hold, e.g. { under_70: 500 } or { 'under_70@3': 500 } (or {} to hold nothing)" };
    }
  } catch (e) {
    return { ok: false, error: `the code crashed when run: ${e.message}` };
  }
  return { ok: true, run: fn };
}

/** The 5 years of training data as CSV text (for the download button). */
export function trainingCsv() {
  const cols = ["date", "dow", "weekend", "holiday", "temp_high", "precip", "rained", "forecast_high", "p_below_65", "p_below_70", "p_below_75", "p_below_80", "p_rain", "revenue"];
  const lines = [cols.join(",")];
  for (const d of TRAIN) lines.push(cols.map((c) => d[c]).join(","));
  return lines.join("\n");
}

export const ICE_INFO = { trainDays: TRAIN.length, testDays: TEST.length, horizon: HORIZON };
