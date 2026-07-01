import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SYSTEM_SKILLS, CODE_SKILLS, SYSTEM_PROMPTS, STUDIO_PROMPT_KEYS } from '@/lib/promptsConfig'

const CC_ROOT = path.join(os.homedir(), 'Desktop', 'Mars', 'Convert-Cake-SEO-Project-FULL-20260623')

function readSystemPrompt(file: string): string {
  try { return fs.readFileSync(path.join(CC_ROOT, file), 'utf-8') } catch { return '' }
}

function writeSystemPrompt(file: string, content: string) {
  const filePath = path.join(CC_ROOT, file)
  const backupPath = `${filePath}.backup-${new Date().toISOString().slice(0,16).replace(/[-:T]/g, '').replace('T', '-')}`
  try {
    const existing = fs.readFileSync(filePath, 'utf-8')
    fs.writeFileSync(backupPath, existing)
  } catch {}
  fs.writeFileSync(filePath, content, 'utf-8')
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')

  const systemPrompts = SYSTEM_PROMPTS.map(p => ({
    ...p,
    content: readSystemPrompt(p.file),
  }))

  const systemSkills = SYSTEM_SKILLS.map(s => ({
    ...s,
    content: readSystemPrompt(s.file),
  }))

  let projectOverrides: Record<string, string> = {}
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { writingPrompt: true },
    })
    if (project?.writingPrompt) {
      try { projectOverrides = JSON.parse(project.writingPrompt) } catch {}
    }
  }

  let studioOverrides: Record<string, string> = {}
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { studioPrompt: true },
  })
  if (org?.studioPrompt) {
    try { studioOverrides = JSON.parse(org.studioPrompt) } catch {}
  }

  const projects = await prisma.project.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, clientName: true, writingPrompt: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ systemPrompts, systemSkills, codeSkills: CODE_SKILLS, studioPromptKeys: STUDIO_PROMPT_KEYS, projectOverrides, studioOverrides, projects })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const orgId = session.user.organizationId
  const body = await req.json()
  const { type, key, content, projectId } = body

  if (type === 'system') {
    const prompt = SYSTEM_PROMPTS.find(p => p.key === key) ?? SYSTEM_SKILLS.find(s => s.key === key)
    if (!prompt) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })
    writeSystemPrompt(prompt.file, content)
    return NextResponse.json({ ok: true })
  }

  if (type === 'project' && projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { writingPrompt: true },
    })
    let overrides: Record<string, string> = {}
    if (project?.writingPrompt) {
      try { overrides = JSON.parse(project.writingPrompt) } catch {}
    }
    if (content === null || content === '') { delete overrides[key] } else { overrides[key] = content }
    await prisma.project.update({ where: { id: projectId }, data: { writingPrompt: JSON.stringify(overrides) } })
    return NextResponse.json({ ok: true })
  }

  if (type === 'studio') {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { studioPrompt: true },
    })
    let overrides: Record<string, string> = {}
    if (org?.studioPrompt) {
      try { overrides = JSON.parse(org.studioPrompt) } catch {}
    }
    if (content === null || content === '') { delete overrides[key] } else { overrides[key] = content }
    await prisma.organization.update({ where: { id: orgId }, data: { studioPrompt: JSON.stringify(overrides) } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
}
