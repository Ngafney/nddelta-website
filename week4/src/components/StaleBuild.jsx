/**
 * "You are running an old version of this page."
 *
 * A tab left open across a redeploy keeps running whatever JavaScript it
 * loaded, forever — it has no reason to ask for the page again. During an event
 * that is genuinely dangerous: a round gets fixed between games and half the
 * room is still on the old build, behaving differently from the other half and
 * reporting bugs that no longer exist.
 *
 * So the page checks. It knows its own bundle from `import.meta.url` (Vite puts
 * a content hash in the filename), fetches the entry HTML occasionally, and
 * compares. If the server is serving a different bundle than the one running,
 * it says so and offers a reload.
 *
 * It never reloads on its own: doing that to somebody mid-trade would be worse
 * than the staleness. The banner waits to be clicked.
 */
import React, { useEffect, useState } from "react";

/** The bundle this code was loaded from, e.g. "index-B7aDJTII.js". */
function runningBundle() {
  try {
    const m = String(import.meta.url).match(/[^/]+\.js(?:\?.*)?$/);
    return m ? m[0].split("?")[0] : null;
  } catch {
    return null;
  }
}

const CHECK_MS = 90_000;

export default function StaleBuild({ base = "/week4/" }) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const mine = runningBundle();
    // In dev there is no hashed bundle to compare, so there is nothing to do.
    if (!mine || !/-[A-Za-z0-9_-]{6,}\.js$/.test(mine)) return undefined;

    let stop = false;
    const check = async () => {
      if (stop || stale || document.visibilityState !== "visible") return;
      try {
        const html = await fetch(`${base}?v=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
        const served = html.match(/assets\/([^"']+\.js)/)?.[1];
        if (served && served !== mine) setStale(true);
      } catch {
        /* offline, or the deploy is mid-flight — try again later */
      }
    };

    const t = setInterval(check, CHECK_MS);
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    check();
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [base, stale]);

  if (!stale) return null;
  return (
    <div className="stalebar">
      <span>This page is an old version — reload to get the current one.</span>
      <button className="pxbtn pxbtn--sm" onClick={() => window.location.reload()}>
        RELOAD
      </button>
    </div>
  );
}
