// ─────────────────────────────────────────────────────────────────────────────
//  ไฟล์ธุรกิจ (CSV/PDF) → Project Context + Business Skill (Content Engine ชั้นที่ 1)
//
//  คำสั่งเจ้าของ (owner item 3, 2026-09-14): ลากไฟล์ธุรกิจของลูกค้าเข้า Article Lab
//  แล้วให้ระบบ (1) กรอก Project Context ให้ครบทุกข้อเท็จจริง (2) เติมลง Business Skill
//  ของโปรเจกต์นั้น — เติมช่องว่าง + "ต่อท้าย" รายละเอียดใหม่ในช่องที่มีข้อมูลอยู่แล้ว
//  ห้ามลบของเดิม ตามที่ทีมอนุมัติไว้ก่อนหน้า
// ─────────────────────────────────────────────────────────────────────────────

import { BUSINESS_SKILL_CARDS, RISK_OPTIONS } from '@/components/settings/content-engine/constants'
import type { BusinessSkillData, CardConfig, FieldValues, RiskLevel } from '@/components/settings/content-engine/types'
import { askJson } from '@/lib/competitor-gap/ai'

export type BusinessSkillDraft = Omit<BusinessSkillData, 'status'>

export interface ContextFilesAiResult {
  projectContext: string
  businessSkill: BusinessSkillDraft
  summary: string
  warnings: string[]
  /** token/cost จริงจาก OpenRouter — ให้ route.ts log ลง AIJob */
  usage: { totalTokens: number; costUsd: number }
}

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

const SYSTEM = `คุณคือ Business Analyst ที่อ่านไฟล์ที่ทีมงานเอเจนซี่ส่งมาจากลูกค้า (ไฟล์ CSV รายการสินค้า/ราคา/สาขา หรือ PDF โบรชัวร์/ใบเสนอราคา/เอกสารบริษัท)
แล้วสรุปเป็นสองส่วน ให้ระบบเขียนบทความ SEO ใช้เป็นความรู้ของแบรนด์นี้ ตอบกลับเป็น JSON object เท่านั้น ห้ามมี markdown code fence

{
  "summary": "สรุปสิ่งที่เจอในไฟล์หนึ่งประโยค ไม่เกิน 150 ตัวอักษร",
  "projectContext": "ข้อความภาษาไทยยาว ละเอียด ครบทุกข้อเท็จจริงที่เจอในไฟล์ — สินค้า/บริการ ราคา สาขา/พื้นที่บริการ จุดขาย กลุ่มเป้าหมาย ช่องทางติดต่อ นโยบาย เงื่อนไข ฯลฯ เขียนเป็นข้อ ๆ อ่านง่าย ห้ามย่อทิ้งข้อมูล ห้ามแต่งเติมสิ่งที่ไม่มีในไฟล์",
  "businessSkill": {
    "industry": "อุตสาหกรรม / หมวดย่อย (ถ้าไฟล์บอก)",
    "riskLevel": "low | medium | high | critical",
${BUSINESS_SKILL_CARDS.map(describeCard).join(',\n')}
  },
  "warnings": ["ข้อควรระวัง เช่น ไฟล์อ่านไม่ครบ ตัวเลขไม่ชัดเจน ฯลฯ (ใส่ [] ถ้าไม่มี)"]
}

กฎการกรอก
1. ข้อเท็จจริงทุกช่องต้องมาจากไฟล์ที่ให้มาเท่านั้น ห้ามแต่งเติม ถ้าไฟล์ไม่บอกให้ใส่ "" ในช่องนั้น
2. productsServices แยกทีละบริการ/สินค้าหลักที่เจอในไฟล์ ราคาต้องตรงกับไฟล์ทุกตัวอักษร
3. approvedClaims ใส่เฉพาะคำกล่าวอ้างที่ไฟล์เขียนไว้เองจริง ๆ status = "Draft" ห้ามใส่ approvedBy / approvalDate
4. officialSources ใส่เฉพาะหน่วยงาน/ใบอนุญาตที่ไฟล์ระบุจริง status = "Draft"
5. ช่อง select ต้องใช้ค่าจากรายการที่กำหนดเท่านั้น ช่องวันที่ใช้ YYYY-MM-DD หรือ ""
6. เขียนภาษาไทยเป็นหลัก ยกเว้นชื่อเฉพาะและค่าตัวเลือกที่กำหนดเป็นภาษาอังกฤษ
7. ถ้าไฟล์ไม่มีข้อมูลพอสำหรับ Business Skill เลย ให้ projectContext มีเนื้อหาเท่าที่มี และปล่อยช่อง Business Skill ว่างไว้ อย่าเดา`

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

function sanitizeDraft(raw: Record<string, unknown>): BusinessSkillDraft {
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

  for (const row of draft.productsServices as FieldValues[]) {
    if (!row.lastVerified) row.lastVerified = today
  }
  for (const row of draft.approvedClaims as FieldValues[]) {
    row.status = 'Draft'
    delete row.approvedBy
    delete row.approvalDate
  }
  for (const row of draft.officialSources as FieldValues[]) row.status = 'Draft'

  return draft as unknown as BusinessSkillDraft
}

/** อ่านข้อความที่ดึงจากไฟล์แล้ว → projectContext + businessSkill draft ด้วย AI */
export async function analyzeContextFiles(fileNames: string[], combinedText: string): Promise<ContextFilesAiResult> {
  const user = [
    `ไฟล์ที่ทีมอัปโหลด: ${fileNames.join(', ')}`,
    `วันที่วิเคราะห์: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '=== เนื้อหาไฟล์ ===',
    combinedText || '(ไม่มีข้อความ)',
  ].join('\n')

  const res = await askJson<Record<string, unknown>>({
    trace: 'content_engine_context_files_scan',
    system: SYSTEM,
    user,
    maxTokens: 16_000,
    temperature: 0.2,
    timeoutMs: 240_000,
  })
  if (!res.data) throw new Error(res.error ?? 'AI สรุปไฟล์ไม่สำเร็จ')

  const warnings: string[] = []
  if (res.error) warnings.push(res.error)
  if (Array.isArray(res.data.warnings)) {
    for (const w of res.data.warnings) if (typeof w === 'string' && w.trim()) warnings.push(w.trim())
  }

  const businessSkillRaw = (res.data.businessSkill && typeof res.data.businessSkill === 'object')
    ? (res.data.businessSkill as Record<string, unknown>)
    : {}

  return {
    projectContext: toText(res.data.projectContext).slice(0, 20_000),
    businessSkill: sanitizeDraft(businessSkillRaw),
    summary: toText(res.data.summary).slice(0, 300),
    warnings,
    usage: { totalTokens: res.usage.totalTokens, costUsd: res.usage.costUsd },
  }
}

// ── ผสานร่างใหม่เข้ากับ Business Skill เดิม — เติมช่องว่าง + ต่อท้ายช่องที่มีข้อมูลแล้ว ──
// ห้ามลบข้อความเดิมเด็ดขาด (คำสั่งเจ้าของ)

function mergeScalar(card: CardConfig, existing: FieldValues, incoming: FieldValues): FieldValues {
  const out: FieldValues = { ...existing }
  for (const f of card.fields) {
    const newVal = incoming[f.key]
    if (!newVal) continue
    const oldVal = out[f.key]
    if (!oldVal) {
      out[f.key] = newVal
      continue
    }
    // select/date เป็นค่าเลือกตายตัว — เติมเฉพาะตอนว่าง ไม่ต่อท้าย
    if (f.type === 'select' || f.type === 'date') continue
    if (oldVal.includes(newVal)) continue
    out[f.key] = `${oldVal}\n${newVal}`.slice(0, FIELD_MAX_CHARS)
  }
  return out
}

/** ใช้ช่องแรกของการ์ด (เช่น ชื่อสินค้า / ข้อความ claim) เป็นตัวระบุแถวเดียวกัน — เหมือนกับ mergeScanIntoSkill ฝั่งฟอร์ม */
function rowKey(card: CardConfig, row: FieldValues): string {
  const first = card.fields[0]?.key
  return first ? (row[first] ?? '').trim().toLowerCase() : ''
}

/** แถวชื่อเดียวกัน → ผสานทีละช่อง (เติมว่าง/ต่อท้าย) แถวใหม่จริง → เพิ่มต่อท้ายรายการ */
function mergeRepeatable(card: CardConfig, existing: FieldValues[], incoming: FieldValues[]): FieldValues[] {
  const merged = existing.map((r) => ({ ...r }))
  const indexByKey = new Map<string, number>()
  merged.forEach((r, i) => {
    const key = rowKey(card, r)
    if (key) indexByKey.set(key, i)
  })
  for (const row of incoming) {
    const key = rowKey(card, row)
    const idx = key ? indexByKey.get(key) : undefined
    if (idx !== undefined) {
      merged[idx] = mergeScalar(card, merged[idx], row)
    } else {
      merged.push(row)
      if (key) indexByKey.set(key, merged.length - 1)
    }
  }
  return merged.slice(0, ROW_LIMITS[card.key] ?? 10)
}

/** ผสาน BusinessSkillDraft ใหม่เข้ากับของเดิม (ถ้ามี) คืนค่าเป็น BusinessSkillData ที่พร้อมบันทึก */
export function mergeBusinessSkill(existing: BusinessSkillData | null, incoming: BusinessSkillDraft): BusinessSkillData {
  const base: BusinessSkillData = existing ?? {
    status: 'Draft',
    industry: '',
    riskLevel: 'medium',
    businessProfile: {},
    industryKnowledge: {},
    productsServices: [],
    targetAudience: {},
    approvedClaims: [],
    prohibitedClaims: [],
    officialSources: [],
    brandVoice: {},
    compliance: {},
    expertReviewer: {},
  }

  const merged: BusinessSkillData = { ...base }

  // industry เป็น text ธรรมดา — เติม/ต่อท้ายได้; riskLevel เป็นตัวเลือก เติมเฉพาะตอนว่าง
  if (incoming.industry) {
    merged.industry = merged.industry ? (merged.industry.includes(incoming.industry) ? merged.industry : `${merged.industry}\n${incoming.industry}`) : incoming.industry
  }
  if (!merged.riskLevel && incoming.riskLevel) merged.riskLevel = incoming.riskLevel

  for (const card of BUSINESS_SKILL_CARDS) {
    const key = card.key as keyof BusinessSkillData
    if (card.repeatable) {
      merged[key] = mergeRepeatable(card, (base[key] as FieldValues[]) ?? [], (incoming[key as keyof BusinessSkillDraft] as FieldValues[]) ?? []) as never
    } else {
      merged[key] = mergeScalar(card, (base[key] as FieldValues) ?? {}, (incoming[key as keyof BusinessSkillDraft] as FieldValues) ?? {}) as never
    }
  }

  return merged
}

// ── Business Skill แบบ "raw" (ข้อความอิสระ ไม่ใช่ JSON ฟอร์ม) ────────────────
// บาง project เก็บ Business Skill เป็นข้อความอิสระ (ทีมพิมพ์เองในโหมด raw)
// ห้ามแปลงเป็น JSON ทับของเดิมเด็ดขาด — แปลงร่างใหม่เป็นข้อความอ่านง่ายแล้วต่อท้ายแทน

/** แปลง BusinessSkillDraft ที่มีข้อมูลจริงเป็นข้อความไทยอ่านง่าย ไว้ต่อท้าย Business Skill แบบ raw */
export function businessSkillDraftToText(draft: BusinessSkillDraft): string {
  const lines: string[] = []
  if (draft.industry) lines.push(`อุตสาหกรรม: ${draft.industry}`)

  for (const card of BUSINESS_SKILL_CARDS) {
    const key = card.key as keyof BusinessSkillDraft
    if (card.repeatable) {
      const rows = (draft[key] as FieldValues[]) ?? []
      if (rows.length === 0) continue
      lines.push(`${card.title}:`)
      for (const row of rows) {
        const parts = card.fields
          .map((f) => (row[f.key] ? `${f.label}: ${row[f.key]}` : ''))
          .filter(Boolean)
        if (parts.length) lines.push(`- ${parts.join(' · ')}`)
      }
    } else {
      const values = (draft[key] as FieldValues) ?? {}
      const parts = card.fields
        .map((f) => (values[f.key] ? `${f.label}: ${values[f.key]}` : ''))
        .filter(Boolean)
      if (parts.length) lines.push(`${card.title}: ${parts.join(' · ')}`)
    }
  }

  return lines.join('\n')
}
