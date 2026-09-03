/**
 * POST /api/seo-lab/ai-visibility
 * Body: { brand: string, domain: string, prompts?: string[] }
 * Tests brand visibility in AI answers using Claude
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { orChat, OR_MODELS } from '@/lib/openrouter'
import { logAIJob } from '@/lib/logAIJob'
import { slugifyClient, OR_CLIENT_SYSTEM } from '@/lib/orClient'

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

  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 503 })

  const body = await req.json()
  const { brand, domain, prompts = DEFAULT_PROMPTS } = body
  if (!brand) return NextResponse.json({ error: 'brand required' }, { status: 400 })

  const start = Date.now()
  const results: Array<{ prompt: string; answer: string; mentioned: boolean }> = []
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0

  for (const prompt of prompts.slice(0, 5)) {
    try {
      const msg = await orChat({
        trace: 'ai_visibility',
        client: slugifyClient(brand) || OR_CLIENT_SYSTEM,
        model:     OR_MODELS.default(),
        maxTokens: 300,
        messages:  [{ role: 'user', content: buildPrompt(brand, domain, prompt) }],
      })
      inputTokens  += msg.usage.inputTokens
      outputTokens += msg.usage.outputTokens
      costUsd      += msg.usage.costUsd
      const text = msg.text
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

  const cost = costUsd

  await logAIJob({
    organizationId: session.user.organizationId,
    createdById:    session.user.id,
    jobType:        'SEO_LAB_AI_VISIBILITY',
    modelProvider:  'OPENROUTER',
    modelName:      OR_MODELS.default(),
    status:         'SUCCESS',
    tokenUsed:      inputTokens + outputTokens,
    externalCost:   cost,
    externalCalls:  results.length,
    externalApi:    'OpenRouter',
    inputSummary:   `brand: ${brand} | score: ${visibilityScore}% | ${elapsed}ms`,
  })

  return NextResponse.json({ brand, domain, visibilityScore, mentionCount, total: results.length, results, cost })
}
