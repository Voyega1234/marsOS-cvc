import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getSession } from '@/lib/auth'
import { logAIJob } from '@/lib/logAIJob'
import { prisma } from '@/lib/prisma'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CC_ROOT = path.join(os.homedir(), 'Desktop', 'Mars', 'Convert-Cake-SEO-Project-FULL-20260623')

function loadReviewPrompt(content: string, siteUrl: string): string {
  const promptFile = path.join(CC_ROOT, 'prompts', 'article_review_prompt.md')
  try {
    const tpl = fs.readFileSync(promptFile, 'utf-8')
    return tpl
      .replace('{{content}}', content.slice(0, 8000))
      .replace('{{siteUrl}}', siteUrl ? `Site URL: ${siteUrl}` : '')
  } catch {
    // fallback if file missing
    return `You are an expert SEO content analyst. Analyze this article and return a JSON object.

Article content:
${content.slice(0, 8000)}

Return ONLY valid JSON (no markdown, no explanation) in this exact shape:
{
  "suggestions": [{"id":"s1","category":"SEO","priority":"High","title":"...","description":"...","applied":false}],
  "links": [{"id":"l1","anchor":"...","url":"/path","reason":"...","added":false}]
}

category must be one of: SEO, E-E-A-T, Readability, Conversion
priority must be one of: High, Medium, Low
Generate 4-8 suggestions and 3-5 internal link opportunities.
${siteUrl ? `Site URL: ${siteUrl}` : ''}
All text in Thai language.`
  }
}

// Claude Opus 4.8 pricing: $5/1M input, $25/1M output
const CLAUDE_INPUT_COST  = 5 / 1_000_000
const CLAUDE_OUTPUT_COST = 25 / 1_000_000

export async function POST(req: NextRequest) {
  const session = await getSession()
  const orgId  = session?.user?.organizationId ?? null
  const userId = session?.user?.id ?? null

  try {
    const { content, siteUrl = '', articleId, projectId } = await req.json()
    if (!content?.trim()) return NextResponse.json({ error: 'No content provided' }, { status: 400 })

    const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'

    // Check for studio override on article_review prompt (org-wide)
    let reviewTemplate: string | null = null
    if (orgId) {
      try {
        const org = await (prisma as any).organization.findUnique({
          where: { id: orgId },
          select: { studioPrompt: true },
        })
        if (org?.studioPrompt) {
          const studioOverrides: Record<string, string> = JSON.parse(org.studioPrompt)
          if (studioOverrides['article_review']) reviewTemplate = studioOverrides['article_review']
        }
      } catch {}
    }

    const prompt = reviewTemplate
      ? reviewTemplate.replace('{{content}}', content.slice(0, 8000)).replace('{{siteUrl}}', siteUrl ? `Site URL: ${siteUrl}` : '')
      : loadReviewPrompt(content, siteUrl)

    const message = await client.messages.create({
      model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })

    // Log cost
    if (orgId && userId) {
      const inputTokens  = message.usage?.input_tokens  ?? 0
      const outputTokens = message.usage?.output_tokens ?? 0
      const totalTokens  = inputTokens + outputTokens
      const cost = (inputTokens * CLAUDE_INPUT_COST) + (outputTokens * CLAUDE_OUTPUT_COST)
      logAIJob({
        organizationId: orgId, createdById: userId,
        projectId: projectId ?? null, articleId: articleId ?? null,
        jobType: 'SEO_REVIEW', modelProvider: 'CLAUDE', modelName: model,
        status: 'SUCCESS', tokenUsed: totalTokens, estimatedCost: cost,
        inputSummary: `SEO Review — ${content.slice(0, 80)}...`,
      }).catch(() => {})
    }

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ suggestions: [], links: [] })

    const parsed = JSON.parse(jsonMatch[0])
    return NextResponse.json({
      suggestions: parsed.suggestions ?? [],
      links: parsed.links ?? [],
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e), suggestions: [], links: [] }, { status: 500 })
  }
}
