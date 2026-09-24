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

## The physics is real

`shared/orbits.js` integrates the Sun, the Earth and the asteroid with an
adaptive Dormand–Prince 5(4), plus the first post-Newtonian correction from the
Sun. The relativity is not decoration:

- The asteroid's perihelion sits around **15 solar radii**, and it makes three
  to seven passes.
- General relativity moves the impact point by **tens of thousands of
  kilometres** by arrival day.
- Run the same launch state with Newtonian gravity alone and it **misses the
  Earth entirely**.

`test/physics.test.js` checks the relativistic term against the one number
everybody knows — Mercury's perihelion advancing 43″ per century — before
anything else is allowed to depend on it.

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
