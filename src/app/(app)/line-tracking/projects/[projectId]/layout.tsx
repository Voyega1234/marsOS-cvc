import { redirect, notFound } from 'next/navigation'
import { getProjectHeader } from '@/lib/line-tracking/projectHeader'
import { getAuthSession } from '@/lib/session'
import ProjectSidebar from '@/components/line-tracking/ProjectSidebar'

export const dynamic = 'force-dynamic'

// Per-project layout: the project's own navigation beside the page.
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { projectId: string }
}) {
  const { projectId } = params
  const session = await getAuthSession()
  if (!session) redirect('/')

  const project = await getProjectHeader(projectId)
  if (!project) notFound()

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <ProjectSidebar projectId={projectId} projectName={project.name} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
