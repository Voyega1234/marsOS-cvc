/**
 * Who may use the LINE Tracking module.
 *
 * Owner's rule (2026-11-20): everyone who signs in with a @convertcake.com account may use
 * it, except the role CLIENT.
 *
 * One function, used by the sidebar item, the pages, the server actions and the staff API of
 * the module. Whoever it refuses gets no menu item and no session from `@/lib/session`, so
 * they are refused everywhere.
 *
 * The check is by role only. The email domain is enforced one level up, at login: every role
 * other than CLIENT must sign in with Google and a @convertcake.com address
 * (`src/lib/login-policy.ts`), so "has a role other than CLIENT" and "team member with a
 * convertcake email" are the same set of people. CLIENT is the only role that may use another
 * email domain, and it must never get in: the module holds leads, slips and platform
 * credentials of every LINE Tracking project.
 */
export function canUseLineTracking(role: string | null | undefined): boolean {
  const value = role?.trim();
  if (!value) return false;
  return value.toUpperCase() !== "CLIENT";
}

/**
 * Sensitive maintenance inside the module (re-reading old PDFs with AI, bulk repairs).
 * Decided by role, not by a list of emails.
 */
export function isLineTrackingAdmin(role: string | null | undefined): boolean {
  return role === "ADMIN";
}
