/**
 * The rules, written once.
 *
 * This constant feeds three consumers that must never disagree:
 *   1. the Rules panel students read on each game tab,
 *   2. the LLM system prompt that compiles strategies,
 *   3. the payoff tables the engine actually scores with (matrix.js
 *      imports PAYOFFS from here).
 */

// The two live games. Bandit & Chicken definitions remain below for their
// engines but are intentionally NOT listed here, so the hub, the compiler,
// and the API all treat only these two as real.
export const GAMES = ["pd", "icecream"];

export const GAME_META = {
  pd: { name: "Prisoner's Dilemma", subtitle: "Iterated · Axelrod payoffs", icon: "🤝" },
  icecream: { name: "Sunset Scoops", subtitle: "Weather-Hedging Puzzle", icon: "🍦" },
  // retired (code kept, not offered)
  bandit: { name: "Slot Machines", subtitle: "Multi-Armed Bandit", icon: "🎰" },
  chicken: { name: "Chicken", subtitle: "Hawk–Dove", icon: "🚗" },
};

/**
 * Measured economics of the scored period — what the shop actually earns at
 * each temperature, and on wet vs dry days. Drives the contract guide graph so
 * the picture students see is the real data, not an illustration.
 * (Regenerate alongside ice-data.js if the dataset changes.)
 */
export const ICE_ECON = {
  costPerDay: 1800,
  tempBands: [
    { lo: 55, hi: 60, days: 228, revenue: 827 },
    { lo: 60, hi: 65, days: 323, revenue: 1208 },
    { lo: 65, hi: 70, days: 543, revenue: 1555 },
    { lo: 70, hi: 75, days: 688, revenue: 2014 },
    { lo: 75, hi: 80, days: 715, revenue: 2433 },
    { lo: 80, hi: 85, days: 584, revenue: 2755 },
    { lo: 85, hi: 90, days: 572, revenue: 2998 },
  ],
  rain: { wet: { days: 346, revenue: 1171 }, dry: { days: 3307, revenue: 2258 } },
  breakEvenTemp: 72, // where average revenue crosses the $1,800 daily cost
};

/** Ice Cream Shop (Sunset Scoops) constants — the weather-hedging sim. */
export const ICE = {
  startReserves: 2000,   // starting cash
  reserveCap: 2000,      // the bank skims anything above this after each billing
  billEveryDays: 14,     // costs are billed (and reserves reset/skimmed) on this cycle
  dailyCost: 1800,       // fixed operating cost accrued each day
  contracts: [
    { key: "under_65", label: "High < 65°", priceFrom: "p_below_65", wins: (d) => d.temp_high < 65 },
    { key: "over_65",  label: "High ≥ 65°", priceFrom: "!p_below_65", wins: (d) => d.temp_high >= 65 },
    { key: "under_70", label: "High < 70°", priceFrom: "p_below_70", wins: (d) => d.temp_high < 70 },
    { key: "over_70",  label: "High ≥ 70°", priceFrom: "!p_below_70", wins: (d) => d.temp_high >= 70 },
    { key: "under_75", label: "High < 75°", priceFrom: "p_below_75", wins: (d) => d.temp_high < 75 },
    { key: "over_75",  label: "High ≥ 75°", priceFrom: "!p_below_75", wins: (d) => d.temp_high >= 75 },
    { key: "under_80", label: "High < 80°", priceFrom: "p_below_80", wins: (d) => d.temp_high < 80 },
    { key: "over_80",  label: "High ≥ 80°", priceFrom: "!p_below_80", wins: (d) => d.temp_high >= 80 },
    { key: "rain_yes", label: "Rain",        priceFrom: "p_rain",     wins: (d) => d.rained === 1 },
    { key: "rain_no",  label: "No rain",     priceFrom: "!p_rain",    wins: (d) => d.rained === 0 },
  ],
};

/** Matrix-game payoffs: PAYOFFS[game][myAction][oppAction] = my points. */
export const PAYOFFS = {
  chicken: {
    STAY: { STAY: -50, SWERVE: 20 },
    SWERVE: { STAY: -20, SWERVE: -10 },
  },
  // Axelrod's classic payoffs: T=5 > R=3 > P=1 > S=0, with 2R > T+S.
  pd: {
    COOPERATE: { COOPERATE: 3, DEFECT: 0 }, // R (reward) / S (sucker)
    DEFECT: { COOPERATE: 5, DEFECT: 1 },    // T (temptation) / P (punishment)
  },
};

export const ACTIONS = {
  chicken: ["STAY", "SWERVE"],
  pd: ["COOPERATE", "DEFECT"],
};

/** The action mirror/opposite defaults to before any history exists. */
export const COOPERATIVE = { chicken: "SWERVE", pd: "COOPERATE" };

export const BANDIT = {
  machines: 8,
  spins: 100,
  simulations: 10000,
  names: ["RUBY", "GOLD", "JADE", "AZURE", "VIOLET", "AMBER", "TEAL", "ROSE"],
};

export const MATCH = {
  rounds: 200, // decisions per match (Axelrod's tournament length); memory resets after
  matchesPerPairing: 5, // every pairing plays this many matches (Axelrod ran 5 games)
};

/**
 * Human-readable rules, two layers per game:
 *   simple  — anyone gets it in ten seconds, no jargon
 *   details — the math and the structure, for teams who want the edge
 * Both are shown on-site and both go to the LLM compiler.
 */
export const RULES_TEXT = {
  bandit: {
    simple: [
      `${BANDIT.machines} slot machines. You get ${BANDIT.spins} pulls, split however you like.`,
      `The Manual board scores how close you got to the best-possible on YOUR machines ("% of oracle"), so a lucky machine set can't beat a smart run.`,
      `Each machine has a hidden personality — some pay well, some quietly rob you. Nobody can see which is which. The whole game is figuring that out without wasting too many pulls doing it.`,
      `🕹 MANUAL — pull the levers yourself. Every attempt gets brand-new machines. Your best run goes on the Manual board.`,
      `🤖 ALGORITHM — tell the computer your plan in plain English ("try each machine once, then stick with the best"). It plays ${BANDIT.simulations.toLocaleString()} full games with your plan and your average goes on the Algorithm board.`,
      `The boards are separate on purpose: one lucky run and ten thousand runs of skill are different sports.`,
    ].join("\n"),
    details: [
      `THE ACTUAL MATH — each machine pays out from a bell curve (a normal distribution). Its true average is itself drawn from Normal(0, 10): so most machines average near zero, a lucky one averages +15, an unlucky one −15. Its spread is drawn from Normal(10, 2), floored at 0 — so single pulls are noisy, and one great payoff doesn't prove a machine is good.`,
      `Payoffs can be NEGATIVE. Roughly half of all machines lose you points on average. Avoiding the bad ones matters as much as finding the good one.`,
      `FAIRNESS — every team's algorithm faces the exact same ${BANDIT.simulations.toLocaleString()} sets of machines, so the Algorithm board is a pure strategy race. "% of oracle" compares you to a psychic who knew the best machine from pull one.`,
      `THE CLASSIC DILEMMA — spend pulls exploring (learning which machine is good) or exploiting (milking your best guess)? Too little exploring and you commit to a dud; too much and you've wasted your budget. This is the "multi-armed bandit" problem, and it's everywhere: ad testing, drug trials, restaurant picks.`,
    ].join("\n"),
  },
  chicken: {
    simple: [
      `Two cars drive straight at each other. Each round, both drivers secretly pick: STAY (keep driving straight) or SWERVE (chicken out).`,
      `Both STAY → 💥 head-on crash, both lose 50. You STAY and they SWERVE → you look fearless (+20), they lose face (−20). Both SWERVE → mildly embarrassing all round, −10 each.`,
      `You don't play by hand — you write a bot by describing your plan in plain English. Your bot plays ${MATCH.rounds} rounds in a row against each opponent and can react to everything they've done so far ("if they've stayed twice in a row, swerve").`,
      `Each team enters ONE bot. Every bot plays every other bot, and the board ranks average points per match.`,
    ].join("\n"),
    details: [
      `STRUCTURE — a match is ${MATCH.rounds} rounds against one opponent. Your bot sees the full history of the current match (both sides' moves, both scores) and nothing from earlier matches — memory resets to zero. Every pairing plays ${MATCH.matchesPerPairing} matches, and whenever any team changes its submission, the whole tournament instantly replays.`,
      `FOR THE GAME THEORISTS — this is hawk–dove. There's no single "best" move: against a bot that always stays, you should swerve (−20 beats −50); against a bot that always swerves, you should stay. The interesting question is what wins against a whole ROOM of other bots — including bots that punish, forgive, or bluff over ${MATCH.rounds} rounds.`,
      `Three HOUSE BOTS are always in the tournament — the wall you have to clear. We won't tell you how they play; watch a replay and figure them out.`,
    ].join("\n"),
  },
  pd: {
    simple: [
      `The Prisoner's Dilemma. Each round, both players secretly pick: COOPERATE or DEFECT.`,
      `Both COOPERATE → 3 points each. You DEFECT while they COOPERATE → you get 5, they get 0. Both DEFECT → 1 point each. (Axelrod's classic payoffs.)`,
      `You describe a bot in plain English and the AI writes its code. Your bot plays ${MATCH.rounds} rounds in a row against every other team's bot and remembers everything from the match so far — so betrayal has consequences.`,
      `You never see who you're playing — only what they DO. Reading an opponent's moves to guess how they tick and exploit it is the whole game.`,
      `Every bot plays every other bot in a full round-robin, and the board ranks AVERAGE POINTS PER MATCH — not wins. You are not trying to beat your opponent; you are trying to score. A bot can win every single duel and still finish near the bottom, because two bots quietly cooperating both out-earn a bully who "wins" every match 200–190.`,
      `After each run you can download a CSV of your results vs every opponent and replay any match round-by-round.`,
    ].join("\n"),
    details: [
      `STRUCTURE — ${MATCH.rounds} rounds per match, ${MATCH.matchesPerPairing} matches per pairing (exactly Axelrod's tournament), memory resets between matches, and the whole tournament re-runs whenever any team resubmits.`,
      `WHAT YOUR BOT CAN SEE — the current match's full history (both sides' moves, both scores, streaks and counts) and a random-number generator, but NEVER the opponent's identity. Build anything within reason: reactive rules, randomness, even a little linear model over the history.`,
      `FOR THE GAME THEORISTS — Axelrod's payoffs (T=5 > R=3 > P=1 > S=0). In one round DEFECT strictly dominates, so "rational" one-shot players both defect and get 1 each — worse than the 3 each of mutual cooperation. Over ${MATCH.rounds} remembered rounds reciprocity flips the logic, exactly as Axelrod's 1980 tournaments showed.`,
      `DO THE ARITHMETIC BEFORE YOU WRITE A BULLY — ${MATCH.rounds} rounds of mutual cooperation pays ${MATCH.rounds * PAYOFFS.pd.COOPERATE.COOPERATE}. ${MATCH.rounds} rounds of mutual defection pays only ${MATCH.rounds * PAYOFFS.pd.DEFECT.DEFECT}. Betraying a bot that forgives you nets ${PAYOFFS.pd.DEFECT.COOPERATE} for one round, but if it stops cooperating you have traded a ${PAYOFFS.pd.COOPERATE.COOPERATE}-per-round partnership for a ${PAYOFFS.pd.DEFECT.DEFECT}-per-round grind for the rest of the match. The pot you are fighting over is tiny next to the pot you can build.`,
      `THINGS WORTH DECIDING — how you open (before you know anything); whether you ever defect first; how you answer a defection (once? forever? probabilistically?); whether you forgive, and how fast; whether you behave differently near round ${MATCH.rounds} when there is no future left to protect; and how you tell a random opponent apart from a reactive one using only their moves.`,
      `ONE HOUSE BOT is always in the field: a coin-flipper that cooperates or defects at random. Everything else on the board is another team.`,
    ].join("\n"),
  },
  icecream: {
    simple: [
      `You run Sunset Scoops, an ice cream shop. Sales swing hard with the weather — a warm dry day takes about $2,500, a cold one about $1,300, and a rainy one barely $1,200. Costs are $${ICE.dailyCost.toLocaleString()} EVERY day, rain or shine.`,
      `You start with just $${ICE.startReserves.toLocaleString()} in the bank. Every ${ICE.billEveryDays} days the bills come due for that whole stretch; if your cash can't cover them you go BANKRUPT. And after each payment the bank sweeps away anything above $${ICE.reserveCap.toLocaleString()} — you never get to build a cushion, so one cold fortnight can sink you.`,
      `Your shield is a weather prediction market you trade ON MARGIN — no cash needed to take a position. Every day it quotes the next WEEK of weather (today plus 7 days ahead): contracts on whether each day's high beats 65–80° or whether it'll rain. Hedge the cold/rainy days coming up and the payout lands right when sales crater. Prices drift as the forecast sharpens, so buying a contract cheap and selling it once it rises locks in the gain — just like real futures.`,
      `You get 5 years of history to study (download it and train your bot on it), then describe a hedging strategy in plain English — the AI codes it — and it's run day-by-day across 10 years of weather that's the same for everyone.`,
      `ONE leaderboard: how many times you went bankrupt over the ten years — fewest wins, and total profit breaks ties. Afterward, step through your whole run day-by-day to see exactly what your bot did.`,
    ].join("\n"),
    details: [
      `THE MONEY — revenue lands daily; costs ($${ICE.dailyCost.toLocaleString()}/day) are billed every ${ICE.billEveryDays} days. Can't cover a bill → bankrupt (counter +1, reserves reset to $${ICE.startReserves.toLocaleString()}). Survive it → the bank skims you back down to $${ICE.reserveCap.toLocaleString()}. Neither the skim nor a bankruptcy reset counts as profit — profit is pure operating + hedging P&L.`,
      `A ROLLING 8-DAY MARKET, ON MARGIN — each day you see prices for today and the next 7 days, keyed like "under_70@3" (the high is under 70° three days out). Opening a position needs NO cash. P&L is futures-style daily mark-to-market: you earn qty × (today's price − yesterday's price) on everything you hold, and on a contract's own day its price becomes the outcome (1 or 0). So a gain you sell into is banked for good — it is not handed back at settlement.`,
      `EVERYTHING YOU CAN TRADE — ten contracts, on any of eight days:\n` +
        `   TEMPERATURE (that day's HIGH):  ${ICE.contracts.filter((c) => !c.key.startsWith("rain")).map((c) => `"${c.key}" (${c.label})`).join(",  ")}\n` +
        `   RAIN:  ${ICE.contracts.filter((c) => c.key.startsWith("rain")).map((c) => `"${c.key}" (${c.label})`).join(",  ")}\n` +
        `   DAY — append "@0" through "@7": @0 is today, @1 tomorrow, up to @7 a week out. A bare key like "under_70" means @0.\n` +
        `   So "over_75@2" = the high is 75° or more, two days from now. Buy the side that PAYS when your sales are bad: cold (under_*) and wet (rain_yes) contracts pay on exactly the days the shop struggles. The over_* and rain_no sides pay on good days — useful if you want to bet ON sunshine, but they make a bad hedge.\n` +
        `   Quantities are whole numbers, can be NEGATIVE (a short), and everything you hold is capped at 60,000 contracts total. Whatever you don't list gets sold.`,
      `THE MARKET IS FAIR — prices are calibrated forecasts, so every contract has ~zero expected profit at any lead time. Hedging changes your RISK, not your average: a hedge that pays out on the cold/rainy days when sales crater smooths your profit and stops bankruptcies; over-hedging just adds noise. (Offset-0 contracts settle the same day at a known outcome, so only FUTURE days are worth trading.) Everyone gets the identical weather, forecasts, and prices — a pure strategy race, and without hedging the shop goes bankrupt again and again.`,
      `HOW A CONTRACT ACTUALLY PAYS — say "under_70@5" (the high is under 70°, five days out) is priced at $0.30. You hold 1,000 of them. If that day really does come in under 70°, the price walks to $1.00 and you make 1,000 × (1.00 − 0.30) = +$700 — which lands right when a cold day guts your sales. If it comes in warm, the price walks to $0 and you lose 1,000 × $0.30 = $300 on a day you were making money anyway. That is what a hedge IS: you give up a little on good days to be rescued on bad ones.`,
      `WHY SIZE AND TIMING ARE THE WHOLE PUZZLE — in this data a cold day (under 70°) earns about $1,200 LESS than a warm one, and a rainy day about $1,100 less, so a hedge of a few hundred contracts barely moves the needle while an enormous one over-corrects and starts adding risk back. There is a genuine sweet spot in the middle and it is yours to find. Timing matters just as much: tomorrow's forecast is accurate, so tomorrow's contract is already priced near $0 or $1 and transfers almost no risk. The risk you can actually offload sits FURTHER OUT, where the forecast is still uncertain and prices are still near the middle. Buying several days ahead and holding through settlement is what really protects the shop.`,
      `WHAT ACTUALLY WINS — the board is bankruptcies, so you are buying SURVIVAL, not smooth earnings. Buying early and holding through settlement is what prevents bankruptcies; a well-sized hedge cuts them by roughly three quarters. It will make your day-to-day profit look choppier (the position is marked to market daily while the protection lands in the 14-day billing cycle) — that is fine here, because nothing scores day-to-day smoothness. Ties go to the higher total profit, so don't burn money you don't need to.`,
      `YOUR BOT SEES — each day: the 8-day forecast market (forecast high ± error and rain odds per day, plus every contract price), the calendar (weekend/holiday), its current positions and reserves, days-until-billing, the full history so far, and 5 years of training data. It returns the target portfolio — how many of each contract to hold. Anything you don't list is sold. Build anything within reason.`,
    ].join("\n"),
  },
};
