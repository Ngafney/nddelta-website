/**
 * The rules, fetched from the server so the text students read and the text
 * the engine enforces cannot drift apart.
 */
import React from "react";
import { money } from "./PixelBits.jsx";

export default function Rules({ rules, round }) {
  if (!rules) return <div className="panel">loading…</div>;
  const prior = rules.priors?.[round?.prior];
  const settlement = rules.settlements?.[round?.settlement];

  return (
    <>
      {round && (
        <div className="panel">
          <div className="panel-title">THIS ROUND</div>
          <div className="kv">
            <span>how p was drawn</span>
            <b>{prior ? `${prior.name} — ${prior.blurb}` : "—"}</b>
          </div>
          <div className="kv">
            <span>what a share pays</span>
            <b>{settlement ? settlement.blurb : "—"}</b>
          </div>
          <div className="kv">
            <span>one flip costs</span>
            <b>{money(round.simCostC)}</b>
          </div>
          <div className="kv">
            <span>one more flip during trading</span>
            <b>{money(round.liveFlipCostC)}</b>
          </div>
          <div className="kv">
            <span>starting cash</span>
            <b>{money(round.startCashC)}</b>
          </div>
          <div className="kv">
            <span>flip window · trading</span>
            <b>
              {round.simSeconds}s · {round.minutes} min
            </b>
          </div>
        </div>
      )}

      <div className="panel rules open">
        <div className="panel-title">THE COIN MARKET</div>
        <Body text={rules.marketRules} />
      </div>

      <div className="panel rules open">
        <div className="panel-title">THE BANDIT LAB</div>
        <Body text={rules.banditRules} />
      </div>

      <div className="panel">
        <div className="panel-title">LIMITS</div>
        <div className="rules-body">
          <p>
            Up to <b>{rules.limits.maxSharesPerOrder}</b> shares an order, <b>{rules.limits.maxOrdersPerPlayer}</b> resting
            orders each, <b>{rules.limits.teamSize}</b> players a team, and at most <b>{rules.sims.max}</b> flips a round.
          </p>
        </div>
      </div>
    </>
  );
}

function Body({ text }) {
  return (
    <div className="rules-body">
      {text.split("\n\n").map((para, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: bold(para) }} />
      ))}
    </div>
  );
}

/** Only **bold** — the rules text is ours, not user input. */
function bold(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\\\*/g, "*");
}
