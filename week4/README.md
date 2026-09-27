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
latitude — measurably so; `test/corridor.test.js` checks the skew is real. Push
it through Φ((line − µ)/σ) and you get a confident wrong answer. That is why
the week is called what it is.

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
any price and nobody has to think. One standard normal pair is drawn per round
and pushed through each release's shrinking Cholesky factor, so successive
solutions walk in toward the truth the way real ones do.

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
