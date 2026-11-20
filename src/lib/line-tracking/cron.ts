import { createHash, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

// Compare digests so the comparison takes the same time whatever the input length.
function secretMatches(provided: string, secret: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "bad-secret" };

/**
 * Guard for the scheduler-triggered routes.
 *
 * These routes sit outside the login gate (the cron has no session), so the
 * shared secret is the only thing standing in front of them. Production
 * therefore fails CLOSED: with no CRON_SECRET set we refuse rather than run,
 * because "no secret configured" previously meant "let everyone in".
 *
 * The two failure reasons are kept apart on purpose — a missing secret is a
 * deploy mistake that should be fixed loudly (503, and the smoke test looks for
 * it), while a wrong secret is someone knocking (401).
 *
 * Local development still runs without a secret; there is nothing to protect.
 */
export function checkCronAuth(req: NextRequest): CronAuthResult {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    console.error(
      "[cron] CRON_SECRET is not set — refusing to run. Set it in the Vercel project settings; Vercel Cron then sends it as `Authorization: Bearer <CRON_SECRET>` automatically."
    );
    return { ok: false, reason: "unconfigured" };
  }

  // Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`.
  // The secret is read from a header only: a secret in the query string ends up in logs.
  const authHeader = req.headers.get("authorization");
  const provided =
    req.headers.get("x-cron-secret") ||
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  return provided && secretMatches(provided, secret) ? { ok: true } : { ok: false, reason: "bad-secret" };
}

/** Boolean form for callers that only need pass/fail. */
export function isAuthorized(req: NextRequest): boolean {
  return checkCronAuth(req).ok;
}
