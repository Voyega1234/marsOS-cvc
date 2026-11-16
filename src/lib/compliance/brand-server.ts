/** Compliance — Brand Rule: ส่วนที่แตะฐานข้อมูล (server only)
 *  ตาราง ComplianceBrand* เป็นตารางเสริม สร้างด้วยไฟล์ SQL แยก — ทุกจุดต้องทนได้เมื่อยังไม่มีตาราง (Prisma P2021)
 *  เพื่อให้ Compliance เดิมทำงานต่อได้ก่อนเจ้าของระบบรัน SQL */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errMsg, parseTermsJson, toRuleLite, userNames } from './server'
import {
  BRAND_UNAVAILABLE_MESSAGE, buildBrandRuleSet, buildVoiceGuide, voiceRule,
  type BrandDetail, type BrandRuleView, type BrandStatus, type BrandSummary, type GuideSource,
} from './brand'
import type { RuleLite, RuleStatus, RuleType, Severity } from './types'

export function isMissingTable(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2021'
}

/** catch ร่วมของ route แบรนด์: ไม่มีตาราง → 503 พร้อมข้อความบอกไฟล์ SQL, อย่างอื่น → 500 */
export function brandError(e: unknown): NextResponse {
  if (isMissingTable(e)) return NextResponse.json({ error: BRAND_UNAVAILABLE_MESSAGE, unavailable: true }, { status: 503 })
  return NextResponse.json({ error: errMsg(e) }, { status: 500 })
}

export async function listBrands(orgId: string): Promise<BrandSummary[]> {
  const rows = await prisma.complianceBrand.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, industry: true, status: true, voice: true, updatedAt: true },
    orderBy: { name: 'asc' },
    take: 500,
  })
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [ruleCounts, fileCounts] = await Promise.all([
    prisma.complianceBrandRule.groupBy({ by: ['brandId'], where: { organizationId: orgId, brandId: { in: ids } }, _count: { _all: true } }),
    prisma.complianceBrandFile.groupBy({ by: ['brandId'], where: { organizationId: orgId, brandId: { in: ids } }, _count: { _all: true } }),
  ])
  const rc = new Map(ruleCounts.map((r) => [r.brandId, r._count._all]))
  const fc = new Map(fileCounts.map((r) => [r.brandId, r._count._all]))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    industry: r.industry,
    status: r.status as BrandStatus,
    voiceChars: r.voice.length,
    ruleCount: rc.get(r.id) ?? 0,
    fileCount: fc.get(r.id) ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }))
}

/** รายละเอียดแบรนด์ 1 ราย — กฎที่ดึงจากคลังกฎแสดงเนื้อหาปัจจุบันของคลังกฎ, ไฟล์คืนเฉพาะ metadata (ไม่คืนข้อความ) */
export async function loadBrandDetail(orgId: string, brandId: string): Promise<BrandDetail | null> {
  const brand = await prisma.complianceBrand.findFirst({ where: { id: brandId, organizationId: orgId } })
  if (!brand) return null
  const [ruleRows, fileRows] = await Promise.all([
    prisma.complianceBrandRule.findMany({ where: { organizationId: orgId, brandId }, orderBy: { createdAt: 'asc' } }),
    prisma.complianceBrandFile.findMany({
      where: { organizationId: orgId, brandId },
      select: { id: true, fileName: true, chars: true, createdAt: true, createdById: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  const libIds = ruleRows.map((r) => r.libraryRuleId).filter((x): x is string => !!x)
  const libRows = libIds.length
    ? await prisma.complianceRule.findMany({ where: { organizationId: orgId, id: { in: libIds } } })
    : []
  const libById = new Map(libRows.map((r) => [r.id, r]))
  const names = await userNames(fileRows.map((f) => f.createdById))

  const rules: BrandRuleView[] = ruleRows.map((r) => {
    const status = r.status === 'INACTIVE' ? 'INACTIVE' as const : 'ACTIVE' as const
    if (r.libraryRuleId) {
      const lib = libById.get(r.libraryRuleId)
      if (!lib) {
        return {
          id: r.id, source: 'library', libraryRuleId: r.libraryRuleId, libraryStatus: 'MISSING', libraryIndustry: '',
          code: '', title: '(กฎต้นทางในคลังกฎไม่พบแล้ว)', description: '', ruleType: 'CONTEXT', terms: [], severity: 'LOW',
          guidance: '', sourceName: '', version: 0, status, effective: false,
        }
      }
      const lite = toRuleLite(lib)
      return {
        id: r.id, source: 'library', libraryRuleId: r.libraryRuleId, libraryStatus: lib.status as RuleStatus, libraryIndustry: lib.industry,
        code: lite.code, title: lite.title, description: lite.description, ruleType: lite.ruleType, terms: lite.terms, severity: lite.severity,
        guidance: lite.guidance, sourceName: lite.sourceName, version: lite.version, status, effective: status === 'ACTIVE' && lib.status === 'ACTIVE',
      }
    }
    return {
      id: r.id, source: 'own', libraryRuleId: null, libraryStatus: null, libraryIndustry: '',
      code: r.code, title: r.title, description: r.description, ruleType: r.ruleType as RuleType, terms: parseTermsJson(r.terms),
      severity: r.severity as Severity, guidance: r.guidance, sourceName: r.sourceName, version: r.version, status, effective: status === 'ACTIVE',
    }
  })

  return {
    id: brand.id,
    name: brand.name,
    industry: brand.industry,
    status: brand.status as BrandStatus,
    voiceChars: brand.voice.length,
    ruleCount: rules.length,
    fileCount: fileRows.length,
    updatedAt: brand.updatedAt.toISOString(),
    voice: brand.voice,
    notes: brand.notes,
    rules,
    files: fileRows.map((f) => ({
      id: f.id, fileName: f.fileName, chars: f.chars, createdAt: f.createdAt.toISOString(), createdByName: names.get(f.createdById) ?? '',
    })),
  }
}

export interface BrandCheckSet {
  brandId: string
  brandName: string
  status: BrandStatus
  /** กฎที่ใช้จับคำ + ให้ AI ตรวจ (ยังไม่รวมกฎ Brand voice) */
  rules: RuleLite[]
  /** กฎสังเคราะห์ของ Brand voice — ใส่เข้าชุดกฎเฉพาะเมื่อเปิด AI และมีเนื้อหา Brand voice */
  voiceRule: RuleLite | null
  guide: string
  guideTruncated: boolean
  guideSources: GuideSource[]
  skippedLibrary: number
}

/** โหลดทุกอย่างที่การตรวจแบบ Brand Rule ต้องใช้ — คืน null เมื่อไม่พบแบรนด์ในองค์กรนี้ */
export async function loadBrandForCheck(orgId: string, brandId: string): Promise<BrandCheckSet | null> {
  const brand = await prisma.complianceBrand.findFirst({ where: { id: brandId, organizationId: orgId } })
  if (!brand) return null
  const [ruleRows, fileRows] = await Promise.all([
    prisma.complianceBrandRule.findMany({ where: { organizationId: orgId, brandId }, orderBy: { createdAt: 'asc' } }),
    prisma.complianceBrandFile.findMany({
      where: { organizationId: orgId, brandId },
      select: { fileName: true, text: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  const links = ruleRows.filter((r) => !!r.libraryRuleId).map((r) => ({ id: r.id, libraryRuleId: r.libraryRuleId as string, status: r.status }))
  const libRows = links.length
    ? await prisma.complianceRule.findMany({ where: { organizationId: orgId, id: { in: links.map((l) => l.libraryRuleId) }, status: 'ACTIVE' } })
    : []
  const { rules, skippedLibrary } = buildBrandRuleSet({
    brandId: brand.id,
    brandName: brand.name,
    own: ruleRows.filter((r) => !r.libraryRuleId).map((r) => ({
      id: r.id, code: r.code, title: r.title, description: r.description, ruleType: r.ruleType, terms: parseTermsJson(r.terms),
      severity: r.severity, guidance: r.guidance, sourceName: r.sourceName, version: r.version, status: r.status,
    })),
    links,
    library: libRows.map(toRuleLite),
  })
  const g = buildVoiceGuide(brand.voice, fileRows)
  return {
    brandId: brand.id,
    brandName: brand.name,
    status: brand.status as BrandStatus,
    rules,
    voiceRule: g.guide ? voiceRule(brand.id, brand.name) : null,
    guide: g.guide,
    guideTruncated: g.truncated,
    guideSources: g.sources,
    skippedLibrary,
  }
}

/** id แบรนด์ → ชื่อ (สำหรับแสดงผลตรวจ) — ไม่มีตาราง = map ว่าง ไม่ throw */
export async function brandNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  if (!uniq.length) return new Map()
  try {
    const rows = await prisma.complianceBrand.findMany({ where: { organizationId: orgId, id: { in: uniq } }, select: { id: true, name: true } })
    return new Map(rows.map((r) => [r.id, r.name]))
  } catch (e) {
    if (isMissingTable(e)) return new Map()
    throw e
  }
}
