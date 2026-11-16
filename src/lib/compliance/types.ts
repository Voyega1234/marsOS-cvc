/** Article Compliance Checker — ชนิดข้อมูลร่วม (ไม่มี prisma/next เพื่อให้ client component import ได้) */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type RiskLevel = Severity | 'NONE'
export type RuleType = 'PROHIBITED_TERM' | 'RISKY_TERM' | 'CONTEXT'
export type RuleStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
export type CheckStatus = 'PENDING_REVIEW' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED'
export type Verdict = 'violation' | 'needs_review' | 'likely_ok'

export interface RuleLite {
  id: string
  version: number
  industry: string
  code: string
  title: string
  description: string
  ruleType: RuleType
  terms: string[]
  severity: Severity
  guidance: string
  sourceName: string
  sourceUrl: string
  sourceRef: string
  effectiveDate: string | null
}

export interface Finding {
  id: string
  ruleId: string
  ruleVersion: number
  ruleCode: string
  ruleTitle: string
  severity: Severity
  origin: 'rule' | 'ai'
  term: string
  quote: string
  excerpt: string
  reason: string
  suggestion: string
  verdict: Verdict
  sourceName: string
  sourceRef: string
  sourceUrl: string
}

export const BUILTIN_INDUSTRIES = [
  { key: 'beauty_clinic', label: 'คลินิกความงาม / สถานพยาบาล' },
  { key: 'food_supplement', label: 'อาหาร / ผลิตภัณฑ์เสริมอาหาร' },
  { key: 'cosmetics', label: 'เครื่องสำอาง' },
  { key: 'herbal', label: 'ผลิตภัณฑ์สมุนไพร' },
  { key: 'medicine', label: 'ยา' },
  { key: 'medical_device', label: 'เครื่องมือแพทย์' },
  { key: 'finance_banking', label: 'สินเชื่อ / ธนาคาร' },
  { key: 'investment', label: 'การลงทุน / หลักทรัพย์ / กองทุน' },
  { key: 'insurance', label: 'ประกันภัย' },
  { key: 'digital_asset', label: 'สินทรัพย์ดิจิทัล' },
  { key: 'real_estate', label: 'อสังหาริมทรัพย์' },
  { key: 'alcohol', label: 'เครื่องดื่มแอลกอฮอล์' },
  { key: 'tobacco', label: 'ยาสูบ / บุหรี่ไฟฟ้า' },
  { key: 'gambling', label: 'การพนัน' },
  { key: 'general_consumer', label: 'สินค้าและบริการทั่วไป' },
]

export function industryLabel(key: string): string {
  return BUILTIN_INDUSTRIES.find((i) => i.key === key)?.label ?? key
}

export const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export const SEVERITY_LABEL: Record<RiskLevel, string> = {
  CRITICAL: 'วิกฤต',
  HIGH: 'สูง',
  MEDIUM: 'ปานกลาง',
  LOW: 'ต่ำ',
  NONE: 'ไม่พบความเสี่ยง',
}

export const RULE_TYPE_LABEL: Record<RuleType, string> = {
  PROHIBITED_TERM: 'คำต้องห้าม',
  RISKY_TERM: 'คำเสี่ยง',
  CONTEXT: 'ตามบริบท',
}

export const RULE_STATUS_LABEL: Record<RuleStatus, string> = {
  DRAFT: 'ฉบับร่าง',
  ACTIVE: 'เปิดใช้',
  ARCHIVED: 'เก็บถาวร',
}

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  PENDING_REVIEW: 'รอตรวจ',
  APPROVED: 'อนุมัติ',
  CHANGES_REQUESTED: 'ขอให้แก้ไข',
  REJECTED: 'ไม่อนุมัติ',
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  violation: 'ละเมิด',
  needs_review: 'ต้องให้คนตรวจ',
  likely_ok: 'น่าจะไม่เป็นปัญหา',
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  RULE_CREATE: 'สร้างกฎ',
  RULE_UPDATE: 'แก้ไขกฎ',
  RULE_STATUS: 'เปลี่ยนสถานะกฎ',
  CHECK_RUN: 'ตรวจบทความ',
  CHECK_REVIEW: 'ตัดสินผลตรวจ',
  STARTER_IMPORT: 'นำเข้าชุดกฎตั้งต้น',
  AI_UPDATE_RUN: 'ให้ AI ตรวจอัปเดตกฎ',
}

/** ---- ปุ่ม "ให้ AI ตรวจอัปเดตกฎ" — AI เสนอ คนกดยืนยันทีละข้อ (ไม่แก้กฎเอง) ---- */
export const RULE_UPDATE_FIELDS = [
  'title', 'description', 'ruleType', 'terms', 'severity', 'guidance',
  'sourceName', 'sourceUrl', 'sourceRef', 'effectiveDate',
] as const
export type RuleUpdateField = (typeof RULE_UPDATE_FIELDS)[number]

export const RULE_FIELD_LABEL: Record<RuleUpdateField, string> = {
  title: 'ชื่อกฎ',
  description: 'คำอธิบาย',
  ruleType: 'ประเภท',
  terms: 'คำ/วลีที่ต้องจับ',
  severity: 'ความรุนแรง',
  guidance: 'แนวทางที่ควรเขียนแทน',
  sourceName: 'แหล่งอ้างอิง',
  sourceUrl: 'ลิงก์แหล่งอ้างอิง',
  sourceRef: 'ข้อ/มาตรา',
  effectiveDate: 'วันที่มีผลบังคับใช้',
}

export interface RuleUpdateValues {
  title?: string
  description?: string
  ruleType?: RuleType
  terms?: string[]
  severity?: Severity
  guidance?: string
  sourceName?: string
  sourceUrl?: string
  sourceRef?: string
  /** YYYY-MM-DD หรือ null */
  effectiveDate?: string | null
}

export interface RuleUpdateProposal {
  /** id ชั่วคราวของข้อเสนอในรอบนี้ เช่น p1 */
  id: string
  /** update = แก้กฎที่มีอยู่, new = กฎใหม่ที่ควรเพิ่ม (จะถูกสร้างเป็นฉบับร่าง) */
  kind: 'update' | 'new'
  ruleId: string | null
  ruleCode: string
  ruleTitle: string
  ruleStatus: RuleStatus | null
  /** ค่าปัจจุบันของ field ที่เสนอแก้ (ว่างเมื่อ kind = new) */
  before: RuleUpdateValues
  /** ค่าใหม่ที่เสนอ — update: เฉพาะ field ที่ต่างจากเดิม, new: ข้อมูลกฎทั้งข้อ */
  changes: RuleUpdateValues
  /** AI อธิบายว่ากฎหมายเปลี่ยนอะไร (ภาษาไทย) */
  reason: string
  evidenceUrl: string
  evidenceQuote: string
  /** true = ลิงก์หลักฐานอยู่บนโดเมนต้นทางของกฎ/หน่วยงานรัฐ และเป็นหน้าที่ web search คืนมาจริง */
  trusted: boolean
  trustNote: string
}

export interface RuleUpdateResult {
  industry: string
  model: string
  checkedRules: number
  /** จำนวนแหล่งกฎหมายที่ไปตรวจ */
  sources: number
  summary: string
  proposals: RuleUpdateProposal[]
  /** ข้อเสนอที่ถูกตัดทิ้งเพราะไม่ผ่านการตรวจรูปแบบ */
  dropped: number
  /** ข้อผิดพลาดรายแหล่ง (ตรวจไม่สำเร็จบางแหล่ง) */
  errors: string[]
}

export const RULE_EDITOR_ROLES = ['ADMIN', 'SEO_MANAGER']
export const REVIEWER_ROLES = ['ADMIN', 'SEO_MANAGER', 'REVIEWER']
