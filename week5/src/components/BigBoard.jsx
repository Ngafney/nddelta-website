/**
 * /week5/board — the projector page. Zero interaction.
 *
 * The big live chart is the show: history greyed, the live ticks printing one
 * by one toward T, the line K across it. Beside it the price the room is paying,
 * the leaderboard, and the phase clock. At the bell it plays the same reveal the
 * players get, once, on a timer. The clock is lined up with the server's using
 * the skew from each poll, as week 3's board does.
 */
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { PixelSprite, clock, num, DELTA, DELTA_PALETTE } from "./PixelBits.jsx";
import Leaderboard from "./Leaderboard.jsx";
import Reveal from "./Reveal.jsx";
import HorizonChart, { ChartHeader } from "./HorizonChart.jsx";

/** `initial` seeds the first render (the render test uses it). */
export default function BigBoard({ initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [now, setNow] = useState(Date.now());
  const [reveal, setReveal] = useState(null);
  const [playing, setPlaying] = useState(false);
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
        // Poll again just after the next print, or in a second, whichever is sooner.
        const due = d.round?.nextTickAt != null ? d.round.nextTickAt - (Date.now() + skew.current) + 60 : 1000;
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

  const url = `${window.location.host}/week5/`;

  if (!round) {
    return (
      <div className="bigboard">
        <div className="dead-note">
          NO ROUND IS OPEN
          <br />
          <span style={{ fontSize: 9, color: "var(--dim)" }}>week5/admin</span>
        </div>
      </div>
    );
  }

  const serverNow = now + skew.current;
  const msLeft = round.endsAt == null ? null : Math.max(0, round.endsAt - serverNow);
  const msToNext = round.nextTickAt == null ? null : round.nextTickAt - serverNow;
  const settled = round.status === "settled";
  const mk = data.market;

  return (
    <>
      <div className="bigboard">
        <header className="site-header">
          <div className="logo-block">
            <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={5} />
            <div>
              <div className="title-main">THE HORIZON MARKET</div>
              <div className="title-sub">
                WEEK 5 · DOES Y FINISH ABOVE {round.K} AT TICK {round.T}?
              </div>
            </div>
          </div>
          <div className="header-right">
            <div className={`clockbox ${msLeft != null && msLeft < 20_000 && !settled ? "warn" : ""}`}>
              <i>{settled ? "SETTLED" : round.status === "research" ? "RESEARCH" : round.status === "lobby" ? "PRE-OPEN" : "TO THE BELL"}</i>
              <b className="bb-clock">{msLeft == null ? "—:—" : clock(msLeft)}</b>
            </div>
          </div>
        </header>

        {(round.status === "lobby" || round.status === "research") && (
          <div className="panel bb-join">
            <div className="panel-title" style={{ justifyContent: "center" }}>
              {round.status === "research" ? "RESEARCH — DOWNLOAD THE DATA, FIT IT, PRICE IT" : "JOIN NOW"}
            </div>
            <div className="big">{url}</div>
            <div className="hint">
              {round.players} player{round.players === 1 ? "" : "s"} · {round.teams} team{round.teams === 1 ? "" : "s"} ·{" "}
              {round.secondsPerTick}s a tick · {round.T} ticks
            </div>
          </div>
        )}

        <div className="panel">
          <HorizonChart
            series={data.series}
            K={round.K}
            T={round.T}
            height={440}
            big
            header={<ChartHeader round={round} series={data.series} msToNext={msToNext} big />}
          />
        </div>

        <div className="bb-grid">
          <div>
            <div className="panel">
              <div className="panel-title">
                THE PRICE OF "ABOVE {round.K}"
                <span className="right">{mk.volume} shares traded</span>
              </div>
              <div className="spread-strip" style={{ fontSize: 20 }}>
                <span>
                  BID <b className="bidv" style={{ fontSize: 34 }}>{mk.bestBid ?? "—"}</b>
                </span>
                <span>
                  LAST <b className="lastv" style={{ fontSize: 52 }}>{mk.last ?? "—"}</b>
                </span>
                <span>
                  ASK <b className="askv" style={{ fontSize: 34 }}>{mk.bestAsk ?? "—"}</b>
                </span>
              </div>
              {settled && (
                <div className={`bb-settle ${round.xStar === 100 ? "up" : "down"}`}>
                  Y<sub>{round.T}</sub> = {num(round.yT, 2)} {round.xStar === 100 ? ">" : "≤"} {round.K} · PAID ${round.xStar}
                </div>
              )}
            </div>
            {data.history?.length > 0 && (
              <div className="panel panel--tight">
                <div className="panel-title">EARLIER ROUNDS</div>
                {data.history.slice(0, 5).map((h) => (
                  <div className="kv" key={h.roundId}>
                    <span>
                      φ = {h.phi1}
                      {h.switchTick != null ? ` → ${h.phi2} at ${h.switchTick}` : ""} · paid {h.settles}
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
              <span className="right">{settled ? "FINAL" : `marked at ${num(mk.mark, 1)}`}</span>
            </div>
            <Leaderboard rows={data.leaderboard} settled={settled} limit={12} />
          </div>
        </div>
      </div>

      {playing && reveal && (
        <Reveal reveal={reveal} me={null} leaderboard={reveal.leaderboard ?? data.leaderboard} projector onClose={() => setPlaying(false)} />
      )}
    </>
  );
}
