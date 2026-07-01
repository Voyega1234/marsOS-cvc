import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ReviewPageClient } from '@/components/review/ReviewPageClient'

export const metadata: Metadata = { title: 'Review Queue' }

export default async function ReviewPage() {
  const session = await getSession()
  if (!session?.user) redirect('/login')
  const orgId = session.user.organizationId
  const userRole = session.user.role ?? ''
  if (!orgId) redirect('/login')

  // CLIENT: only see their own articles pending approval
  if (userRole === 'CLIENT') {
    const access = await prisma.clientProjectAccess.findMany({
      where: { userId: session.user.id },
      select: { projectId: true },
    })
    const projectIds = access.map(a => a.projectId)

    const articles = await prisma.article.findMany({
      where: {
        projectId: { in: projectIds },
        status: 'CLIENT_REVIEW',
      },
      include: {
        project: { select: { id: true, name: true, clientName: true } },
        keyword: { select: { keyword: true } },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { user: { select: { name: true, role: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return (
      <ReviewPageClient
        role="CLIENT"
        clientRevisionArticles={[]}
        clientReviewArticles={articles.map(a => ({
          id: a.id,
          title: a.title,
          status: a.status,
          updatedAt: a.updatedAt,
          project: { id: a.project.id, name: a.project.clientName ?? a.project.name },
          keyword: a.keyword?.keyword ?? null,
          htmlContent: a.htmlContent ?? null,
          comments: a.comments.map(c => ({
            id: c.id,
            body: c.body,
            createdAt: c.createdAt,
            user: { name: c.user.name, role: c.user.role },
          })),
        }))}
      />
    )
  }

  // ADMIN/team: see CLIENT_REVISION (needs action) + CLIENT_REVIEW (waiting for client)
  const [clientRevisionArticles, clientReviewArticles] = await Promise.all([
    prisma.article.findMany({
      where: { project: { organizationId: orgId }, status: 'CLIENT_REVISION' },
      include: {
        project: { select: { id: true, name: true, clientName: true } },
        keyword: { select: { keyword: true } },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { user: { select: { name: true, role: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.article.findMany({
      where: { project: { organizationId: orgId }, status: 'CLIENT_REVIEW' },
      include: {
        project: { select: { id: true, name: true, clientName: true } },
        keyword: { select: { keyword: true } },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          include: { user: { select: { name: true, role: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  const mapArticle = (a: typeof clientRevisionArticles[0]) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    updatedAt: a.updatedAt,
    project: { id: a.project.id, name: a.project.clientName ?? a.project.name },
    keyword: a.keyword?.keyword ?? null,
    htmlContent: a.htmlContent ?? null,
    comments: a.comments.map(c => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      user: { name: c.user.name, role: c.user.role },
    })),
  })

  return (
    <ReviewPageClient
      role={userRole}
      clientRevisionArticles={clientRevisionArticles.map(mapArticle)}
      clientReviewArticles={clientReviewArticles.map(mapArticle)}
    />
  )
}
