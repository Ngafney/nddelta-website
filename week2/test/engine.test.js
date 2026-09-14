/**
 * Engine + curve tests — no framework, just assertions. `npm test` in week2/.
 *
 * The two things that must be true for this game to be worth playing:
 *   1. x* really is the global minimum of the curve that gets revealed.
 *   2. The market cannot be made to print money, lose money, or bankrupt
 *      anybody, no matter what order anyone clicks in — including out past the
 *      settlement range, where the ladder still lets you quote.
 * Most of what follows is an attack on one of those two claims.
 */
import assert from "node:assert";
import {
  newMarket,
  newPlayer,
  placeOrder,
  cancelOrder,
  cancelLevel,
  cancelAll,
  settle,
  powers,
  reserves,
  spendableC,
  descentCostC,
  bookLevels,
  bestBid,
  bestAsk,
  markPx,
  midPx,
  grid,
  onTick,
  snapTick,
  maxSharesAt,
  valueC,
  leaderboard,
  auditState,
  createTeam,
  joinTeam,
  leaveTeam,
  makeTeamCode,
  EngineError,
} from "../shared/engine.js";
import { makeCurve, fAt, dAt, sampleCurve, pointAt } from "../shared/curve.js";
import { DIFFICULTIES, DIFFICULTY_ORDER, LIMITS, MONEY, MODES, curveConfigFor } from "../shared/rules.js";

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

/* ── harness ──────────────────────────────────────────────────────────── */

let clock = 1_000_000;
const tick = () => ++clock;

const GRAD = curveConfigFor("gradient");

/** A live market with teams already formed. `over` overrides the price grid. */
function market(names = ["a", "b", "c"], cashC = 10_000_000, over = {}) {
  const s = newMarket({ roundId: "r", mode: "gradient", difficulty: "wavy", startCashC: cashC, ...over });
  s.status = "live";
  s.endsAt = clock + 600_000;
  for (const n of names) s.players[n] = newPlayer(n, n.toUpperCase(), `dev-${n}`, cashC, clock);
  let t = 0;
  for (let k = 0; k < names.length; k += LIMITS.teamSize) {
    const group = names.slice(k, k + LIMITS.teamSize);
    const id = `t${t++}`;
    const code = makeTeamCode(s, (n) => Math.floor(Math.random() * n));
    createTeam(s, group[0], `Team ${id}`, id, code);
    for (const m of group.slice(1)) joinTeam(s, m, code);
  }
  return s;
}

const B = (s, pid, px, qty = 1) => placeOrder(s, pid, "B", px, qty, tick());
const A = (s, pid, px, qty = 1) => placeOrder(s, pid, "A", px, qty, tick());
const clean = (s) => assert.deepStrictEqual(auditState(s), [], `audit: ${auditState(s).join(" | ")}`);

function throws(fn, re) {
  try {
    fn();
  } catch (e) {
    if (re && !re.test(e.message)) throw new Error(`wrong error: ${e.message}`);
    return e;
  }
  throw new Error("expected a rejection, got none");
}

/** Settle a copy at every reachable price and assert nobody goes negative. */
function settlesSafelyEverywhere(s, label) {
  const g = grid(s);
  const step = Math.max(1, Math.round((g.settleMax - g.settleMin) / 120));
  for (let px = g.settleMin; px <= g.settleMax; px += step) {
    const copy = JSON.parse(JSON.stringify(s));
    settle(copy, px, tick());
    for (const p of Object.values(copy.players)) {
      assert.ok(p.cash >= 0, `${label}: settling at ${px} left ${p.name} at ${p.cash} cents`);
    }
    assert.deepStrictEqual(auditState(copy), [], `${label}: audit after settling at ${px}`);
  }
}

/* ── the curve ────────────────────────────────────────────────────────── */

console.log("\ncurve");

ok("the MINIMUM VALUE is exactly y*, on every difficulty (brute force)", () => {
  // This is the contract: what settles is how low f gets, so that number has
  // to be exactly the one we drew — not merely close to it.
  for (const k of DIFFICULTY_ORDER) {
    for (let i = 0; i < 8; i++) {
      const { spec, diagnostics } = makeCurve(`gm-${k}-${i}`, DIFFICULTIES[k], GRAD);
      assert.ok(diagnostics.ok, `${k}/${i}: self-check failed`);
      let bx = 0;
      let by = Infinity;
      for (let j = 0; j <= 40000; j++) {
        const x = GRAD.lo + ((GRAD.hi - GRAD.lo) * j) / 40000;
        const y = fAt(spec, x);
        if (y < by) {
          by = y;
          bx = x;
        }
      }
      assert.ok(Math.abs(by - spec.yStar) <= 0.01, `${k}/${i}: lowest value ${by} but y* is ${spec.yStar}`);
      assert.ok(Math.abs(fAt(spec, spec.xStar) - spec.yStar) <= 0.01, `${k}/${i}: f(x*) is not y*`);
      assert.ok(Math.abs(bx - spec.xStar) <= 0.02, `${k}/${i}: the low point is at ${bx}, not x* ${spec.xStar}`);
    }
  }
});

ok("the settlement y* is normal with mean 500 and sd 100", () => {
  const ys = [];
  const xs = [];
  for (let i = 0; i < 4000; i++) {
    const { spec } = makeCurve(`n-${i}`, DIFFICULTIES.parabola, GRAD);
    ys.push(spec.yStar);
    xs.push(spec.xStar);
  }
  const mean = ys.reduce((a, b) => a + b) / ys.length;
  const sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length);
  assert.ok(Math.abs(mean - 500) < 6, `mean ${mean}`);
  assert.ok(Math.abs(sd - 100) < 6, `sd ${sd}`);
  const within1 = ys.filter((y) => Math.abs(y - 500) <= 100).length / ys.length;
  assert.ok(Math.abs(within1 - 0.683) < 0.03, `${(within1 * 100).toFixed(1)}% within one sd`);
  for (const y of ys) assert.ok(y >= MODES.gradient.settleMin && y <= MODES.gradient.settleMax, `y* ${y} is unsettleable`);
  // And WHERE the bottom sits is spread across the domain, not bunched up.
  for (const x of xs) assert.ok(x >= GRAD.lo && x <= GRAD.hi, `x* ${x} escaped the domain`);
  const left = xs.filter((x) => x < (GRAD.lo + GRAD.hi) / 2).length / xs.length;
  assert.ok(Math.abs(left - 0.5) < 0.05, `the low point favours one side: ${(left * 100).toFixed(0)}% left`);
});

ok("the published gradient is the real derivative", () => {
  for (const k of DIFFICULTY_ORDER) {
    const { spec } = makeCurve(`d-${k}`, DIFFICULTIES[k], GRAD);
    for (const x of [0.5, 7.3, 23.9, 50, 68.2, 91.4, 99.5]) {
      const fd = (fAt(spec, x + 1e-5) - fAt(spec, x - 1e-5)) / 2e-5;
      const an = dAt(spec, x);
      assert.ok(Math.abs(fd - an) < 1e-3 * (1 + Math.abs(fd)), `${k} @ ${x}: ${fd} vs ${an}`);
    }
  }
});

ok("the gradient at x* is zero (it is a genuine critical point)", () => {
  for (const k of DIFFICULTY_ORDER) {
    for (let i = 0; i < 6; i++) {
      const { spec } = makeCurve(`c-${k}-${i}`, DIFFICULTIES[k], GRAD);
      const scale = 1 + Math.abs(dAt(spec, spec.xStar + 5));
      assert.ok(Math.abs(dAt(spec, spec.xStar)) < 1e-6 * scale, `${k}/${i}: f'(x*) = ${dAt(spec, spec.xStar)}`);
    }
  }
});

ok("the curve works on a domain that runs negative", () => {
  const neg = { lo: -600, hi: 400, yMean: 500, ySd: 100, yClamp: [20, 980], climb: [60, 700] };
  for (const k of DIFFICULTY_ORDER) {
    const { spec, diagnostics } = makeCurve(`neg-${k}`, DIFFICULTIES[k], neg);
    assert.ok(diagnostics.ok, `${k}: self-check failed on a negative domain`);
    assert.ok(spec.xStar >= neg.lo && spec.xStar <= neg.hi);
    let by = Infinity;
    let bx = 0;
    for (let j = 0; j <= 40000; j++) {
      const x = neg.lo + ((neg.hi - neg.lo) * j) / 40000;
      const y = fAt(spec, x);
      if (y < by) {
        by = y;
        bx = x;
      }
    }
    assert.ok(Math.abs(by - spec.yStar) <= 0.01, `${k}: lowest value ${by} vs y* ${spec.yStar}`);
    assert.ok(Math.abs(bx - spec.xStar) <= 0.2, `${k}: the low point is at ${bx}, not ${spec.xStar}`);
  }
});

ok("difficulty actually gets harder (more decoy valleys)", () => {
  const counts = DIFFICULTY_ORDER.map((k) => {
    let n = 0;
    for (let i = 0; i < 20; i++) n += makeCurve(`h-${k}-${i}`, DIFFICULTIES[k], GRAD).diagnostics.localMinima;
    return n / 20;
  });
  assert.strictEqual(counts[0], 0, "a parabola must have no other minima");
  assert.ok(counts[4] > counts[2] && counts[2] > counts[1], `local-minimum counts: ${counts.join(", ")}`);
});

ok("curves are deterministic in the seed", () => {
  const a = makeCurve("same", DIFFICULTIES.rugged, GRAD).spec;
  const b = makeCurve("same", DIFFICULTIES.rugged, GRAD).spec;
  const c = makeCurve("other", DIFFICULTIES.rugged, GRAD).spec;
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
});

ok("the drawn curve and the point oracle agree", () => {
  const { spec } = makeCurve("draw", DIFFICULTIES.wavy, GRAD);
  for (const [x, y] of sampleCurve(spec, 40)) assert.ok(Math.abs(fAt(spec, x) - y) < 1e-3, `sample at ${x}`);
  const p = pointAt(spec, 42.42);
  assert.strictEqual(p.x, 42.42);
  assert.ok(Math.abs(p.y - fAt(spec, 42.42)) < 1e-3);
});

ok("a descent step goes downhill on a parabola, from anywhere", () => {
  const { spec } = makeCurve("descent", DIFFICULTIES.parabola, GRAD);
  for (const x0 of [12, 35, 50, 64, 88]) {
    const d = dAt(spec, x0);
    // A small enough rate always decreases f; that is the whole premise.
    const rate = 0.5 / (1 + Math.abs(d));
    const x1 = x0 - rate * d;
    if (Math.abs(x0 - spec.xStar) < 1) continue;
    assert.ok(fAt(spec, x1) < fAt(spec, x0), `descent from ${x0} did not go down`);
    assert.ok(Math.abs(x1 - spec.xStar) < Math.abs(x0 - spec.xStar), `descent from ${x0} moved away from x*`);
  }
});

/* ── the price grid ───────────────────────────────────────────────────── */

console.log("\nthe ladder");

ok("gradient mode is ticks of 5, prediction mode ticks of 1", () => {
  const g = grid(market());
  assert.strictEqual(g.tick, 5);
  assert.strictEqual(g.center, 500);
  assert.strictEqual(g.settleMin, MODES.gradient.settleMin);
  assert.strictEqual(g.settleMax, MODES.gradient.settleMax);
  const pm = newMarket({ roundId: "p", mode: "prediction" });
  assert.strictEqual(grid(pm).tick, 1);
  assert.strictEqual(grid(pm).center, 50);
});

ok("off-grid prices are refused, on-grid ones are not", () => {
  const s = market();
  throws(() => B(s, "a", 497, 1), /5-tick grid/);
  throws(() => B(s, "a", 500.5, 1), /off the ladder|5-tick grid/);
  B(s, "a", 495, 1);
  B(s, "a", 500, 1);
  clean(s);
});

ok("the ladder runs far past where settlement can land, and never walls off", () => {
  const s = market();
  const g = grid(s);
  assert.ok(g.orderMin < g.settleMin, "the ladder must extend below the settlement range");
  assert.ok(g.orderMax > g.settleMax, "and above it");
  assert.ok(g.settleMin - g.orderMin >= (g.settleMax - g.settleMin) * 4, "by a long way");
  assert.ok(onTick(s, -500), "a negative tick is quotable");
  assert.ok(onTick(s, 5000), "so is one far above the settlement range");
  assert.strictEqual(snapTick(s, 502), 500);
  assert.strictEqual(snapTick(s, -498), -500);
});

ok("negative prices trade and settle without breaking anything", () => {
  const s = market(["a", "b"], 10_000_000);
  A(s, "a", -100, 2); // someone offers to pay you to take shares off them
  const r = B(s, "b", -100, 2);
  assert.strictEqual(r.filled, 2);
  assert.strictEqual(s.last, -100);
  assert.ok(s.players.b.cash > 10_000_000, "the buyer was paid to go long");
  assert.ok(s.players.a.cash < 10_000_000, "the seller paid to go short");
  clean(s);
  settlesSafelyEverywhere(s, "negative prices");
});

/* ── matching ─────────────────────────────────────────────────────────── */

console.log("\nmatching");

ok("a resting order sits, a crossing order trades", () => {
  const s = market();
  const r = B(s, "a", 400, 3);
  assert.strictEqual(r.filled, 0);
  assert.strictEqual(r.resting.qty, 3);
  const t = A(s, "b", 400, 2);
  assert.strictEqual(t.filled, 2);
  assert.strictEqual(s.players.a.pos, 2);
  assert.strictEqual(s.players.b.pos, -2);
  assert.strictEqual(s.last, 400);
  clean(s);
});

ok("price priority then time priority", () => {
  const s = market(["a", "b", "c", "d"]);
  A(s, "a", 520, 1);
  A(s, "b", 515, 1);
  A(s, "c", 515, 1);
  const r = B(s, "d", 600, 3);
  assert.deepStrictEqual(r.trades.map((t) => t.px), [515, 515, 520]);
  assert.strictEqual(s.players.b.pos, -1);
  clean(s);
});

ok("the taker gets the price improvement, not the maker", () => {
  const s = market();
  A(s, "a", 300, 1);
  B(s, "b", 700, 1);
  assert.strictEqual(s.last, 300, "must trade at the resting price");
  assert.strictEqual(s.players.b.cash, 10_000_000 - 300 * 100, "buyer paid 300, not 700");
  clean(s);
});

ok("a partial fill leaves the remainder resting", () => {
  const s = market();
  A(s, "a", 445, 2);
  const r = B(s, "b", 445, 5);
  assert.strictEqual(r.filled, 2);
  assert.strictEqual(r.resting.qty, 3);
  assert.strictEqual(bestBid(s), 445);
  assert.strictEqual(bestAsk(s), null);
  clean(s);
});

ok("self-trade prevention cancels your own resting order instead of printing", () => {
  const s = market();
  A(s, "a", 400, 2);
  const r = B(s, "a", 450, 1);
  assert.strictEqual(r.trades.length, 0, "a player must not trade with themselves");
  assert.strictEqual(s.players.a.pos, 0);
  assert.strictEqual(s.last, null, "no print, so no mark to move");
  clean(s);
});

ok("teammates may trade with each other", () => {
  const s = market(["a", "b"]);
  assert.strictEqual(s.players.a.teamId, s.players.b.teamId);
  A(s, "a", 400, 1);
  assert.strictEqual(B(s, "b", 400, 1).filled, 1);
  clean(s);
});

ok("oversized and zero orders are refused", () => {
  const s = market();
  throws(() => B(s, "a", 400, 0), /size must be/);
  throws(() => B(s, "a", 400, 1.5), /size must be/);
  throws(() => B(s, "a", 400, LIMITS.maxSharesPerOrder + 1), /size must be/);
  clean(s);
});

ok("closed markets and teamless players cannot trade", () => {
  const s = market();
  s.status = "lobby";
  throws(() => B(s, "a", 400, 1), /closed/);
  s.status = "settled";
  throws(() => B(s, "a", 400, 1), /closed/);
  s.status = "live";
  s.players.a.teamId = null;
  s.teams.t0.members = s.teams.t0.members.filter((m) => m !== "a");
  throws(() => B(s, "a", 400, 1), /team/);
});

/* ── balances ─────────────────────────────────────────────────────────── */

console.log("\nbalances");

ok("a bid reserves (price - floor) x shares, an offer (ceiling - price) x shares", () => {
  const s = market();
  const g = grid(s);
  B(s, "a", 250, 4);
  assert.strictEqual(reserves(s, "a").a, (250 - g.settleMin) * 4 * 100);
  A(s, "b", 900, 3);
  assert.strictEqual(reserves(s, "b").b, (g.settleMax - 900) * 3 * 100);
  clean(s);
});

ok("an order priced outside the settlement range is margined on BOTH invariants", () => {
  // Two books, because a bid above the ceiling and an offer below the floor
  // would cross each other instantly and leave nothing resting to inspect.
  const hi = market(["a", "b"], 10_000_000);
  const g = grid(hi);
  // A bid above the highest possible settlement is a guaranteed loss, and the
  // second reserve term is what stops it being a route to insolvency.
  B(hi, "a", 1500, 1);
  const ra = reserves(hi, "a");
  assert.strictEqual(ra.a, (1500 - g.settleMin) * 100, "invariant A carries the full price");
  assert.strictEqual(ra.b, (1500 - g.settleMax) * 100, "invariant B carries the overpay");
  clean(hi);

  // And an offer below the lowest possible settlement, symmetrically.
  const lo = market(["a", "b"], 10_000_000);
  A(lo, "b", -250, 1);
  const rb = reserves(lo, "b");
  assert.strictEqual(rb.b, (g.settleMax + 250) * 100, "invariant B carries the whole downside");
  assert.strictEqual(rb.a, (g.settleMin + 250) * 100, "invariant A carries the undersell");
  clean(lo);
});

ok("the old bankruptcy route — bidding above the ceiling — is now closed", () => {
  // Before the second reserve term this exact shape could be walked negative:
  // sit tight against invariant B, then fill a bid priced above the ceiling,
  // which loses (price - ceiling) a lot and used to reserve nothing for it.
  const s = market(["a", "b"], 300_000); // $3,000
  const g = grid(s);
  // Three offers near the floor eat almost all of invariant B.
  A(s, "a", g.settleMin + 100, 3); // reserves 3 x (1000-100) = $2,700
  const before = powers(s, s.players.a);
  assert.ok(before.sellC < 40_000, `invariant B should be nearly exhausted, is ${before.sellC}`);

  // The attack: a bid far above the ceiling. It must be refused for any size
  // the remaining invariant-B headroom cannot cover.
  const overpay = g.settleMax + 500;
  throws(() => B(s, "a", overpay, 5), /out of balance/);
  const allowed = maxSharesAt(s, s.players.a, "B", overpay);
  assert.ok(allowed < 5, `margin should cap the attack, allowed ${allowed}`);

  // Whatever the margin does allow must still leave the books clean once filled.
  if (allowed > 0) {
    A(s, "b", overpay, allowed);
    B(s, "a", overpay, allowed);
    clean(s);
    settlesSafelyEverywhere(s, "bid above the ceiling");
  }
});

ok("you cannot bid more cash than you have", () => {
  const s = market(["a", "b"], 100_000); // $1,000
  B(s, "a", 500, 2); // $1,000 exactly
  throws(() => B(s, "a", 5, 1), /out of balance/);
  clean(s);
});

ok("you cannot offer more downside than you can cover", () => {
  const s = market(["a", "b"], 100_000);
  A(s, "a", 500, 2); // reserves 2 x $500
  throws(() => A(s, "a", 995, 1), /out of balance/);
  clean(s);
});

ok("being long increases how much you may offer, by exactly the ceiling a lot", () => {
  const s = market(["a", "b"], 100_000);
  const g = grid(s);
  A(s, "b", 10, 1);
  B(s, "a", 10, 1); // a is long 1 at 10
  assert.strictEqual(powers(s, s.players.a).sellC, 100_000 - 1_000 + g.settleMax * 100);
  clean(s);
});

ok("cancelling releases the reservation", () => {
  const s = market();
  const r = B(s, "a", 600, 5);
  assert.strictEqual(powers(s, s.players.a).buyC, 10_000_000 - 300_000);
  cancelOrder(s, "a", r.resting.id);
  assert.strictEqual(powers(s, s.players.a).buyC, 10_000_000);
  clean(s);
});

ok("you cannot cancel somebody else's order, and cancel-all clears only yours", () => {
  const s = market();
  const r = B(s, "a", 600, 1);
  throws(() => cancelOrder(s, "b", r.resting.id), /not your order/);
  B(s, "b", 300, 2);
  B(s, "a", 350, 3);
  const out = cancelAll(s, "a");
  assert.strictEqual(out.canceled, 2);
  assert.strictEqual(out.qty, 4);
  assert.strictEqual(s.orders.length, 1, "the other player's order survives");
  throws(() => cancelLevel(s, "a", "B", 600), /nothing of yours/);
  clean(s);
});

ok("there is exactly one price in the game, and it is flat", () => {
  assert.strictEqual(descentCostC({ cash: 10_000_000 }), 100_000, "a step is $1,000");
  assert.strictEqual(descentCostC({ cash: 1_000 }), 100_000, "and stays $1,000 when you are nearly broke");
  assert.strictEqual(MONEY.startCashC, 10_000_000, "$100,000 to start");
  assert.strictEqual(MONEY.descentCostC, 100_000);
  assert.ok(!("probeCostPct" in MONEY) && !("ticketCostPct" in MONEY), "nothing else is for sale");
});

ok("spending on information is checked against BOTH invariants", () => {
  const s = market(["a", "b"], 1_000_000);
  B(s, "a", 100, 10); // ties up $100 x 10 on invariant A
  assert.strictEqual(spendableC(s, s.players.a), 1_000_000 - 100_000);
  A(s, "a", 910, 10); // ties up $90 x 10 on invariant B
  assert.strictEqual(spendableC(s, s.players.a), Math.min(900_000, 1_000_000 - 90_000));
  clean(s);
});

/* ── the no-bankruptcy claim ──────────────────────────────────────────── */

console.log("\nsolvency");

ok("no settlement price can make anyone negative, on a busy random book", () => {
  const s = market(["a", "b", "c", "d"], 5_000_000);
  const g = grid(s);
  const rnd = mulberry(99);
  for (let i = 0; i < 500; i++) {
    const pid = ["a", "b", "c", "d"][Math.floor(rnd() * 4)];
    const side = rnd() < 0.5 ? "B" : "A";
    // Deliberately quote well outside the settlement range too.
    const px = snapTick(s, g.settleMin - 400 + rnd() * (g.settleMax - g.settleMin + 800));
    try {
      placeOrder(s, pid, side, px, 1 + Math.floor(rnd() * 5), tick());
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
    }
  }
  clean(s);
  settlesSafelyEverywhere(s, "random book");
});

ok("random storm: 60 players, 20,000 actions, invariants hold throughout", () => {
  const names = Array.from({ length: 60 }, (_, i) => `p${i}`);
  const s = market(names, 10_000_000);
  const g = grid(s);
  const rnd = mulberry(4242);
  let placed = 0;
  let traded = 0;
  for (let i = 0; i < 20_000; i++) {
    const pid = names[Math.floor(rnd() * names.length)];
    const roll = rnd();
    try {
      if (roll < 0.62) {
        const side = rnd() < 0.5 ? "B" : "A";
        const px = snapTick(s, g.settleMin - 200 + rnd() * (g.settleMax - g.settleMin + 400));
        const r = placeOrder(s, pid, side, px, 1 + Math.floor(rnd() * 8), tick());
        placed++;
        traded += r.filled;
      } else if (roll < 0.8) {
        cancelAll(s, pid);
      } else if (roll < 0.92) {
        const mine = s.orders.filter((o) => o.pid === pid);
        if (mine.length) cancelOrder(s, pid, mine[Math.floor(rnd() * mine.length)].id);
      } else {
        const p = s.players[pid];
        const cost = descentCostC(p);
        if (cost <= spendableC(s, p)) {
          p.cash -= cost;
          p.spentC += cost;
        }
      }
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
    }
    if (i % 500 === 0) clean(s);
  }
  clean(s);
  assert.ok(traded > 500, `expected real trading, got ${traded} shares from ${placed} orders`);
  settlesSafelyEverywhere(s, "storm");
});

ok("money is conserved: the room's cash only ever falls by what it spends", () => {
  const names = ["a", "b", "c", "d", "e"];
  const s = market(names, 3_000_000);
  const rnd = mulberry(7);
  for (let i = 0; i < 3000; i++) {
    try {
      placeOrder(s, names[Math.floor(rnd() * names.length)], rnd() < 0.5 ? "B" : "A", snapTick(s, rnd() * 1000), 1 + Math.floor(rnd() * 4), tick());
    } catch {}
  }
  const total = () => Object.values(s.players).reduce((t, p) => t + p.cash, 0);
  const start = names.length * 3_000_000;
  assert.strictEqual(total(), start, "trading must not create or destroy cash");
  settle(s, 615.5, tick());
  assert.strictEqual(total(), start, "settlement must not create or destroy cash");
  clean(s);
});

ok("open interest always nets to zero", () => {
  const s = market(["a", "b", "c"]);
  const rnd = mulberry(11);
  for (let i = 0; i < 800; i++) {
    try {
      placeOrder(s, ["a", "b", "c"][Math.floor(rnd() * 3)], rnd() < 0.5 ? "B" : "A", snapTick(s, rnd() * 1000), 1 + Math.floor(rnd() * 3), tick());
    } catch {}
  }
  assert.strictEqual(Object.values(s.players).reduce((t, p) => t + p.pos, 0), 0);
  clean(s);
});

ok("you cannot mint value by washing trades through a teammate", () => {
  const s = market(["a", "b"], 10_000_000);
  const before = leaderboard(s)[0].valueC;
  for (let i = 0; i < 20; i++) {
    A(s, "a", 900, 1);
    B(s, "b", 900, 1);
    A(s, "b", 100, 1);
    B(s, "a", 100, 1);
  }
  cancelAll(s, "a");
  cancelAll(s, "b");
  settle(s, 440, tick());
  assert.strictEqual(leaderboard(s)[0].valueC, before, "team value moved on wash trades");
  clean(s);
});

ok("order caps are enforced", () => {
  const s = market(["a", "b"], 1_000_000_000);
  for (let i = 0; i < LIMITS.maxOrdersPerPlayer; i++) placeOrder(s, "a", "B", 5, 1, tick());
  throws(() => B(s, "a", 5, 1), /resting orders/);
  clean(s);
});

/* ── settlement and scoring ───────────────────────────────────────────── */

console.log("\nsettlement");

ok("settlement pays shares at the settlement value, to the cent, and pulls the book", () => {
  const s = market();
  A(s, "a", 300, 2);
  B(s, "b", 300, 2);
  B(s, "c", 100, 1); // resting, must not fill at the bell
  settle(s, 632.75, tick());
  assert.strictEqual(s.orders.length, 0);
  assert.strictEqual(s.players.b.cash, 10_000_000 - 60_000 + 2 * 63_275);
  assert.strictEqual(s.players.a.cash, 10_000_000 + 60_000 - 2 * 63_275);
  assert.strictEqual(s.players.c.cash, 10_000_000);
  assert.strictEqual(s.players.b.settledPos, 2);
  clean(s);
});

ok("settling twice does nothing the second time", () => {
  const s = market();
  A(s, "a", 200, 1);
  B(s, "b", 200, 1);
  settle(s, 550, tick());
  const snapshot = JSON.stringify(s.players);
  settle(s, 550, tick());
  assert.strictEqual(JSON.stringify(s.players), snapshot);
});

ok("being right pays and being wrong costs", () => {
  const s = market(["bull", "bear"], 10_000_000);
  A(s, "bear", 300, 5);
  B(s, "bull", 300, 5);
  settle(s, 700, tick());
  assert.ok(s.players.bull.cash > 10_000_000, "the buyer who was right must profit");
  assert.ok(s.players.bear.cash < 10_000_000, "the seller who was wrong must lose");
  assert.strictEqual(s.players.bull.cash + s.players.bear.cash, 20_000_000);
});

ok("the mark is the last trade; the mid is the touch, then the center", () => {
  const s = market();
  assert.strictEqual(midPx(s), 500, "an empty book sits where the ladder opened");
  assert.strictEqual(markPx(s), 500);
  B(s, "a", 200, 1);
  A(s, "b", 400, 1);
  assert.strictEqual(midPx(s), 300);
  A(s, "c", 200, 1);
  assert.strictEqual(markPx(s), 200, "once something trades, that is the mark");
});

ok("mark-to-market tracks the position", () => {
  const s = market();
  A(s, "a", 400, 1);
  B(s, "b", 400, 1);
  assert.strictEqual(valueC(s, s.players.b), 10_000_000);
  s.last = 600;
  assert.strictEqual(valueC(s, s.players.b), 10_000_000 - 40_000 + 60_000);
  assert.strictEqual(valueC(s, s.players.a), 10_000_000 + 40_000 - 60_000);
});

/* ── teams ────────────────────────────────────────────────────────────── */

console.log("\nteams");

ok("a team caps at four and the code is what lets you in", () => {
  const s = market([]);
  for (const n of ["a", "b", "c", "d", "e"]) s.players[n] = newPlayer(n, n, `d${n}`, 10_000_000, clock);
  const code = makeTeamCode(s, (n) => Math.floor(Math.random() * n));
  createTeam(s, "a", "Sharpe Ratio", "T1", code);
  joinTeam(s, "b", code);
  joinTeam(s, "c", code.toLowerCase());
  joinTeam(s, "d", code);
  throws(() => joinTeam(s, "e", code), /full/);
  throws(() => joinTeam(s, "e", "ZZZZ"), /no team has that code/);
  assert.strictEqual(s.teams.T1.members.length, 4);
});

ok("names and double-joins are refused", () => {
  const s = market([]);
  for (const n of ["a", "b"]) s.players[n] = newPlayer(n, n, `d${n}`, 10_000_000, clock);
  createTeam(s, "a", "Gamma", "T1", "AAAA");
  throws(() => createTeam(s, "b", "gamma", "T2", "BBBB"), /already has that name/);
  throws(() => createTeam(s, "a", "Delta", "T3", "CCCC"), /already on a team/);
});

ok("a team scores the AVERAGE of its members, so size does not matter", () => {
  const four = market(["a", "b", "c", "d"], 10_000_000);
  A(four, "a", 300, 1);
  B(four, "b", 300, 1);
  settle(four, 800, tick());
  const rows = leaderboard(four);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].size, 4);
  assert.strictEqual(rows[0].valueC, 10_000_000, "the score is the average, and internal trades cannot move it");
  assert.strictEqual(rows[0].totalC, 40_000_000, "the total is still reported");
  assert.ok(rows[0].members.find((m) => m.name === "B").valueC > 10_000_000, "members keep their own number");

  // A team of two that did nothing must tie a team of four that did nothing —
  // turning up with more people is not an edge.
  const two = market(["x", "y"], 10_000_000);
  settle(two, 800, tick());
  assert.strictEqual(leaderboard(two)[0].valueC, rows[0].valueC, "three players or four, same score");
});

ok("leaving is blocked while you hold risk", () => {
  const s = market(["a", "b"]);
  const r = B(s, "a", 300, 1);
  throws(() => leaveTeam(s, "a"), /cancel your orders/);
  cancelOrder(s, "a", r.resting.id);
  A(s, "b", 300, 1);
  B(s, "a", 300, 1);
  throws(() => leaveTeam(s, "a"), /settle your position/);
});

/* ── views ────────────────────────────────────────────────────────────── */

console.log("\nviews");

ok("the book view shows your shares separately from the market's", () => {
  const s = market();
  B(s, "a", 400, 3);
  B(s, "b", 400, 2);
  const l = bookLevels(s, "a").bids.find((x) => x.px === 400);
  assert.strictEqual(l.qty, 5);
  assert.strictEqual(l.mine, 3);
  assert.strictEqual(bookLevels(s, "b").bids[0].mine, 2);
  assert.strictEqual(bookLevels(s, null).bids[0].mine, 0);
});

ok("both sides of a fill get a notification", () => {
  const s = market();
  A(s, "a", 400, 1);
  B(s, "b", 400, 1);
  assert.strictEqual(s.players.a.fills[0].side, "A");
  assert.strictEqual(s.players.a.fills[0].taker, false);
  assert.strictEqual(s.players.b.fills[0].taker, true);
  assert.strictEqual(s.players.b.fills[0].cp, "A");
});

ok("no error message ever names a settlement bound", () => {
  const s = market(["a", "b"], 50_000);
  const g = grid(s);
  // Prices chosen so that neither bound is a number the player typed — any
  // appearance of one in the reply would therefore be the engine leaking it.
  const messages = [];
  for (const attempt of [
    () => B(s, "a", 995, 50),
    () => A(s, "a", 5, 50),
    () => B(s, "a", 4995, 50),
    () => A(s, "a", -4995, 50),
    () => B(s, "a", g.orderMax + 5, 1),
    () => B(s, "a", 502, 1),
  ]) {
    try {
      attempt();
    } catch (e) {
      messages.push(e.message);
    }
  }
  assert.ok(messages.length >= 4, "expected several rejections to inspect");
  for (const m of messages) {
    assert.ok(!new RegExp(`\b${g.settleMax}\b`).test(m), `leaked the ceiling: ${m}`);
    assert.ok(!new RegExp(`\b${g.orderMax}\b`).test(m), `leaked the ladder end: ${m}`);
    assert.ok(!/settlement can reach|between \d+ and \d+/.test(m), `leaked a range: ${m}`);
  }
});

ok("the tape and the fill log stay capped", () => {
  const s = market(["a", "b"], 1_000_000_000);
  for (let i = 0; i < LIMITS.tapeLength + 40; i++) {
    A(s, "a", 500, 1);
    B(s, "b", 500, 1);
  }
  assert.strictEqual(s.tape.length, LIMITS.tapeLength);
  assert.strictEqual(s.players.a.fills.length, LIMITS.fillsKept);
});

/* ── util ─────────────────────────────────────────────────────────────── */

function mulberry(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
