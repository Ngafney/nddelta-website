import React, { useEffect, useState } from "react";
import room from "./room.js";
import App from "@week/src/App.jsx";

/**
 * Weeks 1–4 do not export their floor; the default App picks it by pathname,
 * and /solo/week3/ is the floor. Around it, one line the live game does not
 * need: in solo the bandit lab has no AI behind it, and the player should know
 * that before typing a paragraph the quick compiler cannot read.
 */
const labOpen = () => {
  try {
    return localStorage.getItem("w3game") === "bandit";
  } catch {
    return false;
  }
};

function Floor() {
  const [lab, setLab] = useState(labOpen);
  useEffect(() => {
    const check = () => setTimeout(() => setLab(labOpen()), 0);
    document.addEventListener("click", check, true);
    return () => document.removeEventListener("click", check, true);
  }, []);
  return (
    <>
      {lab && (
        <div className="solo3-labnote" role="note">
          <b>Solo: no AI here.</b> Your plan is compiled by the offline quick-compiler. It reads plans like "explore 10 flips, then the best",
          "flip each coin twice, then the most heads", "epsilon 5%", "UCB c=0.5", "Thompson sampling", "pretend each coin starts with 1 head
          and 1 tail, then flip the best", or "stay on a coin until it comes up tails twice in a row, then move to the next". Always read
          step 3 to check what it actually wrote.
        </div>
      )}
      <App />
    </>
  );
}

export default { ...room, Floor };
