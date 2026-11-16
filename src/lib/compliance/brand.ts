/** Compliance — Brand Rule: ชนิดข้อมูล + ตัวตรวจ input + ตัวประกอบชุดกฎของแบรนด์ (pure, ไม่มี prisma/next — client import ได้) */
import { parseTerms } from './engine'
import { BRAND_INDUSTRY_PREFIX, type RuleLite, type RuleStatus, type RuleType, type Severity } from './types'

export const BRAND_NAME_MAX = 200
export const BRAND_VOICE_MAX = 40_000
export const BRAND_NOTES_MAX = 4000
export const BRAND_FILE_MAX_CHARS = 200_000
export const BRAND_FILE_MIN_CHARS = 20
export const BRAND_FILES_MAX = 10
export const BRAND_RULES_MAX = 300
export const BRAND_PULL_MAX = 200
export const BRAND_TERM_MAX = 200
/** งบตัวอักษรของ Brand voice ที่ส่งให้ AI ต่อการตรวจ 1 ครั้ง (ข้อความที่พิมพ์เองมาก่อน แล้วตามด้วยไฟล์ใหม่สุด) */
export const BRAND_GUIDE_BUDGET = 36_000

export const BRAND_SQL_FILE = 'scripts/sql/add-compliance-brand-tables.sql'
export const BRAND_UNAVAILABLE_MESSAGE =
  `Brand Rule ยังใช้ไม่ได้ — ต้องรันไฟล์ ${BRAND_SQL_FILE} ใน Supabase โปรเจกต์ "SEO PROJECT" ก่อน (การตรวจระดับอุตสาหกรรมใช้งานได้ตามปกติ)`

export type BrandStatus = 'ACTIVE' | 'ARCHIVED'
export type BrandRuleStatus = 'ACTIVE' | 'INACTIVE'

export interface BrandSummary {
  id: string
  name: string
  industry: string
  status: BrandStatus
  voiceChars: number
  ruleCount: number
  fileCount: number
  updatedAt: string
}

export interface BrandRuleView {
  id: string
  /** own = กฎที่แบรนด์เขียนเอง, library = ดึงจากคลังกฎ (เนื้อหาตามคลังกฎปัจจุบัน แก้ได้ที่คลังกฎเท่านั้น) */
  source: 'own' | 'library'
  libraryRuleId: string | null
  /** สถานะของกฎต้นทางในคลังกฎ — ตอนตรวจใช้เฉพาะ ACTIVE; MISSING = กฎต้นทางถูกลบ/ไม่พบ */
  libraryStatus: RuleStatus | 'MISSING' | null
  libraryIndustry: string
  code: string
  title: string
  description: string
  ruleType: RuleType
  terms: string[]
  severity: Severity
  guidance: string
  sourceName: string
  version: number
  status: BrandRuleStatus
  /** true = ถูกใช้ตอนตรวจ (เปิดอยู่ และถ้าเป็นกฎจากคลังกฎ ต้นทางต้อง ACTIVE) */
  effective: boolean
}

export interface BrandFileView {
  id: string
  fileName: string
  chars: number
  createdAt: string
  createdByName: string
}

export interface BrandDetail extends BrandSummary {
  voice: string
  notes: string
  rules: BrandRuleView[]
  files: BrandFileView[]
}

const RULE_TYPES: RuleType[] = ['PROHIBITED_TERM', 'RISKY_TERM', 'CONTEXT']
const SEVERITY_LIST: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : ''
}

/** ช่องที่ไม่ได้ส่งมา = ไม่แตะ (ใช้ได้ทั้งสร้างและแก้) */
export function sanitizeBrandInput(body: Record<string, unknown>): {
  name?: string
  industry?: string
  voice?: string
  notes?: string
  status?: BrandStatus
} {
  const out: { name?: string; industry?: string; voice?: string; notes?: string; status?: BrandStatus } = {}
  if (typeof body.name === 'string') out.name = clean(body.name, BRAND_NAME_MAX).replace(/\s+/g, ' ')
  if (typeof body.industry === 'string') out.industry = body.industry.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 60)
  if (typeof body.voice === 'string') out.voice = clean(body.voice, BRAND_VOICE_MAX)
  if (typeof body.notes === 'string') out.notes = clean(body.notes, BRAND_NOTES_MAX)
  if (body.status === 'ACTIVE' || body.status === 'ARCHIVED') out.status = body.status
  return out
}

export interface BrandRuleInput {
  code: string
  title: string
  description: string
  ruleType: RuleType
  terms: string[]
  severity: Severity
  guidance: string
  sourceName: string
}

/** กฎที่แบรนด์เขียนเอง — คืน error เป็นข้อความไทยเมื่อข้อมูลไม่พอให้ตรวจได้จริง */
export function sanitizeBrandRuleInput(body: Record<string, unknown>): { data: BrandRuleInput } | { error: string } {
  const title = clean(body.title, 300)
  if (!title) return { error: 'ต้องใส่ชื่อกฎ' }
  const ruleType = RULE_TYPES.includes(body.ruleType as RuleType) ? (body.ruleType as RuleType) : 'PROHIBITED_TERM'
  const severity = SEVERITY_LIST.includes(body.severity as Severity) ? (body.severity as Severity) : 'MEDIUM'
  const rawTerms = Array.isArray(body.terms) ? body.terms.filter((t): t is string => typeof t === 'string').join('\n') : typeof body.terms === 'string' ? body.terms : ''
  const terms = parseTerms(rawTerms).slice(0, 300)
  if (terms.some((t) => t.length > BRAND_TERM_MAX)) return { error: `คำในกฎยาวเกิน ${BRAND_TERM_MAX} ตัวอักษร — ข้อความยาวให้ใส่ในคำอธิบายของกฎประเภทบริบทแทน` }
  const description = clean(body.description, 4000)
  if (ruleType !== 'CONTEXT' && terms.length === 0) return { error: 'กฎประเภทคำต้องห้าม/คำเสี่ยง ต้องมีคำอย่างน้อย 1 คำ' }
  if (ruleType === 'CONTEXT' && !description) return { error: 'กฎประเภทบริบท ต้องมีคำอธิบายว่าห้าม/ต้องทำอะไร' }
  return {
    data: {
      code: clean(body.code, 40),
      title,
      description,
      ruleType,
      terms,
      severity,
      guidance: clean(body.guidance, 4000),
      sourceName: clean(body.sourceName, 500),
    },
  }
}

export function sanitizeFileInput(body: Record<string, unknown>): { fileName: string; text: string; truncated: boolean } | { error: string } {
  const fileName = clean(body.fileName, 200).replace(/[\\/]/g, '-') || 'brand-voice.txt'
  const raw = typeof body.text === 'string' ? body.text.replace(/\u0000/g, '').trim() : ''
  if (raw.length < BRAND_FILE_MIN_CHARS) return { error: 'อ่านข้อความจากไฟล์ได้น้อยเกินไป (อย่างน้อย 20 ตัวอักษร)' }
  const truncated = raw.length > BRAND_FILE_MAX_CHARS
  return { fileName, text: truncated ? raw.slice(0, BRAND_FILE_MAX_CHARS) : raw, truncated }
}

export function brandIndustryKey(brandId: string): string {
  return `${BRAND_INDUSTRY_PREFIX}${brandId}`
}

export function voiceRuleId(brandId: string): string {
  return `brand-voice:${brandId}`
}

/** กฎสังเคราะห์ 1 ข้อสำหรับ Brand voice — ให้ AI อ้าง ruleId นี้เมื่อข้อความไม่ตรงน้ำเสียง/แนวทางของแบรนด์ */
export function voiceRule(brandId: string, brandName: string): RuleLite {
  return {
    id: voiceRuleId(brandId),
    version: 1,
    industry: brandIndustryKey(brandId),
    code: 'BRAND-VOICE',
    title: `Brand voice ของ ${brandName}`,
    description:
      'ข้อความในบทความต้องตรงกับ Brand voice ของแบรนด์ตามเอกสาร BRAND VOICE GUIDE: น้ำเสียง ระดับภาษา สรรพนาม คำที่แบรนด์ให้ใช้/ห้ามใช้ วิธีเรียกชื่อแบรนด์และสินค้า และข้อความที่แบรนด์ไม่ต้องการให้สื่อ',
    ruleType: 'CONTEXT',
    terms: [],
    severity: 'MEDIUM',
    guidance: 'ปรับถ้อยคำให้ตรงกับ Brand voice ของแบรนด์',
    sourceName: `Brand voice: ${brandName}`,
    sourceUrl: '',
    sourceRef: '',
    effectiveDate: null,
  }
}

export interface OwnRuleRow {
  id: string
  code: string
  title: string
  description: string
  ruleType: string
  terms: string[]
  severity: string
  guidance: string
  sourceName: string
  version: number
  status: string
}

export interface LinkRow {
  id: string
  libraryRuleId: string
  status: string
}

/** ชุดกฎที่ใช้ตรวจแบบ Brand Rule: กฎที่แบรนด์เขียนเอง (เปิดอยู่) + กฎจากคลังกฎที่ดึงมา (เปิดอยู่ และต้นทาง ACTIVE) */
export function buildBrandRuleSet(params: {
  brandId: string
  brandName: string
  own: OwnRuleRow[]
  links: LinkRow[]
  /** กฎต้นทางในคลังกฎ (ACTIVE เท่านั้น) */
  library: RuleLite[]
}): { rules: RuleLite[]; skippedLibrary: number } {
  const industry = brandIndustryKey(params.brandId)
  const rules: RuleLite[] = []
  for (const r of params.own) {
    if (r.status !== 'ACTIVE') continue
    rules.push({
      id: r.id,
      version: r.version,
      industry,
      code: r.code || 'BRAND',
      title: r.title,
      description: r.description,
      ruleType: RULE_TYPES.includes(r.ruleType as RuleType) ? (r.ruleType as RuleType) : 'CONTEXT',
      terms: r.terms,
      severity: SEVERITY_LIST.includes(r.severity as Severity) ? (r.severity as Severity) : 'MEDIUM',
      guidance: r.guidance,
      sourceName: r.sourceName || `Brand Rule: ${params.brandName}`,
      sourceUrl: '',
      sourceRef: '',
      effectiveDate: null,
    })
  }
  const byId = new Map(params.library.map((r) => [r.id, r]))
  const seen = new Set<string>()
  let skippedLibrary = 0
  for (const l of params.links) {
    if (l.status !== 'ACTIVE') continue
    const lib = byId.get(l.libraryRuleId)
    if (!lib) { skippedLibrary++; continue }
    if (seen.has(lib.id)) continue
    seen.add(lib.id)
    rules.push(lib)
  }
  rules.sort((a, b) => a.code.localeCompare(b.code))
  return { rules, skippedLibrary }
}

export interface GuideSource {
  name: string
  chars: number
  used: number
}

/** ประกอบ Brand voice ที่ส่งให้ AI: ข้อความที่พิมพ์เองก่อน แล้วตามด้วยไฟล์ (ลำดับที่ส่งเข้ามา = ใหม่สุดก่อน) จนเต็มงบ */
export function buildVoiceGuide(
  voice: string,
  files: Array<{ fileName: string; text: string }>,
  budget = BRAND_GUIDE_BUDGET,
): { guide: string; truncated: boolean; sources: GuideSource[] } {
  const parts: string[] = []
  const sources: GuideSource[] = []
  let left = Math.max(0, budget)
  let truncated = false
  const add = (name: string, label: string, raw: string) => {
    const text = raw.trim()
    if (!text) return
    const used = Math.min(text.length, left)
    if (used < text.length) truncated = true
    sources.push({ name, chars: text.length, used })
    if (used > 0) parts.push(`### ${label}\n${text.slice(0, used)}`)
    left -= used
  }
  add('ข้อความ Brand voice', 'Brand voice (พิมพ์โดยทีม)', voice)
  for (const f of files) add(f.fileName, `ไฟล์: ${f.fileName}`, f.text)
  return { guide: parts.join('\n\n'), truncated, sources }
}
