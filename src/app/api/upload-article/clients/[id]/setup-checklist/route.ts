/**
 * GET /api/upload-article/clients/[id]/setup-checklist — Upload Article: ลูกค้ารายนี้ตั้งค่าใน Project Setting ครบหรือยัง
 *
 * เช็คจากค่าที่บันทึกไว้จริงทุกข้อ (ไม่มีให้ติ๊กเอง) — ใช้แสดง badge บนปุ่ม Project Setting + เมนู Checklist
 * แต่ละข้อบอก section ที่ต้องไปตั้ง; badge นับเฉพาะข้อ required ที่ยังไม่ผ่าน
 * PBN Backlinks ไม่ใช้ checklist นี้ (คืนรายการว่าง)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveContentEngine } from '@/lib/content-engine-resolve'
import { parsePrefs } from '@/lib/upload-article/prefs-store'
import { isPbnPrefs } from '@/lib/upload-article/pbn'
import { missingWriterLayers } from '@/lib/upload-article/writer'
import { uploadCtaSummary } from '@/lib/upload-article/cta'
import { uploadAuthorSummary } from '@/lib/upload-article/author'
import { UPLOAD_PLATFORM_LABEL, uploadPlatformOf } from '@/lib/upload-article/platform-info'
import type { UploadInternalLinks, UploadSiteScan } from '@/lib/upload-article/types'

export type UploadChecklistSection = 'website' | 'scan' | 'style' | 'links' | 'images' | 'cta' | 'author' | 'engine'

export interface UploadChecklistItem {
  id: string
  label: string
  ok: boolean
  required: boolean
  hint: string
  section: UploadChecklistSection
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    const v = JSON.parse(raw || '')
    return v && typeof v === 'object' ? (v as T) : fallback
  } catch {
    return fallback
  }
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  const orgId = session?.user?.organizationId
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session!.user.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const c = await prisma.uploadClient.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: {
      websitePlatform: true, wpUrl: true, wpUser: true, wpAppPasswordEnc: true,
      siteConnection: true, themeColors: true, pushPrefs: true,
    },
  })
  if (!c) return NextResponse.json({ error: 'ไม่พบลูกค้า' }, { status: 404 })

  const prefs = parsePrefs(c.pushPrefs) as Record<string, unknown>
  if (isPbnPrefs(prefs)) return NextResponse.json({ items: [], missingRequired: 0, doneCount: 0, totalCount: 0 })

  // ── เว็บไซต์ & Connect — ตามแพลตฟอร์ม (เงื่อนไขเดียวกับตัว publish ใน sitePublishers) ──
  const platform = c.websitePlatform || 'wordpress'
  const conn = parseJson<Record<string, Record<string, string | undefined> | undefined>>(c.siteConnection, {})
  let websiteOk = false
  if (platform === 'wordpress') websiteOk = !!(c.wpUrl && c.wpUser && c.wpAppPasswordEnc)
  else if (platform === 'shopify') websiteOk = !!(conn.shopify?.storeDomain && conn.shopify?.accessToken)
  else if (platform === 'webflow') websiteOk = !!(conn.webflow?.apiToken && conn.webflow?.collectionId)
  else if (platform === 'wix') websiteOk = !!(conn.wix?.apiKey && conn.wix?.siteId && conn.wix?.memberId)
  else if (platform === 'custom') websiteOk = !!conn.custom?.webhookUrl

  // ── สแกนเว็บปลายทาง — มีผลสแกนที่บันทึกไว้ ──
  const siteScan = prefs.siteScan as Partial<UploadSiteScan> | undefined
  const scanOk = !!siteScan?.scannedAt

  // ── สไตล์บทความ — ลูกค้าใหม่ themeColors = "{}" (ใช้สีตั้งต้นของระบบ) ต้องมีการบันทึกสีจริงอย่างน้อยครั้งเดียว ──
  const themeColors = parseJson<Record<string, unknown>>(c.themeColors, {})
  const styleOk = Object.keys(themeColors).some((k) => k !== 'styleMode')

  // ── Internal Link — นับเหมือนหน้า Internal Link: GSC ที่ไม่ได้ตัดออก + ลิงก์ที่เพิ่มเอง ──
  const links = (prefs.internalLinks ?? {}) as Partial<UploadInternalLinks>
  const excluded = new Set(links.excluded ?? [])
  const gscCount = (links.gsc ?? []).filter((l) => !excluded.has(l.url)).length
  const manualCount = (links.manual ?? []).length
  const linksOk = gscCount + manualCount > 0

  // ── รูปภาพ / CTA / Author ──
  const imagesSaved = 'imageDefaults' in prefs
  const cta = uploadCtaSummary(prefs.cta)
  const ctaOk = cta.enabled && cta.ready
  const author = uploadAuthorSummary(prefs.author)
  const authorOk = author.enabled && author.count > 0

  // ── Content Engine ของลูกค้ารายนี้ (ไม่มี fallback ไป Studio) ──
  const ce = await resolveContentEngine(orgId, { projectId: params.id })
  const missingLayers = missingWriterLayers(ce)

  const items: UploadChecklistItem[] = [
    {
      id: 'website', label: `เชื่อมต่อเว็บ (${UPLOAD_PLATFORM_LABEL[uploadPlatformOf({ websitePlatform: platform })]})`, ok: websiteOk, required: true, section: 'website',
      hint: websiteOk ? `แพลตฟอร์ม: ${platform}` : `แพลตฟอร์ม: ${platform} — ใส่ข้อมูลเชื่อมต่อให้ครบแล้วกดบันทึก`,
    },
    {
      id: 'scan', label: 'สแกนเว็บปลายทาง', ok: scanOk, required: true, section: 'scan',
      hint: scanOk ? `สแกนล่าสุด ${new Date(siteScan!.scannedAt!).toLocaleDateString('th-TH')}` : 'ยังไม่เคยสแกน — ระบบยังไม่รู้ว่าเว็บมี TOC/FAQ/CTA ซ้ำหรือไม่',
    },
    {
      id: 'style', label: 'สไตล์บทความ (สี/ฟอนต์)', ok: styleOk, required: true, section: 'style',
      hint: styleOk ? 'บันทึกธีมแล้ว' : 'ยังใช้สีตั้งต้นของระบบ — ดึงธีมจากเว็บหรือเลือกสีแล้วกด "บันทึกธีม"',
    },
    {
      id: 'links', label: 'Internal Link', ok: linksOk, required: true, section: 'links',
      hint: linksOk ? `มีลิงก์ ${gscCount + manualCount} รายการ (GSC ${gscCount} / เพิ่มเอง ${manualCount})` : 'ยังไม่มีลิงก์ — ดึงจาก GSC หรือเพิ่มลิงก์เอง',
    },
    {
      id: 'engine', label: 'Content Engine พร้อมเขียน', ok: missingLayers.length === 0, required: true, section: 'engine',
      hint: missingLayers.length === 0 ? 'ครบทุก layer ที่ใช้เขียน' : `ยังขาด: ${missingLayers.join(', ')}`,
    },
    {
      id: 'image-prompt', label: 'Content Engine: Image Prompt', ok: !!ce.imagePrompt, required: false, section: 'engine',
      hint: ce.imagePrompt ? `ใช้งาน: ${ce.imagePrompt.name}` : 'ยังไม่มี Image Prompt ที่ Active — ใช้ตอนสร้างรูปปก/รูปประกอบ',
    },
    {
      id: 'images', label: 'ตั้งค่ารูปภาพ', ok: imagesSaved, required: false, section: 'images',
      hint: imagesSaved ? 'บันทึกค่ารูปภาพแล้ว' : 'ยังใช้ค่าตั้งต้น (ปก + รูปประกอบ 2 รูป)',
    },
    {
      id: 'cta', label: 'CTA', ok: ctaOk, required: false, section: 'cta',
      hint: ctaOk ? `เปิดใช้ ${cta.count} รายการ` : cta.enabled ? 'เปิดอยู่แต่ยังไม่มี CTA ที่ใช้ได้ (รูป/ลิงก์ไม่ครบ)' : 'ปิดอยู่',
    },
    {
      id: 'author', label: 'Author Box', ok: authorOk, required: false, section: 'author',
      hint: authorOk ? `ผู้เขียน ${author.count} คน` : author.enabled ? 'เปิดอยู่แต่ยังไม่มีผู้เขียน' : 'ปิดอยู่',
    },
  ]

  return NextResponse.json({
    items,
    missingRequired: items.filter((i) => i.required && !i.ok).length,
    doneCount: items.filter((i) => i.ok).length,
    totalCount: items.length,
  })
}

export const dynamic = 'force-dynamic'
