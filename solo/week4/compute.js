/**
 * Where the heavy arithmetic happens, behind one small interface, so the bots
 * (room.js) do not care whether it runs in a browser worker or, in the
 * headless harness, in a Node worker thread.
 *
 * A backend is { analyse(d, opts, onPartial) → Promise<out>, build(seed, opts) → Promise<spec> }.
 */

let backend = null;

export function setBackend(b) {
  backend = b;
}

/* ── the bots' analysis, one per release, shared by the whole room ─────── */

const cache = new Map();

/**
 * The room's working on one release. Every bot holds the same sightings, so
 * one computation serves all of them; what differs is how much of it each one
 * uses, and how long it takes them to get round to it.
 *
 * Returns { partial, partialAt, full, fullAt } — fields fill in as the worker
 * finishes. Never blocks.
 */
export function analysisFor(key, d) {
  let c = cache.get(key);
  if (c) return c;
  c = { key, partial: null, partialAt: 0, full: null, fullAt: 0, failed: false };
  cache.set(key, c);
  while (cache.size > 14) cache.delete(cache.keys().next().value);
  if (!backend) return c;
  backend
    .analyse(d, { seed: key }, (out) => {
      c.partial = out;
      c.partialAt = Date.now();
    })
    .then((out) => {
      c.full = out;
      c.fullAt = Date.now();
      if (!c.partial) {
        c.partial = out;
        c.partialAt = c.fullAt;
      }
    })
    .catch((e) => {
      c.failed = true;
      console.warn("[solo w4] analysis failed", e?.message ?? e);
      cache.delete(key);
    });
  return c;
}

export function peekAnalysis(key) {
  return cache.get(key) ?? null;
}

/* ── the next rock, built before anybody asks ─────────────────────────── */

let next = null;

/** Start building a rock now if one is not already on the way. */
export function prefetchSpec() {
  if (!backend || next) return;
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  next = backend.build(seed, { refits: 80 }).catch((e) => {
    console.warn("[solo w4] could not build a rock", e?.message ?? e);
    return null;
  });
}

/** A built rock (waiting for it if it is still in the oven), and start the one after. */
export async function takeSpec() {
  for (let tries = 0; tries < 3; tries++) {
    prefetchSpec();
    const p = next;
    next = null;
    const spec = await p;
    prefetchSpec();
    if (spec) return spec;
  }
  throw new Error("could not build a round — reload the page and try again");
}
