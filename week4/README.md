# ND Delta — Week 4: Monte Carlo

A real asteroid, really spotted on the way in, that really hit. You are put
back at the moment the warning went out. There is a corridor across the ground,
an uncertainty ellipse on it, and a line of latitude. **North of the line or
south of it?** Two order books, and exactly one pays $100 a share.

```
npm install
npm run api        # API on :3400
npm run dev        # app on :5176  → http://localhost:5176/week4/
npm run serve      # both in one process on :8083 (event day)
npm test           # corridor, engine, api, scope, render
npm run test:all   # …plus a build and an end-to-end run over HTTP
```

Admin: `/week4/admin` (password `123` until changed). Projector: `/week4/board`.

## What a team actually does

Draw a few thousand samples from the published covariance, walk each one down
the corridor from the nominal point, read off its latitude, and count. The
fraction landing north of the line is what NORTH is worth. Fifteen lines of
code, and the data panel hands you a prompt that contains every number, the
five assumptions worth arguing about, and the one warning that matters.

**Latitude is not linear in distance along the corridor.** A great circle
climbs, flattens, and falls, so a Gaussian along the ground comes out skewed in
latitude. Push it through Φ((line − µ)/σ) and you get a confident wrong answer.
That is why the week is called what it is.

And that claim is **measured, not asserted** — `test/lesson.test.js` fails the
build if it stops being true. It has to, because it did stop being true. A
playtester was handed a round where reaching for Φ(z) instead of simulating cost
him **0.9 points of price**: one tick, correct and worth nothing. The round had
put the line where latitude happens to be nearly linear, which is exactly where
a Gaussian is right.

Two things were wrong. The corridor was far too short — at σ = 600 km a great
circle barely curves — and line placement was scoring only difficulty, so it
spent the geometry without noticing. Now the corridor is **2400 km**, placement
scores what the shortcut costs, and if a draw offers no line where it costs
anything the round is **redrawn** rather than shipped. Measured over twenty
rounds the shortcut is now wrong by a median of **6.9 points**, up to 15:

| σ along the corridor | what Φ(z) costs, on the line actually used |
| --- | --- |
| 600 km | under 1 point — an assertion, not an edge |
| 1000 km | 1.4 points |
| 1500 km | 2.5 points |
| 2400 km | **4–7 points, and 15 on 2018 LA's geometry** |

The effect tracks the **asymmetry** of the latitude swing, not its size. 2018 LA
climbs 5.0° one way along ±2σ and falls 0.9° the other, and prices nothing like
a Gaussian; 2019 MO runs 10.8° up and 8.3° down — a far bigger swing — and
prices almost exactly like one. The control room says which kind of round it
just built, in words, before the bell.

The covariance is also **not diagonal**. A team that samples the two components
separately gets a different, wrong number, and there is a test for that too.

## What this replaced, and why

The first version asked the room to determine an orbit: three years of noisy
astrometry, a sungrazing asteroid, fit it yourself. It was unplayable, for a
reason that had nothing to do with the statistics:

- At day zero the rock sat 0.06 AU from the Sun doing **167 km/s**. Between the
  first observation and the fourth it travelled 1.4 AU, so a finite-difference
  velocity came out **105% wrong**.
- A velocity error of one part in 10⁸ moved the impact **456 km**; one part in
  10⁴ moved it **4.4 million km**.

The orbit had to be known to eight significant figures before the residuals
meant anything. Every fit anyone tried sat at millions of sigma and predicted a
miss — mine included, at 4.6 million σ. The Monte Carlo was never the hard
part; the inverse problem was. So the inverse problem is gone.

## What is real and what is modelled

**Real, and checkable.** The object, the date and time to the second, where it
actually hit, its speed, energy and size, and how much warning there was. All
from [NASA/JPL CNEOS Fireball and Bolide Data](https://cneos.jpl.nasa.gov/fireballs/)
and the impact list on
[Wikipedia](https://en.wikipedia.org/wiki/List_of_predicted_asteroid_impacts_on_Earth).
Settlement is not a simulation: the market pays out on which side of the line
the rock genuinely came down.

**Modelled.** The uncertainty. Nobody publishes a covariance for a four-metre
rock found nineteen hours before arrival, so the *shape* is taken from what
impact corridors look like — long, thin, tilted — and the *scale*, with the
placement of the line, is solved so the opening question is as hard as the
operator asked for.

**Mixed: the corridor direction.** For 2008 TC3 there is a published trajectory
solution (azimuth 101°, 21° above the horizon, 12.38 km/s ground-relative) and
that is what is used. The other three are derived from the CNEOS velocity
components and marked `modelled` — a derivation worth distrusting, because run
on 2008 TC3, where the answer is known, it returns 87° against a documented
101° and gets the vertical sign wrong. Every event says which it is.

## The construction that makes it a game

The nominal point a team is shown is **not** where the thing landed. It is the
truth displaced by a draw from the very covariance they are handed — which is
what a published solution *is*. Publish the true point as "nominal" and the
favoured side is always the winning side, so the correct play is to buy it at
any price and nobody has to think.

Successive solutions **wander as they tighten** rather than marching straight in.
Pushing one error draw through each release's shrinking Cholesky factor is
simpler and was what the first version did, but it makes a dull round: every
release makes the favoured side a little more favoured, so the only trade an
update ever asks for is "buy more of what you already own". A playtester named
that exactly. Now 35% of each solution is fresh noise, so the ellipse still
shrinks monotonically but its centre moves both ways, and in **11 rounds out of
20** somebody who was right at the open is wrong by the second release and right
again by the close.

That costs the guarantee the earlier version had. It used to forbid any line the
solutions could cross, which kept the confidence ladder monotone — but once the
centre wanders, the forbidden band swallows every line worth asking about and
every round opens at 100% certain. (Measured: 14 in a row.) So crossing is
allowed and the **collapse** is bounded instead: over 24 rounds the question
opens at a median 66% against the 65% requested, never drops below **58%** at
any release, and closes at a median **99%**, worst case 85%. The round may change
its mind; it may not stop having one.

## There is always something to trade against

The four configurable noise slots only ever *take* liquidity — they fire a market
order and cancel whatever does not fill. So a round opened with an empty book and
stayed empty until a human posted something, and the first thing anyone tries is
to buy. A playtester priced the market right to within a point, found no other
side in either book, and reported the trading half as unplayable. Fairly.

The desk now also keeps a **standing two-sided quote** in both books, on by
default, 15 a side at 42 / 58. It is deliberately ignorant: anchored at 50,
never moved by the data or the news, which makes it the thing a team with a real
number is playing against. The spread is what stops it being free money that
teaches nothing — at 42 / 58 in both books, buying both sides costs 116 to
collect 100 and selling both collects 84 to owe 100, so there is no arbitrage
against the desk itself. The only way to take its money is to be right about
where the rock came down.

It needs its own account, and that is not cosmetic: self-trade prevention in the
matcher *cancels* your resting order rather than printing against you, so while
the takers and the quoter shared a seat the desk deleted its own quotes within a
minute of the bell.

## The margin knows the two books are one question

Settlement has exactly two outcomes, so solvency is checked against both
literally rather than bounded over a range. Holding NORTH and SOUTH together
costs margin but carries no risk — correct, and the trade the round teaches.

## Layout

```
shared/events.js     the real impactors, with provenance on every field
shared/corridor.js   ground-track geometry, the covariance, the calibration
shared/engine.js     two books, one wallet, IOC, settlement, teams
shared/rules.js      every constant, the player copy, and the AI prompt
server/handler.js    the whole API
src/                 the floor, the corridor map, the admin panel, the board
```

## What the playtest changed

A subagent played a round knowing only what a student would know. It priced the
market correctly — NORTH 29.6 against a true 0.291, in about ninety seconds of
actual work — and still reported the round as not worth playing. Everything
below came out of that, and all of it is now covered by a test that fails if it
regresses:

- the Monte Carlo was worth **0.9 points**, so the week's whole premise was
  decorative → corridor lengthened, placement scores the lesson, weak draws are
  redrawn (`test/lesson.test.js`)
- **no counterparty** in either book, so a correct price could not be acted on →
  a standing quote, on by default
- every release pushed the price the same way → solutions wander as they tighten
- **`reserved` exceeded total cash**, because it summed each order's worst case
  over *different* outcomes — a number that is never true. Now the worst case
  over outcomes, so `reserved + free = cash`
- prices had no units anywhere → the rules say dollars per share, and what a
  resting order ties up
- **`IF NORTH` / `IF SOUTH` showed buying power**, not profit — the right number
  for "can I place this" and the wrong one for every question a trader asks
- successful orders returned no `ok`, and `19.2°N` arrived as `19.2Â°N` because
  responses never declared a charset
- the advertised 40-order cap is unreachable one-sided at $10,000 and easy when
  hedged, which the rules now say
