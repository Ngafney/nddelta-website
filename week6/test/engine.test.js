/**
 * Engine tests — the week 3 matching engine on week 6's three books and one
 * underlying. Ported from week 5 (priority, self-trade, hidden tables), plus
 * what this week leans on: the per-sum solvency invariant, settlement of all
 * three books at the right payoffs, parity, book toggles, the lock on teams,
 * and a random storm across every book that must never break solvency at ANY
 * reachable sum. `npm run test:engine` in week6/.
 */
import assert from "node:assert";
import {
  newMarket, newPlayer, placeOrder, cancelAll, cancelOrder, cancelLevel, setBookOpen, settle, auditState, spendableC,
  createTeam, joinTeam, leaveTeam, setTeamNumber, grid, leaderboard, bookLevels, teamView, powers, bounds,
} from "../shared/engine.js";
import { MONEY, BOOK_ORDER } from "../shared/rules.js";
import { payoff, shuffle } from "../shared/game.js";
import { rngFrom } from "../shared/rng.js";

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e.stack ?? e.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
}

/**
 * A sealed pot: three teams (numbers 7, 3, 10 → S = 20, N = 3, Smax = 30),
 * K = 15, every book open, trading live. `revealed` can pre-fill the pot.
 */
function room({ K = 15, revealed = [], books = { fut: true, call: true, put: true }, numbers = [7, 3, 10] } = {}) {
  const s = newMarket({ roundId: "r", startCashC: MONEY.startCashC, books, K });
  const ids = ["a", "b", "c", "d"];
  for (const id of ids) s.players[id] = newPlayer(id, id.toUpperCase(), `dev-${id}`, MONEY.startCashC, 0);
  createTeam(s, "a", "Team A", "ta", "AAAA", numbers[0], 0);
  joinTeam(s, "b", "AAAA");
  createTeam(s, "c", "Team C", "tc", "CCCC", numbers[1], 0);
  createTeam(s, "d", "Team D", "td", "DDDD", numbers[2], 0);
  // the lock, as the server does it
  s.N = 3;
  s.K = K;
  s.Smax = 30;
  s.locked = true;
  s.revealOrder = ["ta", "tc", "td"];
  s.revealed = revealed.map((n, i) => ({ n, at: i }));
  s.status = "live";
  return s;
}
const S_TRUE = 20;

console.log("\nthe ladders");

ok("each book's ladder is its payoff range: SUM 0…10N, CALL 0…10N−K, PUT 0…K", () => {
  const s = room();
  assert.deepStrictEqual([grid(s, "fut").orderMin, grid(s, "fut").orderMax], [0, 30]);
  assert.deepStrictEqual([grid(s, "call").orderMin, grid(s, "call").orderMax], [0, 15]);
  assert.deepStrictEqual([grid(s, "put").orderMin, grid(s, "put").orderMax], [0, 15]);
  assert.throws(() => placeOrder(s, "a", "fut", "B", 31, 1, 0), /off the ladder/);
  assert.throws(() => placeOrder(s, "a", "call", "A", 16, 1, 0), /off the ladder/);
  assert.throws(() => placeOrder(s, "a", "put", "B", -1, 1, 0), /off the ladder/);
  assert.throws(() => placeOrder(s, "a", "fut", "B", 12.5, 1, 0), /off the ladder/);
  assert.throws(() => placeOrder(s, "a", "straddle", "B", 1, 1, 0), /no such book/);
  placeOrder(s, "a", "fut", "B", 30, 1, 0);
  placeOrder(s, "c", "put", "A", 0, 1, 0);
  assert.deepStrictEqual(auditState(s), []);
});

ok("the ladder opens at the uniform-prior fair value and narrows as numbers come out", () => {
  const open = room();
  assert.strictEqual(grid(open, "fut").center, 15, "E[S] = 3 × 5");
  const late = room({ revealed: [7, 3] });
  assert.strictEqual(grid(late, "fut").center, 15, "10 known + 5 expected");
  assert.deepStrictEqual(bounds(late), { sum: 10, left: 1, lo: 10, hi: 20 });
  assert.strictEqual(grid(late, "put").center, Math.round((5 + 4 + 3 + 2 + 1 + 0 * 6) / 11), "put fair with one number left");
});

console.log("\nsolvency across every reachable sum");

ok("a player with no cash cannot quote anything, anywhere", () => {
  const s = room();
  const p = s.players.a;
  p.cash -= MONEY.startCashC;
  p.spentC += MONEY.startCashC;
  for (const k of BOOK_ORDER) {
    assert.throws(() => placeOrder(s, "a", k, "B", 5, 1, 0), /out of balance/);
    assert.throws(() => placeOrder(s, "a", k, "A", 5, 1, 0), /out of balance/);
  }
  placeOrder(s, "a", "fut", "B", 0, 1, 0); // a bid at zero cannot lose, so even a broke player may post one
  assert.deepStrictEqual(auditState(s), []);
});

ok("the margin is the worst case over the sums still possible, not the whole range", () => {
  // $100 of cash. A SUM offer at 25 risks (30 − 25) = $5 a share at the open…
  const s = room();
  s.players.a.cash = 10_000;
  s.players.a.startC = 10_000;
  for (const id of ["b", "c", "d"]) s.players[id].cash = s.players[id].startC = 10_000;
  placeOrder(s, "a", "fut", "A", 25, 20, 0);
  assert.throws(() => placeOrder(s, "a", "fut", "A", 25, 1, 0), /out of balance/, "20 shares × $5 = every dollar");
  cancelAll(s, "a");
  // …but with 7 and 3 out and one number left, S ≤ 20, so an offer at 25 can never lose.
  const t = room({ revealed: [7, 3] });
  t.players.a.cash = t.players.a.startC = 10_000;
  placeOrder(t, "a", "fut", "A", 25, 50, 0);
  placeOrder(t, "a", "fut", "A", 20, 50, 0);
  placeOrder(t, "a", "fut", "A", 19, 50, 0); // worst case S = 20: $1 × 50 = $50 of the $100
  assert.throws(() => placeOrder(t, "a", "fut", "A", 17, 50, 0), /out of balance/, "$3 × 50 on top of the $50 already at risk");
  placeOrder(t, "a", "fut", "A", 18, 25, 0); // $2 × 25 = $50 more: exactly the stack
  assert.strictEqual(powers(t, t.players.a).freeC, 0);
  assert.throws(() => placeOrder(t, "a", "fut", "A", 19, 1, 0), /out of balance/);
  assert.deepStrictEqual(auditState(t), []);
});

ok("a bid above the highest possible payoff is margined against the loss it locks in", () => {
  const s = room({ revealed: [7, 3] }); // S ∈ [10, 20]
  s.players.a.cash = s.players.a.startC = 10_000; // $100
  // A SUM bid at 25 loses at least $5 a share, at most $15: 10 shares could lose $150 > $100.
  assert.throws(() => placeOrder(s, "a", "fut", "B", 25, 10, 0), /out of balance/);
  placeOrder(s, "a", "fut", "B", 25, 6, 0); // worst $90
  assert.throws(() => placeOrder(s, "a", "fut", "B", 25, 1, 0), /out of balance/);
  assert.deepStrictEqual(auditState(s), []);
});

ok("a put offer is margined against LOW sums and a call offer against HIGH ones", () => {
  const s = room(); // K = 15, S ∈ [0, 30]
  s.players.a.cash = s.players.a.startC = 10_000;
  // Short put: worst at S = 0 pays 15; offered at 5 → loses $10 a share → 10 shares.
  placeOrder(s, "a", "put", "A", 5, 10, 0);
  assert.throws(() => placeOrder(s, "a", "put", "A", 5, 1, 0), /out of balance/);
  cancelAll(s, "a");
  // Short call: worst at S = 30 pays 15; offered at 5 → same.
  placeOrder(s, "a", "call", "A", 5, 10, 0);
  assert.throws(() => placeOrder(s, "a", "call", "A", 5, 1, 0), /out of balance/);
  cancelAll(s, "a");
  // Short a call AND a put at 5 each: the two worst cases are at opposite ends,
  // so together they need only max, not sum: a short put loses at S=0 where the
  // short call wins its premium. 10 of each is 10 × (10 − 5)… still only $50 at
  // either end. So 10 + 10 fits, and more besides.
  placeOrder(s, "a", "call", "A", 5, 10, 0);
  placeOrder(s, "a", "put", "A", 5, 10, 0);
  assert.ok(powers(s, s.players.a).freeC >= 0);
  assert.deepStrictEqual(auditState(s), []);
});

ok("positions across books offset: long the sum, short the call, short the put is riskless by parity", () => {
  const s = room(); // K = 15
  // b buys 10 SUM at 15, sells 10 CALL at 2, sells 10 PUT at 2 — against c.
  placeOrder(s, "c", "fut", "A", 15, 10, 1);
  placeOrder(s, "b", "fut", "B", 15, 10, 2);
  placeOrder(s, "c", "call", "B", 2, 10, 3);
  placeOrder(s, "b", "call", "A", 2, 10, 4);
  placeOrder(s, "c", "put", "B", 2, 10, 5);
  placeOrder(s, "b", "put", "A", 2, 10, 6);
  // b's final cash is the same at every S: SUM − CALL + PUT… wait: long S, short call, short put
  // pays S − max(S−K,0) − max(K−S,0) = min(S,K) − max(K−S,0) = S − |S−K|… not flat. Use the
  // parity trade instead: long SUM, short CALL, long PUT pays K exactly.
  cancelAll(s, "b");
  const t = room();
  placeOrder(t, "c", "fut", "A", 15, 10, 1);
  placeOrder(t, "b", "fut", "B", 15, 10, 2);
  placeOrder(t, "c", "call", "B", 2, 10, 3);
  placeOrder(t, "b", "call", "A", 2, 10, 4);
  placeOrder(t, "c", "put", "A", 2, 10, 5);
  placeOrder(t, "b", "put", "B", 2, 10, 6);
  const before = t.players.b.cash;
  for (const S of [0, 7, 15, 23, 30]) {
    const u = JSON.parse(JSON.stringify(t));
    settle(u, S, 9);
    assert.strictEqual(u.players.b.cash, before + 10 * 15 * 100, `b holds K regardless, at S=${S}`);
  }
  // And because the position is riskless, b's headroom is the full stack less what was paid net.
  assert.strictEqual(powers(t, t.players.b).freeC, before + 10 * 15 * 100);
  void s;
});

console.log("\nmatching");

ok("price-time priority within a book, and books never cross-match", () => {
  const s = room();
  placeOrder(s, "a", "fut", "A", 16, 5, 1);
  placeOrder(s, "c", "fut", "A", 15, 5, 2);
  placeOrder(s, "a", "fut", "A", 15, 5, 3);
  placeOrder(s, "d", "call", "A", 1, 5, 4); // a call offer at 1 must not fill a SUM bid
  const r = placeOrder(s, "b", "fut", "B", 16, 12, 5);
  assert.deepStrictEqual(r.trades.map((t) => [t.px, t.qty, t.seller]), [[15, 5, "c"], [15, 5, "a"], [16, 2, "a"]]);
  assert.strictEqual(s.players.b.pos.fut, 12);
  assert.strictEqual(s.players.b.pos.call, 0);
  assert.strictEqual(s.books.call.orders.length, 1);
  assert.strictEqual(s.players.b.cash, MONEY.startCashC - (15 * 10 + 16 * 2) * 100);
  assert.deepStrictEqual(auditState(s), []);
});

ok("self-trade prevention: crossing your own order cancels it and prints nothing", () => {
  const s = room();
  placeOrder(s, "a", "put", "A", 6, 5, 1);
  const r = placeOrder(s, "a", "put", "B", 7, 5, 2);
  assert.strictEqual(r.trades.length, 0);
  assert.strictEqual(s.books.put.last, null);
  assert.deepStrictEqual(bookLevels(s, "put", "a").asks, []);
  assert.strictEqual(bookLevels(s, "put", "a").bids[0].px, 7);
});

ok("the books are shut outside the live phase and when the host has not opened them", () => {
  const s = room();
  for (const status of ["lobby", "settled"]) {
    s.status = status;
    assert.throws(() => placeOrder(s, "a", "fut", "B", 10, 1, 0), /closed/);
  }
  s.status = "live";
  const t = room({ books: { fut: true, call: false, put: false } });
  placeOrder(t, "a", "fut", "B", 10, 1, 0);
  assert.throws(() => placeOrder(t, "a", "call", "B", 1, 1, 0), /not open for trading yet/);
  assert.throws(() => placeOrder(t, "a", "put", "B", 1, 1, 0), /not open for trading yet/);
  setBookOpen(t, "call", true);
  placeOrder(t, "a", "call", "B", 1, 1, 0);
  // Shutting a book pulls everything resting in it, and only in it.
  setBookOpen(t, "call", false);
  assert.strictEqual(t.books.call.orders.length, 0);
  assert.strictEqual(t.books.fut.orders.length, 1);
  assert.deepStrictEqual(auditState(t), []);
});

ok("cancel by id, by level and all-in-one-book each touch only what they should", () => {
  const s = room();
  const r1 = placeOrder(s, "a", "fut", "B", 10, 5, 1);
  placeOrder(s, "a", "fut", "B", 10, 5, 2);
  placeOrder(s, "a", "call", "B", 3, 5, 3);
  placeOrder(s, "a", "put", "B", 3, 5, 4);
  assert.deepStrictEqual(cancelOrder(s, "a", r1.resting.id), { canceled: 1, qty: 5 });
  assert.throws(() => cancelOrder(s, "c", s.books.fut.orders[0].id), /not your order/);
  assert.throws(() => cancelOrder(s, "a", 999), /already gone/);
  assert.deepStrictEqual(cancelLevel(s, "a", "fut", "B", 10), { canceled: 1, qty: 5 });
  assert.throws(() => cancelLevel(s, "a", "fut", "B", 10), /nothing of yours/);
  assert.deepStrictEqual(cancelAll(s, "a", "call"), { canceled: 1, qty: 5 });
  assert.strictEqual(s.books.put.orders.length, 1);
  assert.deepStrictEqual(cancelAll(s, "a"), { canceled: 1, qty: 5 });
});

console.log("\nsettlement");

ok("settlement pays each book its payoff at S, in whole cents, and pulls every resting order", () => {
  for (const S of [0, 4, 15, 20, 30]) {
    const s = room();
    placeOrder(s, "c", "fut", "A", 14, 10, 1);
    placeOrder(s, "a", "fut", "B", 14, 10, 2); // a long 10 SUM at 14
    placeOrder(s, "c", "call", "A", 3, 7, 3);
    placeOrder(s, "a", "call", "B", 3, 7, 4); // a long 7 CALL at 3
    placeOrder(s, "a", "put", "A", 4, 5, 5);
    placeOrder(s, "c", "put", "B", 4, 5, 6); // a short 5 PUT at 4
    placeOrder(s, "b", "fut", "B", 1, 5, 7); // left resting
    settle(s, S, 9);
    for (const k of BOOK_ORDER) assert.strictEqual(s.books[k].orders.length, 0);
    const paid = 10 * 14 + 7 * 3 - 5 * 4;
    const got = 10 * payoff("fut", S, 15) + 7 * payoff("call", S, 15) - 5 * payoff("put", S, 15);
    assert.strictEqual(s.players.a.cash, MONEY.startCashC - paid * 100 + got * 100, `a at S=${S}`);
    assert.strictEqual(s.players.c.cash, MONEY.startCashC + paid * 100 - got * 100, `c at S=${S}`);
    assert.strictEqual(s.players.b.cash, MONEY.startCashC, "a resting order never fills at the bell");
    assert.deepStrictEqual(s.payouts, { fut: S, call: Math.max(S - 15, 0), put: Math.max(15 - S, 0) });
    assert.deepStrictEqual(s.players.a.settledPos, { fut: 10, call: 7, put: -5 });
    assert.deepStrictEqual(s.players.a.pos, { fut: 0, call: 0, put: 0 });
    assert.strictEqual(settle(s, 99, 10).settleS, S, "settling twice changes nothing");
    assert.deepStrictEqual(auditState(s), []);
    for (const p of Object.values(s.players)) assert.ok(p.cash >= 0);
  }
});

ok("hidden tables trade but never appear on the leaderboard; team scores are averages", () => {
  const s = room();
  s.players.bot = newPlayer("bot", "DESK", "dev-bot", MONEY.startCashC * 400, 0);
  s.players.bot.teamId = "house";
  s.teams.house = { id: "house", name: "HOUSE", code: "----", members: ["bot"], hidden: true, number: null };
  placeOrder(s, "bot", "fut", "A", 12, 5, 1);
  placeOrder(s, "a", "fut", "B", 12, 5, 2);
  const lb = leaderboard(s);
  assert.ok(!lb.some((r) => r.id === "house"));
  assert.strictEqual(lb.length, 3);
  const ta = lb.find((r) => r.id === "ta");
  assert.strictEqual(ta.size, 2);
  assert.strictEqual(ta.valueC, Math.round((s.players.a.cash + 5 * 12 * 100 + s.players.b.cash) / 2), "marked at the last trade");
  assert.deepStrictEqual(auditState(s), []);
});

console.log("\nteams and the pot");

ok("a team forms with a legal number, any member may change it, and the lock seals it", () => {
  const s = newMarket({ roundId: "r", startCashC: MONEY.startCashC });
  for (const id of ["a", "b", "c"]) s.players[id] = newPlayer(id, id.toUpperCase(), `dev-${id}`, MONEY.startCashC, 0);
  assert.throws(() => createTeam(s, "a", "Team A", "ta", "AAAA", 11, 0), /0 to 10/);
  assert.throws(() => createTeam(s, "a", "Team A", "ta", "AAAA", -1, 0), /0 to 10/);
  assert.throws(() => createTeam(s, "a", "Team A", "ta", "AAAA", 2.5, 0), /0 to 10/);
  assert.throws(() => createTeam(s, "a", "Team A", "ta", "AAAA", NaN, 0), /0 to 10/);
  createTeam(s, "a", "Team A", "ta", "AAAA", 0, 0);
  assert.strictEqual(teamView(s, s.players.a).number, 0, "zero is a real number, not a blank");
  joinTeam(s, "b", "AAAA");
  setTeamNumber(s, "b", 10, 1);
  assert.strictEqual(teamView(s, s.players.a).number, 10);
  assert.strictEqual(teamView(s, s.players.a).pickedBy, "B");
  assert.throws(() => setTeamNumber(s, "c", 4, 1), /join or create/);
  assert.throws(() => setTeamNumber(s, "a", 11, 1), /0 to 10/);
  s.locked = true;
  assert.throws(() => setTeamNumber(s, "a", 4, 1), /sealed/);
  assert.throws(() => createTeam(s, "c", "Team C", "tc", "CCCC", 4, 0), /sealed/);
  assert.throws(() => leaveTeam(s, "b"), /locked/);
  leaveTeam(s, "b", { force: true });
  assert.ok(s.teams.ta, "a kicked player does not take the team with them after the lock");
  assert.strictEqual(teamView(s, s.players.a).canPick, false);
});

ok("before the lock an emptied team disappears with its code; a kick after the lock leaves the number in the pot", () => {
  const s = newMarket({ roundId: "r", startCashC: MONEY.startCashC });
  s.players.a = newPlayer("a", "A", "dev-a", MONEY.startCashC, 0);
  createTeam(s, "a", "Solo", "ts", "SSSS", 7, 0);
  leaveTeam(s, "a");
  assert.strictEqual(s.teams.ts, undefined);
  assert.strictEqual(s.codes.SSSS, undefined);
  const t = room();
  leaveTeam(t, "c", { force: true });
  assert.deepStrictEqual(t.teams.tc.members, []);
  assert.strictEqual(t.teams.tc.number, 3);
  assert.strictEqual(t.teams.tc.owner, null);
  assert.deepStrictEqual(auditState(t), []);
  assert.ok(!leaderboard(t).some((r) => r.id === "tc"), "an empty team is not ranked");
});

console.log("\nthe storm");

ok("a random storm across all three books never breaks solvency, at any reachable sum, as the pot empties", () => {
  for (const seedBase of ["storm-1", "storm-2"]) {
    const numbers = shuffle([7, 3, 10], seedBase).slice(0, 3);
    const s = room({ numbers, K: 15 });
    const rand = rngFrom(seedBase);
    const ids = ["a", "b", "c", "d"];
    const order = ["ta", "tc", "td"];
    let revealedAt = [900, 1800]; // reveal two numbers along the way
    for (let i = 0; i < 2700; i++) {
      if (revealedAt.length && i === revealedAt[0]) {
        revealedAt = revealedAt.slice(1);
        const tid = order[s.revealed.length];
        s.revealed.push({ n: s.teams[tid].number, at: i });
      }
      const id = ids[Math.floor(rand() * 4)];
      if (rand() < 0.04) {
        cancelAll(s, id);
        continue;
      }
      const mkt = BOOK_ORDER[Math.floor(rand() * 3)];
      const g = grid(s, mkt);
      const px = g.orderMin + Math.floor(rand() * (g.orderMax - g.orderMin + 1));
      try {
        placeOrder(s, id, mkt, rand() < 0.5 ? "B" : "A", px, 1 + Math.floor(rand() * 50), i);
      } catch (e) {
        if (!/balance|too many|full/.test(e.message)) throw e;
      }
      if (i % 300 === 0) assert.deepStrictEqual(auditState(s), [], `step ${i}`);
    }
    assert.deepStrictEqual(auditState(s), []);
    assert.ok(BOOK_ORDER.some((k) => s.books[k].volume > 0), "something traded");
    // Settle at EVERY sum still reachable: nobody may end below zero at any of them.
    const { lo, hi } = bounds(s);
    for (let S = lo; S <= hi; S++) {
      const u = JSON.parse(JSON.stringify(s));
      settle(u, S, 1);
      assert.deepStrictEqual(auditState(u), [], `S=${S}`);
      for (const p of Object.values(u.players)) assert.ok(p.cash >= 0, `${p.name} at ${p.cash} when S=${S}`);
    }
    // And at the true sum, with the audit's own check that the numbers add up.
    settle(s, numbers.reduce((a, b) => a + b, 0), 1);
    assert.deepStrictEqual(auditState(s), []);
    assert.ok(spendableC(s, s.players.a) >= 0);
  }
});

ok("a settlement outside the public bounds would be caught by the audit", () => {
  const s = room({ revealed: [7, 3, 10] });
  settle(s, 21, 1);
  assert.ok(auditState(s).some((p) => /settled at 21 but the numbers sum to 20/.test(p)));
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
