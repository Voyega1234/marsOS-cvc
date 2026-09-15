// ─────────────────────────────────────────────────────────────────────────────
//  Content Engine — สแกนวางลิงก์/วางข้อความ แล้วร่างฟอร์มให้ (Master Prompt /
//  Article Brief / Validator Pack / Image Prompt)
//
//  คำสั่งเจ้าของ 2026-09-11: ต่อยอดจาก Business Skill scan ให้ครบทุก layer
//
//  - หลักฐาน: มี url → ใช้ collectLabScanEvidence (fetch แบบ browserLike + fallback
//    web_search เหมือน Article Lab) / มี text → ใช้ข้อความที่วางมาโดยตรง
//  - CE_MASTER_PROMPT: อ่าน "บทความตัวอย่าง" (ลิงก์หรือข้อความ) แล้วถอดรูปแบบการเขียน
//    ออกมาเป็น Master Prompt ให้บทความใหม่เขียนตามแพทเทิร์นเดิมเป๊ะ
//  - CE_ARTICLE_BRIEF: เดา brief จากบริบท/บทความตัวอย่างที่ให้มา
//  - CE_VALIDATOR_PACK: ปรับ prompt ของแต่ละ validator ให้ตรงบริบท/ความเสี่ยงธุรกิจ
//  - CE_IMAGE_PROMPT: ร่าง prompt สร้างภาพให้ตรงบริบทธุรกิจ
//
//  ผลลัพธ์เป็น "ร่าง" เท่านั้น ไม่บันทึกลง DB — ทีมกดรับในฟอร์มแล้วกดบันทึกเอง
// ─────────────────────────────────────────────────────────────────────────────

import {
  ARTICLE_BRIEF_CARDS,
  CONTENT_TYPES,
  DEFAULT_VALIDATORS,
  MASTER_PROMPT_VARIABLES,
  RISK_OPTIONS,
} from '@/components/settings/content-engine/constants'
import type { CardConfig } from '@/components/settings/content-engine/types'
import { askJson } from '@/lib/competitor-gap/ai'
import { collectLabScanEvidence, evidenceTextHeading, type LabScanEvidence } from '@/lib/lab-scan'

export type CELayerScanType = 'CE_MASTER_PROMPT' | 'CE_ARTICLE_BRIEF' | 'CE_VALIDATOR_PACK' | 'CE_IMAGE_PROMPT'

export interface LayerScanEvidenceSummary {
  source: 'site' | 'web_search' | 'text'
  pages: Array<{ url: string; title: string }>
}

export interface LayerScanResult {
  fields: Record<string, string>
  evidence: LayerScanEvidenceSummary
  warnings: string[]
}

const FIELD_MAX_CHARS = 6000
const TEXT_EVIDENCE_MAX_CHARS = 12_000

// ── ข้อบังคับตายตัว: ผลลัพธ์บทความต้องเป็น HTML เดียวเสมอ (ข้อ 11 ของสเปก) ─────
// เติมทับท้าย outputFormat เสมอ ไม่พึ่งให้โมเดลจำเอง
export const OUTPUT_HTML_GUARD =
  `ผลลัพธ์ต้องเป็นเอกสาร HTML ชุดเดียวเท่านั้น (single HTML document) ห้ามเป็นข้อความล้วนหรือ Markdown เด็ดขาด
ต้องมี JSON-LD schema ครบ Article + BreadcrumbList + FAQPage (เมื่อบทความมี FAQ) และมี breadcrumb markup ในหน้า`

function toText(v: unknown, max = FIELD_MAX_CHARS): string {
  if (typeof v === 'string') return v.trim().slice(0, max)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : ''))
      .filter(Boolean)
      .join('\n')
      .slice(0, max)
  }
  return ''
}

// ── หลักฐาน ────────────────────────────────────────────────────────────────

async function collectEvidence(params: {
  url?: string
  text?: string
}): Promise<{ heading: string; body: string; summary: LayerScanEvidenceSummary; warnings: string[] }> {
  const text = (params.text ?? '').trim()
  if (text) {
    return {
      heading: 'ข้อความที่วางมาโดยตรง:',
      body: text.slice(0, TEXT_EVIDENCE_MAX_CHARS),
      summary: { source: 'text', pages: [] },
      warnings: [],
    }
  }

  const rawUrl = (params.url ?? '').trim()
  if (!rawUrl) throw new Error('ต้องมี url หรือ text อย่างใดอย่างหนึ่ง')
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`

  const { evidence, warnings } = await collectLabScanEvidence(url)
  const heading = [
    'หน้าเว็บที่อ่านมา:',
    ...evidence.pages.map((p) => `- ${p.url} | title: ${p.title} | h1: ${p.h1} | ${p.words} คำ`),
    '',
    evidenceTextHeading(evidence),
  ].join('\n')

  return {
    heading,
    body: evidence.textSample || '(ไม่มีข้อความ)',
    summary: {
      source: evidence.source,
      pages: evidence.pages.map((p) => ({ url: p.url, title: p.title })),
    },
    warnings,
  }
}

// ── Layer: Master Prompt (ถอดแพทเทิร์นจากบทความตัวอย่าง) ─────────────────────

const MASTER_PROMPT_SYSTEM = `คุณคือ Prompt Engineer ที่อ่าน "บทความตัวอย่าง" หนึ่งชิ้นแล้วถอดแพทเทิร์นการเขียนออกมาเป็น
"Master Prompt" ให้ระบบเขียนบทความใหม่เลียนแบบแพทเทิร์นเดิมได้ 100%

วิเคราะห์บทความตัวอย่างให้ครบทุกมิติ:
- โครงหัวข้อ/ลำดับ heading (H1 → H2 → H3) มีกี่ส่วน เรียงลำดับอย่างไร
- สไตล์เกริ่นนำ (intro) และสรุปท้ายบทความ (outro)
- โทนภาษา ความยาวประโยค ความยาวย่อหน้าโดยประมาณ
- การใช้ list/ตาราง มีตรงไหนบ้าง
- ตำแหน่งวาง CTA
- มี FAQ หรือไม่ วางตรงไหน รูปแบบคำถามแบบไหน
- สไตล์การวาง internal link
- การใช้ schema/breadcrumb (ถ้าสังเกตได้จากโครง HTML)

ตอบกลับเป็น JSON object เท่านั้น ห้ามมี markdown code fence ตามโครงนี้ (ค่าทุกช่องเป็น string):
{
  "contentType": "หนึ่งใน: ${CONTENT_TYPES.join(' | ')}",
  "industryScope": "ขอบเขตอุตสาหกรรมที่ pattern นี้ใช้ได้ เช่น All Industries",
  "riskLevel": "low | medium | high | critical",
  "requiredVariables": "รายการตัวแปรที่ต้องใช้ เลือกจาก: ${MASTER_PROMPT_VARIABLES.join(', ')} — หนึ่งตัวต่อบรรทัด",
  "optionalVariables": "รายการตัวแปรที่ใช้ได้แต่ไม่บังคับ เลือกจากชุดเดียวกัน — หนึ่งตัวต่อบรรทัด",
  "systemInstruction": "คำสั่งบทบาท + กติกาการเขียนของ AI นักเขียน อิงจากแพทเทิร์นที่พบ",
  "writingInstruction": "ขั้นตอน/กติกาการเขียนแบบละเอียด ให้ตรงโครง heading, ความยาว, list/table, FAQ, internal link ของบทความตัวอย่างเป๊ะ",
  "outputFormat": "รูปแบบผลลัพธ์ที่ต้องได้ (โครง HTML, schema)",
  "prohibitedBehavior": "สิ่งที่ห้ามทำ อิงจากสิ่งที่บทความตัวอย่างไม่ทำ",
  "fallbackBehavior": "ทำอย่างไรถ้าข้อมูลไม่พอ",
  "testCases": "ตัวอย่างเคสทดสอบสั้น ๆ",
  "versionNote": "สรุปสั้น ๆ ว่า pattern นี้มาจากบทความตัวอย่างเรื่องอะไร"
}

กฎ
1. writingInstruction ต้องระบุจำนวนและลำดับของ section ตามที่นับได้จริงในบทความตัวอย่าง ห้ามคิดเอง
2. ห้ามคัดลอกเนื้อหาของบทความตัวอย่างมาใส่ตรง ๆ ให้เขียนเป็น "กติกา/คำสั่ง" แทน
3. outputFormat ต้องระบุชัดว่าเป็นเอกสาร HTML เดียว ห้ามเป็น plain text/Markdown และต้องมี JSON-LD schema
   (Article + BreadcrumbList + FAQPage เมื่อมี FAQ) พร้อม breadcrumb markup
4. ถ้าบทความตัวอย่างไม่มี FAQ ให้ระบุใน writingInstruction ว่าไม่ต้องมี FAQ section
5. เขียนภาษาไทยเป็นหลัก ยกเว้นศัพท์เทคนิคและชื่อตัวแปร`

function sanitizeMasterPromptFields(raw: Record<string, unknown>): Record<string, string> {
  const contentTypeRaw = toText(raw.contentType, 200)
  const contentType = CONTENT_TYPES.includes(contentTypeRaw) ? contentTypeRaw : 'Knowledge Article'

  const riskRaw = toText(raw.riskLevel, 20)
  const riskLevel = (RISK_OPTIONS as string[]).includes(riskRaw) ? riskRaw : 'medium'

  const filterVars = (v: unknown) =>
    toText(v)
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => MASTER_PROMPT_VARIABLES.includes(x))
      .join('\n')

  const outputFormat = [toText(raw.outputFormat, 2000), OUTPUT_HTML_GUARD].filter(Boolean).join('\n\n')

  return {
    contentType,
    industryScope: toText(raw.industryScope, 200) || 'All Industries',
    riskLevel,
    requiredVariables: filterVars(raw.requiredVariables),
    optionalVariables: filterVars(raw.optionalVariables),
    systemInstruction: toText(raw.systemInstruction, 8000),
    writingInstruction: toText(raw.writingInstruction, 8000),
    outputFormat,
    prohibitedBehavior: toText(raw.prohibitedBehavior, 4000),
    fallbackBehavior: toText(raw.fallbackBehavior, 2000),
    testCases: toText(raw.testCases, 2000),
    versionNote: toText(raw.versionNote, 500),
  }
}

async function scanMasterPrompt(params: { url?: string; text?: string }): Promise<LayerScanResult> {
  const { heading, body, summary, warnings } = await collectEvidence(params)
  const user = ['บทความตัวอย่าง:', '', heading, body].join('\n')

  const res = await askJson<Record<string, unknown>>({
    trace: 'content_engine_master_prompt_scan',
    system: MASTER_PROMPT_SYSTEM,
    user,
    maxTokens: 16_000,
    temperature: 0.2,
    timeoutMs: 240_000,
  })
  if (!res.data) throw new Error(res.error ?? 'AI สรุปผลไม่สำเร็จ')
  if (res.error) warnings.push(res.error)

  return { fields: sanitizeMasterPromptFields(res.data), evidence: summary, warnings }
}

// ── Layer: Article Brief (dot-notation "cardKey.fieldKey") ──────────────────

function describeArticleBriefCard(card: CardConfig): string {
  const fields = card.fields
    .map((f) => {
      const opts = f.type === 'select' && f.options?.length ? ` (เลือกหนึ่งใน: ${f.options.join(' | ')})` : ''
      return `    "${card.key}.${f.key}": "${f.label}${opts}"`
    })
    .join(',\n')
  return `  // ${card.title}\n${fields}`
}

const ARTICLE_BRIEF_SYSTEM = `คุณคือ SEO Content Strategist ที่ร่าง "Article Brief" ให้นักเขียน AI ใช้เป็นโจทย์เขียนบทความ

อ่านหลักฐานที่ให้มา (เว็บไซต์ลูกค้า หรือบทความ/บริบทที่วางมา) แล้วร่าง brief ให้ครบ

ตอบกลับเป็น JSON object แบบ flat เท่านั้น (key เป็น "ชื่อการ์ด.ชื่อฟิลด์" ตรงตัว) ห้ามมี markdown code fence:
{
${ARTICLE_BRIEF_CARDS.map(describeArticleBriefCard).join(',\n')}
}

กฎ
1. ฟิลด์ไหนไม่มีหลักฐานรองรับ ให้เว้นว่าง "" ห้ามเดามั่ว
2. primaryKeyword / secondaryKeywords ต้องมาจากคำที่เกี่ยวกับธุรกิจ/บทความที่ให้มาจริง
3. ช่อง select ต้องใช้ค่าจากรายการที่กำหนดเท่านั้น
4. เขียนภาษาไทยเป็นหลัก`

function sanitizeArticleBriefFields(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const card of ARTICLE_BRIEF_CARDS) {
    for (const f of card.fields) {
      const flatKey = `${card.key}.${f.key}`
      const value = toText(raw[flatKey])
      if (!value) continue
      if (f.type === 'select' && f.options && !f.options.includes(value)) continue
      out[flatKey] = value
    }
  }
  return out
}

async function scanArticleBrief(params: { url?: string; text?: string }): Promise<LayerScanResult> {
  const { heading, body, summary, warnings } = await collectEvidence(params)
  const user = ['หลักฐาน:', '', heading, body].join('\n')

  const res = await askJson<Record<string, unknown>>({
    trace: 'content_engine_article_brief_scan',
    system: ARTICLE_BRIEF_SYSTEM,
    user,
    maxTokens: 16_000,
    temperature: 0.2,
    timeoutMs: 240_000,
  })
  if (!res.data) throw new Error(res.error ?? 'AI สรุปผลไม่สำเร็จ')
  if (res.error) warnings.push(res.error)

  return { fields: sanitizeArticleBriefFields(res.data), evidence: summary, warnings }
}

// ── Layer: Validator Pack (ปรับ prompt ของแต่ละ validator ให้ตรงบริบท) ───────

const VALIDATOR_IDS = DEFAULT_VALIDATORS.map((v) => v.id)

const VALIDATOR_PACK_SYSTEM = `คุณคือ QA Lead ที่ปรับ "Validator Pack" (เกณฑ์ตรวจบทความก่อนส่ง) ให้ตรงกับบริบทธุรกิจ/อุตสาหกรรมที่ให้มา

Validator ที่มีอยู่แล้ว (ห้ามเพิ่ม/ลด ปรับได้เฉพาะข้อความ prompt ของแต่ละตัว):
${DEFAULT_VALIDATORS.map((v) => `- ${v.id}: ${v.name} — ปัจจุบัน: ${v.prompt}`).join('\n')}

ตอบกลับเป็น JSON object เท่านั้น ห้ามมี markdown code fence ตามโครงนี้ (ค่าทุกช่องเป็น string):
{
  "industryScope": "ขอบเขตอุตสาหกรรม",
  "riskScope": "low | medium | high | critical",
${VALIDATOR_IDS.map((id) => `  "${id}": "prompt ที่ปรับให้ตรงบริบทธุรกิจนี้"`).join(',\n')}
}

กฎ
1. ปรับข้อความ prompt ของแต่ละ validator ให้เจาะจงกับอุตสาหกรรม/ความเสี่ยงของธุรกิจนี้ เช่น
   ธุรกิจการแพทย์ต้องเน้นกฎหมายโฆษณาทางการแพทย์ใน compliance และ fact_source
2. schema_html ต้องคงข้อความที่บังคับว่าเอกสารต้องเป็น HTML เดียว มี JSON-LD (Article + BreadcrumbList +
   FAQPage เมื่อมี FAQ) และ breadcrumb — ห้ามลบเงื่อนไขนี้ออก แม้จะปรับถ้อยคำได้
3. ถ้าไม่มีข้อมูลพอให้ปรับ ให้คืน prompt เดิมของ validator นั้นแบบคำต่อคำ
4. เขียนภาษาไทยเป็นหลัก`

function sanitizeValidatorPackFields(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const industryScope = toText(raw.industryScope, 200)
  if (industryScope) out.industryScope = industryScope
  const riskScope = toText(raw.riskScope, 20)
  if ((RISK_OPTIONS as string[]).includes(riskScope)) out.riskScope = riskScope

  for (const id of VALIDATOR_IDS) {
    const value = toText(raw[id], 3000)
    if (!value) continue
    // schema_html ต้องคง guard เอกสาร HTML เดียว + JSON-LD เสมอ
    out[id] = id === 'schema_html' && !/HTML/i.test(value) ? `${value}\n${OUTPUT_HTML_GUARD}` : value
  }
  return out
}

async function scanValidatorPack(params: { url?: string; text?: string }): Promise<LayerScanResult> {
  const { heading, body, summary, warnings } = await collectEvidence(params)
  const user = ['หลักฐาน:', '', heading, body].join('\n')

  const res = await askJson<Record<string, unknown>>({
    trace: 'content_engine_validator_pack_scan',
    system: VALIDATOR_PACK_SYSTEM,
    user,
    maxTokens: 16_000,
    temperature: 0.2,
    timeoutMs: 240_000,
  })
  if (!res.data) throw new Error(res.error ?? 'AI สรุปผลไม่สำเร็จ')
  if (res.error) warnings.push(res.error)

  return { fields: sanitizeValidatorPackFields(res.data), evidence: summary, warnings }
}

// ── Layer: Image Prompt (ร่าง prompt สร้างภาพเดียว) ──────────────────────────

const IMAGE_PROMPT_SYSTEM = `คุณคือ Art Director ที่ร่าง prompt สั่งสร้างภาพประกอบบทความให้ตรงกับบริบทธุรกิจ

ตอบกลับเป็น JSON object เท่านั้น ห้ามมี markdown code fence:
{
  "promptText": "prompt เต็มสำหรับสร้างภาพ ใช้ตัวแปรได้: {{keyword}}, {{title}}, {{site_name}}, {{brand_tone}}, {{accent_color}} — ห้ามใส่ตัวอักษรบนภาพ ระบุสไตล์ อัตราส่วนภาพ และให้คืนค่า alt_text ภาษาไทย"
}

กฎ
1. อ้างอิงโทน/สีของธุรกิจจากหลักฐานที่ให้มาเท่านั้น ถ้าไม่มีให้ใช้ตัวแปร {{brand_tone}} / {{accent_color}} แทน
2. เขียนภาษาไทยเป็นหลัก`

function sanitizeImagePromptFields(raw: Record<string, unknown>): Record<string, string> {
  const promptText = toText(raw.promptText, 4000)
  return promptText ? { promptText } : {}
}

async function scanImagePrompt(params: { url?: string; text?: string }): Promise<LayerScanResult> {
  const { heading, body, summary, warnings } = await collectEvidence(params)
  const user = ['หลักฐาน:', '', heading, body].join('\n')

  const res = await askJson<Record<string, unknown>>({
    trace: 'content_engine_image_prompt_scan',
    system: IMAGE_PROMPT_SYSTEM,
    user,
    maxTokens: 4_000,
    temperature: 0.3,
    timeoutMs: 180_000,
  })
  if (!res.data) throw new Error(res.error ?? 'AI สรุปผลไม่สำเร็จ')
  if (res.error) warnings.push(res.error)

  return { fields: sanitizeImagePromptFields(res.data), evidence: summary, warnings }
}

// ── ทางเข้าใช้งานหลัก ─────────────────────────────────────────────────────

export async function runLayerScan(params: {
  layer: CELayerScanType
  url?: string
  text?: string
}): Promise<LayerScanResult> {
  switch (params.layer) {
    case 'CE_MASTER_PROMPT':
      return scanMasterPrompt(params)
    case 'CE_ARTICLE_BRIEF':
      return scanArticleBrief(params)
    case 'CE_VALIDATOR_PACK':
      return scanValidatorPack(params)
    case 'CE_IMAGE_PROMPT':
      return scanImagePrompt(params)
    default:
      throw new Error(`ไม่รู้จัก layer: ${params.layer}`)
  }
}

// เผื่อไฟล์อื่น import ชนิดนี้ไปใช้ (LabScanEvidence ใช้ซ้ำจาก lab-scan.ts)
export type { LabScanEvidence }
