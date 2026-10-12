/**
 * Getting in: your name, then a team — and the team's number.
 *
 *   name  →  CREATE TEAM (name it, pick 0–10, get a code to read out)
 *         →  JOIN TEAM   (type the code someone read out)
 *
 * One account per device, so typing a second name on the same browser signs
 * you back into the first one rather than minting a rival.
 */
import React, { useEffect, useState } from "react";
import { api, deviceId, fingerprint, withPlayer } from "../api.js";
import { PixelSprite, PxButton, Spinner, DELTA, DELTA_PALETTE } from "./PixelBits.jsx";
import NumberPick from "./NumberPick.jsx";

export default function Gate({ player, round, me, limits, team, onHold, onPlayer, onDone }) {
  const onTeam = onDone;
  const [step, setStep] = useState(player ? "choose" : "name");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const sealed = !!round?.locked;

  return (
    <div className="wrap wrap--narrow">
      <div className="gate">
        <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={6} className="delta-big" />
        <h1>THE SUM</h1>
        <div className="sub">
          WEEK 6 · OPTIONS
          <br />
          EVERY TEAM HIDES A NUMBER · TRADE THE SUM OF THEM
        </div>

        {step === "name" && (
          <NameStep
            busy={busy}
            setBusy={setBusy}
            err={err}
            setErr={setErr}
            onDone={(p) => {
              onPlayer(p);
              setStep("choose");
            }}
          />
        )}

        {step === "choose" && (
          <>
            <div className="gate-choice">
              <div className={`choice ${sealed ? "off" : ""}`} onClick={() => !sealed && setStep("create")} role="button" tabIndex={0}>
                <span className="ico">🎲</span>
                <span className="lbl">CREATE TEAM</span>
                <span className="desc">{sealed ? "The numbers are locked for this round — join a team instead." : "Name it, pick your number, read the code out."}</span>
              </div>
              <div className="choice" onClick={() => setStep("join")} role="button" tabIndex={0}>
                <span className="ico">🔑</span>
                <span className="lbl">JOIN TEAM</span>
                <span className="desc">Type the four-character code from whoever made the team.</span>
              </div>
            </div>
            <div className="hint" style={{ textAlign: "center" }}>
              Playing as <b style={{ color: "var(--gold)" }}>{player?.name ?? me?.name ?? "you"}</b>. Up to {round?.teamSize ?? 4} to a team, one number per team — you trade
              your own money, and the leaderboard scores your team on its average.
            </div>
          </>
        )}

        {(step === "create" || step === "join") && (
          <TeamStep
            mode={step}
            limits={limits}
            team={team}
            onHold={onHold}
            player={player}
            busy={busy}
            setBusy={setBusy}
            err={err}
            setErr={setErr}
            onBack={() => {
              setErr(null);
              setStep("choose");
            }}
            onDone={onTeam}
          />
        )}

        {step === "name" && <div className="press-start">PRESS START TO PLAY</div>}
      </div>
    </div>
  );
}

function NameStep({ busy, setBusy, err, setErr, onDone }) {
  const [name, setName] = useState("");

  async function go(e) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await api.post("join", { name: name.trim(), deviceId: deviceId(), fp: fingerprint() });
      onDone(res);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={go}>
        <input type="text" placeholder="YOUR NAME" value={name} maxLength={18} autoFocus onChange={(e) => setName(e.target.value)} />
        <PxButton type="submit" disabled={busy || name.trim().length < 2}>
          {busy ? <Spinner text="JOINING" /> : "START"}
        </PxButton>
      </form>
      {err && <div className="err">{err}</div>}
      <div className="hint" style={{ textAlign: "center" }}>
        One account per device. If this browser has already played, typing any name signs you back into the account it already has.
      </div>
    </>
  );
}

function TeamStep({ mode, player, team, onHold, busy, setBusy, err, setErr, onBack, onDone }) {
  const [value, setValue] = useState("");
  const [number, setNumber] = useState(null);
  const [made, setMade] = useState(null);

  // The code screen stays up until the player says they are done with it.
  useEffect(() => {
    if (!made) return undefined;
    onHold?.(true);
    return () => onHold?.(false);
  }, [made, onHold]);

  async function go(e) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      if (mode === "create") {
        if (number == null) throw new Error("pick your team's number first");
        const res = await api.post("team/create", withPlayer(player, { name: value.trim(), number }));
        setMade(res.team);
      } else {
        const res = await api.post("team/join", withPlayer(player, { code: value.trim() }));
        onDone(res.team);
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  if (made) {
    const here = team?.members ?? [];
    const num = team?.number ?? made.number;
    return (
      <>
        <div className="field-label" style={{ textAlign: "center" }}>
          {made.name} — YOUR TEAM CODE
        </div>
        <div className="codebox">{made.code}</div>
        <div className="hint" style={{ textAlign: "center" }}>
          <b style={{ color: "var(--gold)" }}>Read this out to your team.</b> Up to {made.max ?? 4} of you, including you.
        </div>
        <div className="yournum">
          <i>YOUR TEAM&#39;S NUMBER</i>
          <b>{num}</b>
          <small>Only your team can see it. Any of you can change it until the host opens trading.</small>
        </div>

        <div className="joinlist">
          {Array.from({ length: made.max }, (_, i) => {
            const m = here[i];
            return (
              <div key={i} className={`joinslot ${m ? "in" : ""}`}>
                {m ? m.name : "empty"}
              </div>
            );
          })}
        </div>
        <div className="hint" style={{ textAlign: "center" }}>
          {here.length} of {made.max} in so far. They can still join after you go in.
        </div>

        <div className="mt">
          <PxButton variant="green" onClick={() => onDone(made)}>
            I HAVE READ IT OUT — GO →
          </PxButton>
        </div>
      </>
    );
  }

  return (
    <>
      <form onSubmit={go}>
        <input
          type="text"
          className={mode === "join" ? "code-input" : ""}
          placeholder={mode === "create" ? "TEAM NAME" : "CODE"}
          value={value}
          maxLength={mode === "create" ? 20 : 4}
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setValue(mode === "join" ? e.target.value.toUpperCase() : e.target.value)}
        />
        {mode === "join" && (
          <PxButton type="submit" disabled={busy || value.trim().length < 4}>
            {busy ? <Spinner text="…" /> : "JOIN"}
          </PxButton>
        )}
      </form>
      {mode === "create" && (
        <>
          <div className="field-label mt" style={{ textAlign: "center" }}>
            YOUR TEAM'S SECRET NUMBER · 0 TO 10
          </div>
          <NumberPick value={number} onPick={setNumber} big />
          <div className="hint" style={{ textAlign: "center" }}>
            It goes into the draw with everyone else's. Nobody outside your team will know which one is yours — not even when it comes out.
          </div>
          <div className="mt">
            <PxButton type="button" onClick={go} disabled={busy || value.trim().length < 2 || number == null}>
              {busy ? <Spinner text="…" /> : number == null ? "PICK A NUMBER" : `CREATE WITH ${number}`}
            </PxButton>
          </div>
        </>
      )}
      {err && <div className="err">{err}</div>}
      <div className="mt">
        <PxButton variant="ghost" small onClick={onBack}>
          ← BACK
        </PxButton>
      </div>
    </>
  );
}
