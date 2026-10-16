/**
 * The room's laptops. Two of these run in the background of a solo game: one
 * does the bots' Monte Carlo on each release as it is published, the other
 * builds the next rock before anybody asks for it. The tab never stalls.
 *
 *   { id, kind: "analyse", d, opts }   → { id, ok, out }   (posted twice: a quick
 *                                        pass, then the full one, as `partial`)
 *   { id, kind: "build", seed, opts }  → { id, ok, out }
 */
import { analyse } from "./sky.js";
import { buildSpec } from "./build.js";

self.onmessage = (ev) => {
  const { id, kind } = ev.data ?? {};
  try {
    if (kind === "analyse") {
      const { d, opts = {} } = ev.data;
      // A rough answer first, the way a team posts something and then refines.
      const quick = analyse(d, { clean: 60, raw: 40, seed: opts.seed });
      self.postMessage({ id, ok: true, partial: true, out: quick });
      const full = analyse(d, { clean: opts.clean ?? 300, raw: opts.raw ?? 150, seed: opts.seed });
      self.postMessage({ id, ok: true, out: full });
    } else if (kind === "build") {
      self.postMessage({ id, ok: true, out: buildSpec(ev.data.seed, ev.data.opts) });
    } else {
      self.postMessage({ id, ok: false, error: `unknown job ${kind}` });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: e?.message ?? String(e) });
  }
};
