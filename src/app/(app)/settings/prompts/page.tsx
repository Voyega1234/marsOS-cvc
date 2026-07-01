import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PromptsSkillsClient } from '@/components/settings/PromptsSkillsClient'
import { SYSTEM_PROMPTS, SYSTEM_SKILLS, CODE_SKILLS, STUDIO_PROMPT_KEYS } from '@/lib/promptsConfig'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const metadata: Metadata = { title: 'Prompts & Skills' }

const CC_ROOT = path.join(os.homedir(), 'Desktop', 'Mars', 'Convert-Cake-SEO-Project-FULL-20260623')

function readFile(file: string): string {
  try { return fs.readFileSync(path.join(CC_ROOT, file), 'utf-8') } catch { return '' }
}

export default async function PromptsSkillsPage() {
  const session = await getSession()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/dashboard')

  const orgId = session.user.organizationId!

  const [projects, org] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, clientName: true, writingPrompt: true },
      orderBy: { name: 'asc' },
    }),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { studioPrompt: true },
    }),
  ])

  const studioOverrides: Record<string, string> = (() => {
    try { return org?.studioPrompt ? JSON.parse(org.studioPrompt) : {} } catch { return {} }
  })()

  const systemPrompts = SYSTEM_PROMPTS.map(p => ({
    ...p,
    content: readFile(p.file),
  }))

  const systemSkills = SYSTEM_SKILLS.map(s => ({
    ...s,
    content: readFile(s.file),
  }))

  return (
    <PromptsSkillsClient
      systemPrompts={systemPrompts}
      systemSkills={systemSkills}
      codeSkills={CODE_SKILLS}
      studioPromptKeys={STUDIO_PROMPT_KEYS}
      studioOverrides={studioOverrides}
      projects={projects.map(p => ({
        id: p.id,
        name: p.name,
        clientName: p.clientName,
        overrides: (() => {
          try { return p.writingPrompt ? JSON.parse(p.writingPrompt) : {} } catch { return {} }
        })(),
      }))}
    />
  )
}
