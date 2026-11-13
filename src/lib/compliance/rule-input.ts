/** Compliance — ตรวจ/ทำความสะอาด body ของกฎ (ใช้ทั้ง POST และ PATCH) */
import { parseTerms } from './engine'

export const CONTENT_FIELDS = [
  'industry', 'code', 'title', 'description', 'ruleType', 'terms', 'severity',
  'guidance', 'sourceName', 'sourceUrl', 'sourceRef', 'effectiveDate',
] as const

const RULE_TYPES = ['PROHIBITED_TERM', 'RISKY_TERM', 'CONTEXT']
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export interface RuleInput {
  industry?: string
  code?: string
  title?: string
  description?: string
  ruleType?: string
  terms?: string[]
  severity?: string
  guidance?: string
  sourceName?: string
  sourceUrl?: string
  sourceRef?: string
  effectiveDate?: Date | null
}

function s(v: unknown, max: number): string | undefined {
  return typeof v === 'string' ? v.trim().slice(0, max) : undefined
}

/** คืน { data } หรือ { error } — field ที่ไม่ได้ส่งมาจะไม่อยู่ใน data */
export function sanitizeRuleInput(body: Record<string, unknown>): { data: RuleInput; error?: string } {
  const d: RuleInput = {}
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K] | undefined) => { if (v !== undefined) d[k] = v }
  set('industry', s(body.industry, 60)?.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''))
  set('code', s(body.code, 40))
  set('title', s(body.title, 300))
  set('description', s(body.description, 4000))
  set('guidance', s(body.guidance, 4000))
  set('sourceName', s(body.sourceName, 500))
  // ลิงก์อ้างอิงถูกแสดงเป็น <a href> — รับเฉพาะ http(s) กัน javascript: / data:
  const url = s(body.sourceUrl, 1000)
  if (url && !/^https?:\/\//i.test(url)) return { data: d, error: 'ลิงก์อ้างอิงต้องขึ้นต้นด้วย http:// หรือ https://' }
  set('sourceUrl', url)
  set('sourceRef', s(body.sourceRef, 300))
  if (body.ruleType !== undefined) {
    if (typeof body.ruleType !== 'string' || !RULE_TYPES.includes(body.ruleType)) return { data: d, error: 'ประเภทกฎไม่ถูกต้อง' }
    d.ruleType = body.ruleType
  }
  if (body.severity !== undefined) {
    if (typeof body.severity !== 'string' || !SEVERITIES.includes(body.severity)) return { data: d, error: 'ระดับความรุนแรงไม่ถูกต้อง' }
    d.severity = body.severity
  }
  if (body.terms !== undefined) {
    const raw = Array.isArray(body.terms) ? body.terms.filter((t): t is string => typeof t === 'string').join('\n') : typeof body.terms === 'string' ? body.terms : ''
    d.terms = parseTerms(raw).slice(0, 300)
  }
  if (body.effectiveDate !== undefined) {
    if (body.effectiveDate === null || body.effectiveDate === '') d.effectiveDate = null
    else {
      const dt = new Date(String(body.effectiveDate))
      if (Number.isNaN(dt.getTime())) return { data: d, error: 'วันที่มีผลบังคับใช้ไม่ถูกต้อง' }
      d.effectiveDate = dt
    }
  }
  return { data: d }
}
