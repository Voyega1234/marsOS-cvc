/**
 * GET /api/projects/[id]/setup-checklist — สถานะความพร้อมก่อนเริ่มงานกับลูกค้า
 *
 * เช็คจากข้อมูลจริงทุกข้อ (ไม่ใช่ให้คนติ๊กเอง) — ครบ 100% = เริ่มโปรเจกต์ได้
 * ใช้กับแท็บ Checklist ใน Project Settings; แต่ละข้อพก action บอกว่าไปตั้งที่ไหน
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveContentEngine } from '@/lib/content-engine-resolve'

export interface ChecklistItem {
  id: string
  label: string
  ok: boolean
  required: boolean
  hint: string
  /** ไปตั้งค่าที่ไหน: drawer = แท็บในฟันเฟือง / main = แท็บหลักของโปรเจกต์ / clients = หน้ารวม client */
  action: { kind: 'drawer'; tab: 'lab' | 'ce' | 'google' | 'website' } | { kind: 'main'; tab: string } | { kind: 'clients' }
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const p = await (prisma.project as any).findFirst({
    where: { id: params.id, organizationId: orgId },
    select: {
      ownerId: true, websitePlatform: true, wpUrl: true, wpUser: true, wpAppPassword: true,
      siteConnection: true, themeColors: true, ctaSetting: true, authorEnabled: true, authors: true,
      gscSiteUrl: true, ga4PropertyId: true, keywordRows: true, timeline: true, projectContext: true,
    },
  })
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parse = (raw: string | null | undefined, fallback: unknown) => {
    try { return JSON.parse(raw || '') } catch { return fallback }
  }

  // ── เว็บไซต์เชื่อมแล้วจริง (ตามแพลตฟอร์ม) ──
  const platform = p.websitePlatform ?? (p.wpUrl ? 'wordpress' : null)
  const conn = parse(p.siteConnection, {}) as Record<string, Record<string, string>>
  let websiteOk = false
  if (platform === 'wordpress') websiteOk = !!(p.wpUrl && p.wpUser && p.wpAppPassword)
  else if (platform === 'shopify') websiteOk = !!(conn.shopify?.storeDomain && conn.shopify?.accessToken)
  else if (platform === 'webflow') websiteOk = !!(conn.webflow?.apiToken && conn.webflow?.collectionId)
  else if (platform === 'wix') websiteOk = !!(conn.wix?.apiKey && conn.wix?.siteId)
  else if (platform === 'custom') websiteOk = !!conn.custom?.webhookUrl

  // ── Content Engine ครบทุก layer ของ scope โปรเจกต์นี้ ──
  const ce = await resolveContentEngine(orgId, { projectId: params.id })
  const ceOk = ce.missing.length === 0

  const themeColors = parse(p.themeColors, {}) as Record<string, unknown>
  const colorsOk = Object.keys(themeColors).some(k => k !== 'styleMode')
  const cta = parse(p.ctaSetting, {}) as { enabled?: boolean; channels?: Array<{ value?: string }> }
  const ctaOk = !!cta.enabled && (cta.channels ?? []).some(c => c.value)
  const authorsList = parse(p.authors, []) as unknown[]
  const authorOk = !!p.authorEnabled && authorsList.length > 0
  const keywordRows = parse(p.keywordRows, []) as unknown[]
  const timeline = parse(p.timeline, []) as unknown[]

  const items: ChecklistItem[] = [
    {
      id: 'owner', label: 'มอบหมายผู้ดูแลโปรเจกต์', ok: !!p.ownerId, required: true,
      hint: 'ตั้งได้จาก tag ผู้ดูแลในหน้า Clients — ใช้กับ filter งานของแต่ละคน',
      action: { kind: 'clients' },
    },
    {
      id: 'website', label: 'เชื่อมเว็บไซต์ของลูกค้า', ok: websiteOk, required: true,
      hint: platform ? `แพลตฟอร์ม: ${platform} — ใส่ credentials ให้ครบแล้วกดทดสอบ` : 'ยังไม่ได้เลือกแพลตฟอร์ม',
      action: { kind: 'drawer', tab: 'website' },
    },
    {
      id: 'content-engine', label: 'Content Engine ครบทุก layer', ok: ceOk, required: true,
      hint: ceOk ? 'Business Skill · Master Prompt · Brief · Validator · Image Prompt ครบ' : `ยังขาด: ${ce.missing.join(', ')}`,
      action: { kind: 'drawer', tab: 'ce' },
    },
    {
      id: 'keywords', label: 'มีแผนคีย์เวิร์ด/Timeline แล้ว', ok: keywordRows.length > 0 || timeline.length > 0, required: true,
      hint: 'รัน Keyword Research แล้วสร้าง timeline บทความ',
      action: { kind: 'main', tab: 'keyword-research' },
    },
    {
      id: 'colors', label: 'ตั้งชุดสี/สไตล์บทความ (Article Lab)', ok: colorsOk, required: false,
      hint: 'สีต่อ element + โหมด embed/clean — ไม่ตั้ง = ค่ามาตรฐาน',
      action: { kind: 'drawer', tab: 'lab' },
    },
    {
      id: 'cta', label: 'ตั้ง CTA ช่องทางติดต่อของลูกค้า', ok: ctaOk, required: false,
      hint: 'เบอร์โทร/LINE/ลิงก์ — บทความจะแทรกกล่อง CTA ให้อัตโนมัติ',
      action: { kind: 'drawer', tab: 'lab' },
    },
    {
      id: 'author', label: 'ตั้งผู้เขียนประจำ (E-E-A-T)', ok: authorOk, required: false,
      hint: 'ชื่อ + ตำแหน่ง + รูป — โทนภาษาและกล่องผู้เขียนท้ายบทความ',
      action: { kind: 'drawer', tab: 'lab' },
    },
    {
      id: 'context', label: 'ใส่บริบทธุรกิจ (Project Context)', ok: !!p.projectContext?.trim(), required: false,
      hint: 'ข้อเท็จจริงของธุรกิจ — กัน AI เขียนข้อมูลผิด',
      action: { kind: 'drawer', tab: 'lab' },
    },
    {
      id: 'google', label: 'ผูก GSC + GA4 ของเว็บลูกค้า', ok: !!(p.gscSiteUrl && p.ga4PropertyId), required: false,
      hint: 'เพิ่ม Service Email เข้าเว็บลูกค้า แล้วเลือก property — ใช้กับ Report/Content Refresh',
      action: { kind: 'drawer', tab: 'google' },
    },
  ]

  const requiredItems = items.filter(i => i.required)
  const doneAll = items.filter(i => i.ok).length
  const doneRequired = requiredItems.filter(i => i.ok).length

  return NextResponse.json({
    items,
    progressPct: Math.round((doneAll / items.length) * 100),
    requiredReady: doneRequired === requiredItems.length,
    doneCount: doneAll,
    totalCount: items.length,
  })
}
