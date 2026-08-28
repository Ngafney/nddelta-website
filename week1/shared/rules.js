/**
 * The rules, written once.
 *
 * This constant feeds three consumers that must never disagree:
 *   1. the Rules panel students read on each game tab,
 *   2. the LLM system prompt that compiles strategies,
 *   3. the payoff tables the engine actually scores with (matrix.js
 *      imports PAYOFFS from here).
 */

export const GAMES = ["bandit", "chicken", "pd"];

export const GAME_META = {
  bandit: { name: "Slot Machines", subtitle: "Multi-Armed Bandit", icon: "🎰" },
  chicken: { name: "Chicken", subtitle: "Hawk–Dove", icon: "🚗" },
  pd: { name: "Split or Steal", subtitle: "Prisoner's Dilemma", icon: "💰" },
};

/** Matrix-game payoffs: PAYOFFS[game][myAction][oppAction] = my points. */
export const PAYOFFS = {
  chicken: {
    STAY: { STAY: -50, SWERVE: 20 },
    SWERVE: { STAY: -20, SWERVE: -10 },
  },
  pd: {
    SPLIT: { SPLIT: 50, STEAL: 0 },
    STEAL: { SPLIT: 100, STEAL: -10 }, // both-steal stings: restores strict T>R>P>S
  },
};

export const ACTIONS = {
  chicken: ["STAY", "SWERVE"],
  pd: ["SPLIT", "STEAL"],
};

/** The action mirror/opposite defaults to before any history exists. */
export const COOPERATIVE = { chicken: "SWERVE", pd: "SPLIT" };

export const BANDIT = {
  machines: 8,
  spins: 100,
  simulations: 10000,
  names: ["RUBY", "GOLD", "JADE", "AZURE", "VIOLET", "AMBER", "TEAL", "ROSE"],
};

export const MATCH = {
  rounds: 10, // decisions per match; memory resets after
  matchesPerPairing: 5, // every pairing plays this many matches
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
      `100 points sit on the table. Each round, both teams secretly pick: SPLIT (share it) or STEAL (grab it all).`,
      `Both SPLIT → 50 each. You STEAL and they SPLIT → you take all 100, they get nothing. Both STEAL → you scuffle and both LOSE 10.`,
      `You write a bot in plain English. It plays ${MATCH.rounds} rounds in a row against each opponent and remembers everything from the match so far — so betrayal has consequences.`,
      `Each team enters ONE bot. Every bot plays every other bot, and the board ranks average points per match.`,
    ].join("\n"),
    details: [
      `STRUCTURE — ${MATCH.rounds} rounds per match, ${MATCH.matchesPerPairing} matches per pairing, memory resets between matches, tournament replays on every new submission.`,
      `FOR THE GAME THEORISTS — this is the iterated prisoner's dilemma. In a single round, stealing never pays less than splitting — so "rational" players both steal and both get zero. The interesting question is what happens over ${MATCH.rounds} rounds when your bot can REMEMBER and react to what the other side did. That memory is the whole game; the rest is yours to figure out.`,
      `Three HOUSE BOTS are always in the tournament — the bar to beat. We won't spell out how they play; watch a replay and work it out.`,
    ].join("\n"),
  },
};
