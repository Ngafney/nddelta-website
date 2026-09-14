# DELTA Week 2 — Gradient Trading

One game, two modes, one order book.

**Gradient Trading.** A differentiable function `f` lives on a domain the
players are never told. The contract settles at **`min f(x)`** — *how low the
function gets*, not where it gets there — and that minimum value is drawn from a
normal distribution with **mean 500 and standard deviation 100**. One share pays
it in dollars. The ladder trades in **ticks of 5** and opens at 500.

That matters more than it sounds: a player's own points are quoted in the same
units as the ladder. See `f(37) = 612` and you know the answer is **at or below
612**; the game is working out how much further down it goes, and whether the
room agrees with you. The chart draws that bound as a line across itself,
because it is the single most useful thing anyone owns.

Everyone starts with **$100,000** and exactly one private point: its `x`, its
height `f(x)`, and its exact gradient `f'(x)`, drawn as an arrow pointing
**downhill** and printed as a number.

There is exactly **one thing to buy**: another step of gradient descent, for a
flat **$1,000**. Sixty people each hold a different sliver of the same secret.
The market is how the room pools it.

**Prediction Market.** The same book, the same money rules, the same teams — but
no curve. Forced to **ticks of 1 settling 0–100**, so the price reads as a
probability in percent. The admin writes a question and, when the clock stops,
resolves it to whatever number they say.

---

## What players are told, and what they are not

They are **blind except for the points they have paid for**. Not disclosed
anywhere — not in the copy, not on the chart axes, not on the ladder, not in an
error message:

- the domain of `f`
- the range of `f`
- the settlement bounds
- the distribution the minimum was drawn from
- **which difficulty they are on** — the preset names and blurbs describe the
  shape of the function, so the whole catalogue lives behind the admin token

The chart fits **both** axes to the player's own points, so it cannot hand over
the domain by drawing it. The ladder has no visible end in either direction. A
probe's step is capped so nobody can binary-search for an edge on one fee. The
`GET rules` payload ships labels only — no bounds, no shape parameters, no mean
or standard deviation. There are tests for each of those.

The one number about the range they do see is where the ladder **opens** (500),
because you asked for it. Everything else is yours to say out loud.

> **One inference channel worth knowing about.** A player who posts an offer can
> read what it reserved and solve for the settlement ceiling, because the
> reserve *is* `(ceiling − price) × shares` and you asked for reserved cash to
> be visible. Closing it would mean hiding the number. Knowing the ceiling says
> very little about a minimum that is 500 ± 100, so I left the number visible
> and am flagging it rather than quietly making the panel less useful.

---

## Running it

### For a room of people (recommended)

```powershell
powershell -File week2\start-public.ps1
```

Builds if needed, serves the app and the API from one node process on `:8081`,
and opens a Cloudflare tunnel that prints a public `https://` URL. Add `/week2/`
to it and read it out.

One process means the whole market lives in memory: every transaction is atomic
for free, polling costs nothing, and there is no database to fall over
mid-round. **This is the best way to run a real round.**

### Locally, for development

```bash
cd week2
npm install
npm run api     # the API on :3200 (a stand-in for the Vercel functions)
npm run dev     # vite on :5174, proxying /api to :3200
```

### On Vercel

It deploys with the rest of the site. `vercel.json` rewrites `/api/week2/*` to
`api/week2/router.mjs`, and the root `npm run build` builds week2 into
`public/week2/`. Storage is Upstash Redis; without credentials, serverless
storage is per-invocation memory and **nothing will persist** — the admin panel
says so in a red banner.

| | |
|---|---|
| `/week2/` | the trading floor |
| `/week2/admin` | the control room (password `123` until you change it) |
| `/week2/board` | the projector screen |

---

## Running a round

1. Open `/week2/admin`, pick a **mode**.
   - *Gradient*: pick a curve — Parabola, Tilted, Wavy, Rugged, Diabolical.
   - *Prediction*: write the question.
2. Set the minutes and the starting cash. **Build round.**
3. Put `/week2/board` on the projector — it shows the join URL.
4. Players enter a name, then **create a team** (and read the 4-character code
   out) or **join** one with a code. Four to a team.
5. **Open** the market. Players trade.
6. The clock runs out, or you **close now**.
   - *Gradient* settles itself at `min f`, immediately and automatically.
   - *Prediction* stops at "closed" and waits for you to **resolve** it.
7. The curve unfurls, the podium rises, the leaderboard is final.
8. **Build round** again. Tick *keep players* and the teams survive with fresh
   money, new points, and a new curve.

---

## The one thing you can buy

One iteration of gradient descent, from a point you own, for a flat **$1,000**:

```
x ← x − rate × f'(x)
```

The control sits **inside the chart panel**, directly under the curve, so a step
is chosen while looking at the thing being stepped on. You pick the learning
rate on a log slider and see exactly where the step lands before you pay.

The **top of the slider is the largest legal step**, and it moves with the slope
you are standing on — so "as far as one step can take me" is always the far
right, and there is no way to drag somewhere and then be told off for it.

One price, one purchase, no menu. The only question a player ever answers is how
big a step to take, which is the question the game is about. A flat fee also
means the cost does not shrink as you lose, so a step stays a real decision at
every stack size.

A large rate legitimately overshoots the bottom and comes up the far side — that
is gradient descent, not a bug. The guarantee that a step goes downhill only
holds for a step small relative to the *local curvature*, which is why the tests
assert it on a parabola and not on a random round curve.

---

## The parts that had to be right

### The minimum really is what the game says it is

`shared/curve.js` does not draw a random function and hope. It builds

```
f(x) = A·(1 − e^(−(x−x*)²/2σ²))  +  B·((x−x*)/H)²  +  λ·h(x)
```

where `h` is a random texture (sines, a degree-7 polynomial, an exponential,
Gaussian decoy valleys) **detrended so `h(x*) = 0` and `h'(x*) = 0`**. Every
term vanishes with zero slope at `x*`, so `x*` is a critical point by
construction, for any `A`, `B` and `λ`.

Making it the *global* minimum is then one exact calculation rather than a
search: `f` is affine in the well depth `A`, so the smallest sufficient depth is

```
A_min = max over {x : B·u² + λ·h(x) < 0} of  −(B·u² + λ·h(x)) / w(x)
```

taken with the `x → x*` limit of the same ratio, which is exactly the condition
that `x*` curves upward. We take 15% headroom, then re-verify *between* grid
points with golden-section refinement and deepen the well until nothing
undercuts `x*`.

The localized well is what makes hard curves possible at all. A plain quadratic
core is nearly flat near `x*`, so any negative curvature in the texture forces
the texture's weight to near zero and every difficulty collapses into a
parabola. A well reaches full depth within a few `σ` and then stops growing, so
the texture keeps its strength everywhere else. Measured decoy valleys per
curve: Parabola 0, Tilted 0.3, Wavy 1.6, Rugged 2.4, Diabolical 3.6.

Then the piece that makes it a *contract*. `shape(x)` is ≥ 0 everywhere and
exactly 0 at the low point, and `f = yOffset + yScale·shape`, so **`min f` is
exactly `yOffset`** for any positive scale. Setting `yOffset` to the drawn `y*`
therefore makes the minimum value precisely the number we drew, to the cent,
while a positive scale cannot move an argmin — so every line of the proof above
survives untouched. `yScale` is then free to decide only how far `f` climbs
above its own floor, which is what makes a single point informative or useless.

Everything is written in terms of the domain's center and half-width, so the
construction works on **any** domain, including one that runs negative. Tests
brute-force both the minimum value and its location on four domains, negative
ones included, and get zero error. The admin panel re-runs the same self-check
per round, and the server refuses to start a round that fails it.

Three bugs worth recording. Rounding the detrend constants to 4dp left a
residual tilt that walked the true minimum off its intended spot — the contract
would have settled at a lie. The original quadratic core made `diabolical`
average 0.5 decoy valleys. And the first version of this whole game settled on
the *location* of the minimum rather than its value, which is a different game
entirely — that one was caught by you, not by a test.

### Nobody can go bust, and nobody can print money

`shared/engine.js`. All money is **integer cents**; prices are integer dollars
on the tick grid, so a lot costs `px × 100` cents exactly and nothing drifts.

Final cash is linear in the settlement `S`, so its worst case over
`[settleMin, settleMax]` is at an endpoint. That gives two invariants, and every
resting order contributes to whichever one it can hurt:

```
(A)  cash + settleMin·position  ≥  reserveA
(B)  cash + settleMax·position  ≥  reserveB

     a resting BID   at px, q:   reserveA += (px − settleMin)⁺·q
                                 reserveB += (px − settleMax)⁺·q
     a resting OFFER at px, q:   reserveB += (settleMax − px)⁺·q
                                 reserveA += (settleMin − px)⁺·q
```

The familiar two terms are the first and third. **The other two are what let the
ladder run past the settlement range at all** — which it must, because a ladder
that stopped somewhere would disclose a bound. A bid priced above the highest
possible settlement loses money on every fill, so it has to be margined against
invariant B too; without that term it degrades (B) on each fill and can be walked
into a negative balance. I can construct that bankruptcy, and there is a test
named after it. With all four terms, **every price on the ladder is safe to
quote**, negative ones included.

Both invariants are checked before an order is accepted, at its limit price and
full size, and both are *exactly conserved* by fills at any price — so solvency
at acceptance implies solvency forever, and settlement cannot push anyone below
zero.

The tests settle busy random books at every reachable price, run 60 players
through 20,000 random actions (quoting far outside the settlement range on
purpose) checking every invariant throughout, and assert that teammates cannot
wash-trade a team total upward.

Also enforced: price–time priority; self-trade prevention that cancels your own
resting order rather than printing against yourself (so nobody can walk the
mark); order and position caps; and the curve never leaving the server until
the bell.

### Sixty people clicking at once

The market is one document, because an order that trades has to move the book,
two cash balances and two positions at once or none of them.

- **Within a process**, writes are chained onto a promise queue. Optimistic
  concurrency alone is not enough — thirty people on the same tick in the same
  second means thirty writers racing one key, and a measured **14 of 30** lost
  every retry and were turned away.
- **Between processes** (serverless), an atomic Redis compare-and-swap
  arbitrates, and a losing CAS hands back the fresh document so the change is
  replayed rather than lost.

The load test fires 900 actions across 60 players in six simultaneous waves:
nothing dropped, the audit passes after every wave, and the room's money
reconciles to the cent.

### The book

Virtualized, so only the visible slice is ever in the DOM, and it scrolls
indefinitely in both directions — there is no visible end, because a ladder that
stopped somewhere would disclose a settlement bound for free.

It opens **fully zoomed out**, because the first thing a trader needs is the
shape of the whole book; zoom in once you know where to look. Zoom changes the
row height, which is arithmetic the virtualizer depends on, so it is a JS
constant rather than a CSS rule — and it also grows to a touch target on a
phone. There is a test for that, because a mismatch would misplace every row.

If the book is empty on screen but has orders above or below, a bar at that edge
says so and jumps you there — otherwise an empty stretch of ladder looks
identical whether the book is empty or you have simply scrolled away from it.

Your **net position sits immediately above the ladder**, so nobody clicks a side
without knowing which way they already are.

### Desktop and phone

On a phone the header collapses to one line, a sticky bar keeps cash, position
and P&L on screen while you scroll the book, sliders get 40px thumbs, the admin
table scrolls sideways, and safe-area insets keep everything clear of the notch
and the home indicator. There is a short-landscape rule so the book does not eat
the screen.

**Notifications**: one trade is one notification, whether the click ate one
resting order or five, and it says which side of it you were on — *you lifted
Bob*, *you hit Bob*, *Dave lifted you*. On a phone only the newest is shown,
because a stack of them covers the ladder; they still queue and expire normally
underneath.

---

## Tests

```bash
npm test            # engine (50) + api (37) + render (16)
npm run build
npm run test:e2e    # real HTTP through serve.js (11)
```

| suite | what it covers |
|---|---|
| `test/engine.test.js` | the curve on four domains; matching, priority, the four-term margin, solvency at every price, settlement, teams, and that no message leaks a bound |
| `test/api.test.js` | auth, one-account-per-device, teams, both modes, the descent, the preloaded answer, the global reset, what leaks, CAS under load |
| `test/render.test.js` | every screen against realistic mock data, plus the phone layout |
| `test/e2e.test.js` | boots `serve.js` and plays a whole round over HTTP |

Tests never touch the shared store: they set `KV_FORCE_MEMORY=1`.

---

## Layout

```
week2/
  shared/curve.js      the function, and the proof its minimum is where we say
  shared/engine.js     matching, the four-term margin, settlement, teams
  shared/rules.js      constants, difficulties, modes, the player-facing copy
  server/handler.js    the whole API; the only place the secret lives
  server/kv.js         storage, two backings, plus the atomic CAS
  src/                 the React app (floor, admin, big board)
  test/                four suites
api/week2/router.mjs   the Vercel entry point
```

## Running the room

- **Teams** are formed by a code. After you create one the screen **holds for a
  few seconds** so you actually read the code out — without it the person who
  made the team clicks straight through and nobody else ever sees it. The code
  also stays in the top corner all round.
- **Nothing advances on its own.** The reveal moves when you click NEXT, and a
  new round waits behind a NEXT button rather than yanking anyone out of a board
  they are still reading. The projector is the exception: it has nobody to click
  it, so it runs on a timer.
- **Prediction markets can be resolved in advance.** If you already know how a
  question turned out, load the answer while the market is still trading: it is
  stored and nothing else — trading is untouched, no player payload carries it,
  and the bell settles there by itself. Clear it or change it any time; resolving
  by hand afterwards clears it, so the two can never disagree.
- **Global reset** wipes the round, every player, every team and the history in
  two clicks. Your admin password survives, because locking yourself out of the
  control room is not a reset, it is an outage.
- **Teams are scored on the AVERAGE of their members**, not the sum, so a team of
  three and a team of four are playing the same game. The total is still shown.

## Cheating

One account per device, enforced server-side on a device id kept in both
localStorage and a long-lived cookie. A coarse browser fingerprint is sent
alongside and used only to **flag** lookalikes in the admin panel, never to
block: two identical phones on one lecture-hall network legitimately look the
same, and locking a real student out is worse than one person having two
windows. The admin panel lists flagged pairs and has a kick button.

Player tokens are HMACs of the player id under `SESSION_SECRET`, so they cannot
be forged from anything public. **Set `SESSION_SECRET` in production** — the
server refuses to boot without it.

## Changing the numbers

Everything the game is tuned by lives in `shared/rules.js`: the settlement range
and tick per mode, where the ladder opens, how far past the settlement range it
runs, the mean and standard deviation of the minimum, the starting stack, the
one price, and the difficulty presets. The engine and the curve read all of it, so
a change there is a change everywhere — including to a negative floor, which is
supported and tested.
