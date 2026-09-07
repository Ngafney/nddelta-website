/**
 * The contract guide: every contract you can buy, drawn against the money.
 *
 * This exists because the single most expensive mistake in this game is buying
 * the WRONG SIDE — "over_70" pays on warm days, when the shop is already rich,
 * so it is an anti-hedge that makes bankruptcy MORE likely. Words didn't stop
 * it, so here it is as a picture: real revenue by temperature, the $1,800 cost
 * line, and each contract drawn over the temperatures where it actually pays —
 * green when it pays in the loss zone (a hedge), red when it pays in the profit
 * zone (a bet on good weather).
 */
import React from "react";
import { ICE_ECON } from "../../shared/rules.js";

const LO = 55, HI = 90;                 // temperature axis
const x = (t) => ((t - LO) / (HI - LO)) * 100; // → %

// `avg` is the real average revenue on the days each contract pays, so the
// label is measured, not asserted. A contract that pays on almost every day
// (under_80) is priced near $1 and barely separates good days from bad — it is
// a weak hedge, and saying so is more useful than colouring it green.
const TEMP_ROWS = [
  { key: "under_65", from: LO, to: 65, hedge: true, avg: 1050, tag: "HEDGE" },
  { key: "under_70", from: LO, to: 70, hedge: true, avg: 1301, tag: "HEDGE" },
  { key: "under_75", from: LO, to: 75, hedge: true, avg: 1576, tag: "HEDGE" },
  { key: "under_80", from: LO, to: 80, hedge: true, avg: 1822, tag: "WEAK", weak: true },
  { key: "over_65", from: 65, to: HI, hedge: false, avg: 2351, tag: "BET" },
  { key: "over_70", from: 70, to: HI, hedge: false, avg: 2520, tag: "BET" },
  { key: "over_75", from: 75, to: HI, hedge: false, avg: 2706, tag: "BET" },
  { key: "over_80", from: 80, to: HI, hedge: false, avg: 2875, tag: "BET" },
];

export default function ContractGuide() {
  const { tempBands, costPerDay, rain, breakEvenTemp } = ICE_ECON;
  const maxRev = Math.max(...tempBands.map((b) => b.revenue));
  const costY = (costPerDay / maxRev) * 100;

  return (
    <div className="cg">
      {/* ── revenue vs temperature, with the cost line ── */}
      <div className="cg-title">WHAT THE SHOP EARNS, BY TEMPERATURE</div>
      <div className="cg-chart">
        <div className="cg-cost" style={{ bottom: `${costY}%` }}>
          <span>${costPerDay.toLocaleString()} costs — you break even here</span>
        </div>
        {tempBands.map((b) => {
          const losing = b.revenue < costPerDay;
          return (
            <div className="cg-bar" key={b.lo} style={{ left: `${x(b.lo)}%`, width: `${x(b.hi) - x(b.lo)}%` }}>
              <div className={`cg-fill ${losing ? "bad" : "good"}`} style={{ height: `${(b.revenue / maxRev) * 100}%` }}>
                <span className="cg-val">${b.revenue.toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="cg-axis">
        {[55, 60, 65, 70, 75, 80, 85].map((t) => (
          <span key={t} style={{ left: `${x(t)}%` }}>{t}°</span>
        ))}
        <span style={{ left: "100%" }}>90°+</span>
      </div>
      <div className="cg-zones">
        <span className="z bad" style={{ left: 0, width: `${x(breakEvenTemp)}%` }}>LOSING MONEY</span>
        <span className="z good" style={{ left: `${x(breakEvenTemp)}%`, width: `${100 - x(breakEvenTemp)}%` }}>MAKING MONEY</span>
      </div>

      {/* ── each contract, over the temperatures where it pays ── */}
      <div className="cg-title" style={{ marginTop: 18 }}>WHERE EACH CONTRACT PAYS $1</div>
      {TEMP_ROWS.map((r) => {
        const cls = r.weak ? "weak" : r.hedge ? "hedge" : "bet";
        return (
          <div className="cg-row" key={r.key}>
            <code className={cls}>{r.key}</code>
            <div className="cg-track">
              <i className="cg-mark" style={{ left: `${x(breakEvenTemp)}%` }} />
              <div className={`cg-span ${cls}`} style={{ left: `${x(r.from)}%`, width: `${x(r.to) - x(r.from)}%` }}>
                pays $1 here · shop earns ${r.avg.toLocaleString()}/day
              </div>
            </div>
            <span className={`cg-tag ${cls}`}>{r.tag}</span>
          </div>
        );
      })}

      {/* ── rain ── */}
      <div className="cg-title" style={{ marginTop: 18 }}>RAIN</div>
      <div className="cg-rain">
        <div className="cg-rainbox bad">
          <div className="k">RAINY DAY</div>
          <div className="v">${rain.wet.revenue.toLocaleString()}</div>
          <div className="s">{rain.wet.days} days · below cost</div>
          <code className="hedge">rain_yes</code>
          <span className="cg-tag hedge">HEDGE</span>
        </div>
        <div className="cg-rainbox good">
          <div className="k">DRY DAY</div>
          <div className="v">${rain.dry.revenue.toLocaleString()}</div>
          <div className="s">{rain.dry.days} days · above cost</div>
          <code className="bet">rain_no</code>
          <span className="cg-tag bet">BET</span>
        </div>
      </div>

      <div className="cg-note">
        Read a row as: on the days this contract pays out, the shop takes in that much
        revenue. Costs are ${costPerDay.toLocaleString()} every day, so anything under that line is a
        day you lost money. (The hottest band is 85°+ — the data runs to 110°.)
      </div>

      <div className="cg-note">
        <b>A hedge has to pay on the days that hurt you.</b> The green contracts pay when the shop is
        losing money — that cash arrives exactly when you can't cover the bill. The red ones pay on
        days you were already profitable, so they drain you on cold and wet days and make bankruptcy{" "}
        <i>more</i> likely. <code>under_80</code> is marked WEAK because it pays on almost every day —
        its price is already near $1, so it hardly separates a bad day from a good one.
      </div>

      <div className="cg-note">
        Pick the day with <code>@0</code>–<code>@7</code>: <code>@0</code> is today, <code>@7</code> is
        a week out — so <code>under_70@3</code> is "the high is under 70° three days from now".
        Quantities are whole numbers and may be negative (a short). Anything you don't list is sold.
      </div>
    </div>
  );
}
