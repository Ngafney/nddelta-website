/**
 * /week3/board — the projector page. Zero interaction.
 *
 * The admin chooses what it shows: the COIN MARKET (join URL, the flip-window
 * countdown, the book, the tape, the team board, and — at the bell — the same
 * reveal the players get, played once) or the BANDIT LAB leaderboard.
 */
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { PixelSprite, clock, num, money, DELTA, DELTA_PALETTE } from "./PixelBits.jsx";
import Leaderboard from "./Leaderboard.jsx";
import Reveal, { Scatter } from "./Reveal.jsx";
import { BanditBoard } from "./BanditLab.jsx";

export default function BigBoard() {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [reveal, setReveal] = useState(null);
  const [playing, setPlaying] = useState(false);
  const shown = useRef(new Set());
  const skew = useRef(0);

  useEffect(() => {
    const load = () =>
      api
        .get("board")
        .then((d) => {
          if (d.round?.serverNow) skew.current = d.round.serverNow - Date.now();
          setData(d);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 2000);
    const c = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, []);

  const round = data?.round ?? null;

  // Play the reveal once, when a round actually settles. A page that loads
  // after the fact shows the standings without replaying the theater.
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

  const url = `${window.location.host}/week3/`;
  const view = data?.cfg?.board ?? "market";

  if (view === "bandit") {
    return (
      <div className="bigboard">
        <Header title="BANDIT LAB" sub="WEEK 3 · FIVE COINS · 100 FLIPS" />
        <div className="panel bb-join">
          <div className="panel-title" style={{ justifyContent: "center" }}>
            JOIN · WRITE A STRATEGY · RUN 10,000 GAMES
          </div>
          <div className="big">{url}</div>
        </div>
        <BanditBoard rows={data?.bandit ?? []} limit={14} big />
      </div>
    );
  }

  if (!round) {
    return (
      <div className="bigboard">
        <div className="dead-note">
          NO ROUND IS OPEN
          <br />
          <span style={{ fontSize: 9, color: "var(--dim)" }}>week3/admin</span>
        </div>
      </div>
    );
  }

  const msLeft = round.endsAt == null ? null : round.endsAt - (now + skew.current);
  const settled = round.status === "settled";

  return (
    <>
      <div className="bigboard">
        <header className="site-header">
          <div className="logo-block">
            <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={5} />
            <div>
              <div className="title-main">COIN MARKET</div>
              <div className="title-sub">
                WEEK 3 · {round.priorName} ·{" "}
                {round.settlement === "flip" ? "SETTLES ON ONE FINAL FLIP" : "SETTLES AT 100 × p"}
              </div>
            </div>
          </div>
          <div className="header-right">
            <div className={`clockbox ${msLeft != null && msLeft < 30_000 && !settled ? "warn" : ""}`}>
              <i>
                {settled ? "SETTLED" : round.status === "sims" ? "FLIPS LOCK" : round.status === "lobby" ? "PRE-OPEN" : "TRADING"}
              </i>
              <b className="bb-clock">{msLeft == null ? "—:—" : clock(msLeft)}</b>
            </div>
          </div>
        </header>

        {(round.status === "lobby" || round.status === "sims") && (
          <div className="panel bb-join">
            <div className="panel-title" style={{ justifyContent: "center" }}>
              {round.status === "sims" ? "CHOOSE YOUR FLIPS — TRADING OPENS WHEN THE CLOCK HITS ZERO" : "JOIN NOW"}
            </div>
            <div className="big">{url}</div>
            <div className="hint">
              {round.players} player{round.players === 1 ? "" : "s"} · {round.teams} team{round.teams === 1 ? "" : "s"} ·{" "}
              {money(round.simCostC)} a flip · {data.simsOrdered} flips ordered by the room so far
            </div>
          </div>
        )}

        {settled && data.scatter && (
          <div className="panel">
            <div className="panel-title">
              DID BUYING FLIPS PAY?
              <span className="right">
                p = {num((round.p ?? 0) * 100, 2)}
                {round.settlement === "flip" ? ` · final flip ${round.finalHeads ? "HEADS" : "TAILS"}` : ""}
              </span>
            </div>
            <Scatter points={data.scatter} height={260} />
          </div>
        )}

        <div className="bb-grid">
          <div>
            <div className="panel">
              <div className="panel-title">
                THE MARKET
                <span className="right">
                  {data.market.volume} shares traded · {round.players} players
                </span>
              </div>
              <div className="spread-strip" style={{ fontSize: 20 }}>
                <span>
                  BID <b className="bidv" style={{ fontSize: 34 }}>{data.market.bestBid ?? "—"}</b>
                </span>
                <span>
                  LAST <b className="lastv" style={{ fontSize: 46 }}>{data.market.last ?? "—"}</b>
                </span>
                <span>
                  ASK <b className="askv" style={{ fontSize: 34 }}>{data.market.bestAsk ?? "—"}</b>
                </span>
              </div>
              <Depth book={data.market} />
            </div>

            <div className="panel panel--tight">
              <div className="panel-title">TAPE</div>
              <div className="tape" style={{ maxHeight: 220 }}>
                {data.market.tape.map((t) => (
                  <div key={t.s} className={`tape-row ${t.aggr}`} style={{ fontSize: 16 }}>
                    <span className="p">{t.px}</span>
                    <span className="q">{t.qty} shares</span>
                    <span className="t">{new Date(t.ts).toLocaleTimeString([], { hour12: false })}</span>
                  </div>
                ))}
                {!data.market.tape.length && <div className="hint">No trades yet.</div>}
              </div>
            </div>
          </div>

          <div>
            <div className="panel bb-lb">
              <div className="panel-title">
                LEADERBOARD
                <span className="right">{settled ? "FINAL" : `mark ${num(data.market.mark, 1)}`}</span>
              </div>
              <Leaderboard rows={data.leaderboard} settled={settled} limit={12} />
            </div>

            {data.history?.length > 0 && (
              <div className="panel panel--tight">
                <div className="panel-title">EARLIER COINS</div>
                {data.history.slice(0, 5).map((h) => (
                  <div className="kv" key={h.roundId}>
                    <span>
                      🪙 p = {num((h.p ?? 0) * 100, 1)}
                      {h.settlement === "flip" ? ` → flipped ${h.settles >= 50 ? "H" : "T"}` : ""}
                    </span>
                    <b>{h.podium?.[0]?.name ?? "—"}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {playing && reveal && (
        <Reveal reveal={reveal} me={null} leaderboard={data.leaderboard} projector onClose={() => setPlaying(false)} />
      )}
    </>
  );
}

function Header({ title, sub }) {
  return (
    <header className="site-header">
      <div className="logo-block">
        <PixelSprite grid={DELTA} palette={DELTA_PALETTE} scale={5} />
        <div>
          <div className="title-main">{title}</div>
          <div className="title-sub">{sub}</div>
        </div>
      </div>
    </header>
  );
}

/** A fat horizontal depth ladder — readable from the back of the room. */
function Depth({ book }) {
  const max = Math.max(1, ...book.bids.map((b) => b.qty), ...book.asks.map((a) => a.qty));
  const bids = book.bids.slice(0, 8);
  const asks = book.asks.slice(0, 8);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
      <div>
        <div className="field-label" style={{ color: "var(--bid)" }}>
          BIDS
        </div>
        {bids.map((l) => (
          <div key={l.px} className="bookrow" style={{ gridTemplateColumns: "1fr 54px" }}>
            <button className="side bid" disabled style={{ opacity: 1 }}>
              <span className="depth" style={{ width: `${(l.qty / max) * 100}%` }} />
              <span className="qty">{l.qty}</span>
            </button>
            <div className="px">{l.px}</div>
          </div>
        ))}
        {!bids.length && <div className="hint">empty</div>}
      </div>
      <div>
        <div className="field-label" style={{ color: "var(--ask)" }}>
          OFFERS
        </div>
        {asks.map((l) => (
          <div key={l.px} className="bookrow" style={{ gridTemplateColumns: "54px 1fr" }}>
            <div className="px">{l.px}</div>
            <button className="side ask" disabled style={{ opacity: 1 }}>
              <span className="depth" style={{ width: `${(l.qty / max) * 100}%` }} />
              <span className="qty">{l.qty}</span>
            </button>
          </div>
        ))}
        {!asks.length && <div className="hint">empty</div>}
      </div>
    </div>
  );
}
