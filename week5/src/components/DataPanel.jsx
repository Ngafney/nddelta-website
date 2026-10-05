import React, { useEffect, useState } from "react";
import { api, withPlayer } from "../api.js";
import { PxButton, Spinner } from "./PixelBits.jsx";

/**
 * The data, and what it is. Week 4's panel, pointed at a time series.
 *
 * There is no fitted line and no ACF here on purpose: estimating the process
 * IS the round, and a team handed φ̂ learns nothing. What the panel owes a
 * human is an explanation of the contract and of one row, the table itself,
 * and the two ways out of it — a CSV, or a block of text for an AI. It refetches
 * whenever a new tick prints, so the download is always current.
 */
export default function DataPanel({ player, round }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const open = round && round.status !== "lobby";
  const tick = round?.tickNow ?? 0;

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    api
      .get("data", withPlayer(player))
      .then((x) => live && (setD(x), setErr(null)))
      .catch((e) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [open, tick, round?.roundId, player]);

  if (!open) {
    return (
      <section className="panel">
        <div className="panel-title">THE DATA</div>
        <p className="hint">Nothing yet. The history comes out the moment the host opens research.</p>
      </section>
    );
  }
  if (err) {
    return (
      <section className="panel">
        <div className="panel-title">THE DATA</div>
        <p className="hint">{err}</p>
      </section>
    );
  }
  if (!d) return <Spinner text="FETCHING THE SERIES" />;

  const href = `/api/week5/data.csv?${new URLSearchParams(withPlayer(player))}`;
  const last = d.tick > 0 ? d.live[d.live.length - 1] : d.history[d.history.length - 1];
  // Newest first: the row that just printed is the one people look for.
  const rows = [];
  for (let s = d.tick; s >= 1; s--) rows.push({ t: s, y: d.live[s - 1], live: true });
  for (let i = d.history.length - 1; i >= 0; i--) rows.push({ t: i - (d.history.length - 1), y: d.history[i], live: false });

  return (
    <section className="panel datapanel">
      <div className="panel-title">
        THE DATA <span className="dim">· {d.rows} rows · tick {d.tick} of {d.T}</span>
      </div>

      <div className="explain">
        <h3>What you are being asked</h3>
        <p>
          A hidden process <b>Y</b> prints one value every{" "}
          <b>{d.secondsPerTick === 1 ? "second" : `${d.secondsPerTick} seconds`}</b>. A share pays{" "}
          <b>$100</b> if Y at the final tick <b>T = {d.T}</b> is <b>above K = {d.K}</b>, and nothing otherwise. Y is{" "}
          <b>{last.toFixed(2)}</b> now, with <b>{d.h}</b> tick{d.h === 1 ? "" : "s"} to go. What is that worth?
        </p>

        <h3>What one row is</h3>
        <p>
          <b>t</b> is the tick: the history runs up to <b>t = 0</b>, the moment the book opened, and live ticks count up
          from 1 to {d.T}. <b>y</b> is Y at that tick. That is all anybody has.
        </p>

        <h3>What to do with it</h3>
        <p>
          Fit it. The usual first guess is an AR(1) — Y pulled back toward a level μ at a rate set by φ — and{" "}
          <b>φ is the number that decides the price</b>. The same chart can be worth fifty or eighty depending on it.
          Download the CSV, or copy the whole thing as a prompt for an AI and argue with what it tells you.
        </p>
        <p className="dim">
          Every tick adds a row. Download again and re-fit as it grows — and do not assume the process you fitted at the
          open is the process you are trading at the end.
        </p>
      </div>

      <div className="factgrid">
        <Fact label="CONTRACT" value={`Y_${d.T} > ${d.K}`} sub="pays $100, else $0" />
        <Fact label="TICK" value={`${d.tick} / ${d.T}`} sub={`${d.secondsPerTick}s per tick`} />
        <Fact label="Y NOW" value={last.toFixed(4)} sub={last > d.K ? "above K" : "at or below K"} />
        <Fact label="HORIZON" value={`h = ${d.h}`} sub="ticks still to print" />
      </div>

      <div className="datarow">
        <a className="pxbtn dl" href={href} download>
          ↓ DOWNLOAD CSV
        </a>
        <PxButton
          onClick={() => {
            navigator.clipboard
              .writeText(d.prompt)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              })
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "COPIED" : "COPY AI PROMPT"}
        </PxButton>
      </div>

      <div className="tablewrap tall">
        <table className="obstable">
          <thead>
            <tr>
              <th>t</th>
              <th>y</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.t} className={r.live ? "liverow" : ""}>
                <td className="num">{r.t}</td>
                <td className="num">{r.y.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint">{d.note}</p>
    </section>
  );
}

function Fact({ label, value, sub }) {
  return (
    <div className="fact">
      <i>{label}</i>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}
