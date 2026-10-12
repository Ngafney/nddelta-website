/**
 * Eleven big buttons, 0 to 10. The one thing every team has to do.
 */
import React from "react";

export default function NumberPick({ value, onPick, disabled = false, big = false }) {
  return (
    <div className={`numpick ${big ? "big" : ""}`} role="radiogroup" aria-label="your team's number">
      {Array.from({ length: 11 }, (_, n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          className={`numbtn ${value === n ? "on" : ""}`}
          disabled={disabled}
          onClick={() => onPick(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
