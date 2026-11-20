import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/session'

// Every page under /line-tracking/projects/[projectId] calls this first.
//
// The project layout already runs the same check, but a layout is NOT re-run when the
// browser soft-navigates between pages that share it: the RSC request names the layouts
// the browser already holds and the server renders only the page below them. A hand-crafted
// request (RSC: 1 + Next-Router-State-Tree) would get the page rendered with no layout
// check at all. So each page checks for itself.
//
// MarsOS: the module has one kind of user, staff allowed by `@/lib/line-tracking/access`.
// There is no client-viewer login. `opts.clientAllowed` is kept so the pages need no change;
// it has no effect.
export async function guardProjectPage(
  _projectId: string,
  _opts: { clientAllowed: boolean },
): Promise<{ isStaff: boolean }> {
  const session = await getAuthSession()
  if (!session) redirect('/')
  return { isStaff: true }
}

export type ProjectRouteAccess = { ok: true; isStaff: boolean } | { ok: false; status: 401 | 403 }

// The same rule as guardProjectPage, for a route handler under
// /line-tracking/projects/[projectId] (a file download): it answers with a status instead
// of redirecting. Keep the two in step.
export async function projectRouteAccess(
  _projectId: string,
  _opts: { clientAllowed: boolean },
): Promise<ProjectRouteAccess> {
  const session = await getAuthSession()
  if (!session) return { ok: false, status: 401 }
  return { ok: true, isStaff: true }
}
