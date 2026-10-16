import "@solo/env.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { installHandler } from "@solo/local.js";
import { handle } from "@week/server/handler.js";
import SoloShell from "@solo/SoloShell.jsx";
import game from "./game.jsx";
import "@week/src/styles.css";
import "./solo3.css";

/**
 * The week's real handler, with one courtesy: a bandit run plays 10,000 games
 * in this tab and holds the page for a second or so. Yield to the browser
 * first so the "PLAYING 10,000 GAMES" spinner is on screen while it does.
 */
const yieldFirst = new Set(["POST bandit/run", "POST bandit/compile"]);
installHandler(async (method, route, body, query) => {
  if (yieldFirst.has(`${method} ${route}`)) await new Promise((r) => setTimeout(r, 60));
  return handle(method, route, body, query);
});

createRoot(document.getElementById("root")).render(<SoloShell game={game} />);
