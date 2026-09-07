// TEMPORARY event-day storage credentials for the shared leaderboard DB.
//
// Normally these come from Vercel env vars; this committed fallback exists only
// because we can't reach the Vercel dashboard for this deploy. Throwaway DB —
// only team names / strategies / scores, no money, no personal data.
// DELETE the Upstash database and blank these lines after the event.
export const STORE_CONFIG = {
  UPSTASH_REDIS_REST_URL: "https://dominant-seahorse-123068.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "gQAAAAAAAeC8AAIgcDI2NzA4NDQ1ODA1ZDk0NWJmYjg5YjAwY2U2YzRlZDY2YQ",
};
