// Solo mode has no shared store: the game runs in the browser against an
// in-memory one. This stands in for week3/server/store-config.mjs so the live
// event's store credentials never end up in a public bundle.
export const STORE_CONFIG = {};
