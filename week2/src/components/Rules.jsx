/**
 * The rules, fetched from the server so the text students read and the text
 * the engine enforces cannot drift apart.
 */
import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Rules({ mode }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("rules").then(setData).catch(() => {});
  }, []);

  if (!data) return <div className="panel">loading…</div>;
  const text = mode === "prediction" ? data.predictionRules : data.rules;

  return (
    <>
      <div className="panel rules open">
        <div className="panel-title">HOW IT WORKS</div>
        <div className="rules-body">
          {text.split("\n\n").map((para, i) => (
            <p key={i} dangerouslySetInnerHTML={{ __html: bold(para) }} />
          ))}
        </div>
      </div>

      {mode !== "prediction" && (
        <div className="panel">
          <div className="panel-title">THE FUNCTION</div>
          <div className="rules-body">
            <p>{data.tip}</p>
            <p>
              The admin picks how nasty it is before the round. From easiest to hardest:
            </p>
          </div>
          <div className="difficulties">
            {data.order.map((k) => (
              <div key={k} className="diff">
                <span className="dn">{data.difficulties[k].name}</span>
                <span className="db">{data.difficulties[k].blurb}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">LIMITS</div>
        <div className="rules-body">
          <p>
            Up to <b>{data.limits.maxLotsPerOrder}</b> lots an order, <b>{data.limits.maxOrdersPerPlayer}</b> resting
            orders each, <b>{data.limits.teamSize}</b> players a team
            {mode === "prediction" ? "" : <>, and <b>{data.limits.maxPointsPerPlayer}</b> points on the curve</>}.
          </p>
        </div>
      </div>
    </>
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
