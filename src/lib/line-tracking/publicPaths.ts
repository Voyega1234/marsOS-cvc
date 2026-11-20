// The LINE Tracking addresses that must work without a MarsOS login.
//
// These are called by people and systems that have no staff account: a visitor who clicked
// an ad, the tracking script on a customer's website, the LINE platform (webhook), the
// scheduler (cron) and Looker Studio. Each route checks its own caller (LINE signature,
// CRON_SECRET, Looker token, or nothing secret to give away on a redirect page).
//
// Every rule matches the WHOLE path and names the methods it allows. Nothing here is a
// prefix: `/line-tracking/...` (staff pages) and the rest of `/api/line-tracking/...` stay
// behind the login.
//
// No imports: the middleware runs on the edge runtime.
const SEGMENT = "[^/]+";

const RULES: { pattern: RegExp; methods: readonly string[] }[] = [
  // LINE platform -> webhook of one project (GET is a plain "is it up" answer)
  { pattern: new RegExp(`^/api/webhooks/line/${SEGMENT}/?$`), methods: ["GET", "POST"] },
  // Tracking script on the customer's website (other origin, so OPTIONS preflight too)
  { pattern: new RegExp(`^/api/track/${SEGMENT}/?$`), methods: ["POST", "OPTIONS"] },
  // LIFF page inside the LINE app
  { pattern: new RegExp(`^/api/liff/${SEGMENT}/?$`), methods: ["GET", "POST"] },
  // Scheduler: the route refuses a call without CRON_SECRET
  { pattern: /^\/api\/conversions\/(process|convertcake-sheet)\/?$/, methods: ["GET", "POST"] },
  // Looker Studio: the route refuses a call without the project's Looker token
  { pattern: /^\/api\/line-tracking\/looker\/(summary|leads|conversions)\/?$/, methods: ["GET"] },
  // Links a visitor opens
  { pattern: new RegExp(`^/(go|s|t|liff)/${SEGMENT}/?$`), methods: ["GET", "HEAD"] },
  { pattern: /^\/line\/(start|success|callback)\/?$/, methods: ["GET", "HEAD"] },
  { pattern: /^\/embed\.js$/, methods: ["GET", "HEAD"] },
];

export function isLineTrackingPublicPath(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  return RULES.some((rule) => rule.methods.includes(m) && rule.pattern.test(pathname));
}
