/**
 * Buying information. Three things, all priced off your CURRENT cash, so each
 * one gets cheaper as you spend:
 *
 *   STEP     one gradient-descent iteration from a point you own — a flat
 *            $1,000. You pick the learning rate; the step is −rate × f'(x).
 *            A fixed price, unlike the other two, so it stays a real decision
 *            at every stack size instead of getting cheaper as you lose.
 *   POINT    any x you like, as an offset from a point you own — 5%.
 *   TICKET   1-in-20 to see the whole function — 5%.
 *
 * Nothing here names the domain: the offset is a relative move with a capped
 * size, and the descent readout only ever shows where YOUR step lands.
 */
import React, { useState } from "react";
import { PxButton, Spinner, money, num } from "./PixelBits.jsx";

const NUDGES = [-100, -25, -5, 5, 25, 100];

export default function ProbePanel({ me, anchorX, onAnchor, onProbe, onDescend, onTicket, busy, disabled, limits, odds = 20 }) {
  const points = me?.points ?? [];
  const anchor = points.find((p) => p.x === anchorX) ?? points[points.length - 1] ?? null;
  const [tab, setTab] = useState("step");
  const [offset, setOffset] = useState(25);
  const [lrExp, setLrExp] = useState(1); // learning rate = 10^lrExp

  const maxStep = limits?.maxProbeStep ?? 250;
  const [lrMin, lrMax] = limits?.learningRate ?? [0.01, 10000];

  if (!anchor) {
    return (
      <div className="panel">
        <div className="panel-title">BUY INFORMATION</div>
        <div className="hint">Waiting for your opening point…</div>
      </div>
    );
  }

  const lr = clamp(Math.pow(10, lrExp), lrMin, lrMax);
  const step = -lr * anchor.d;
  const descentTarget = round2(anchor.x + step);
  const stepTooBig = Math.abs(step) > maxStep;
  const stepTooSmall = points.some((p) => Math.abs(p.x - descentTarget) < 0.005);

  const probeTarget = round2(anchor.x + offset);
  const probeDuplicate = points.some((p) => Math.abs(p.x - probeTarget) < 0.005);

  const probeCost = me?.probeCostC ?? 0;
  const descentCost = me?.descentCostC ?? 0;
  const ticketCost = me?.ticketCostC ?? 0;
  const affordable = (c) => c <= (me?.spendableC ?? 0);

  return (
    <div className="panel">
      <div className="panel-title">BUY INFORMATION</div>

      {points.length > 1 && (
        <>
          <span className="field-label">FROM WHICH POINT</span>
          <div className="pointchips" style={{ marginTop: 0, marginBottom: 12 }}>
            {points.map((p) => (
              <button key={p.x} className={`chip ${p.x === anchor.x ? "on" : ""}`} onClick={() => onAnchor(p.x)}>
                x={num(p.x, 2)}
                <small>
                  {p.d > 0 ? "+" : ""}
                  {num(p.d, 2)}
                </small>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="buytabs">
        <button className={tab === "step" ? "on" : ""} onClick={() => setTab("step")}>
          DESCEND <i>{money(descentCost)}</i>
        </button>
        <button className={tab === "point" ? "on" : ""} onClick={() => setTab("point")}>
          POINT <i>5%</i>
        </button>
        <button className={tab === "luck" ? "on" : ""} onClick={() => setTab("luck")}>
          TICKET <i>5%</i>
        </button>
      </div>

      {tab === "step" && (
        <>
          <div className="formula">
            x ← x − <b>rate</b> × f′(x)
          </div>
          <span className="field-label">LEARNING RATE</span>
          <div className="probe-offset">{fmtRate(lr)}</div>
          <input
            type="range"
            min={Math.log10(lrMin)}
            max={Math.log10(lrMax)}
            step={0.01}
            value={lrExp}
            onChange={(e) => setLrExp(Number(e.target.value))}
            aria-label="learning rate"
          />
          <div className="probe-target">
            step <b style={{ color: step < 0 ? "var(--bid)" : "var(--ask)" }}>
              {step > 0 ? "+" : ""}
              {num(step, 2)}
            </b>{" "}
            → lands on <b>x = {num(descentTarget, 2)}</b>
          </div>
          <div className="nudge">
            {[-1, -0.25, 0.25, 1].map((d) => (
              <button key={d} onClick={() => setLrExp((v) => clamp(round2(v + d), Math.log10(lrMin), Math.log10(lrMax)))}>
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
            <button onClick={() => setLrExp(clamp(Math.log10(30 / (Math.abs(anchor.d) || 1)), Math.log10(lrMin), Math.log10(lrMax)))}>
              fit
            </button>
          </div>
          <div className="mt">
            <PxButton
              variant="green"
              style={{ width: "100%" }}
              disabled={busy || disabled || stepTooBig || stepTooSmall || !affordable(descentCost) || anchor.d === 0}
              onClick={() => onDescend(anchor.x, lr)}
            >
              {busy === "descend" ? (
                <Spinner text="DESCENDING" />
              ) : anchor.d === 0 ? (
                "THE SLOPE HERE IS ZERO"
              ) : stepTooBig ? (
                `STEP TOO BIG (MAX ${maxStep})`
              ) : stepTooSmall ? (
                "THAT STEP DOES NOT MOVE"
              ) : !affordable(descentCost) ? (
                "CASH IS COMMITTED"
              ) : (
                `DESCEND · ${money(descentCost)}`
              )}
            </PxButton>
          </div>
          <div className="hint">
            One iteration of gradient descent, at a flat {money(descentCost)} however much you have. A small rate
            creeps; too large and you fly past the bottom and come back up the other side. The slope you are standing
            on is <b>{num(anchor.d, 4)}</b>.
          </div>
        </>
      )}

      {tab === "point" && (
        <>
          <span className="field-label">OFFSET FROM x = {num(anchor.x, 2)}</span>
          <div className="probe-offset">
            {offset > 0 ? "+" : ""}
            {num(offset, 2)}
          </div>
          <div className="probe-target">
            lands on <b>x = {num(probeTarget, 2)}</b>
          </div>
          <input
            type="range"
            min={-maxStep}
            max={maxStep}
            step={sliderStep(maxStep)}
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value))}
            aria-label="offset from your anchor point"
          />
          <div className="nudge">
            {NUDGES.map((n) => (
              <button key={n} onClick={() => setOffset((o) => clamp(round2(o + n), -maxStep, maxStep))}>
                {n > 0 ? `+${n}` : n}
              </button>
            ))}
            <button onClick={() => setOffset((o) => -o)}>flip</button>
          </div>
          <div className="mt">
            <PxButton
              variant="blue"
              style={{ width: "100%" }}
              disabled={busy || disabled || probeDuplicate || !affordable(probeCost) || offset === 0}
              onClick={() => onProbe(anchor.x, offset)}
            >
              {busy === "probe" ? (
                <Spinner text="MEASURING" />
              ) : probeDuplicate ? (
                "YOU OWN THAT POINT"
              ) : !affordable(probeCost) ? (
                "CASH IS COMMITTED"
              ) : (
                `BUY POINT · ${money(probeCost)}`
              )}
            </PxButton>
          </div>
          <div className="hint">
            Any x you like, as long as it is within {maxStep} of a point you already hold. You get its height and its
            exact gradient.
          </div>
        </>
      )}

      {tab === "luck" && (
        <>
          <div className="ticket-big">🎲</div>
          <div className="ticket-odds">1 IN {odds} TO SEE THE ENTIRE FUNCTION</div>
          <div className="mt">
            <PxButton
              variant="purple"
              style={{ width: "100%" }}
              disabled={busy || disabled || !affordable(ticketCost) || me?.sawAll}
              onClick={onTicket}
            >
              {busy === "ticket" ? (
                <Spinner text="SCRATCHING" />
              ) : me?.sawAll ? (
                "YOU HAVE THE WHOLE CURVE"
              ) : !affordable(ticketCost) ? (
                "CASH IS COMMITTED"
              ) : (
                `BUY A TICKET · ${money(ticketCost)}`
              )}
            </PxButton>
          </div>
          <div className="hint">
            Every ticket is an independent roll. Nineteen times in twenty you have simply set fire to 5% of your money —
            which is, of course, exactly what makes the twentieth worth something.
          </div>
        </>
      )}

      <div className="hint" style={{ borderTop: "2px solid var(--line-dim)", paddingTop: 10, marginTop: 14 }}>
        Spent so far <b style={{ color: "var(--ink)" }}>{money(me?.spentC ?? 0)}</b> on {me?.descents ?? 0} step
        {me?.descents === 1 ? "" : "s"}, {me?.probes ?? 0} point{me?.probes === 1 ? "" : "s"} and {me?.tickets ?? 0}{" "}
        ticket{me?.tickets === 1 ? "" : "s"}. Every dollar of it comes off your score.
      </div>
    </div>
  );
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
const sliderStep = (maxStep) => (maxStep > 100 ? 0.5 : 0.1);

function fmtRate(lr) {
  if (lr >= 1000) return lr.toFixed(0);
  if (lr >= 10) return lr.toFixed(1);
  if (lr >= 1) return lr.toFixed(2);
  return lr.toPrecision(2);
}
