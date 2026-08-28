/**
 * Every sprite in the game, drawn as character grids and rendered to
 * canvas at integer scale — the same philosophy as the reference project:
 * pixel art is AUTHORED, not prompted, so it stays crisp and on-palette.
 *
 * Grid chars map to palette keys; "." is transparent.
 */

/** 22×30 slot machine cabinet, drawn the reference way — many inks, lit
 *  marquee, gold seams, shaded edges. Palette keys:
 *  k outline · b body · d body-dark · l body-light · g gold · G gold-dark ·
 *  m marquee bulb (blinks while spinning) · w bezel · s reel screen ·
 *  t tray slot · c coin glint · r lever ball · R ball shine · p pole
 */
export const SLOT_MACHINE = [
  "......kkkkkkkkkk......",
  ".....kGggggggggGk.....",
  "....kGgmggmggmggGk....",
  "...kkGggggggggggGkk...",
  "...kbllbbbbbbbbllbk...",
  "...kblbbbbbbbbbblbkpk.",
  "...kbdkkkkkkkkkkdbkpk.",
  "...kbkwwwwwwwwwwkbkpk.",
  "...kbkwsssssssswkbkpk.",
  "...kbkwsssssssswkbRrk.",
  "...kbkwsssssssswkbrrk.",
  "...kbkwsssssssswkbkk..",
  "...kbkwwwwwwwwwwkbk...",
  "...kbdkkkkkkkkkkdbk...",
  "...kblgGggggggGglbk...",
  "...kbbbbbbbbbbbbbbk...",
  "...kbbbkgkkgkkgbbbk...",
  "...kbdbbbbbbbbbbdbk...",
  "...kbbkkkkkkkkkkbbk...",
  "...kbbkttttttcttbbk...",
  "...kbbkkkkkkkkkkbbk...",
  "...kbdbbbbbbbbbbdbk...",
  "..kkbbbbbbbbbbbbbbkk..",
  ".kGbbbbbbbbbbbbbbbbGk.",
  ".kGgbbbbbbbbbbbbbbgGk.",
  ".kkkkkkkkkkkkkkkkkkkk.",
  ".kdd..............ddk.",
  ".kkk..............kkk.",
];

/** Reel-window placement inside SLOT_MACHINE, in grid units (for the DOM
 *  overlay that animates the symbols). */
export const SLOT_WINDOW = { x: 6, y: 8, w: 10, h: 4 };

const SHADE = {
  "#e0525e": { d: "#9c2f3a", l: "#f28d96" },
  "#f5c542": { d: "#a87b00", l: "#ffe9a3" },
  "#34d399": { d: "#177a52", l: "#93f0c9" },
  "#52a7f0": { d: "#265f96", l: "#a3d4fa" },
  "#b490f5": { d: "#6a4aad", l: "#d8c5fb" },
  "#fb923c": { d: "#b45c14", l: "#fdc48f" },
  "#2dd4bf": { d: "#157f72", l: "#8bece0" },
  "#f472b6": { d: "#a83b7e", l: "#f9b6da" },
};

export function slotPalette(bodyColor, bulbsLit = true) {
  const { d, l } = SHADE[bodyColor] ?? { d: "#333", l: "#ddd" };
  return {
    k: "#060d1c",
    b: bodyColor,
    d,
    l,
    g: "#f5c542",
    G: "#a87b00",
    m: bulbsLit ? "#fff3c4" : "#7a5c00",
    w: "#0a0f1e",
    s: "#131c36",
    t: "#060d1c",
    c: "#ffe9a3",
    r: "#e0525e",
    R: "#f8b3b9",
    p: "#8b98ad",
  };
}

export const MACHINE_COLORS = ["#e0525e", "#f5c542", "#34d399", "#52a7f0", "#b490f5", "#fb923c", "#2dd4bf", "#f472b6"];
export const MACHINE_NAMES = ["RUBY", "GOLD", "JADE", "AZURE", "VIOLET", "AMBER", "TEAL", "ROSE"];

export const REEL_SYMBOLS = ["🍒", "💎", "7", "★", "Δ", "🔔"];

/** 18×9 car, pointing right. Flip for the other side. */
export const CAR_RIGHT = [
  "......kkkkkk......",
  ".....kcccccck.....",
  "....kccwwwwcck....",
  "..kkkccccccccckkk.",
  ".kcccccccccccccck.",
  ".kccccccccccccccdk",
  ".kkkkkkkkkkkkkkkk.",
  "..ktk..........ktk",
  "..kkk..........kkk",
];

export function carPalette(color, dark) {
  return { k: "#060d1c", c: color, d: dark, w: "#bfe3ff", t: "#2a2f3a" };
}

export function flipGrid(grid) {
  return grid.map((row) => [...row].reverse().join(""));
}

/** Explosion frames, 13×13 each. */
export const BOOM_FRAMES = [
  [
    ".............",
    ".............",
    ".............",
    ".....yy......",
    "....yooy.....",
    "....yowoy....",
    "....yowoy....",
    ".....yoy.....",
    "......y......",
    ".............",
    ".............",
    ".............",
    ".............",
  ],
  [
    ".............",
    "..y.......y..",
    ".....yyy.....",
    "...yyoooy....",
    "...yowwwoy...",
    "..yowwwwwoy..",
    "..yowwwwwoy..",
    "..yowwwwwoy..",
    "...yowwwoy...",
    "....yoooy....",
    ".....yyy.....",
    "..y.......y..",
    ".............",
  ],
  [
    "y.....y.....y",
    "...o.....o...",
    ".o..yyyyy..o.",
    "...yooooooy..",
    ".y.yowwwwoy.y",
    "..yowwswwwoy.",
    "y.yowsssswoy.",
    "..yowwswwwoy.",
    ".y.yowwwwoy.y",
    "...yooooooy..",
    ".o..yyyyy..o.",
    "...o.....o...",
    "y.....y.....y",
  ],
  [
    "o...........o",
    "....o...o....",
    "..o.......o..",
    ".....o.o.....",
    "...o......o..",
    ".............",
    "o.....o.....o",
    ".............",
    "...o......o..",
    ".....o.o.....",
    "..o.......o..",
    "....o...o....",
    "o...........o",
  ],
];

export const BOOM_PALETTE = { y: "#f5c542", o: "#f08a3c", w: "#fff3d6", s: "#ffffff" };

/** 12×12 gold trophy for boards. */
export const TROPHY = [
  "kkkkkkkkkkkk",
  "kggggggggggk",
  ".kggggggggk.",
  "kkggggggggkk",
  "k.gggggggg.k",
  "k..gggggg..k",
  ".k.gggggg.k.",
  "....gggg....",
  ".....gg.....",
  ".....gg.....",
  "...gggggg...",
  "..kkkkkkkk..",
];

export const TROPHY_PALETTE = { k: "#060d1c", g: "#f5c542" };

/** 16×14 delta triangle logo. */
export const DELTA = [
  ".......gg.......",
  ".......gg.......",
  "......g..g......",
  "......g..g......",
  ".....g....g.....",
  ".....g....g.....",
  "....g......g....",
  "....g......g....",
  "...g........g...",
  "...g........g...",
  "..g..........g..",
  "..g..........g..",
  ".g............g.",
  ".gggggggggggggg.",
];

export const DELTA_PALETTE = { g: "#f5c542" };

/** 10×10 podium medals: navy ribbon, two-tone metal disc. */
export const MEDAL = [
  "..kk..kk..",
  "..knkknk..",
  "...knnk...",
  "...kkkk...",
  "..kmmmmk..",
  ".kmMMMmmk.",
  ".kmMmmmmk.",
  ".kmmmmmmk.",
  "..kmmmmk..",
  "...kkkk...",
];

export const MEDAL_PALETTES = [
  { k: "#060d1c", n: "#0c2340", m: "#f5c542", M: "#ffe9a3" }, // gold
  { k: "#060d1c", n: "#0c2340", m: "#b9c4d4", M: "#eef3fa" }, // silver
  { k: "#060d1c", n: "#0c2340", m: "#d0975a", M: "#ecc9a0" }, // bronze
];
