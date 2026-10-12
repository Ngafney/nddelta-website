# Week 6 — The Sum

Every team drops a **secret whole number 0–10** when it forms.
**S is the sum.** Three books trade on it:

| book | pays | ladder |
| --- | --- | --- |
| **SUM** | $S a share | 0 … 10N |
| **CALL** | max(S − K, 0) | 0 … 10N − K |
| **PUT** | max(K − S, 0) | 0 … K |

One strike K for both options (default **5N**, set at the open), so at the bell
**CALL − PUT = SUM − K** exactly; the floor shows the parity check live from the
mids. The host draws the numbers one at a time — by hand (**REVEAL NEXT**) or
on a clock (**AUTO every n s**) — and the round settles the instant the last one
lands. Nobody, not even the team, is told whose number just came out until the
final reveal screen.

## Phases

```
lobby ──(pick clock runs out, or OPEN TRADING)──▶ live ──(last number out)──▶ settled
```

- **lobby** — teams form and pick. Creating a team requires a number. Any
  member may change it (`POST team/number`). The host can start a **pick
  clock** (default 30 s; +30 s / HOLD); when it runs out trading opens by
  itself, anchored to when it was due.
- **live** — the numbers are **locked** (`lock`): N, K, every number and the reveal
  order (a seeded shuffle) are fixed. A team that never picked gets a number
  **drawn** from the seed and is told. No new teams (late arrivals join one),
  no leaving, no changing numbers. Books can be opened/shut any time (shutting
  pulls that book's resting orders). Noise desks can be reconfigured live.
- **settled** — every number out; SUM pays S, CALL pays max(S−K,0), PUT pays
  max(K−S,0). The reveal shows whose number was whose.

A new round with **keep players** carries teams over with **no number** — the
floor prompts the team to pick again.

## Solvency across three books on one underlying

`shared/engine.js`. For every whole S still possible (the revealed total plus
0…10 per number left — a range that only shrinks), a player's wealth

    W(S) = cash + Σ_k pos_k·pay_k(S) − Σ_resting reserve(o, S)

must be ≥ 0, where a resting bid at px reserves (px − pay(S))⁺·qty and a resting
offer (pay(S) − px)⁺·qty. Checked before every order on the state it would leave
behind; preserved exactly by fills, cancels, reveals and settlement. Payoffs are
piecewise linear and S is an integer, so checking every integer S is exact.
Long SUM + short CALL + long PUT is recognised as riskless (it pays K).

## The desks

Noise desks (0–6, configurable: every n s, size, sweep) fire **market orders
only** into whatever is resting, in a random open book. They never quote. An
empty book stays empty until a student quotes it — students are the market.

## Run it

```bash
cd week6
npm install
npm run build          # → ../public/week6
node serve.js          # app + API on one port: http://localhost:8086/week6/
                       #   admin  /week6/admin   (password 123 until you change it)
                       #   board  /week6/board   (projector; sound on by default)
```

For a **live room** from a Windows laptop: `week6\start-public.ps1` builds if
needed, starts `serve.js` on :8086 in memory mode and opens a Cloudflare tunnel.

Dev with hot reload: `npm run api` (API on :3501) and `npm run dev` (Vite on
:5178, proxies /api).

## Environment

Same as week 5: `SESSION_SECRET` (required in prod), Upstash vars for Vercel,
`ADMIN_PASSWORD`, `KV_FORCE_MEMORY=1`. See `.env.example`.

## Tests

```bash
npm test               # game + engine + api + render  (KV_FORCE_MEMORY=1)
npm run test:e2e       # boots serve.js, plays a round over HTTP with AUTO reveals
npm run test:all       # all of it, plus the build
```

- **game** — payoffs and parity at every S; the uniform-prior fair value vs a
  40,000-draw Monte Carlo; the seeded shuffle is a permutation; the form.
- **engine** — ladders per book; margin is the worst case over the sums still
  possible; put offers margined at low S, calls at high; the parity position
  is riskless; priority; self-trade; book toggles; settlement at every S;
  a random storm across all three books settled at every reachable S.
- **api** — lobby/pick/lock machine; numbers required, changeable, sealed,
  drawn; nothing a player reads names another team's number or the reveal
  order; manual and AUTO reveals with catch-up anchored to due times; book
  toggles; desks only take; kicks and empty teams; payouts.
- **render** — every screen, every state, server-rendered.
- **e2e** — a whole round over HTTP, then a second round with a drawn number.

## Files

    shared/rules.js     books, defaults, desks, rules copy
    shared/game.js      payoffs, bounds, uniform pmf + fair value, shuffle, form
    shared/engine.js    the three-book matching engine and the solvency rule
    server/handler.js   the API (pick clock, lock, reveals, auto, desks, views)
    server/kv.js        storage, env-only credentials
    src/                React app: floor (Draw, Ladders, SumChart), /board, /admin, reveal
    api/week6/router.mjs  (repo root) the Vercel entry

## The insider

A desk that **knows S**. From the control room the host fires it once
(**STRIKE ONCE**) or runs it on a loop (every n seconds). On a strike it
sweeps, book by book, every resting offer priced at least its **edge** (default
$0.10) below the true payoff and every resting bid at least that far above it,
up to its **shares per strike** (default 100) in all. It only ever takes and
never leaves anything resting; players are not told it exists. Its P&L shows
in the control room and on the reveal.
