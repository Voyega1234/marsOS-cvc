import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canEditPrompts, canViewPrompts } from '@/services/prompts'
import { isValidScopeKey, readCeAiModelsInput, type KnownModelIds } from '@/lib/ce-ai-models'
import { ceScopeBelongsToOrg, defaultCeModels, readCeAiModels, saveCeAiModels } from '@/lib/ce-ai-models-server'
import { listOrModels, type OrModelLists } from '@/lib/openrouter-models'

export const dynamic = 'force-dynamic'

/**
 * Content Engine > AI Model of one scope.
 *   ?scope=studio | <project id> | <Upload Article client id> | <client id>~<PBN set id>
 * GET  → { scope, models, defaults, options }   options = null when OpenRouter's list is unavailable
 * PUT  body { write, regenerate, image, translate }   '' = system default
 * Same people as the rest of the Content Engine: every role except CLIENT.
 */
async function authorize(req: NextRequest, edit: boolean) {
  const session = await getSession()
  if (!session?.user?.organizationId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const allowed = edit ? canEditPrompts(session.user.role) : canViewPrompts(session.user.role)
  if (!allowed) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const scope = new URL(req.url).searchParams.get('scope') ?? ''
  if (!isValidScopeKey(scope)) return { error: NextResponse.json({ error: 'ไม่พบขอบเขตของ Content Engine' }, { status: 400 }) }
  const orgId = session.user.organizationId
  if (!(await ceScopeBelongsToOrg(orgId, scope))) {
    return { error: NextResponse.json({ error: 'ไม่พบโปรเจกต์ของ Content Engine นี้' }, { status: 404 }) }
  }
  return { orgId, scope }
}

function knownIds(lists: OrModelLists | null): KnownModelIds | null {
  if (!lists) return null
  // Covers are drawn from reference images (the Content Engine's references, the logo), so an
  // image model that takes no image input is not offered: it would fail at the first cover.
  return {
    text: new Set(lists.text.map((m) => m.id)),
    image: new Set(lists.image.filter((m) => m.imageInput !== false).map((m) => m.id)),
  }
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req, false)
  if ('error' in auth) return auth.error
  try {
    const [models, lists] = await Promise.all([readCeAiModels(auth.orgId, auth.scope), listOrModels()])
    return NextResponse.json({
      scope: auth.scope,
      models,
      defaults: defaultCeModels(),
      options: lists ? { text: lists.text, image: lists.image, fetchedAt: lists.fetchedAt } : null,
    })
  } catch (e) {
    console.error('[ce-ai-models] read failed:', e)
    return NextResponse.json({ error: 'อ่านค่า AI Model ไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const auth = await authorize(req, true)
  if ('error' in auth) return auth.error
  const body = await req.json().catch(() => null)
  // With the list in hand an unknown id is refused. Without it (OpenRouter unreachable) the id
  // only has to look like one — saving stays possible, and a wrong id shows up at first use.
  const lists = await listOrModels()
  const input = readCeAiModelsInput(body, knownIds(lists))
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })
  try {
    await saveCeAiModels(auth.orgId, auth.scope, input.value)
    return NextResponse.json({ scope: auth.scope, models: input.value, defaults: defaultCeModels(), verified: !!lists })
  } catch (e) {
    console.error('[ce-ai-models] save failed:', e)
    return NextResponse.json({ error: 'บันทึก AI Model ไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 })
  }
}
