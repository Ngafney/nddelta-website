import React, { useEffect, useState } from "react";
import room from "./room.js";
import App from "@week/src/App.jsx";

/**
 * Weeks 1–4 do not export their floor; the default App picks it by pathname,
 * and /solo/week3/ is the floor. Around it, one line the live game does not
 * need: the AI may be unreachable, and then a built-in reader compiles instead.
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
          <b>The same AI as the meeting writes your strategy.</b> If it can't be reached, a built-in reader steps in: it understands plans like "explore 10 flips, then the best", "epsilon 5%", "UCB c=0.5", "Thompson sampling" or "pretend each coin starts with 1 head and 1 tail, then flip the best". Either way, read step 3 to check what it actually wrote.
        </div>
      )}
      <App />
    </>
  );
}

export default { ...room, Floor };
