/**
 * Session adapter for the LINE Tracking module ONLY.
 *
 * The module was written against a `getAuthSession()` that returns `{ user: { id, email } }`
 * for a logged-in staff member and null otherwise. This file gives it that shape on top of
 * the MarsOS login (Supabase, `getSession` in `@/lib/auth`), so the module's pages and
 * server actions keep their own checks unchanged.
 *
 * It returns null for anyone who may not use LINE Tracking (see
 * `@/lib/line-tracking/access`), which always includes the role CLIENT. Do not use it
 * outside the module: the rest of MarsOS calls `getSession` directly.
 */
import { getSession } from "@/lib/auth";
import { canUseLineTracking } from "@/lib/line-tracking/access";

export interface LineTrackingSession {
  user: {
    id: string;
    email: string | null;
    name: string | null;
    role: string;
    organizationId: string | null;
  };
}

export async function getAuthSession(): Promise<LineTrackingSession | null> {
  const session = await getSession();
  const user = session?.user;
  if (!user?.id || !canUseLineTracking(user.role)) return null;
  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      name: user.name ?? null,
      role: user.role,
      organizationId: user.organizationId ?? null,
    },
  };
}

export async function requireSession(): Promise<LineTrackingSession> {
  const session = await getAuthSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export async function getUserId(): Promise<string | null> {
  return (await getAuthSession())?.user.id ?? null;
}
