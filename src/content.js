/**
 * Everything the site says, in one place. Edit here; the pages only lay it out.
 */

export const INTEREST_FORM = "https://docs.google.com/forms/d/e/1FAIpQLScMIyGTV4G0-hnK5DDvqvl9TDiiR4u8FxwscFIqg_u0nMI69g/viewform";
export const CLUB_EMAIL = "nddelta@gmail.com";

export const MEETINGS = {
  when: "Mondays, 7–8 PM",
  where: "DeBartolo Hall 216",
};

export const COMPETITION = {
  name: "The Notre Dame Trading Competition",
  edition: "The second Notre Dame Trading Competition",
  dateLong: "Saturday, December 5, 2026",
  dateShort: "Dec 5, 2026",
  time: "10 AM – 5 PM",
  where: "Stayer Hall & the Mendoza Trading Room",
  prospectus: "/docs/nd-trading-competition-prospectus-2026.pdf",
  contacts: ["ggardey@nd.edu", "cbacall@nd.edu", "ngafney@nd.edu"],
};

export const PHOTOS = {
  floor: { src: "/images/competition/trading-floor.jpg", alt: "Teams at their desks in the Mendoza Trading Room during the 2025 competition" },
  wall: { src: "/images/competition/trading-room-wall.jpg", alt: "The live leaderboard and price charts on the trading room wall during the 2025 competition" },
  organizers: { src: "/images/competition/organizers.jpg", alt: "George Gardey, Nathan Gafney and Calvin Bacall in front of the competition screen" },
  board: { src: "/images/competition/competition-sign.jpg", alt: "The 2025 Notre Dame Trading Competition sign outside the Mendoza Trading Room" },
  meeting: { src: "/images/group-photo.png", alt: "DELTA members crowded around a table mid-game at a weekly meeting" },
  firstMeeting: { src: "/images/first-meeting-2026.jpg", alt: "A full lecture hall at DELTA's first meeting of the 2026–27 year" },
};

export const LEADERS = [
  {
    name: "George Gardey",
    role: "Co-President",
    email: "ggardey@nd.edu",
    linkedin: "https://www.linkedin.com/in/georgegardey/",
    photo: "/images/george.jpeg",
    bio: "George is a senior double majoring in computer science and economics. He has interned at Amazon and Optiver, and is returning to Optiver full time as a quantitative researcher.",
  },
  {
    name: "Calvin Bacall",
    role: "Co-President",
    email: "cbacall@nd.edu",
    linkedin: "https://www.linkedin.com/in/calvinbacall/",
    photo: "/images/calvin.jpg",
    bio: "Calvin Bacall is a senior double majoring in physics and economics. Last summer he conducted research in Theology, and he currently works as the mailman at St. Edward's Hall.",
  },
  {
    name: "Nathan Gafney",
    role: "Trading Competition Lead",
    email: "ngafney@nd.edu",
    linkedin: "https://www.linkedin.com/in/nathangafney/",
    photo: "/images/nathan.jpg",
    bio: "Nathan is a senior double majoring in finance and applied mathematics. He has interned at AfterQuery, a Y Combinator–backed AI research lab, and at Garda Capital Partners as a trading analyst, and is joining FT Partners. He built the exchange the trading competition runs on.",
  },
  {
    name: "Ava Maria Geremia",
    role: "Head of Marketing",
    email: "ageremia@nd.edu",
    linkedin: "https://www.linkedin.com/in/ava-maria-geremia/",
    photo: "/images/ava.jpeg",
    bio: "Ava is a senior majoring in marketing and strategic management. She has interned at Symbotic and Goldman Sachs, and is returning to Goldman Sachs.",
  },
];

/** 2025 competition sponsors (prospectus p.5). */
export const SPONSORS = [
  { name: "Hudson River Trading", logo: "/images/logos/hrt.svg", aspect: 1.782 },
  { name: "Jane Street", logo: "/images/logos/janestreet.svg", aspect: 2.566 },
  { name: "Susquehanna", logo: "/images/logos/susquehanna.svg", aspect: 11.875, scale: 1.2 },
  { name: "Optiver", logo: "/images/logos/optiver.svg", aspect: 4.491 },
  { name: "Jump Trading", logo: "/images/logos/jump.svg", aspect: 2.314 },
  { name: "DRW", logo: "/images/logos/drw.svg", aspect: 3.016 },
  { name: "Belvedere Trading", logo: "/images/logos/belvedere.png", aspect: 3.012 },
  { name: "Old Mission", logo: "/images/logos/oldmission.svg", aspect: 3.842 },
];

export const TIERS = [
  {
    name: "Platinum",
    price: "$5,000",
    perks: ["Top logo placement on materials, banners, the website and the trading dashboards", "A speaking slot at the opening session", "A recruiting table in the Mendoza Trading Room", "Participant résumés"],
  },
  {
    name: "Gold",
    price: "$2,500",
    perks: ["Large logo placement on materials, the website and the dashboards", "Recognition in the opening and closing remarks", "Participant résumés"],
  },
  {
    name: "Silver",
    price: "$1,000",
    perks: ["Logo placement on promotional materials and the competition website", "Recognition during the competition"],
  },
];

/** Where members have gone. */
export const PLACEMENTS = [
  { name: "Optiver", logo: "/images/logos/optiver.svg", aspect: 4.491 },
  { name: "Goldman Sachs", logo: "/images/logos/goldman.svg", aspect: 2.384 },
  { name: "Citadel", logo: "/images/logos/citadel.svg", aspect: 8.314 },
  { name: "FT Partners", logo: "/images/logos/ftpartners.svg", aspect: 1.788, scale: 1.9 },
  { name: "Barclays", logo: "/images/logos/barclays.svg", aspect: 5.9, scale: 0.85 },
  { name: "Bank of America", logo: "/images/logos/bofa.svg", aspect: 9.931 },
  { name: "Deutsche Bank", logo: "/images/logos/deutsche.svg", aspect: 5.068 },
  { name: "Garda Capital Partners", logo: "/images/logos/garda.svg", aspect: 3.699 },
  { name: "Amazon", logo: "/images/logos/amazon.svg", aspect: 3.31 },
  { name: "AfterQuery", logo: "/images/logos/afterquery.svg", aspect: 5.907 },
];

/** The weekly games, labelled with the meeting each was built for (from the meeting emails). */
export const GAMES = [
  {
    week: 1,
    meeting: "Introduction, Games & Model-Building",
    title: "Games of Strategy",
    hook: "Write a bot for the Prisoner's Dilemma, then hedge an ice cream shop against the weather.",
    blurb:
      "Two games. In the Prisoner's Dilemma each team describes a strategy in plain English, it gets turned into code, and every bot plays every other bot. In Sunset Scoops you run a beach ice cream shop that loses money on cold days and buy weather contracts so a bad week doesn't sink you.",
    topics: ["Game theory", "Hedging"],
    color: "#7c5cff",
  },
  {
    week: 2,
    meeting: "Optimization, Solution Spaces & an Introduction to Trading",
    title: "Gradient Trading",
    hook: "Trade the lowest point of a curve nobody can see.",
    blurb:
      "A hidden function, and a contract that pays its minimum value. Everyone starts with one point on the curve and its slope, and can pay for gradient-descent steps to learn more. The market pools what the room knows.",
    topics: ["Optimization", "Market making"],
    color: "#2ec4b6",
  },
  {
    week: 3,
    meeting: "Probability & Randomness",
    title: "Coin Flips",
    hook: "Buy flips of a biased coin, then trade what you think it's worth.",
    blurb:
      "A coin with a hidden chance of heads. Before trading, each player decides how many flips to pay for. Then the market opens on a 1–99 ladder. Buy too few flips and you're guessing; buy too many and you've spent your edge. There's also a multi-armed bandit lab.",
    topics: ["Bayesian updating", "Value of information"],
    color: "#f4a261",
  },
  {
    week: 4,
    meeting: "Monte Carlo Simulations",
    title: "Hit or Miss",
    hook: "An asteroid is on its way. Will it hit Earth or miss?",
    blurb:
      "You get blurry telescope sightings of an asteroid, each a few hundred kilometers off, and a few of them simply wrong. Two contracts, HIT and MISS, and exactly one pays $100. More sightings arrive while you trade. Fit the orbit, simulate where it could go, and count how often it hits.",
    topics: ["Monte Carlo", "Simulation"],
    color: "#e76f51",
  },
  {
    week: 5,
    meeting: "Time Series",
    title: "The Horizon Market",
    hook: "A hidden process ticks live. Will it finish above the strike?",
    blurb:
      "Download the history, figure out whether it's a random walk or mean-reverting, and price a binary that pays $100 if Y finishes above K. The same chart is worth very different prices depending on the answer.",
    topics: ["Time series", "Binary options"],
    color: "#4ea8de",
  },
  {
    week: 6,
    meeting: "Options Theory",
    title: "The Sum",
    hook: "Every team hides a number from 0 to 10. Trade the total.",
    blurb:
      "S is the sum of every team's secret number. Trade S, a call and a put on it while the numbers come out one at a time, and nobody is told whose is whose. You know exactly one number. Use it.",
    topics: ["Options", "Information"],
    color: "#f2b84b",
  },
];
