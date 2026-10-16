/**
 * How the bots read the chart. Every model here sees exactly what a student
 * sees, the public series (history, then the live ticks printed so far), K
 * and the ticks left, and turns it into a price for "Y_T > K" in points.
 *
 * These are the ways people actually price this contract at the meeting:
 *
 *   bayes   (alpha)     OLS on everything, bias-corrected, with an honest
 *                       question about whether φ is really below 1, and a
 *                       running check that the recent ticks still fit
 *   window  (steady)    plain OLS on the last stretch of data, priced with the
 *                       AR(1) forecast. Fine when φ < 1; in a random walk the
 *                       small-sample bias drags it toward 50
 *   frozen  (anchored)  fitted once when the book opened and never again
 *   rw      (stale, fat-finger)  assumes a random walk: the naive desk's mistake
 *   chase   (gambler)   a random walk, but it extrapolates the last few ticks
 *
 * Pure functions, no I/O: the headless harness and the tab share them.
 */
import { fitAR1, diffSigma, Phi } from "../../week5/shared/process.js";

/** P(Y_h > K) for an AR(1) (φ < 1) or a random walk (φ = 1) from y now. */
export function priceAR(y, K, h, phi, mu, sigma) {
  if (h <= 0) return y > K ? 1 : 0;
  const s = Math.max(1e-6, sigma);
  if (phi >= 0.99999 || mu == null || !Number.isFinite(mu)) {
    return Phi((y - K) / (s * Math.sqrt(h)));
  }
  const ph = Math.pow(phi, h);
  const m = mu + ph * (y - mu);
  const v = (s * s * (1 - ph * ph)) / (1 - phi * phi);
  return Phi((m - K) / Math.sqrt(Math.max(1e-9, v)));
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A random walk: Φ((y − K)/(σ̂√h)), σ̂ from first differences. */
export function rwPrice(ys, K, h) {
  const s = diffSigma(ys) || 1;
  return priceAR(ys[ys.length - 1], K, h, 1, null, s);
}

/** Plain OLS on the last `win` points, φ̂ clipped at 1. */
export function windowFit(ys, win) {
  const xs = ys.slice(-win);
  const f = fitAR1(xs);
  if (!f) return null;
  const phi = Math.max(-0.5, Math.min(1, f.phi));
  const mu = phi < 0.999 && f.mu != null && Math.abs(f.mu - mean(xs)) < 25 ? f.mu : mean(xs);
  return { phi, mu, sigma: f.sigma };
}

export function windowPrice(ys, K, h, win = 1000) {
  const f = windowFit(ys, win);
  if (!f) return rwPrice(ys, K, h);
  return priceAR(ys[ys.length - 1], K, h, f.phi, f.mu, f.sigma);
}

const logit = (p) => Math.log(p / (1 - p));
const sigm = (x) => 1 / (1 + Math.exp(-x));

/**
 * What a careful student does with the lesson's prompt.
 *
 *  1. OLS on every row, then Kendall's small-sample correction, since OLS φ̂
 *     runs low by about (1 + 3φ)/n.
 *  2. Is φ distinguishable from 1? The further φ̂ sits below 1 in standard
 *     errors, the less weight the random walk gets (a soft unit-root test).
 *  3. Has it changed? Over the last stretch of live ticks, compare how well
 *     "the AR(1) I fitted" and "a random walk" explain them, and move weight
 *     toward whichever is doing better.
 *
 * Returns the price and the weight on "random walk", which the sim reports.
 */
export function bayesPrice(ys, K, h, liveTicks) {
  const f = fitAR1(ys);
  const y = ys[ys.length - 1];
  if (!f) return { p: rwPrice(ys, K, h), wRW: 1 };
  const n = f.n;
  const phiK = Math.min(1, f.phi + (1 + 3 * f.phi) / n);
  const se = Math.max(1e-4, f.sePhi);
  const t = (1 - phiK) / se;
  let w = 1 - Phi(t - 1.6);
  const mu = mean(ys);
  const sig = f.sigma;
  const sRW = diffSigma(ys) || sig;

  // Recent fit: the last up-to-24 live ticks, μ fixed at the level of the
  // whole series (that is where an AR(1) would pull it).
  const W = Math.min(24, liveTicks);
  if (W >= 6 && phiK < 0.999) {
    let ssrAR = 0;
    let ssrRW = 0;
    for (let i = ys.length - W; i < ys.length; i++) {
      const prev = ys[i - 1];
      const eAR = ys[i] - (mu + phiK * (prev - mu));
      const eRW = ys[i] - prev;
      ssrAR += eAR * eAR;
      ssrRW += eRW * eRW;
    }
    const llr = (ssrAR - ssrRW) / (2 * sig * sig); // > 0: the random walk explains the recent ticks better
    const wc = Math.min(0.97, Math.max(0.03, w));
    w = sigm(logit(wc) + Math.max(-3, Math.min(6, llr * 1.5)));
  }
  const pRW = priceAR(y, K, h, 1, null, sRW);
  // μ is estimated too: widen the AR forecast by how unsure the level is.
  const varMu = (sig * sig) / Math.max(1e-4, (1 - phiK) * (1 - phiK) * ys.length);
  const ph = Math.pow(phiK, h);
  const sigEff = Math.sqrt(sig * sig + (varMu * (1 - ph) * (1 - ph) * (1 - phiK * phiK)) / Math.max(1e-6, 1 - ph * ph));
  const pAR = priceAR(y, K, h, phiK, mu, sigEff);
  return { p: w * pRW + (1 - w) * pAR, wRW: w };
}

/** A momentum chaser: extrapolates the last few ticks, then assumes a random walk. */
export function chasePrice(ys, K, h) {
  const k = Math.min(4, ys.length - 1);
  const y = ys[ys.length - 1];
  const slope = (y - ys[ys.length - 1 - k]) / k;
  const s = diffSigma(ys) || 1;
  return priceAR(y + slope * Math.min(h, 6), K, h, 1, null, s);
}

/** Which model each kind of student uses. */
export const MODEL_OF = {
  alpha: "bayes",
  steady: "window",
  anchored: "frozen",
  stale: "rw",
  fatfinger: "rw",
  gambler: "chase",
};
