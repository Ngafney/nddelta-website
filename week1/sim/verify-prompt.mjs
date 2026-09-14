/**
 * Step 6 — the deliverable is PLAIN ENGLISH, so prove the round trip.
 *
 * Sends each written strategy to the live in-game compiler, then scores the
 * code the AI actually produced against the reconstructed field. A strategy
 * only ships if the AI's own version of it scores well — otherwise the wording
 * is wrong, however good the idea is.
 *
 * usage: node sim/verify-prompt.mjs            (verifies all)
 */
import { evaluate, evaluateRobust } from "./engine.mjs";

const BASE = "https://www.nddelta.com/api/week1";

const J = async (method, path, body) => {
  const r = await fetch(`${BASE}/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};

export async function newTeam() {
  const t = await J("POST", "team", { name: "sim" + Math.floor(Math.random() * 1e6) });
  return { teamId: t.teamId, token: t.token };
}

export async function compilePrompt(auth, prompt) {
  const r = await J("POST", "compile", { ...auth, game: "pd", prompt });
  if (r.refused) return { ok: false, reason: r.reason };
  if (r.error) return { ok: false, reason: r.error };
  return { ok: true, code: r.code, explain: r.explain, summary: r.summary };
}

/** Compile a prompt, then score the AI's code on the reconstructed field. */
export async function verify(auth, name, prompt) {
  const c = await compilePrompt(auth, prompt);
  if (!c.ok) return { name, ok: false, reason: c.reason };
  const r = evaluateRobust(c.code);
  if (!r.ok) return { name, ok: false, reason: "sandbox rejected: " + r.error };
  const d = evaluate(c.code, { detail: true, variantIndex: 0 });
  return { name, ok: true, avg: r.avg, worst: r.worst, best: r.best, code: c.code, explain: c.explain, rows: d.rows };
}
