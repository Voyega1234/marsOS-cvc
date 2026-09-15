/**
 * GET /api/projects/[id]/setup-checklist — สถานะความพร้อมก่อนเริ่มงานกับลูกค้า
 *
 * เช็คจากข้อมูลจริงทุกข้อ (ไม่ใช่ให้คนติ๊กเอง — ยกเว้นข้อ manual ที่ระบุไว้) — ครบ 100% = เริ่มโปรเจกต์ได้
 * ใช้กับแท็บ Checklist ใน Project Settings; แต่ละข้อพก action บอกว่าไปตั้งที่ไหน
 *
 * PATCH /api/projects/[id]/setup-checklist — บันทึกข้อ manual check (เช่น ตั้งค่าธีม Elementor แล้ว)
 * เก็บใน Project.pushPrefs.manualChecks — merge เข้ากับของเดิมเสมอ ห้ามทับ key อื่น
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { timelineEntries } from '@/lib/project-timeline'
import { resolveContentEngine } from '@/lib/content-engine-resolve'

export interface ChecklistItem {
  id: string
  label: string
  ok: boolean
  required: boolean
  hint: string
  /** ไปตั้งค่าที่ไหน: drawer = แท็บในฟันเฟือง / main = แท็บหลักของโปรเจกต์ / clients = หน้ารวม client / manual = ติ๊กยืนยันเอง */
  action: { kind: 'drawer'; tab: 'lab' | 'ce' | 'google' | 'website' } | { kind: 'main'; tab: string } | { kind: 'clients' } | { kind: 'manual' }
}

// key ที่รองรับใน pushPrefs.manualChecks — กันใครส่ง key มั่วมาเขียนทับ
const MANUAL_CHECK_KEYS = ['elementorTheme'] as const
type ManualCheckKey = (typeof MANUAL_CHECK_KEYS)[number]

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
      pushPrefs: true,
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

  // ── Content Engine — เช็คทีละ layer ของ scope โปรเจกต์นี้ ──
  const ce = await resolveContentEngine(orgId, { projectId: params.id })

  const themeColors = parse(p.themeColors, {}) as Record<string, unknown>
  const colorsOk = Object.keys(themeColors).some(k => k !== 'styleMode')
  const cta = parse(p.ctaSetting, {}) as { enabled?: boolean; channels?: Array<{ value?: string }> }
  const ctaOk = !!cta.enabled && (cta.channels ?? []).some(c => c.value)
  const authorsList = parse(p.authors, []) as unknown[]
  const authorOk = !!p.authorEnabled && authorsList.length > 0
  const keywordRows = parse(p.keywordRows, []) as unknown[]
  const timeline = timelineEntries(p.timeline)

  const pushPrefs = parse(p.pushPrefs, {}) as { manualChecks?: Record<string, { done?: boolean; by?: string; at?: string }> }
  const elementorDone = !!pushPrefs.manualChecks?.elementorTheme?.done

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
      id: 'ce-business-skill', label: 'Content Engine: Business Skill', ok: !!ce.businessSkill, required: true,
      hint: ce.businessSkill ? `ใช้งาน: ${ce.businessSkill.name}` : 'ยังไม่มี Business Skill ที่ Active สำหรับโปรเจกต์นี้',
      action: { kind: 'drawer', tab: 'ce' },
    },
    {
      id: 'ce-master-prompt', label: 'Content Engine: Master Prompt', ok: !!ce.masterPrompt, required: true,
      hint: ce.masterPrompt ? `ใช้งาน: ${ce.masterPrompt.name}` : 'ยังไม่มี Master Prompt ที่ Active สำหรับโปรเจกต์นี้',
      action: { kind: 'drawer', tab: 'ce' },
    },
    {
      id: 'ce-article-brief', label: 'Content Engine: Article Brief', ok: !!ce.articleBrief, required: true,
      hint: ce.articleBrief ? `ใช้งาน: ${ce.articleBrief.name}` : 'ยังไม่มี Article Brief ที่ Active สำหรับโปรเจกต์นี้',
      action: { kind: 'drawer', tab: 'ce' },
    },
    {
      id: 'ce-validator-pack', label: 'Content Engine: Validator Pack', ok: !!ce.validatorPack, required: true,
      hint: ce.validatorPack ? `ใช้งาน: ${ce.validatorPack.name}` : 'ยังไม่มี Validator Pack ที่ Active สำหรับโปรเจกต์นี้',
      action: { kind: 'drawer', tab: 'ce' },
    },
    {
      id: 'ce-image-prompt', label: 'Content Engine: Image Prompt', ok: !!ce.imagePrompt, required: true,
      hint: ce.imagePrompt ? `ใช้งาน: ${ce.imagePrompt.name}` : 'ยังไม่มี Image Prompt ที่ Active สำหรับโปรเจกต์นี้',
      action: { kind: 'drawer', tab: 'ce' },
    },
    {
      id: 'keywords', label: 'มีแผนคีย์เวิร์ด/Timeline แล้ว', ok: keywordRows.length > 0 || timeline.length > 0, required: true,
      hint: 'รัน Keyword Research แล้วสร้าง timeline บทความ',
      action: { kind: 'main', tab: 'keyword-research' },
    },
    {
      id: 'elementor-theme', label: 'ตั้งค่าธีม Elementor แล้ว', ok: elementorDone, required: true,
      hint: elementorDone ? 'ทีมยืนยันว่าตั้งธีม Elementor บนเว็บลูกค้าเรียบร้อยแล้ว' : 'ให้ทีมกดยืนยันหลังตั้งค่าธีม Elementor บนเว็บลูกค้าเสร็จ',
      action: { kind: 'manual' },
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
      id: 'gsc', label: 'ผูก Google Search Console (GSC)', ok: !!p.gscSiteUrl, required: true,
      hint: 'เพิ่ม Service Email เข้า GSC ของเว็บลูกค้า แล้วเลือก property — ใช้กับ Report/Content Refresh',
      action: { kind: 'drawer', tab: 'google' },
    },
    {
      id: 'ga4', label: 'ผูก Google Analytics 4 (GA4)', ok: !!p.ga4PropertyId, required: true,
      hint: 'เลือก GA4 property ของเว็บลูกค้า — ใช้กับ Report',
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
    missingRequired: requiredItems.length - doneRequired,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { key?: string; done?: boolean }
  const key = body.key
  if (!key || !MANUAL_CHECK_KEYS.includes(key as ManualCheckKey)) {
    return NextResponse.json({ error: 'Unknown manual check key' }, { status: 400 })
  }
  const done = !!body.done

  const existing = await (prisma.project as any).findFirst({
    where: { id: params.id, organizationId: orgId },
    select: { pushPrefs: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let prefs: Record<string, unknown> = {}
  try { prefs = JSON.parse(existing.pushPrefs || '{}') } catch { prefs = {} }
  const manualChecks = (prefs.manualChecks && typeof prefs.manualChecks === 'object')
    ? { ...(prefs.manualChecks as Record<string, unknown>) }
    : {}
  manualChecks[key] = { done, by: session!.user.name ?? session!.user.email ?? session!.user.id, at: new Date().toISOString() }
  // ไม่แตะ key อื่นใน pushPrefs (excludeCards, stripH1 ฯลฯ) — merge เข้าไปเฉย ๆ
  const next = { ...prefs, manualChecks }

  await prisma.project.update({ where: { id: params.id }, data: { pushPrefs: JSON.stringify(next) } })
  return NextResponse.json({ ok: true })
}
