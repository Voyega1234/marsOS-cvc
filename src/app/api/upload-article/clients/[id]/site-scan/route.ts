import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAIJob } from '@/lib/logAIJob'
import { uaJobInput } from '@/lib/upload-article/ai-job-source'
import { OR_MODELS } from '@/lib/openrouter'
import { computeClientCounts, toUploadClientDTO } from '@/lib/upload-article/serialize'
import { scanUploadSite } from '@/lib/upload-article/site-scan'
import type { UploadPushPrefs } from '@/lib/upload-article/types'
import { updatePrefs, type PrefsObject } from '@/lib/upload-article/prefs-store'

export const maxDuration = 300

/**
 * POST /api/upload-article/clients/[id]/site-scan — สแกนเว็บปลายทางแบบละเอียด
 * Body: { url?, sampleUrl? } — url ว่าง = ใช้ wpUrl หรือ website ของลูกค้า
 *
 * บันทึกผลสแกนไว้ที่ pushPrefs.siteScan และตั้ง excludeCards ให้ component ที่ธีม/ปลั๊กอินใส่เองทุกบทความ
 * (ส่วนที่มีเฉพาะบางบทความไม่ตัด เพราะไม่ซ้ำกับบทความใหม่)
 * ธีม/หน้าตา FAQ ที่เสนอ ไม่บันทึกเอง — ทีมกด "ใช้ธีมจากเว็บนี้" แล้วกดบันทึกธีมในหน้า Generate
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = await prisma.uploadClient.findFirst({ where: { id: params.id, organizationId: orgId } })
  if (!client) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const url = (typeof body.url === 'string' && body.url.trim()) || client.wpUrl || client.website || ''
  if (!url.trim()) {
    return NextResponse.json({ error: 'ยังไม่มี URL เว็บไซต์ — กรอก URL ในแท็บเชื่อมต่อหรือใส่ในช่องสแกนก่อน' }, { status: 400 })
  }
  const sampleUrl = typeof body.sampleUrl === 'string' ? body.sampleUrl.trim().slice(0, 500) : ''

  let result
  try {
    result = await scanUploadSite(url, sampleUrl || undefined)
  } catch (err) {
    return NextResponse.json({ error: `สแกนไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 })
  }

  if (result.usage) {
    logAIJob({
      organizationId: orgId,
      projectId: null,
      inputSummary: uaJobInput(client.id),
      jobType: 'UPLOAD_SITE_SCAN',
      modelProvider: 'OPENROUTER',
      modelName: OR_MODELS.default(),
      status: 'SUCCESS',
      tokenUsed: result.usage.totalTokens,
      estimatedCost: result.usage.costUsd,
      createdById: session.user.id,
    }).catch(() => {})
  }

  // สแกนใช้เวลาหลายนาที — pushPrefs อาจถูกทีมแก้ระหว่างนี้ (เช่นสลับ publishMode) ต้องเขียนผ่าน updatePrefs
  // (ล็อกแถว อ่านค่าล่าสุดก่อนแก้) กันค่าที่แก้ไปหาย (lost update)
  const c = result.scan.components
  const prefsResult = await updatePrefs(client.id, orgId, (current) => {
    const next: UploadPushPrefs = { ...(current as UploadPushPrefs) }
    next.siteScan = { ...result.scan, suggestedTheme: result.suggestedTheme, detail: result.detail }
    next.excludeCards = { toc: c.toc.where === 'auto', faq: c.faq.where === 'auto', cta: c.cta.where === 'auto' }
    return { prefs: next as PrefsObject, result: next }
  })
  if (!prefsResult) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })
  const updated = { ...client, pushPrefs: JSON.stringify(prefsResult.result) }
  const articles = await prisma.uploadArticle.findMany({ where: { clientId: client.id }, select: { status: true } })
  const counts = computeClientCounts(articles)

  return NextResponse.json({
    client: toUploadClientDTO(updated, counts),
    scan: result.scan,
    suggestedTheme: result.suggestedTheme,
    detail: result.detail,
  })
}
