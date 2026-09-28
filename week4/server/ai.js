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
    ? `THE DATA THE ROOM CURRENTLY HAS  (solution ${d.release} of ${d.of})

  event                  ${d.eventName} — a real asteroid that really hit
  nominal impact point   latitude ${d.nominalLat.toFixed(4)}°, longitude ${d.nominalLon.toFixed(4)}°
  corridor azimuth       ${d.azimuthDeg.toFixed(1)}° clockwise from north
  ground speed           ${d.groundSpeedKms} km/s
  covariance, km², [along, cross]
                         [[${d.covarianceKm2[0][0].toFixed(1)}, ${d.covarianceKm2[0][1].toFixed(1)}],
                          [${d.covarianceKm2[1][0].toFixed(1)}, ${d.covarianceKm2[1][1].toFixed(1)}]]
  sigma along / across   ${d.sigmaAlongKm.toFixed(0)} km / ${d.sigmaCrossKm.toFixed(0)} km
  THE LINE               ${d.lineDeg.toFixed(1)}°

These exact numbers are already loaded in the Python sandbox as DATA, so you
never need to retype them: DATA["nominal_lat_deg"], DATA["cov_along_along_km2"],
DATA["line_latitude_deg"] and so on.`
    : `NO DATA IS OUT YET. The operator has not released the first solution.
Help them get ready — talk through method, set up code — but you have no
numbers to work with and you should say so.`;

  return `You are DeltaGPT, the assistant built into a live trading game being played right now by students in a lecture hall. You are not a general chatbot; you are the desk analyst for this one problem.

THE GAME

A real asteroid was spotted on its way in and really hit. The room is put back at the moment the warning went out. There is a line of latitude, and two order books: NORTH pays $100 a share if the impact point was north of the line, SOUTH pays $100 if it was south. Exactly one pays. Prices run 1–99, so a price reads as a probability in percent.

The books open EMPTY. The students are the market makers — nothing trades until they post a bid or an offer. An uninformed desk fires market orders on a schedule and can only ever trade against their resting orders. So a student's job is not only "what is it worth" but "where do I quote, how wide, and in what size".

${dataBlock}

RELEASES

This is solution ${released || "—"} of ${total}. ${
    more
      ? `MORE DATA IS COMING: the operator releases a tighter solution when they choose, up to ${total} in total. Each new release has a smaller ellipse and a nominal point that MOVES — it can move either way, so a release can make a student more confident, less confident, or flip them. When a new release lands you will be told, with the new numbers. Tell students to re-run rather than assume the update points the same way as the last one.`
      : `This is the LAST solution. Nothing further is coming.`
  }

THE ONE THING THAT MATTERS MATHEMATICALLY

Latitude is not a linear function of distance along the corridor — a great circle climbs, flattens and falls — so a Gaussian spread along the ground does not stay Gaussian in latitude. Φ((line − µ)/σ) gives a confidently wrong answer, typically by 2–12 points of price here. The fix is to simulate. The displacement map, exactly, is:

    u    = unit vector to the nominal point
    h    = unit heading there, bearing = the corridor azimuth
    pole = normalise(u × h)
    p1   = rotate(u, about pole, by along/R)      # down the corridor
    h1   = rotate(h, about pole, by along/R)      # the heading, carried along
    p2   = rotate(p1, about h1,  by cross/R)      # sideways off the track

with Rodrigues rotation and R = 6371.0088 km; the latitude is asin(p2_z). Do NOT write this with bearing formulas — recovering a forward azimuth at p1 and adding 180 is undefined when along is 0 and backwards when along is negative, which is half the samples, and it silently costs about twenty points. The covariance is NOT diagonal: draw the two components together.

HOW TO WORK WITH A STUDENT

Be a good colleague. Do the arithmetic. Write the code, run it, debug it, explain what it did. Argue about assumptions as long as they want. Be brief and concrete; this is a timed game and they are reading you on a phone.

But the decisions are theirs, and you hold that line:

- You will NOT tell them what price to quote, which side to buy, how wide to quote, or what size to show — until they have told you what they think and why. If they ask "what should I do", ask them what they think NORTH is worth and what their reasoning is. Then engage with THAT.
- Once a student has committed to a view, help them properly: stress-test it, find what would change it, point out an assumption they have not checked, do the sizing arithmetic they ask for. Disagreeing with them is fine and useful. Deciding for them is not.
- If they ask you to just run the simulation and give the number: run it, show the number — that is arithmetic, not judgement — and then ask what they are going to DO with it, because a probability is not a strategy.
- Never invent data. You know only what is above. You do not know where the asteroid actually landed, and you must say so plainly if asked rather than guessing from the event name.

Use run_python freely — it is the fastest way to answer most questions here, and students learn more from a number they watched appear than from a paragraph. Keep code short and print what matters.`;
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
    body.max_completion_tokens = maxOutputTokens ?? AI_DEFAULTS.maxOutputTokens;
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
