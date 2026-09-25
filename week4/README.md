# ND Delta — Week 4: Monte Carlo

An asteroid hits the Earth in three years, just north or just south of the
equator. Two order books, **NORTH** and **SOUTH**, and exactly one of them pays
$100 a share. The room gets a noisy observing record and has to work out which.

```
npm install
npm run api        # API on :3400
npm run dev        # app on :5176  → http://localhost:5176/week4/
npm run serve      # both in one process on :8083 (event day)
npm test           # physics, engine, api, scope, render
npm run test:all   # …plus a build and an end-to-end run over HTTP
```

Admin: `/week4/admin` (password `123` until changed). Projector: `/week4/board`.

## The physics is real — and deliberately Newtonian

`shared/orbits.js` integrates the Sun, the Earth and the asteroid with an
adaptive Dormand–Prince 5(4). The post-Newtonian term is implemented and
checked against Mercury's perihelion advancing 43″ per century, but **rounds
are played on Newtonian gravity**, and that was a deliberate reversal.

The first cut had the asteroid graze the Sun at ten solar radii, where
relativity moves the impact by tens of thousands of km and a Newtonian fit
misses the planet outright. Lovely payoff, unplayable round — for a reason
that had nothing to do with relativity:

- At day zero the rock sat 0.06 AU from the Sun doing **167 km/s**. Between the
  first observation and the fourth it travelled 1.4 AU, so a finite-difference
  velocity came out **105% wrong**.
- Five perihelion passes amplify ferociously: a velocity error of one part in
  10⁸ puts it **456 km** off by day 400; one part in 10⁴ puts it **4.4 million
  km** off.

Orbit determination therefore had to be right to eight significant figures
before residuals meant anything. Every fit anyone tried — mine included — sat
at millions of sigma and predicted a miss. The round was testing whether you
can write JPL's software in twenty minutes.

The orbit now is gentle: perihelion outside half an AU, e ≈ 0.45, and the
asteroid starts near aphelion at roughly Earth's own speed. A staged
least-squares fit converges to **1σ in about two seconds**, and the round is
about the statistics again.

The operator picks a latitude; a damped Newton shoot on the launch velocity
lands the asteroid on that parallel to four decimal places, at an impact time
fixed to the second.

## The noise is calibrated, not guessed

The operator does not choose kilometres of error. They choose a **confidence**:
"a good team should be about 65% sure on the opening data, and 90% by the last
release."

`shared/observe.js` turns that into a noise level by differentiating the
observations and the impact latitude with respect to all nineteen parameters of
the system (eighteen for the initial states, one for GM of the Sun), building
the Fisher information, and reading off σ of the latitude. The chance of calling
the side correctly is then Φ(|φ|/σ), which inverts in one bisection.

The noise model has two axes:

```
σ(t) = k · range(t)² · e^(−λt)
```

The range term is photon-limited astrometry. The time term is the survey getting
better at a rock now known to be an impactor. **Both are needed** — the record
already contains a close pass years before impact, so range alone sharpens the
opening data exactly as much as the closing data and the confidence ladder never
moves.

## The margin knows the two books are one question

Settlement has exactly two outcomes, so solvency is checked against both
literally rather than bounded over a range. The consequence is that holding
NORTH and SOUTH together costs margin but carries no risk — which is correct,
and is the trade the game is trying to teach.

## Layout

```
shared/orbits.js    integrator, post-Newtonian gravity, the impact solver
shared/observe.js   Fisher analysis, noise calibration, the published record
shared/engine.js    two books, one wallet, IOC, settlement, teams
shared/rules.js     every constant and all player-facing copy
server/handler.js   the whole API
src/                the app, the admin panel, the projector board
```
