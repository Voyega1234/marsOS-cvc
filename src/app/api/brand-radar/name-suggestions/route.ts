import { NextRequest, NextResponse } from 'next/server'
import { bad, errMsg, isCtx, loadOwnedProject, requireStaff } from '@/lib/brand-radar/server'
import { buildNameSuggestPrompt, cleanNames, mergeSuggestions, parseNameSuggestions } from '@/lib/brand-radar/name-suggest'
import { aiJobProjectId } from '@/lib/brand-radar/types'
import { logAIJob } from '@/lib/logAIJob'
import { OR_MODELS, orChat } from '@/lib/openrouter'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Other spellings of the brand name being typed (Thai and English, transliterations, short forms).
 * Suggestions only: nothing is saved. Staff only, and the project is optional because the names
 * are also typed in the new-project dialog, before a project exists.
 *
 * A failed AI call answers 200 with `aiError`, so the page can still offer the variants it builds itself.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return bad('Invalid body')
  const staff = await requireStaff()
  if (!isCtx(staff)) return staff

  const names = cleanNames(body.names)
  if (!names.length) return NextResponse.json({ names: [] })
  const website = typeof body.website === 'string' ? body.website.slice(0, 253) : ''
  const project = typeof body.projectId === 'string' && body.projectId
    ? await loadOwnedProject(staff.orgId, body.projectId)
    : null

  const model = OR_MODELS.default()
  const job = {
    organizationId: staff.orgId,
    projectId: project ? aiJobProjectId(project.id) : null,
    jobType: 'BRAND_RADAR_NAME_SUGGEST',
    modelProvider: 'openrouter',
    modelName: model,
    createdById: staff.userId,
    inputSummary: `brand name suggestions for ${names.length} name(s)`,
  }
  try {
    const res = await orChat({
      trace: 'brand_radar_name_suggest',
      client: project ? project.clientName || project.name : names[0],
      prompt: buildNameSuggestPrompt(names, website),
      model,
      jsonMode: true,
      maxTokens: 600,
      temperature: 0.2,
      timeoutMs: 20_000,
    })
    await logAIJob({ ...job, status: 'SUCCESS', tokenUsed: res.usage.totalTokens, estimatedCost: res.usage.costUsd })
    return NextResponse.json({ names: mergeSuggestions(names, [parseNameSuggestions(res.text)]) })
  } catch (e) {
    await logAIJob({ ...job, status: 'FAILED', errorMessage: errMsg(e) })
    return NextResponse.json({ names: [], aiError: errMsg(e) })
  }
}
