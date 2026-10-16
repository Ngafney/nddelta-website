import "./env.js";
import "@solo/env.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { installHandler, local } from "@solo/local.js";
import { handle } from "@week/server/handler.js";
import SoloShell from "@solo/SoloShell.jsx";
import game from "./game.js";
import { patchResponse } from "./room.js";
import { setBackend, prefetchSpec } from "./compute.js";
import "@week/src/styles.css";
import "./solo4.css";

/* ── the room's laptops: two workers, so the tab never stalls ─────────── */

function pool() {
  const w = new Worker(new URL("./sky.worker.js", import.meta.url), { type: "module" });
  let seq = 0;
  const jobs = new Map();
  w.onmessage = (ev) => {
    const { id, ok, partial, out, error } = ev.data;
    const j = jobs.get(id);
    if (!j) return;
    if (!ok) {
      jobs.delete(id);
      j.reject(new Error(error));
    } else if (partial) j.onPartial?.(out);
    else {
      jobs.delete(id);
      j.resolve(out);
    }
  };
  return (msg, onPartial) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      jobs.set(id, { resolve, reject, onPartial });
      w.postMessage({ ...msg, id });
    });
}
const brain = pool();
const oven = pool();
setBackend({
  analyse: (d, opts, onPartial) => brain({ kind: "analyse", d, opts }, onPartial),
  build: (seed, opts) => oven({ kind: "build", seed, opts }),
});
// Start building the first rock while the setup screen is still up.
prefetchSpec();

/* ── the server, in this tab ──────────────────────────────────────────── */

installHandler(async (method, route, body, query) => patchResponse(route, await handle(method, route, body, query)));

/* The DATA tab's "download CSV" is a plain link to /api/week4/data.csv. In
   solo there is no /api, so the click is answered from the in-tab server. */
document.addEventListener(
  "click",
  (e) => {
    const a = e.target?.closest?.('a[href*="/api/week4/data.csv"]');
    if (!a) return;
    e.preventDefault();
    const q = Object.fromEntries(new URL(a.href, location.href).searchParams);
    local
      .get("data.csv", q)
      .then((r) => {
        const url = URL.createObjectURL(new Blob([r.__raw], { type: "text/csv" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = r.__filename || "sightings.csv";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      })
      .catch((err) => console.warn("[solo w4] csv", err.message));
  },
  true
);

createRoot(document.getElementById("root")).render(<SoloShell game={game} />);
