/**
 * The exchange. Two books, one wallet, and a margin rule that has to be exactly
 * right or the whole round is a lie.
 *
 * The property that matters most: whichever way the asteroid lands, nobody ends
 * up owing money. Every test that touches trading finishes by settling a copy
 * BOTH ways and checking every balance.
 */
import assert from "node:assert";
import {
  newMarket, newPlayer, placeOrder, cancelOrder, cancelLevel, cancelAll,
  powers, freeC, maxSharesAt, orderHolds, reservedC, bookLevels, bestBid, bestAsk,
  markPx, settle, valueC, leaderboard, makeTeamCode, createTeam, joinTeam, leaveTeam,
  teamView, auditState, payout, holdC, fmt, SHARE_C, EngineError,
} from "../shared/engine.js";
import { MARKETS, LIMITS, MONEY, BOOK } from "../shared/rules.js";

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 3).join("\n      ")}`);
  }
}

let clock = 1_000_000;
const tick = () => ++clock;

function market(names = ["a", "b", "c"], cashC = MONEY.startCashC) {
  const s = newMarket({ roundId: "r", startCashC: cashC });
  s.status = "live";
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

const B = (s, m, pid, px, qty = 1) => placeOrder(s, m, pid, "B", px, qty, tick());
const A = (s, m, pid, px, qty = 1) => placeOrder(s, m, pid, "A", px, qty, tick());
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

/** Settle a copy each way and confirm nobody is ever underwater. */
function settlesSafelyBothWays(s, label) {
  for (const winner of MARKETS) {
    const copy = JSON.parse(JSON.stringify(s));
    settle(copy, winner, tick());
    for (const p of Object.values(copy.players)) {
      assert.ok(p.cash >= 0, `${label}: ${winner} landing left ${p.name} at ${p.cash} cents`);
    }
    assert.deepStrictEqual(auditState(copy), [], `${label}: audit after ${winner} landing`);
  }
}

console.log("\nengine");

/* ── the grid ─────────────────────────────────────────────────────────── */

ok("both books share one public grid, and it hides nothing", () => {
  const s = market();
  assert.strictEqual(s.settleMin, 0);
  assert.strictEqual(s.settleMax, 100);
  assert.strictEqual(s.tick, 1);
  assert.strictEqual(s.orderMin, 1);
  assert.strictEqual(s.orderMax, 99);
  for (const m of MARKETS) assert.ok(s.books[m], `${m} has no book`);
});

ok("prices off the ladder or off the grid are refused", () => {
  const s = market();
  throws(() => B(s, "north", "a", 0, 1), /price must be/);
  throws(() => B(s, "north", "a", 100, 1), /price must be/);
  throws(() => B(s, "north", "a", 50.5, 1), /whole number|price must be/);
  throws(() => placeOrder(s, "east", "a", "B", 50, 1, tick()), /no such market/);
  clean(s);
});

/* ── the two payouts ──────────────────────────────────────────────────── */

ok("exactly one market pays, and the payouts say so", () => {
  assert.strictEqual(payout("north", "north"), 100);
  assert.strictEqual(payout("north", "south"), 0);
  assert.strictEqual(payout("south", "south"), 100);
  assert.strictEqual(payout("south", "north"), 0);
});

ok("a resting order's hold is what it could actually cost", () => {
  // A bid at 30 on NORTH costs 30 a share if north pays nothing...
  assert.strictEqual(holdC("south", "north", "B", 30), 30 * SHARE_C);
  // ...and nothing at all if north pays 100, because it was a bargain.
  assert.strictEqual(holdC("north", "north", "B", 30), 0);
  // An offer is the mirror image.
  assert.strictEqual(holdC("north", "north", "A", 30), 70 * SHARE_C);
  assert.strictEqual(holdC("south", "north", "A", 30), 0);
});

/* ── the books are separate ───────────────────────────────────────────── */

ok("an order on one book never appears on the other", () => {
  const s = market();
  B(s, "north", "a", 40, 5);
  assert.strictEqual(s.books.north.orders.length, 1);
  assert.strictEqual(s.books.south.orders.length, 0);
  assert.strictEqual(bestBid(s, "north"), 40);
  assert.strictEqual(bestBid(s, "south"), null);
  clean(s);
});

ok("a trade moves only the position in its own market", () => {
  const s = market();
  A(s, "south", "b", 35, 4);
  const r = B(s, "south", "a", 35, 4);
  assert.strictEqual(r.filled, 4);
  assert.strictEqual(s.players.a.pos.south, 4);
  assert.strictEqual(s.players.a.pos.north, 0);
  assert.strictEqual(s.players.b.pos.south, -4);
  clean(s);
});

/* ── the margin model ─────────────────────────────────────────────────── */

ok("holding both sides costs margin but carries no risk", () => {
  const s = market(["a", "b", "c", "d"]);
  // Somebody sells me both halves of the answer for 45 + 45.
  A(s, "north", "b", 45, 20);
  A(s, "south", "c", 45, 20);
  B(s, "north", "a", 45, 20);
  B(s, "south", "a", 45, 20);
  const a = s.players.a;
  assert.strictEqual(a.pos.north, 20);
  assert.strictEqual(a.pos.south, 20);
  // Paid 90 for something that pays 100 whichever way it goes.
  const pw = powers(s, a);
  for (const outcome of MARKETS) {
    assert.strictEqual(pw[outcome], a.cash + 100 * 20 * SHARE_C, `${outcome} should value the pair identically`);
  }
  clean(s);
  settlesSafelyBothWays(s, "a matched pair");
});

ok("the pair is genuinely cheaper to carry than one leg alone", () => {
  const one = market(["a", "b"]);
  A(one, "north", "b", 50, 10);
  B(one, "north", "a", 50, 10);
  const soloFree = freeC(one, one.players.a);

  const both = market(["a", "b", "c"]);
  A(both, "north", "b", 50, 10);
  A(both, "south", "c", 50, 10);
  B(both, "north", "a", 50, 10);
  B(both, "south", "a", 50, 10);
  const pairFree = freeC(both, both.players.a);

  // Buying the second leg costs the same cash but REMOVES the downside, so the
  // binding constraint improves even though more money went out the door.
  assert.ok(
    pairFree > soloFree,
    `one leg leaves ${fmt(soloFree)} free, the hedged pair leaves ${fmt(pairFree)} — the hedge must help`
  );
});

ok("you cannot be made insolvent by either landing", () => {
  const s = market(["a", "b"]);
  // Load up on one side as hard as the rules allow.
  let sold = 0;
  for (let i = 0; i < 40; i++) {
    try {
      B(s, "north", "b", 50, 50);
      A(s, "north", "a", 50, 50);
      sold += 50;
    } catch {
      break;
    }
  }
  assert.ok(sold > 0, "the setup never traded");
  const pw = powers(s, s.players.a);
  for (const m of MARKETS) assert.ok(pw[m] >= 0, `${m} landing would sink A`);
  clean(s);
  settlesSafelyBothWays(s, "a maximal short");
});

ok("a short in one book is capped by the outcome that hurts", () => {
  const s = market(["a", "b"]);
  // Shorting NORTH at 50: if north lands you owe 100 a share and took 50.
  // $10,000 of cash therefore carries 200 shares and not one more.
  let n = 0;
  for (let i = 0; i < 20; i++) {
    try {
      B(s, "north", "b", 50, 50);
      A(s, "north", "a", 50, 50);
      n += 50;
    } catch {
      break;
    }
  }
  assert.strictEqual(n, 200, `expected the cap at 200 shares, got ${n}`);
  assert.strictEqual(powers(s, s.players.a).north, 0, "should be sitting exactly on the line");
  clean(s);
});

ok("a resting order on the far book charges the outcome it can lose under", () => {
  const s = market(["a", "b"]);
  B(s, "north", "b", 50, 50);
  A(s, "north", "a", 50, 50); // short 50 north
  const before = powers(s, s.players.a);
  A(s, "south", "a", 10, 50); // an offer on the OTHER book, at a silly price
  const after = powers(s, s.players.a);

  // Selling SOUTH at 10 costs 90 a share, but only if south is what lands.
  assert.strictEqual(after.south, before.south - 90 * 50 * SHARE_C, "south landing must charge for it");
  // If NORTH lands the south share is worthless and the offer costs nothing —
  // charging for it there would be inventing risk that does not exist.
  assert.strictEqual(after.north, before.north, "north landing should not charge for a south offer");
  clean(s);
  settlesSafelyBothWays(s, "cross-book exposure");
});

/* ── matching ─────────────────────────────────────────────────────────── */

ok("crossing pays the resting price, and the improvement goes to the taker", () => {
  const s = market();
  A(s, "north", "b", 30, 10);
  const cash0 = s.players.a.cash;
  const r = B(s, "north", "a", 60, 10);
  assert.strictEqual(r.filled, 10);
  assert.strictEqual(r.trades[0].px, 30);
  assert.strictEqual(cash0 - s.players.a.cash, 30 * 10 * SHARE_C, "charged 30, not the 60 limit");
  clean(s);
});

ok("a sweep takes price levels in order", () => {
  const s = market(["a", "b", "c"]);
  A(s, "north", "b", 40, 5);
  A(s, "north", "c", 45, 5);
  A(s, "north", "b", 50, 5);
  const r = B(s, "north", "a", 50, 15);
  assert.deepStrictEqual(r.trades.map((t) => t.px), [40, 45, 50]);
  assert.strictEqual(r.filled, 15);
  clean(s);
});

ok("a player can never trade with themselves", () => {
  const s = market();
  B(s, "north", "a", 50, 10);
  const r = A(s, "north", "a", 40, 10);
  assert.strictEqual(r.trades.length, 0);
  assert.strictEqual(s.players.a.pos.north, 0);
  assert.strictEqual(s.books.north.orders.filter((o) => o.pid === "a" && o.side === "B").length, 0);
  clean(s);
});

ok("an unaffordable remainder is cancelled rather than refused", () => {
  const s = market(["a", "b"]);
  // Spend A down to a thin cash balance by going long, so the binding
  // constraint becomes "south lands and my north shares are worthless".
  for (let i = 0; i < 4; i++) {
    A(s, "north", "b", 50, 40);
    B(s, "north", "a", 50, 40);
  }
  const a = s.players.a;
  assert.strictEqual(a.pos.north, 160);
  assert.strictEqual(powers(s, a).south, a.cash, "south power is just the cash here");

  // 20 shares on offer at 55. Buying those 20 is affordable; resting the other
  // 30 at a limit of 99 is not, because a resting bid holds its full price.
  A(s, "north", "b", 55, 20);
  const fillCost = 55 * 20 * SHARE_C;
  const restHold = 99 * 30 * SHARE_C;
  assert.ok(a.cash > fillCost, "the crossing part has to be affordable");
  assert.ok(a.cash < fillCost + restHold, "…and the remainder has to not be");

  const r = B(s, "north", "a", 99, 50);
  assert.strictEqual(r.filled, 20);
  assert.strictEqual(r.canceled, 30);
  assert.strictEqual(r.ioc, true);
  assert.strictEqual(r.resting, null);
  assert.strictEqual(s.books.north.orders.filter((o) => o.pid === "a").length, 0);
  clean(s);
  settlesSafelyBothWays(s, "after an IOC");
});

/* ── cancelling ───────────────────────────────────────────────────────── */

ok("cancels free the balance they were holding, per book and in bulk", () => {
  const s = market();
  B(s, "north", "a", 30, 10);
  B(s, "south", "a", 30, 10);
  A(s, "north", "a", 80, 10);
  assert.strictEqual(orderHolds(s, "a").length, 3);
  const held = reservedC(s, "a");
  assert.ok(held > 0);

  cancelLevel(s, "a", "north", "B", 30);
  assert.strictEqual(orderHolds(s, "a").length, 2);

  cancelAll(s, "a", "south");
  assert.strictEqual(orderHolds(s, "a").length, 1);
  assert.strictEqual(orderHolds(s, "a")[0].market, "north");

  cancelAll(s, "a");
  assert.strictEqual(reservedC(s, "a"), 0);
  assert.strictEqual(freeC(s, s.players.a), s.players.a.cash);
  clean(s);
});

/* ── settlement ───────────────────────────────────────────────────────── */

ok("settlement pays one book a hundred and the other nothing", () => {
  const s = market(["a", "b", "c"]);
  A(s, "north", "b", 40, 10);
  B(s, "north", "a", 40, 10);
  A(s, "south", "c", 60, 10);
  B(s, "south", "a", 60, 10);
  const cash = s.players.a.cash;

  const north = JSON.parse(JSON.stringify(s));
  settle(north, "north", tick());
  assert.strictEqual(north.players.a.cash, cash + 100 * 10 * SHARE_C, "north pays only the north leg");

  const south = JSON.parse(JSON.stringify(s));
  settle(south, "south", tick());
  assert.strictEqual(south.players.a.cash, cash + 100 * 10 * SHARE_C, "south pays only the south leg");

  // Both legs at 40 and 60 cost exactly 100, so the pair is a wash either way.
  assert.strictEqual(north.players.a.cash, south.players.a.cash);
  assert.strictEqual(auditState(north).length, 0);
});

ok("settling twice does nothing the second time", () => {
  const s = market();
  settle(s, "north", tick());
  const snapshot = JSON.stringify(s.players);
  settle(s, "south", tick());
  assert.strictEqual(JSON.stringify(s.players), snapshot);
  assert.strictEqual(s.winner, "north");
});

ok("the winner has to be a real market", () => {
  const s = market();
  throws(() => settle(s, "up", tick()), /one of the two markets/);
});

/* ── scoring ──────────────────────────────────────────────────────────── */

ok("teams rank on the average, so a big table wins nothing by being big", () => {
  const s = market(["a", "b", "c", "d", "e"]);
  s.players.a.cash += 400_000;
  s.players.e.cash += 400_000;
  const board = leaderboard(s);
  const big = board.find((r) => r.size === 4);
  const small = board.find((r) => r.size === 1);
  assert.ok(big && small);
  assert.ok(small.valueC > big.valueC, "the solo player with the same profit must outrank the crowd");
  assert.ok(big.totalC > small.totalC, "…while the total still honestly favours the crowd");
});

ok("a portfolio is marked on both books at once", () => {
  const s = market(["a", "b", "c"]);
  A(s, "north", "b", 30, 10);
  B(s, "north", "a", 30, 10);
  A(s, "south", "c", 70, 10);
  B(s, "south", "a", 70, 10);
  const v = valueC(s, s.players.a);
  assert.strictEqual(v, s.players.a.cash + (30 + 70) * 10 * SHARE_C);
});

/* ── teams ────────────────────────────────────────────────────────────── */

ok("a team fills up and then refuses the fifth", () => {
  const s = market(["a"]);
  for (const n of ["b", "c", "d", "e"]) s.players[n] = newPlayer(n, n, `d${n}`, MONEY.startCashC, clock);
  const code = s.teams.t0.code;
  joinTeam(s, "b", code);
  joinTeam(s, "c", code);
  joinTeam(s, "d", code);
  throws(() => joinTeam(s, "e", code), /full/);
  clean(s);
});

ok("you cannot walk away from a position", () => {
  const s = market(["a", "b"]);
  A(s, "north", "b", 40, 5);
  B(s, "north", "a", 40, 5);
  throws(() => leaveTeam(s, "a"), /close your positions/);
});

/* ── the whole thing under load ───────────────────────────────────────── */

ok("ten thousand orders across both books leave every balance standing", () => {
  const names = [];
  for (let i = 0; i < 12; i++) names.push(`p${i}`);
  const s = market(names, 200_000_000);
  let took = 0;
  let iocs = 0;
  for (let i = 0; i < 10_000; i++) {
    const pid = names[i % names.length];
    const m = MARKETS[(i >> 1) % 2];
    const side = i % 2 ? "B" : "A";
    const px = 5 + ((i * 37) % 90);
    const qty = 1 + ((i * 13) % 25);
    // Orders rest forever otherwise, and everyone silts up against the order
    // cap long before anything interesting happens. Desks pull quotes.
    if (i % 97 === 0) cancelAll(s, names[(i / 97) % names.length | 0]);
    try {
      const r = placeOrder(s, m, pid, side, px, qty, tick());
      took++;
      if (r.ioc) {
        iocs++;
        assert.strictEqual(r.resting, null, "an IOC may never leave an order resting");
      }
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
    }
    if (i % 500 === 0) {
      const bad = auditState(s);
      assert.deepStrictEqual(bad, [], `audit broke at order ${i}: ${bad.join(" | ")}`);
    }
  }
  assert.ok(took > 1000, `only ${took} orders were accepted`);
  clean(s);
  settlesSafelyBothWays(s, "after ten thousand orders");
});

ok("no sequence of fills can overdraw a player", () => {
  // Deliberately adversarial: everyone tries to get as long and short as the
  // rules will let them on both books at once, at silly prices.
  const names = ["a", "b", "c", "d"];
  const s = market(names);
  for (let i = 0; i < 4000; i++) {
    const pid = names[i % 4];
    const m = MARKETS[i % 2];
    const side = i % 3 === 0 ? "A" : "B";
    const px = i % 7 === 0 ? 1 + (i % 12) : 88 + (i % 11);
    try {
      placeOrder(s, m, pid, side, Math.min(99, px), 1 + (i % 40), tick());
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
    }
  }
  for (const p of Object.values(s.players)) {
    const pw = powers(s, p);
    for (const m of MARKETS) assert.ok(pw[m] >= 0, `${p.name} is short ${fmt(-pw[m])} if ${m} lands`);
  }
  clean(s);
  settlesSafelyBothWays(s, "adversarial");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
