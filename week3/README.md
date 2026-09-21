# DELTA Week 3 — Coin Flips

Two games for the probability meeting, one app, one join, one set of teams.

**🪙 Coin Market.** A coin is made with a hidden probability of heads, **p**,
drawn from a distribution the admin picks (and players are told — it is the
Bayesian's prior). Everyone starts with **$10,000**. Before any trading, a
**flip window** (2 minutes by default) lets each player choose how many times to
flip the coin themselves at **$100 a flip**, up to 100. When the window closes
the flips are dealt, the money is gone, and trading opens by itself on the
Week 2 order book, quoted **1–99** like a prediction market.

A share pays either **100 × p** or, if the admin picks it, **$100 or $0 on one
final flip** — same expected value, far more variance. Buy all 100 flips and
you know the coin cold with nothing left to quote with; buy none and you are
trading blind.

Once flips are dealt, each player sees their heads and tails two ways — the
frequentist's **heads ÷ flips**, and the Bayesian **posterior mean with a 90%
credible interval** starting from the round's prior. At the bell the reveal
ends with **"did buying flips pay?"**: every player's flips against their P&L.

**🎰 Bandit Lab.** The five-coin multi-armed bandit. Each coin's p is uniform
on 0–1; 100 flips; $100 a heads. Teams describe a strategy in plain English,
the AI writes it as code (same compiler setup as Week 1's games), they check
it, and it plays **10,000 games** — the same 10,000 for every team — for the
leaderboard. For scale:

| strategy | average |
|---|---|
| random | ≈ $5,000 |
| UCB (c = 2) | ≈ $6,600 |
| Thompson sampling | ≈ $7,500 |
| **explore 15 flips round-robin, then best rate** (the lecture's answer) | ≈ $7,570 |
| a psychic who always flips the best coin | ≈ $8,333 |

`npm run bench` reproduces that table.

---

## Running it

### For a room of people (recommended)

```powershell
powershell -File week3\start-public.ps1
```

Serves the app and API from one node process on `:8082` and opens a Cloudflare
tunnel with a public `https://` URL. Add `/week3/` to it and read it out. One
process = everything in memory, atomic, no database to fall over.

For the bandit lab's AI compiler, put `OPENAI_API_KEY` in `week3/.env` (see
`.env.example`). Without it an offline quick-compiler that reads the common
phrasings stands in, and the lab says so on screen.

### Locally, for development

```bash
cd week3
npm install
npm run api     # the API on :3300
npm run dev     # vite on :5175, proxying /api to :3300
```

### On Vercel

Deploys with the rest of the site: `vercel.json` rewrites `/api/week3/*` to
`api/week3/router.mjs`, and the root `npm run build` builds week3 into
`public/week3/`. Storage is the same Upstash Redis as Week 2, under `w3:` keys.

| | |
|---|---|
| `/week3/` | both games |
| `/week3/admin` | the control room (password `123` until you change it) |
| `/week3/board` | the projector — coin market or bandit leaderboard, admin's choice |

---

## Running the meeting

1. `/week3/admin` → **Set up a new coin**: how p is drawn (Uniform, Beta(½,½),
   Beta(0.3,0.3)), what a share pays (100 × p, or one final flip), the flip
   window, the trading minutes, cash, flip price. **Build round.** A round has
   to exist before anyone can join — for either game.
2. Put `/week3/board` on the projector. Players join, make or join a team
   (4 max), and can already pre-pick their flips and play in the bandit lab.
3. **Open the flip window.** The clock runs; players change their minds freely.
   Nothing is charged or flipped until it hits zero.
4. Trading opens by itself. **+1 MIN / CLOSE NOW** as needed.
5. The coin settles itself at the bell: the reveal, the flips-vs-P&L chart,
   the podium, the board.
6. **Build round** again with *keep players* ticked for another coin — try the
   final-flip settlement or a U-shaped prior.
7. Flip the projector to **bandit leaderboard** when it's the lab's turn.

The admin can **peek at the answer** (don't say it out loud) and **pin p** for
a worked example. Players who join after the window closed get one flip
purchase of their own before they can trade.

## Things worth knowing

- **Flips burn money, trades only move it.** The market is zero-sum, so the
  room as a whole always ends down by exactly what it spent on flips. Buying
  information only pays if it lets you take money off people who bought less.
  That is the lesson — and it is what the post-bell chart shows.
- **The bandit lab only runs code the server compiled.** The compile route
  signs the code; run and save refuse anything unsigned. On top of that the
  code runs through a denylist (no loops, no `new`, no escapes) with seeded
  randomness only, as in Week 1.
- **Teams are the scoring unit in both games**: the market ranks a team's
  average, the lab ranks a team's best run and shares one strategy library.
- **Global reset** wipes rounds, players, teams, saved strategies and the
  bandit board. The admin password survives.

## Tests

```bash
npm test            # engine (15) + api (17) + render (10)
npm run build
npm run test:e2e    # real HTTP through serve.js (2)
```

## Layout

```
week3/
  shared/rules.js      priors, settlements, money, limits, player-facing copy
  shared/coin.js       drawing p (Beta, incl. a, b < 1) and flipping it
  shared/bandit.js     the five-coin bandit, its sandbox, 10,000-game runs
  shared/engine.js     week 2's matching engine on a 1–99 ladder
  server/handler.js    the whole API; the only place p lives before the bell
  server/llm.js        the strategy compiler (+ offline stand-in)
  src/                 the React app (floor, bandit lab, admin, big board)
  test/                four suites
api/week3/router.mjs   the Vercel entry point
```
