import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET /api/projects/[id]/keywords-cache — returns AI keyword research rows stored on project
// PATCH /api/projects/[id]/keywords-cache — saves keyword rows back to project
// DELETE /api/projects/[id]/keywords-cache — intentional clear (ปุ่ม "ล้างค่า")

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { keywordRows: true },
  })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let keywordRows: unknown[] = []
  try { keywordRows = JSON.parse((project as { keywordRows?: string }).keywordRows || '[]') } catch { keywordRows = [] }

  return NextResponse.json({ keywordRows })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { keywordRows } = body
  if (!Array.isArray(keywordRows)) return NextResponse.json({ error: 'keywordRows must be array' }, { status: 400 })
  // Refuse to overwrite existing data with an empty array — use DELETE if intentional clear is needed
  if (keywordRows.length === 0) {
    const cur = await prisma.project.findFirst({
      where: { id: params.id, organizationId: session.user.organizationId },
      select: { keywordRows: true },
    })
    const existing = JSON.parse((cur as { keywordRows?: string })?.keywordRows || '[]')
    if (Array.isArray(existing) && existing.length > 0) {
      return NextResponse.json({ error: 'Cannot overwrite existing keyword data with empty array' }, { status: 400 })
    }
  }

  const existing = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.project.update({
    where: { id: params.id },
    data: { keywordRows: JSON.stringify(keywordRows) },
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.project.update({ where: { id: params.id }, data: { keywordRows: '[]' } })
  return NextResponse.json({ ok: true })
}
