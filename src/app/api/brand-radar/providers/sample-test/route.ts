import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isRadarCtx, parseStrings, requireProject } from '@/lib/brand-radar/server'
import { callProvider, hasCredentials, logProviderCall } from '@/lib/brand-radar/providers'
import { analyzeAnswer } from '@/lib/brand-radar/runner'
import { isProviderKey, LIMITS, PROVIDERS } from '@/lib/brand-radar/types'
import type { AskResult } from '@/lib/brand-radar/sample-test'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Hard cap per request: the browser sends the asks in batches so one request stays short and progress is visible. */
const MAX_ASKS_PER_REQUEST = 5

/**
 * Sample-size test: asks one platform the same prompt a few times and reports what each answer said.
 * Nothing is stored in the Brand Radar report tables; every call is still logged to AI Cost.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; provider?: unknown; prompt?: unknown; asks?: unknown }
  const ctx = await requireProject(body.projectId)
  if (!isRadarCtx(ctx)) return ctx
  if (!isProviderKey(body.provider)) return bad('Unknown provider')
  const key = body.provider
  if (PROVIDERS[key].method === 'observed_serp') {
    return bad('Google AI Mode / AI Overview are asked once per prompt, so there is nothing to compare. Pick another platform')
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt.length < 3 || prompt.length > 2000) return bad('Prompt must be 3-2000 characters')
  const asks = body.asks
  if (typeof asks !== 'number' || !Number.isInteger(asks) || asks < 1 || asks > MAX_ASKS_PER_REQUEST) {
    return bad(`asks must be a whole number from 1 to ${MAX_ASKS_PER_REQUEST}`)
  }
  try {
    const profile = await prisma.brandRadarProfile.findFirst({ where: { organizationId: ctx.orgId, projectId: ctx.project.id } })
    if (!profile) return bad('Set up Brand Radar for this client first')
    if (!hasCredentials(key)) return bad('This platform is not connected on the server')
    const comps = await prisma.brandRadarCompetitor.findMany({
      where: { organizationId: ctx.orgId, projectId: ctx.project.id, status: 'ACTIVE' },
    })
    const competitors = comps.map((c) => ({ id: c.id, name: c.name, aliases: parseStrings(c.aliases), domains: parseStrings(c.domains) }))
    const clientName = ctx.project.clientName || ctx.project.name
    const log = { orgId: ctx.orgId, userId: ctx.userId, projectId: ctx.project.id }

    const ask = async (): Promise<AskResult> => {
      try {
        const r = await callProvider(key, { prompt, country: profile.country, language: profile.language, clientName })
        const tokens = r.inputTokens + r.outputTokens
        if (r.status === 'SKIPPED') {
          // A logging failure must not turn a paid, answered ask into a failed one
          await logProviderCall(log, key, prompt, { ok: true, model: r.model, costUsd: r.costUsd, tokens }).catch(() => undefined)
          return { ok: false, error: (r.error || 'Skipped').slice(0, 300), costUsd: r.costUsd }
        }
        const text = (r.text || '').slice(0, LIMITS.responseTextMax)
        const { hits, cites } = analyzeAnswer(text, r.citations, profile, competitors)
        await logProviderCall(log, key, prompt, { ok: true, model: r.model, costUsd: r.costUsd, tokens }).catch(() => undefined)
        return {
          ok: true,
          brandMentioned: !!hits.brand,
          brandRecommended: !!(hits.brand && hits.brand.recommended),
          positionPct: hits.brand ? hits.brand.positionPct : null,
          competitors: hits.competitors.map((h) => h.name),
          domains: Array.from(new Set(cites.map((c) => c.domain))),
          ownCited: cites.some((c) => c.ownerType === 'own'),
          costUsd: r.costUsd,
          answer: text.slice(0, 4000),
        }
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300)
        const cost = Number((e as { costUsd?: number }).costUsd) || 0
        await logProviderCall(log, key, prompt, { ok: false, model: '', costUsd: cost, tokens: 0, error: msg }).catch(() => undefined)
        return { ok: false, error: msg, costUsd: cost }
      }
    }

    const settled = await Promise.allSettled(Array.from({ length: asks }, () => ask()))
    const results: AskResult[] = settled.map((s) =>
      s.status === 'fulfilled' ? s.value : { ok: false, error: errMsg(s.reason).slice(0, 300), costUsd: 0 })
    return NextResponse.json({ results })
  } catch (e) {
    console.error('[brand-radar sample test]', errMsg(e))
    return bad('Sample-size test failed', 500)
  }
}
