import React, { useState } from "react";
import { api, loadTeam, tokenForName } from "../api.js";
import { PixelSprite, PxButton, Spinner } from "./PixelBits.jsx";
import { DELTA, DELTA_PALETTE } from "./sprites.js";

export default function NameGate({ onJoin }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function join(e) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      // Pass this browser's stored credential for the name (or the current
      // session's) so rejoining a team you created here always works.
      const token = tokenForName(name) ?? loadTeam()?.token;
      const res = await api.post("team", { name, token });
      onJoin(res);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="gate">
        <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={6} className="delta-big" />
        <h1>DELTA ARCADE</h1>
        <div className="sub">
          WEEK 1 · GAMES OF STRATEGY
          <br />
          PRISONER'S DILEMMA · SUNSET SCOOPS
        </div>
        <form onSubmit={join}>
          <input
            type="text"
            placeholder="ENTER TEAM NAME"
            value={name}
            maxLength={24}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <PxButton type="submit" disabled={busy || name.trim().length < 2}>
            {busy ? <Spinner text="JOINING" /> : "START"}
          </PxButton>
        </form>
        {err && <div className="err">{err}</div>}
        <div className="hint mt" style={{ textAlign: "center" }}>
          Solo counts as a team. A new name creates your team; typing it again on this device signs
          you back in.
        </div>
        <div className="press-start">PRESS START TO PLAY</div>
      </div>
    </div>
  );
}
