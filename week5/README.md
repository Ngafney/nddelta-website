# Week 5 — The Horizon Market

A hidden stochastic process **Y** ticks live on the screen. The room trades one
binary contract on the 1–99 ladder: **will Y be above K at the final tick T?**
It settles at **$100 a share if Y_T > K, else $0**. Every round the host picks
the process in secret; the room downloads the history (CSV, or a prompt to
paste into an AI), estimates the process, and prices it.

The lesson: **the same chart is worth very different prices depending on φ.**
From Y_open = 105 with K = μ = 100 and 60 ticks to go, a mean-reverting φ = 0.9
makes the contract worth about 50; a random walk makes it worth about 74.

## The process

`shared/process.js` — pure and seeded:

    Y_{t+1} = μ + φ_t (Y_t − μ) + σ ε,   ε ~ N(0, 1)

- φ = 1 is a random walk (μ drops out).
- φ_t = φ1 up to the **switch tick** S and φ2 after it (live tick s uses φ2
  exactly when s > S). The switch is always in the live part, never the history.
- The history is generated **backward** from the admin's Y_open with φ1, so it
  ends exactly at Y_open (a Gaussian AR(1) and a random walk are
  time-reversible). History is t = −(H−1) … 0; live ticks t = 1 … T are drawn
  forward when the round is built and kept in the secret spec `w5:spec:<roundId>`.
- Every value is rounded to 4 dp as it is generated, so the CSV *is* the process.
- A **new random seed every round** (the host can pin one). `shared/rng.js` is
  week 3's `rngFrom` + `gaussian`, copied verbatim.

**Fair value** (reveal + admin peek): true P(Y_T > K) at each tick under the
true spec, switch included — propagate m ← μ + φ_s(m − μ), v ← φ_s² v + σ² from
(Y_tick, 0), then Φ((m − K)/√v). Φ is Hart/West's double-precision algorithm
(error ~1e-14).

## Phases and the clock

lobby → **research** (data out, book shut) → **live** (ticks print, book open)
→ **settled** (automatic at tick T) → reveal.

The tick is **derived from the clock** on every read —
`min(T, floor((now − liveStartedAt) / tickMs))` — never stored. Anything due at
a tick (the house desks, the per-tick mid recorded for the reveal, settlement
at T) is done lazily by whoever reads next, anchored to when it was due. Clients
get only the history plus ticks 1 … tick, and line their countdowns up with the
server using `serverNow`, as week 3's board does.

Research ends on its own and the book opens. Once live, the round cannot be
extended (the live clock is the process); **END NOW** jumps to tick T and
settles on the real Y_T. Settings can be changed (and the process redrawn) in
the lobby and in research; they **lock once trading opens**.

## The house desks

- **NAIVE DESK** (togglable): every 10 s, quotes 5 shares a side ±4 around the
  random-walk price Φ((Y_now − K)/(σ̂√h)), σ̂ from the public data only. Right
  in random-walk rounds, wrong in mean-reverting ones. That is the point.
- **NOISE DESK A / B**: buy or sell 3 shares at random every 23 s / 31 s.

Each desk has its own player id at one hidden table (never on the leaderboard),
fires once when due and then re-bases, so a quiet minute cannot become a burst.

## Run it

```bash
cd week5
npm install
npm run build          # → ../public/week5
node serve.js          # app + API on one port: http://localhost:8085/week5/
                       #   admin  /week5/admin   (password 123 until you change it)
                       #   board  /week5/board   (projector)
```

For a **live room** from a Windows laptop: `week5\start-public.ps1` builds if
needed, starts `serve.js` on :8085 in memory mode and opens a Cloudflare tunnel —
add `/week5/` to the https URL it prints. On a Linux box the equivalent is
`KV_FORCE_MEMORY=1 SESSION_SECRET=… node serve.js` plus
`npx cloudflared tunnel --url http://localhost:8085`.

Dev with hot reload: `npm run api` (API on :3500) and `npm run dev` (Vite on
:5177, proxies /api).

## Environment

Never commit secrets — `week5/.env` is gitignored, and unlike weeks 1–4 this
week has **no committed store config**: credentials come from the environment
only. See `.env.example`.

| var | |
| --- | --- |
| `SESSION_SECRET` | recommended. Signs player and admin tokens. If unset, a key is derived from an API key or the Upstash token already in the environment (as week 2 does); production refuses to boot only if there is nothing at all to sign with. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash for Vercel (or `KV_REST_API_URL` / `KV_REST_API_TOKEN` from the integration). Without them Vercel storage is per-invocation and nothing persists — the admin panel shows a banner. |
| `ADMIN_PASSWORD` | optional starting admin password (default `123`, changeable in the panel). |
| `KV_FORCE_MEMORY=1` | force the in-process store (tests, a live room on one box). |

## Tests

```bash
npm test               # process + engine + api + render  (KV_FORCE_MEMORY=1)
npm run test:e2e       # boots serve.js, plays a whole round on a 1 s tick
npm run test:all       # all of it, plus the build
```

- **process** — Φ to 1e-6; history ends at Y_open; seeds reproduce and differ;
  OLS φ̂ within ±0.02 of φ ∈ {0.5, 0.9, 1.0}; the switch waits for its tick;
  fair value vs a 20,000-path Monte Carlo within 1.5 pp (AR, random walk,
  regime switch); the CSV/prompt never carry the process.
- **engine** — week 3's engine tests, plus priority, self-trade, settlement and
  a random solvency storm.
- **api** — with an injected clock: state/data/data.csv never leak φ, μ, σ, the
  switch, the seed or an unrevealed tick; the CSV grows one row per tick; books
  shut in research, open live; auto-settle to 100/0 at T; settings lock; admin
  auth; desks.
- **render** — every screen server-rendered, with and without data.
- **e2e** — create → research → open → trade → settle → reveal over HTTP.

## Files

    shared/process.js   the process, Φ, fair value, OLS, the naive price
    shared/rules.js     presets, defaults, desks, rules copy, CSV + AI prompt
    shared/engine.js    week 3's matching engine (hidden tables added)
    shared/rng.js       week 3's PRNG, verbatim
    server/handler.js   the API (clock, desks, views, admin)
    server/kv.js        week 3's storage, env-only credentials
    src/                React app: floor, /board, /admin, reveal
    api/week5/router.mjs  (repo root) the Vercel entry
