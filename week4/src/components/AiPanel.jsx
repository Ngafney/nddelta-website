import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, withPlayer } from "../api.js";
import { PxButton, Spinner } from "./PixelBits.jsx";

/**
 * DeltaGPT — the assistant, and a Python runtime, in a tab.
 *
 * The model runs on our key behind the server; the CODE runs here, in the
 * student's own browser, under Pyodide. That split is what makes this cheap and
 * safe: nothing a student executes touches our machines, the round's numbers
 * are already in the namespace, and a laptop that has loaded Pyodide once keeps
 * working on a lecture-hall network that has given up.
 *
 * The loop is the ordinary tool-calling one. The model asks to run code, we run
 * it, we hand back stdout, and it carries on — so from the student's side it
 * simply thinks, computes, and answers.
 */

const NL = String.fromCharCode(10);

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";

/** Load Pyodide once per page, on demand. numpy comes with it. */
let pyodidePromise = null;
function loadPyodide(onNote) {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    onNote?.("fetching the Python runtime (once, ~10 MB)");
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = PYODIDE;
      s.onload = res;
      s.onerror = () => rej(new Error("could not load Pyodide from the CDN"));
      document.head.appendChild(s);
    });
    const py = await window.loadPyodide({ indexURL: PYODIDE.replace("pyodide.js", "") });
    onNote?.("loading numpy");
    await py.loadPackage("numpy");
    onNote?.(null);
    return py;
  })().catch((e) => {
    pyodidePromise = null; // let a flaky network be retried
    throw e;
  });
  return pyodidePromise;
}

/** Put the sightings and the constants in the namespace, as numpy arrays. */
function dataLiteral(d) {
  if (!d) return "DATA = {}" + NL + "T = X = Y = None" + NL;
  const kv = {
    sighting_sigma_au: d.sightingSigmaKm / d.auKm,
    sighting_sigma_km: d.sightingSigmaKm,
    earth_ephem_sigma_km: d.earthEphemSigmaKm,
    gm_sun: d.gmSun,
    gm_sun_rel_sigma: d.gmSunRelSigma,
    gm_earth: d.gmEarth,
    earth_a_au: d.earth.aAu,
    earth_e: d.earth.e,
    earth_period_days: d.earth.periodDays,
    earth_peri_rad: d.earth.peri,
    earth_M0_rad: d.earth.M0,
    earth_radius_au: d.earthRadiusAu,
    earth_radius_km: d.earthRadiusKm,
    au_km: d.auKm,
    t_encounter: d.tEncounter,
    t_end: d.tEnd,
    release: d.release,
    of: d.of,
  };
  const arr = (vals, n) => `${n} = np.array([` + vals.join(", ") + "])";
  return (
    "DATA = {" + NL +
    Object.entries(kv).map(([k, v]) => `    ${JSON.stringify(k)}: ${v},`).join(NL) +
    NL + "}" + NL +
    arr(d.sightings.map((s) => s.t), "T") + NL +
    arr(d.sightings.map((s) => s.x), "X") + NL +
    arr(d.sightings.map((s) => s.y), "Y") + NL
  );
}

const GREETING = `I'm DeltaGPT. I've got this round's numbers in front of me and I can run Python right here in your browser.

Ask me anything — but the calls are yours. I'll do the maths and argue about method all day; I won't tell you where to quote until you've told me what you think it's worth.

Try: **"simulate P(north) and show me the code"**, or **"why can't I just use a normal distribution?"**, or tell me your view and I'll try to break it.`;

export default function AiPanel({ player, round }) {
  const [solution, setSolution] = useState(null);
  const [msgs, setMsgs] = useState(() => []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [note, setNote] = useState(null);
  const [err, setErr] = useState(null);
  const endRef = useRef(null);
  const taRef = useRef(null);
  const released = round?.released ?? 0;
  const lastRelease = useRef(released);

  /* The round's own numbers, so the Python sandbox starts with them loaded. */
  useEffect(() => {
    if (!released || !player) return undefined;
    let live = true;
    api
      .get("data", withPlayer(player))
      .then((d) => live && setSolution(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [released, player]);

  useEffect(() => {
    let live = true;
    api
      .get("ai/status")
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus({ ready: false }));
    return () => {
      live = false;
    };
  }, []);

  // Restore the thread across reloads — a student who refreshes mid-round
  // should not lose the conversation they have been building.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("w4chat");
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length) setMsgs(saved);
      }
    } catch {
      /* a cleared or blocked store just means starting fresh */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("w4chat", JSON.stringify(msgs.slice(-60)));
    } catch {
      /* not worth an error */
    }
  }, [msgs]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  /* A new release is news the assistant has to hear about, mid-thread. */
  useEffect(() => {
    if (released > lastRelease.current && lastRelease.current > 0) {
      setMsgs((m) => [
        ...m,
        {
          role: "user",
          content: `[SYSTEM] Solution ${released} has just been released. The nominal point and the covariance have changed — the new numbers are in your brief and already reloaded into DATA in the sandbox. Tell me in one line what moved, then ask me what I want to do about it.`,
          _system: true,
        },
      ]);
      // and answer it straight away
      setTimeout(() => sendRef.current?.(true), 60);
    }
    lastRelease.current = released;
  }, [released]);

  const runPython = useCallback(
    async (code) => {
      const py = await loadPyodide(setNote);
      const prelude = [
        "import io, sys, json, math",
        "import numpy as np",
        dataLiteral(solution),
        "_buf = io.StringIO()",
        "_old = sys.stdout",
        "sys.stdout = _buf",
      ].join("\n");
      const epilogue = "\nsys.stdout = _old\n_buf.getvalue()";
      try {
        const out = await py.runPythonAsync(prelude + "\ntry:\n" +
          code.split("\n").map((l) => "    " + l).join("\n") +
          "\nexcept Exception as _e:\n    import traceback; traceback.print_exc(file=_buf)\n" +
          epilogue);
        const text = String(out ?? "");
        return text.length > 12_000 ? text.slice(0, 12_000) + "\n…[output truncated]" : text || "(no output — remember to print())";
      } catch (e) {
        return `Python could not run that:\n${e.message}`;
      }
    },
    [solution]
  );

  /**
   * One exchange, including however many code-running rounds the model wants.
   *
   * Capped, because a model that keeps calling a tool that keeps failing would
   * otherwise sit there spending the room's credit in a loop.
   */
  const send = useCallback(
    async (auto = false) => {
      if (busy) return;
      const text = input.trim();
      if (!auto && !text) return;
      setErr(null);
      let thread = auto ? msgs : [...msgs, { role: "user", content: text }];
      if (!auto) {
        setMsgs(thread);
        setInput("");
      }
      setBusy(true);
      try {
        for (let hop = 0; hop < 6; hop++) {
          const wire = thread
            .filter((m) => !m._note)
            .map(({ role, content, tool_calls, tool_call_id }) => ({ role, content, tool_calls, tool_call_id }));
          const r = await api.post("ai/chat", withPlayer(player, { messages: wire }));
          const m = r.message ?? {};
          thread = [...thread, { role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls }];
          setMsgs(thread);
          if (!m.tool_calls?.length) break;

          for (const call of m.tool_calls) {
            let args = {};
            try {
              args = JSON.parse(call.function?.arguments ?? "{}");
            } catch {
              args = {};
            }
            const code = String(args.code ?? "");
            setNote("running Python…");
            const out = await runPython(code);
            setNote(null);
            thread = [...thread, { role: "tool", tool_call_id: call.id, content: out, _code: code, _why: args.why }];
            setMsgs(thread);
          }
        }
      } catch (e) {
        setErr(e.code === "no-key" ? "DeltaGPT has no API key yet — ask the operator to set it in the control room." : e.message);
      } finally {
        setBusy(false);
        setNote(null);
      }
    },
    [busy, input, msgs, player, runPython]
  );
  const sendRef = useRef(send);
  sendRef.current = send;

  const shown = useMemo(() => msgs.filter((m) => !(m.role === "user" && m._system) || true), [msgs]);

  if (status && !status.ready) {
    return (
      <section className="panel aipanel">
        <div className="panel-title">DELTAGPT</div>
        <p className="hint">
          The assistant is not switched on yet — the operator needs to put an OpenAI key into the
          control room. Everything else in the game works without it; you can still download the
          data and use your own tools.
        </p>
      </section>
    );
  }

  return (
    <section className="panel aipanel">
      <div className="panel-title">
        DELTAGPT
        <span className="dim aimodel">{status?.model ? ` · ${status.model} · python runs in your browser` : ""}</span>
      </div>

      <div className="chat">
        {!msgs.length && <Bubble role="assistant" content={GREETING} />}
        {shown.map((m, i) =>
          m.role === "tool" ? (
            <ToolBubble key={i} code={m._code} why={m._why} out={m.content} />
          ) : m.role === "assistant" && !m.content && m.tool_calls?.length ? null : (
            <Bubble key={i} role={m.role} content={m.content} system={m._system} />
          )
        )}
        {busy && (
          <div className="chatrow assistant">
            <Spinner text={note ?? "thinking"} />
          </div>
        )}
        {err && <div className="chaterr">{err}</div>}
        <div ref={endRef} />
      </div>

      <div className="chatbox">
        <textarea
          ref={taRef}
          rows={2}
          value={input}
          placeholder={released ? "Ask DeltaGPT…  (Enter sends, Shift+Enter for a new line)" : "No data is out yet — but you can still talk method."}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <PxButton disabled={busy || !input.trim()} onClick={() => send()}>
          {busy ? "…" : "SEND"}
        </PxButton>
      </div>
      <div className="chatfoot">
        <button
          className="linky"
          onClick={() => {
            setMsgs([]);
            try {
              localStorage.removeItem("w4chat");
            } catch {
              /* nothing to clear */
            }
          }}
        >
          new conversation
        </button>
        <span className="dim">
          It knows this round's numbers and when new data lands. It will not tell you where to
          quote until you have told it what you think.
        </span>
      </div>
    </section>
  );
}

/** Minimal markdown: paragraphs, **bold**, `code`, and fenced blocks. */
function Bubble({ role, content, system }) {
  if (!content) return null;
  return (
    <div className={`chatrow ${role} ${system ? "sysnote" : ""}`}>
      <i className="who">{role === "user" ? (system ? "GAME" : "YOU") : "DELTAGPT"}</i>
      <div className="bubble">{renderMarkdown(content)}</div>
    </div>
  );
}

function ToolBubble({ code, why, out }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chatrow tool">
      <i className="who">PYTHON</i>
      <div className="bubble">
        {why && <div className="toolwhy">{why}</div>}
        <button className="linky" onClick={() => setOpen((o) => !o)}>
          {open ? "hide the code" : "show the code"}
        </button>
        {open && <pre className="code">{code}</pre>}
        <pre className="out">{out}</pre>
      </div>
    </div>
  );
}

function renderMarkdown(text) {
  const parts = String(text).split(/```(?:python|py|json|text)?\n?/);
  return parts.map((chunk, i) =>
    i % 2 === 1 ? (
      <pre key={i} className="code">
        {chunk.replace(/\n$/, "")}
      </pre>
    ) : (
      <span key={i}>
        {chunk.split("\n").map((line, j) => (
          <p key={j}>{inline(line)}</p>
        ))}
      </span>
    )
  );
}

function inline(line) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<b key={m.index}>{t.slice(2, -2)}</b>);
    else out.push(<code key={m.index}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
