/**
 * Getting in: your name, then a team.
 *
 *   name  →  CREATE TEAM (name it, get a code to read out)
 *         →  JOIN TEAM   (type the code someone read out)
 *
 * One account per device, so typing a second name on the same browser signs
 * you back into the first one rather than minting a rival.
 */
import React, { useEffect, useState } from "react";
import { api, deviceId, fingerprint, withPlayer } from "../api.js";
import { PixelSprite, PxButton, Spinner, DELTA, DELTA_PALETTE } from "./PixelBits.jsx";

export default function Gate({ player, round, limits, onPlayer, onTeam }) {
  const [step, setStep] = useState(player ? "choose" : "name");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const modeName = round?.mode === "prediction" ? "PREDICTION MARKET" : "GRADIENT TRADING";

  return (
    <div className="wrap wrap--narrow">
      <div className="gate">
        <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={6} className="delta-big" />
        <h1>{round?.mode === "prediction" ? "DELTA MARKETS" : "GRADIENT TRADING"}</h1>
        <div className="sub">
          WEEK 2 · {modeName}
          <br />
          {round?.mode === "prediction" ? "ONE QUESTION · ONE BOOK" : "ONE CURVE · ONE HIDDEN MINIMUM"}
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
              <div className="choice" onClick={() => setStep("create")} role="button" tabIndex={0}>
                <span className="ico">🏴</span>
                <span className="lbl">CREATE TEAM</span>
                <span className="desc">Name it, then read the code out to the people sitting near you.</span>
              </div>
              <div className="choice" onClick={() => setStep("join")} role="button" tabIndex={0}>
                <span className="ico">🔑</span>
                <span className="lbl">JOIN TEAM</span>
                <span className="desc">Type the four-character code from whoever made the team.</span>
              </div>
            </div>
            <div className="hint" style={{ textAlign: "center" }}>
              Playing as <b style={{ color: "var(--gold)" }}>{player?.name}</b>. Up to four to a team — you trade your
              own money, and the leaderboard adds your team together.
            </div>
          </>
        )}

        {step === "create" && (
          <TeamStep
            mode="create"
            limits={limits}
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

        {step === "join" && (
          <TeamStep
            mode="join"
            limits={limits}
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
        <input
          type="text"
          placeholder="YOUR NAME"
          value={name}
          maxLength={18}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <PxButton type="submit" disabled={busy || name.trim().length < 2}>
          {busy ? <Spinner text="JOINING" /> : "START"}
        </PxButton>
      </form>
      {err && <div className="err">{err}</div>}
      <div className="hint" style={{ textAlign: "center" }}>
        One account per device. If this browser has already played, typing any name signs you back into the account it
        already has.
      </div>
    </>
  );
}

function TeamStep({ mode, player, limits, busy, setBusy, err, setErr, onBack, onDone }) {
  const [value, setValue] = useState("");
  const [made, setMade] = useState(null);
  // The code screen holds for a few seconds. Without it the person who made
  // the team clicks straight through and nobody else ever sees the code.
  const hold = limits?.codeHoldSeconds ?? 6;
  const [left, setLeft] = useState(hold);
  useEffect(() => {
    if (!made) return undefined;
    setLeft(hold);
    const t = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(t);
  }, [made, hold]);

  async function go(e) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      if (mode === "create") {
        const res = await api.post("team/create", withPlayer(player, { name: value.trim() }));
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
    return (
      <>
        <div className="field-label" style={{ textAlign: "center" }}>
          {made.name} — YOUR TEAM CODE
        </div>
        <div className="codebox">{made.code}</div>
        <div className="hint" style={{ textAlign: "center" }}>
          <b style={{ color: "var(--gold)" }}>Read this out to your team now.</b> Up to {made.max} of you, including
          you. They can join at any time, but they need this code — and it is easier to say it than to find it later.
        </div>
        <div className="mt">
          <PxButton variant="green" disabled={left > 0} onClick={() => onDone(made)}>
            {left > 0 ? `TO THE FLOOR IN ${left}…` : "TO THE FLOOR →"}
          </PxButton>
        </div>
        <div className="hint" style={{ textAlign: "center" }}>
          It stays in the top corner all round, so you can read it out again.
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
        <PxButton type="submit" disabled={busy || value.trim().length < (mode === "create" ? 2 : 4)}>
          {busy ? <Spinner text="…" /> : mode === "create" ? "CREATE" : "JOIN"}
        </PxButton>
      </form>
      {err && <div className="err">{err}</div>}
      <div className="mt">
        <PxButton variant="ghost" small onClick={onBack}>
          ← BACK
        </PxButton>
      </div>
    </>
  );
}
