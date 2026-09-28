/**
 * DeltaGPT — the in-house assistant the room talks to.
 *
 * WHY THIS EXISTS
 * ---------------
 * The round is meant to be solvable by describing it to a model and arguing
 * about the assumptions. Left to their own devices a room reaches for six
 * different chatbots, half of which cannot run code, none of which know what
 * a "release" is, and all of which have to be re-briefed from scratch by every
 * team. So the game brings its own: one model, one key, the round's numbers
 * already in front of it, and a Python runtime in the browser.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * Hand over the answer. It is briefed to do the arithmetic, write and debug the
 * code, and argue about method as much as anyone likes — and to refuse to name
 * a price, a side, or a quote until the student has said what they think and
 * why. That line is drawn in the system prompt below and is the whole reason
 * this is a custom assistant rather than a link to a chatbot.
 *
 * THE KEY
 * -------
 * Never reaches the browser. It comes from OPENAI_API_KEY if the environment
 * has one, and otherwise from whatever the operator pasted into the control
 * room, which is kept server-side in the same store as everything else.
 */

// Overridable so the whole chain can be tested against a stand-in without a
// key. Never set in production; there is no path from a request to this value.
const OPENAI_URL = process.env.OPENAI_BASE_URL
  ? `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`
  : "https://api.openai.com/v1/chat/completions";

/** What the operator can change without a deploy. */
export const AI_DEFAULTS = {
  model: "gpt-4.1",
  temperature: 0.4,
  maxTurns: 40,
  maxOutputTokens: 2000,
};

/** Models the control room offers. The operator may also type any other id. */
export const AI_MODELS = ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o"];

/**
 * The tool the model gets: Python, run in the student's own browser.
 *
 * Execution happens client-side in Pyodide, so nothing a student runs can cost
 * us anything or reach anything. The server only ferries the call and the
 * result back and forth.
 */
export const PYTHON_TOOL = {
  type: "function",
  function: {
    name: "run_python",
    description:
      "Run Python in the student's browser and get stdout back. numpy is available. " +
      "The round's data is preloaded as a dict called DATA and as a pandas-free " +
      "set of plain floats. Print what you want to see; nothing is returned implicitly.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "The Python to run. Use print() for output." },
        why: { type: "string", description: "One short line: what this is meant to show." },
      },
      required: ["code"],
    },
  },
};

/**
 * The brief.
 *
 * Written as instructions to a colleague rather than a list of prohibitions,
 * because a model told only what it may not do finds the nearest thing it may.
 */
export function systemPrompt(ctx) {
  const d = ctx.solution;
  const released = ctx.released ?? 0;
  const total = ctx.totalReleases ?? 6;
  const more = released < total;

  const dataBlock = d
    ? `WHAT THE ROOM HAS (release ${d.release} of ${d.of})

  ${d.sightings.length} sightings over ${d.arcDays} days, each 1-sigma ${d.sightingSigmaKm} km
  in x and in y independently. About one in twenty-five is a BLUNDER rather
  than noise - off by five to forty sigma - and nobody is told which.

  GM_sun        ${d.gmSun} AU^3/day^2  (+/- ${d.gmSunRelSigma} fractional)
  GM_earth      ${d.gmEarth} AU^3/day^2
  Earth orbit   Kepler ellipse: a=${d.earth.aAu} e=${d.earth.e}
                period=${d.earth.periodDays} d, peri=${d.earth.peri} rad, M0=${d.earth.M0} rad
                its own position is uncertain by about ${d.earthEphemSigmaKm} km
  Earth radius  ${d.earthRadiusAu} AU = ${d.earthRadiusKm} km
  encounter     near day ${d.tEncounter}; integrate to day ${d.tEnd}

The sightings are preloaded in the Python sandbox. Use these names exactly:

  T   - numpy array of times in days
  X   - numpy array of x positions in AU
  Y   - numpy array of y positions in AU
  DATA["sighting_sigma_au"]   DATA["gm_sun"]   DATA["gm_earth"]
  DATA["earth_a_au"]  DATA["earth_e"]  DATA["earth_period_days"]
  DATA["earth_peri_rad"]  DATA["earth_M0_rad"]
  DATA["earth_radius_au"]  DATA["au_km"]  DATA["t_encounter"]  DATA["t_end"]`
    : `NOTHING IS RELEASED YET. Help them get ready - talk through the method,
write the integrator - but there are no sightings to fit.`;

  return `You are DeltaGPT, the assistant built into a live trading game being played right now by students in a lecture hall. You are the desk analyst for this one problem.

THE GAME

An asteroid has been sighted a few times. Does it hit the Earth on its next pass, or miss? Two order books, HIT and MISS; exactly one pays $100 a share. Prices run 1-99 so a price reads as a probability in percent. The books open EMPTY - the students are the market makers, and an uninformed desk fires market orders that can only trade against their resting orders.

THE PHYSICS - and it really is just this

Two dimensions, Sun at the origin, Newtonian gravity from the Sun AND the Earth:

    r_sun   = the rock's position
    a       = -GM_sun * r_sun / |r_sun|^3  -  GM_earth * (r - r_earth) / |r - r_earth|^3

Three bodies, but the rock's mass is negligible so it is a restricted problem: the Earth moves on its own fixed Kepler ellipse regardless of the rock. Solve Kepler's equation for the Earth's position (Newton's method, 10 iterations, e is only 0.0167), integrate the rock with RK4.

${dataBlock}

WHAT A TEAM ACTUALLY HAS TO DO

  1. FIT. Four unknowns - x, y, vx, vy at t=0 - to two numbers per sighting.
     Least squares with a numerical propagator. Gauss-Newton or
     scipy.optimize.least_squares both work. A crude starting guess is fine:
     the first sighting's position, and (last - first)/elapsed for velocity.
  2. LOOK AT THE RESIDUALS. This is the step that separates teams. A blunder
     shows up at five sigma or worse. Show the student the residuals and let
     THEM decide whether to drop it, down-weight it, or keep it. Do not
     silently clean the data.
  3. MONTE CARLO. Jitter every sighting by its error, refit, propagate to the
     encounter, record the closest approach. Several hundred refits. P(hit) is
     the fraction that come within one Earth radius of the Earth's CENTRE.

TWO THINGS THAT SILENTLY RUIN THE ANSWER

  The integrator step must SHRINK near the Earth. A fixed quarter-day step
  moves 200,000 km; it walks straight past the planet and reports a clean miss.
  Scale the step by the distance to the Earth.

  The closest approach must be refined inside the bracketing interval - golden
  section or a fine re-scan - not read off the coarse scan. The distance can
  fall by a lunar distance in a few hours.

Vectorising the refits over samples is the difference between a second and a minute. Cap iteration counts so nothing hangs.

RELEASES

Release ${released || "-"} of ${total}. ${
    more
      ? `MORE SIGHTINGS ARE COMING. Each release adds observations to the same campaign - the ones they already have do not change. The arc lengthens, the fit tightens, and the probability can move a long way in either direction. When a release lands you will be told.`
      : `This is the LAST release.`
  }

HOW TO WORK WITH A STUDENT

Be a good colleague. Write the integrator, write the fit, run it, debug it, explain what it did. Be brief and concrete; this is timed and they are reading you on a phone.

The decisions are theirs and you hold that line. What to do about a suspect sighting, how many samples, whether the Earth's own uncertainty is worth modelling - ask what they want, offer the trade-offs, and let them choose. You will NOT tell them what price to quote, which book to lift, how wide or what size, until they have told you what they think and why. Running the simulation and reporting a number is arithmetic - just do it - but then ask what they intend to do with it.

Never invent data. You do not know the true orbit and you must say so rather than guess.

Use run_python freely. Sanity-check before reporting: residuals should sit near 1 sigma for the sightings you kept, and a propagate-then-propagate-back round trip should return to where it started.`;
}

/** The key, from the environment or from whatever the operator pasted. */
export function apiKeyFrom(state) {
  return (process.env.OPENAI_API_KEY || state?.ai?.key || "").trim();
}

/**
 * One call to OpenAI.
 *
 * Errors are translated into something an operator can act on, because the
 * failure a room will actually hit is an unset or expired key and "fetch
 * failed" is not a useful thing to read in front of sixty people.
 */
export async function chat({ key, model, messages, tools, temperature, maxOutputTokens, signal }) {
  const body = {
    model: model || AI_DEFAULTS.model,
    messages,
    ...(tools ? { tools, tool_choice: "auto" } : {}),
  };
  // The newer reasoning models reject both of these, and take a different
  // token cap. Send them only where they are understood.
  if (/^gpt-(4|4o|4\.1|3\.5)/.test(body.model)) {
    body.temperature = temperature ?? AI_DEFAULTS.temperature;
    body.max_tokens = maxOutputTokens ?? AI_DEFAULTS.maxOutputTokens;
  } else {
    // The reasoning models spend tokens thinking before they write anything,
    // and that spend comes out of the SAME budget. Measured against gpt-5 at a
    // 2000 cap: it thought for the whole allowance and returned an empty reply
    // with no tool call, which on screen is DeltaGPT saying nothing at all.
    // Give them room.
    body.max_completion_tokens = Math.max(maxOutputTokens ?? AI_DEFAULTS.maxOutputTokens, 8000);
  }

  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw Object.assign(new Error(`could not reach OpenAI: ${e.message}`), { status: 502 });
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Object.assign(new Error(`OpenAI sent something that is not JSON (${res.status})`), { status: 502 });
  }

  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`;
    const hint =
      res.status === 401
        ? "the API key is missing, wrong, or revoked — set it in the control room"
        : res.status === 429
        ? "the key is rate limited or out of credit"
        : res.status === 404
        ? `no model called "${body.model}" on this key — pick another in the control room`
        : null;
    throw Object.assign(new Error(hint ? `${msg} (${hint})` : msg), { status: res.status === 401 ? 503 : 502 });
  }

  const choice = data.choices?.[0];
  if (!choice) throw Object.assign(new Error("OpenAI returned no reply"), { status: 502 });
  return { message: choice.message, finish: choice.finish_reason, usage: data.usage ?? null };
}
