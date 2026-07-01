import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { styleGuide, accentColor, articleTheme, forbiddenWords, sampleArticle, internalLinks, linksPerArticle, gscSiteUrl, ga4PropertyId, ctaSetting, authorEnabled, authorName, authorTitle, authorImage, authors } = await req.json()

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updated = await (prisma.project as any).update({
    where: { id: params.id },
    data: {
      ...(styleGuide !== undefined && { styleGuide }),
      ...(accentColor !== undefined && { accentColor }),
      ...(articleTheme !== undefined && { articleTheme }),
      ...(forbiddenWords !== undefined && { forbiddenWords }),
      ...(sampleArticle !== undefined && { sampleArticle }),
      ...(internalLinks !== undefined && { internalLinks }),
      ...(linksPerArticle !== undefined && { linksPerArticle: String(linksPerArticle) }),
      ...(gscSiteUrl !== undefined && { gscSiteUrl }),
      ...(ga4PropertyId !== undefined && { ga4PropertyId }),
      ...(ctaSetting !== undefined && { ctaSetting }),
      ...(authorEnabled !== undefined && { authorEnabled }),
      ...(authorName !== undefined && { authorName }),
      ...(authorTitle !== undefined && { authorTitle }),
      ...(authorImage !== undefined && { authorImage }),
      ...(authors !== undefined && { authors: JSON.stringify(authors) }),
    },
  })

  return NextResponse.json({ ok: true, id: updated.id })
}
