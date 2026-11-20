// "Do this once" claims, kept in the lt_webhook_dedupe table (schema line_tracking).
//
// The decision IS the INSERT, so two serverless instances that race for the same key cannot
// both win. Used for three things, each with its own key prefix:
//   - a whole webhook payload (relay loops, identical LINE retries)
//   - one LINE message that is about to be read by AI (a redelivered event must not be
//     billed twice)
//   - one conversion event that is about to be sent (two queue runs that overlap must not
//     send it twice)
//
// The table is created by scripts/sql/add-line-tracking-tables.sql. The app never creates
// tables at run time.
import { prisma } from "@/lib/prisma";

/** Rows older than this are deleted. No claim window may be longer. */
export const CLAIM_RETENTION_SECONDS = 3600;

/**
 * True when this call is the first to claim `key` inside the window, false when the key was
 * already claimed.
 *
 * Fails OPEN: if the table cannot be reached the work goes ahead. Losing a real lead or a
 * real conversion would be worse than doing one of them twice.
 */
export async function claimOnce(key: string, windowSeconds: number): Promise<boolean> {
  const window = Math.min(Math.max(1, Math.floor(windowSeconds)), CLAIM_RETENTION_SECONDS);
  try {
    const claimed = await prisma.$queryRawUnsafe<unknown[]>(
      `INSERT INTO "line_tracking"."lt_webhook_dedupe" (key, seen_at) VALUES ($1, now())
         ON CONFLICT (key) DO UPDATE SET seen_at = now()
         WHERE "lt_webhook_dedupe".seen_at < now() - ($2 || ' seconds')::interval
       RETURNING 1`,
      key,
      String(window)
    );
    return claimed.length > 0;
  } catch {
    return true;
  }
}

/** Deletes claims past the retention time. Call it on a small share of requests; never throws. */
export async function pruneClaims(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "line_tracking"."lt_webhook_dedupe" WHERE seen_at < now() - interval '1 hour'`
    );
  } catch {
    // Pruning is housekeeping only.
  }
}
