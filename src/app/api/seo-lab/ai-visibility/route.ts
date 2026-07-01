/**
 * POST /api/seo-lab/ai-visibility
 * Body: { brand: string, domain: string, prompts?: string[] }
 * Tests brand visibility in AI answers using Claude
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { logAIJob } from '@/lib/logAIJob'

const DEFAULT_PROMPTS = [
  'What are the best SEO agencies in Thailand?',
  'Recommend a top SEO tool or agency for small businesses in Thailand',
  'Who provides SEO services in Bangkok?',
]

function buildPrompt(brand: string, domain: string, question: string) {
  return `You are a helpful AI assistant. Answer this question naturally as you would to a user. Be concise (2-4 sentences). Do not mention that you are checking brand visibility.

Question: ${question}

After your answer, on a new line write exactly: BRAND_FOUND: YES or BRAND_FOUND: NO depending on whether you mentioned "${brand}" (${domain}) in your answer.`
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.organizationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })

  const body = await req.json()
  const { brand, domain, prompts = DEFAULT_PROMPTS } = body
  if (!brand) return NextResponse.json({ error: 'brand required' }, { status: 400 })

  const client = new Anthropic({ apiKey })
  const start = Date.now()
  const results: Array<{ prompt: string; answer: string; mentioned: boolean }> = []
  let inputTokens = 0
  let outputTokens = 0

  for (const prompt of prompts.slice(0, 5)) {
    try {
      const msg = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages:   [{ role: 'user', content: buildPrompt(brand, domain, prompt) }],
      })
      inputTokens  += msg.usage.input_tokens
      outputTokens += msg.usage.output_tokens
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const mentioned = text.includes('BRAND_FOUND: YES')
      const answer = text.replace(/\nBRAND_FOUND:.*$/m, '').trim()
      results.push({ prompt, answer, mentioned })
    } catch {
      results.push({ prompt, answer: 'Error fetching answer', mentioned: false })
    }
  }

  const mentionCount = results.filter(r => r.mentioned).length
  const visibilityScore = Math.round((mentionCount / results.length) * 100)
  const elapsed = Date.now() - start

  // Cost: Haiku ~$1/1M input, $5/1M output
  const cost = (inputTokens / 1_000_000) * 1.0 + (outputTokens / 1_000_000) * 5.0

  await logAIJob({
    organizationId: session.user.organizationId,
    createdById:    session.user.id,
    jobType:        'SEO_LAB_AI_VISIBILITY',
    modelProvider:  'Anthropic',
    modelName:      'claude-haiku-4-5-20251001',
    status:         'SUCCESS',
    tokenUsed:      inputTokens + outputTokens,
    externalCost:   cost,
    externalCalls:  results.length,
    externalApi:    'Anthropic',
    inputSummary:   `brand: ${brand} | score: ${visibilityScore}% | ${elapsed}ms`,
  })

  return NextResponse.json({ brand, domain, visibilityScore, mentionCount, total: results.length, results, cost })
}
