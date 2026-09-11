// ─────────────────────────────────────────────────────────────────────────────
//  สแกนเว็บไซต์ลูกค้าแล้วร่าง Business Skill (Content Engine ชั้นที่ 1) ให้
//
//  คำสั่งเจ้าของ 2026-09-11: วางลิงก์แล้วระบบกรอกฟอร์ม Business Skill ให้ ทีมยังแก้ต่อได้
//
//  - ใช้ตัวเก็บหลักฐานชุดเดียวกับ Article Lab (collectLabScanEvidence) — อ่านหน้าแรก
//    หน้าเกี่ยวกับเรา บริการ ติดต่อ บทความ FAQ
//  - ผลลัพธ์เป็น "ร่าง" เท่านั้น ไม่เขียนลง DB — ทีมกดรับในฟอร์มแล้วกดบันทึกเอง
//  - โครง JSON ดึงจาก BUSINESS_SKILL_CARDS ตัวเดียวกับฟอร์ม และ sanitize ทิ้งทุกคีย์
//    ที่ฟอร์มไม่รู้จัก ค่าตัวเลือกที่ไม่อยู่ในรายการ และวันที่ที่รูปแบบผิด
// ─────────────────────────────────────────────────────────────────────────────

import { BUSINESS_SKILL_CARDS, RISK_OPTIONS } from '@/components/settings/content-engine/constants'
import type { BusinessSkillData, CardConfig, FieldValues, RiskLevel } from '@/components/settings/content-engine/types'
import { askJson } from '@/lib/competitor-gap/ai'
import { collectLabScanEvidence, type LabScanEvidence } from '@/lib/lab-scan'

/** ส่วนของ Business Skill ที่สแกนเติมให้ได้ (status เป็นของทีม ไม่แตะ) */
export type BusinessSkillDraft = Omit<BusinessSkillData, 'status'>

export interface BusinessSkillScanResult {
  url: string
  businessName: string
  /** สรุปหนึ่งบรรทัด ใช้เป็นคำอธิบายสั้นของชุด */
  summary: string
  draft: BusinessSkillDraft
  evidence: Pick<LabScanEvidence, 'pages' | 'navLabels'>
  warnings: string[]
}

/** เพดานจำนวนแถวของการ์ดที่เพิ่มแถวได้ กันโมเดลลากยาวจนชนเพดาน token */
const ROW_LIMITS: Record<string, number> = {
  productsServices: 15,
  approvedClaims: 10,
  prohibitedClaims: 12,
  officialSources: 6,
}

const FIELD_MAX_CHARS = 4000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function describeCard(card: CardConfig): string {
  const fields = card.fields
    .map((f) => {
      const opts = f.type === 'select' && f.options?.length ? ` (เลือกหนึ่งใน: ${f.options.join(' | ')})` : ''
      const kind = f.type === 'date' ? ' (YYYY-MM-DD)' : ''
      return `    "${f.key}": "${f.label}${opts}${kind}"`
    })
    .join(',\n')
  if (card.repeatable) {
    const limit = ROW_LIMITS[card.key] ?? 10
    return `  "${card.key}": [  // ${card.title} — array ได้สูงสุด ${limit} แถว\n   {\n${fields}\n   }\n  ]`
  }
  return `  "${card.key}": {  // ${card.title}\n${fields}\n  }`
}

const SCAN_SYSTEM = `คุณคือ Business Analyst + Compliance Specialist ที่อ่านเว็บไซต์ธุรกิจไทย แล้วร่าง "Business Skill"
ให้ระบบเขียนบทความ SEO ใช้เป็นความรู้ของแบรนด์นี้

ตอบกลับเป็น JSON object เท่านั้น ห้ามมี markdown code fence ตามโครงนี้ (ค่าทุกช่องเป็น string):
{
  "businessName": "ชื่อธุรกิจตามที่เว็บระบุ",
  "summary": "สรุปธุรกิจหนึ่งประโยค ไม่เกิน 120 ตัวอักษร",
  "industry": "อุตสาหกรรม / หมวดย่อย",
  "riskLevel": "low | medium | high | critical",
${BUSINESS_SKILL_CARDS.map(describeCard).join(',\n')}
}

กฎการกรอก
1. ข้อเท็จจริงของธุรกิจ (businessProfile, productsServices, targetAudience, brandVoice, expertReviewer)
   ต้องมาจากข้อความในเว็บเท่านั้น ห้ามแต่งเติม ถ้าเว็บไม่บอกให้ใส่ "" ในช่องนั้น
   ชื่อบริการ ราคา สาขา เบอร์โทร เวลาทำการ ต้องตรงกับเว็บทุกตัวอักษร
2. productsServices ให้แยกทีละบริการ/สินค้าหลัก ช่อง evidence ใส่ URL หน้าที่เจอข้อมูลนั้น
   ช่อง internalLink ใส่ URL หน้าบริการนั้นในเว็บ ถ้ามี
3. approvedClaims ใส่เฉพาะคำกล่าวอ้างที่เว็บเขียนไว้เองจริง ๆ (เช่น "ประสบการณ์ 15 ปี" "มีใบอนุญาต อย.")
   evidence ใส่ URL + ข้อความที่เจอ ห้ามใส่ approvedBy / approvalDate (ทีมต้องอนุมัติเอง) status = "Draft"
4. prohibitedClaims ใส่คำกล่าวอ้างที่เสี่ยงผิดกฎหมายโฆษณาหรือจรรยาบรรณของหมวดธุรกิจนี้ในประเทศไทย
   พร้อม reason, regulationPolicy (ชื่อกฎหมาย/ประกาศที่เกี่ยวข้อง), violationExample และ safeAlternative
5. officialSources ใส่หน่วยงานทางการหรือองค์กรวิชาชีพที่เกี่ยวกับหมวดธุรกิจนี้ที่มีอยู่จริง
   urlDocument ใส่เฉพาะโดเมนหลักของหน่วยงานที่มั่นใจว่าถูกต้อง ถ้าไม่มั่นใจให้ใส่ "" status = "Draft"
6. industryKnowledge และ compliance เขียนจากความรู้ของหมวดธุรกิจนี้ได้ แต่ต้องเป็นหลักการทั่วไปที่ถูกต้อง
   ไม่อ้างตัวเลขหรือผลลัพธ์ที่ตรวจสอบไม่ได้
7. brandVoice สรุปจากโทนภาษาจริงในเว็บ เช่น สรรพนามที่ใช้เรียกลูกค้า ความเป็นทางการ วิธีเขียน CTA
8. ช่อง select ต้องใช้ค่าจากรายการที่กำหนดเท่านั้น ช่องวันที่ใช้ YYYY-MM-DD หรือ ""
9. เขียนภาษาไทยเป็นหลัก ยกเว้นชื่อเฉพาะ ศัพท์เทคนิค และค่าตัวเลือกที่กำหนดเป็นภาษาอังกฤษ
10. riskLevel: ธุรกิจการแพทย์ ความงามที่มีหัตถการ ยา การเงิน กฎหมาย = high หรือ critical`

function toText(v: unknown): string {
  if (typeof v === 'string') return v.trim().slice(0, FIELD_MAX_CHARS)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : ''))
      .filter(Boolean)
      .join('\n')
      .slice(0, FIELD_MAX_CHARS)
  }
  return ''
}

function sanitizeValues(card: CardConfig, raw: unknown): FieldValues {
  const out: FieldValues = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const src = raw as Record<string, unknown>
  for (const f of card.fields) {
    const value = toText(src[f.key])
    if (!value) continue
    if (f.type === 'select' && f.options && !f.options.includes(value)) continue
    if (f.type === 'date' && !DATE_RE.test(value)) continue
    out[f.key] = value
  }
  return out
}

function sanitizeDraft(raw: Record<string, unknown>, url: string): BusinessSkillDraft {
  const today = new Date().toISOString().slice(0, 10)
  const draft: Record<string, unknown> = {
    industry: toText(raw.industry).slice(0, 200),
    riskLevel: (RISK_OPTIONS as string[]).includes(toText(raw.riskLevel))
      ? (toText(raw.riskLevel) as RiskLevel)
      : 'medium',
  }

  for (const card of BUSINESS_SKILL_CARDS) {
    if (card.repeatable) {
      const rows = Array.isArray(raw[card.key]) ? (raw[card.key] as unknown[]) : []
      draft[card.key] = rows
        .map((r) => sanitizeValues(card, r))
        .filter((r) => Object.keys(r).length > 0)
        .slice(0, ROW_LIMITS[card.key] ?? 10)
    } else {
      draft[card.key] = sanitizeValues(card, raw[card.key])
    }
  }

  // ข้อมูลที่ระบบรู้แน่ ๆ จากการสแกน เติมให้เองแทนการเชื่อโมเดล
  const profile = draft.businessProfile as FieldValues
  if (!profile.website) profile.website = url
  if (!profile.industry && draft.industry) profile.industry = draft.industry as string
  for (const row of draft.productsServices as FieldValues[]) {
    if (!row.lastVerified) row.lastVerified = today
  }
  // claim และแหล่งอ้างอิงจากการสแกนเป็นร่างเสมอ — ทีมต้องอนุมัติเอง
  for (const row of draft.approvedClaims as FieldValues[]) {
    row.status = 'Draft'
    delete row.approvedBy
    delete row.approvalDate
  }
  for (const row of draft.officialSources as FieldValues[]) row.status = 'Draft'

  return draft as unknown as BusinessSkillDraft
}

export async function runBusinessSkillScan(url: string): Promise<BusinessSkillScanResult> {
  const { evidence, warnings } = await collectLabScanEvidence(url)

  const user = [
    `เว็บไซต์: ${url}`,
    `วันที่สแกน: ${new Date().toISOString().slice(0, 10)}`,
    '',
    'หน้าเว็บที่อ่านมา:',
    ...evidence.pages.map((p) => `- ${p.url} | title: ${p.title} | h1: ${p.h1} | ${p.words} คำ`),
    '',
    `เมนูหลัก: ${evidence.navLabels.join(' · ') || '(ไม่พบ)'}`,
    '',
    'ข้อความจริงจากเว็บ:',
    evidence.textSample || '(ไม่มีข้อความ)',
  ].join('\n')

  const res = await askJson<Record<string, unknown>>({
    trace: 'content_engine_business_skill_scan',
    system: SCAN_SYSTEM,
    user,
    maxTokens: 16_000,
    temperature: 0.2,
    timeoutMs: 240_000,
  })
  if (!res.data) throw new Error(res.error ?? 'AI สรุปผลไม่สำเร็จ')
  if (res.error) warnings.push(res.error)

  if (!evidence.textSample || evidence.textSample.length < 300) {
    warnings.push('เว็บนี้มีข้อความให้อ่านน้อยมาก (อาจเป็นเว็บที่โหลดเนื้อหาด้วย JavaScript) — ช่องส่วนใหญ่อาจว่าง')
  }

  return {
    url,
    businessName: toText(res.data.businessName).slice(0, 200),
    summary: toText(res.data.summary).slice(0, 200),
    draft: sanitizeDraft(res.data, url),
    evidence: { pages: evidence.pages, navLabels: evidence.navLabels },
    warnings,
  }
}
