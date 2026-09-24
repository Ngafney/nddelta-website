import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { PxButton, Spinner } from "./PixelBits.jsx";

/** The rules, fetched from the server so there is exactly one copy of them. */
export default function Rules({ onClose }) {
  const [rules, setRules] = useState(null);

  useEffect(() => {
    let gone = false;
    api
      .get("rules")
      .then((r) => !gone && setRules(r))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, []);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card rules-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>HOW THIS WORKS</h2>
          <button className="xclose" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        {!rules ? (
          <Spinner text="LOADING" />
        ) : (
          <>
            <div className="marketcards">
              {rules.markets.map((m) => (
                <div key={m.key} className={`marketcard ${m.key}`}>
                  <b>{m.name}</b>
                  <span>{m.blurb}</span>
                </div>
              ))}
            </div>
            <Markdownish text={rules.rules} />
            <p className="dim">{rules.dataNote}</p>
          </>
        )}
        <PxButton onClick={onClose}>GOT IT</PxButton>
      </div>
    </div>
  );
}

/**
 * Just enough markdown for the rules text: paragraphs and **bold**. A whole
 * parser would be more code than the thing it renders.
 */
function Markdownish({ text }) {
  return (
    <div className="prose">
      {text.split("\n\n").map((para, i) => (
        <p key={i}>
          {para.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((bit, j) => {
            if (bit.startsWith("**") && bit.endsWith("**")) return <b key={j}>{bit.slice(2, -2)}</b>;
            if (bit.startsWith("`") && bit.endsWith("`")) return <code key={j}>{bit.slice(1, -1)}</code>;
            return <React.Fragment key={j}>{bit}</React.Fragment>;
          })}
        </p>
      ))}
    </div>
  );
}
