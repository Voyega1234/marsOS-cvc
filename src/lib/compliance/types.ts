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
  { key: 'beauty_clinic', label: 'คลินิกความงาม' },
  { key: 'finance_banking', label: 'การเงิน / ธนาคาร' },
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
}

export const RULE_EDITOR_ROLES = ['ADMIN', 'SEO_MANAGER']
export const REVIEWER_ROLES = ['ADMIN', 'SEO_MANAGER', 'REVIEWER']
