import "./secret.js";
import "@solo/env.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { installHandler, local } from "@solo/local.js";
import { handle } from "@week/server/handler.js";
import SoloShell from "@solo/SoloShell.jsx";
import game from "./game.js";
import "@week/src/styles.css";
import "./solo5.css";

installHandler(handle);

/**
 * The data panel's DOWNLOAD CSV is a plain link to /api/week5/data.csv. In solo
 * there is no network API (and on nddelta.com that path is the LIVE game), so
 * the click is caught here and the same route is asked of the in-tab server:
 * the file is the handler's own csvText, byte for byte.
 */
document.addEventListener(
  "click",
  async (e) => {
    const a = e.target?.closest?.('a[href*="/api/week5/data.csv"]');
    if (!a) return;
    e.preventDefault();
    const qs = a.getAttribute("href").split("?")[1] ?? "";
    try {
      const out = await local.get(`data.csv?${qs}`);
      const url = URL.createObjectURL(new Blob([out.__raw], { type: out.__contentType || "text/csv" }));
      const dl = document.createElement("a");
      dl.href = url;
      dl.download = out.__filename || "horizon.csv";
      document.body.appendChild(dl);
      dl.click();
      dl.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      window.alert(`Could not build the CSV: ${err.message}`);
    }
  },
  true
);

createRoot(document.getElementById("root")).render(<SoloShell game={game} />);
