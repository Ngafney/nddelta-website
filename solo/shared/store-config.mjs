/**
 * Weeks 1–4 commit event-day database credentials in weekN/server/store-config.mjs.
 * Solo runs in the browser and stores nothing remotely, so every solo build
 * gets this empty config instead: no credential can reach a public bundle.
 */
export const STORE_CONFIG = {};
export default STORE_CONFIG;
