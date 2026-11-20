import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

// LINE Tracking sits inside the MarsOS (app) shell: the sidebar, top bar and fonts come
// from the parent layout. This layout only refuses anyone who may not use the module
// (see src/lib/line-tracking/access.ts). Every page below repeats the check through
// guardProjectPage / getAuthSession, because a layout is not re-run on soft navigation.
export default async function LineTrackingLayout({ children }: { children: React.ReactNode }) {
  const session = await getAuthSession()
  if (!session) redirect('/')
  return <>{children}</>
}
