/**
 * /week6/board — the projector page. Zero interaction.
 *
 * The draw is the show: cells lighting up one by one, the sum rolling, the
 * cone closing. Beside it the three prices the room is paying, the parity
 * check, the leaderboard and the clock. At the bell it plays the same reveal
 * the players get, once, on a timer. Sound is on by default here.
 */
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { PixelSprite, clock, num, DELTA, DELTA_PALETTE } from "./PixelBits.jsx";
import Leaderboard from "./Leaderboard.jsx";
import Reveal from "./Reveal.jsx";
import Draw from "./Draw.jsx";
import SumChart from "./SumChart.jsx";
import Books from "./Books.jsx";
import * as sfx from "./sfx.js";

export default function BigBoard({ initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(Date.now());
  const [reveal, setReveal] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    const on = () => {
      sfx.unlock();
      setTimeout(() => setUnlocked(sfx.isUnlocked()), 100);
    };
    document.addEventListener("pointerdown", on, { passive: true });
    document.addEventListener("keydown", on);
    return () => {
      document.removeEventListener("pointerdown", on);
      document.removeEventListener("keydown", on);
    };
  }, []);
  const shown = useRef(new Set());
  const skew = useRef(0);

  useEffect(() => {
    let stop = false;
    let timer = null;
    const load = async () => {
      try {
        const d = await api.get("board");
        if (stop) return;
        if (d.round?.serverNow) skew.current = d.round.serverNow - Date.now();
        setData(d);
        const next = d.round?.auto?.nextAt ?? d.round?.pickEndsAt ?? null;
        const due = next != null ? next - (Date.now() + skew.current) + 60 : 1000;
        timer = setTimeout(load, Math.max(150, Math.min(1000, due)));
      } catch {
        if (!stop) timer = setTimeout(load, 2000);
      }
    };
    load();
    const c = setInterval(() => setNow(Date.now()), 250);
    return () => {
      stop = true;
      clearTimeout(timer);
      clearInterval(c);
    };
  }, []);

  const round = data?.round ?? null;

  useEffect(() => {
    if (round?.status !== "settled" || !round.roundId) return;
    const key = round.roundId;
    if (shown.current.has(key)) return;
    api
      .get("reveal")
      .then((r) => {
        shown.current.add(key);
        setReveal(r);
        setPlaying(true);
      })
      .catch(() => {});
  }, [round?.status, round?.roundId]);

  const url = `${window.location.host}/week6/`;

  if (!round) {
    return (
      <div className="bigboard">
        <div className="dead-note">
          NO ROUND IS OPEN
          <br />
          <span style={{ fontSize: 9, color: "var(--dim)" }}>week6/admin</span>
        </div>
      </div>
    );
  }

  const serverNow = now + skew.current;
  const msLeft = round.pickEndsAt == null ? null : Math.max(0, round.pickEndsAt - serverNow);
  const settled = round.status === "settled";
  const lobby = round.status === "lobby";
  const liveRound = { ...round, serverNow };

  return (
    <>
      <div className="bigboard">
        <header className="site-header">
          <div className="logo-block">
            <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={5} />
            <div>
              <div className="title-main">THE SUM</div>
              <div className="title-sub">
                WEEK 6 · {round.N} HIDDEN NUMBERS, 0–10 EACH · K = {round.K}
              </div>
            </div>
          </div>
          <div className="header-right">
            <button
              className="ghost soundbtn"
              onClick={() => {
                sfx.unlock();
                setSound((v) => !v);
              }}
              title={sound ? "sound on" : "sound off"}
            >
              {sound ? "🔔" : "🔕"}
            </button>
            {sound && !unlocked && <span className="soundhint">CLICK ANYWHERE FOR SOUND</span>}
            <div className={`clockbox ${msLeft != null && msLeft < 10_000 ? "warn" : ""}`}>
              <i>{settled ? "SETTLED" : lobby ? (msLeft != null ? "TRADING OPENS IN" : "PICKING") : round.auto.on ? "NEXT NUMBER" : "DRAWN"}</i>
              <b className="bb-clock">
                {lobby
                  ? msLeft == null
                    ? "—:—"
                    : clock(msLeft)
                  : settled
                    ? `S = ${round.settleS}`
                    : round.auto.on && round.auto.nextAt != null
                      ? `${Math.max(0, Math.ceil((round.auto.nextAt - serverNow) / 1000))}s`
                      : `${round.revealedCount}/${round.N}`}
              </b>
            </div>
          </div>
        </header>

        {lobby && (
          <div className="panel bb-join">
            <div className="panel-title" style={{ justifyContent: "center" }}>
              JOIN · FORM A TEAM · PICK YOUR NUMBER
            </div>
            <div className="big">{url}</div>
            <div className="hint">
              {round.players} player{round.players === 1 ? "" : "s"} · {round.teams} team{round.teams === 1 ? "" : "s"} · each team holds one number, 0 to 10
            </div>
          </div>
        )}

        <div className="panel">
          <Draw round={liveRound} big sound={sound} />
        </div>

        <div className="bb-grid">
          <div>
            <div className="panel">
              <div className="panel-title">
                THE BOOKS
                <span className="right">{Object.values(data.market ?? {}).reduce((s, m) => s + (m?.volume ?? 0), 0)} shares traded</span>
              </div>
              <Books round={round} market={data.market} me={null} selected={null} onSelect={null} big />
            </div>
            <div className="panel panel--tight">
              <SumChart round={round} height={240} big />
            </div>
            {data.history?.length > 0 && (
              <div className="panel panel--tight">
                <div className="panel-title">EARLIER ROUNDS</div>
                {data.history.slice(0, 5).map((h) => (
                  <div className="kv" key={h.roundId}>
                    <span>
                      {h.N} numbers · S = {h.S} · K = {h.K} · call paid {h.payouts?.call} · put paid {h.payouts?.put}
                    </span>
                    <b>{h.podium?.[0]?.name ?? "—"}</b>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel bb-lb">
            <div className="panel-title">
              LEADERBOARD
              <span className="right">{settled ? "FINAL" : `SUM marked at ${num(data.market?.fut?.mark, 1)}`}</span>
            </div>
            <Leaderboard rows={data.leaderboard} settled={settled} limit={12} />
          </div>
        </div>
      </div>

      {playing && reveal && <Reveal reveal={reveal} me={null} leaderboard={reveal.leaderboard ?? data.leaderboard} projector onClose={() => setPlaying(false)} />}
    </>
  );
}
