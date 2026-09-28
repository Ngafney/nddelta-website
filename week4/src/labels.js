/**
 * What the two books are CALLED, in one place.
 *
 * The engine, the margin model and the stylesheet all address the books as
 * "north" and "south" because that is what they were when this week was about
 * a line of latitude, and renaming them through the matcher buys nothing. But
 * a key is not a label: four components were printing the raw key, so the room
 * was being asked whether an asteroid would land NORTH while the question on
 * the screen above it said HIT or MISS.
 *
 * Every user-visible market name comes from here.
 */
export const MARKET_LABEL = { north: "HIT", south: "MISS" };
export const MARKET_BLURB = {
  north: "it comes within one Earth radius",
  south: "it goes past",
};
export const label = (m) => MARKET_LABEL[m] ?? String(m ?? "").toUpperCase();
