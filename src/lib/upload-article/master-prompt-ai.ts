// ─────────────────────────────────────────────────────────────────────────────
//  Upload Article — AI ช่วยสร้าง/แก้ CE_MASTER_PROMPT จาก "บทความตัวอย่าง"
//
//  - master-from-examples: อ่านบทความตัวอย่าง 3-5 ชิ้น (ลิงก์หรือข้อความ) แล้วถอดแพทเทิร์น
//    การเขียนออกมาเป็น Master Prompt ภาษาไทย (plain text — เปิดในโหมด raw ของ MasterPromptsTab)
//  - master-edit: รับ instruction สั้น ๆ แล้วเสนอ Master Prompt ฉบับแก้ไข (ไม่บันทึก)
// ─────────────────────────────────────────────────────────────────────────────

import { parse, type HTMLElement, type Node } from 'node-html-parser'

import { orChat, OR_MODELS, type ORUsage } from '@/lib/openrouter'
import { safeFetchHtml } from '@/lib/upload-article/safe-fetch'
import { humanBodyRulesBlock, humanTitleRulesBlock } from './human-voice'

export const MASTER_EXAMPLES_MIN_SOURCES = 3
export const MASTER_EXAMPLES_MAX_SOURCES = 5
export const MASTER_EXAMPLES_MAX_CHARS_PER_SOURCE = 15_000
export const MASTER_EXAMPLES_MIN_EXTRACTED_CHARS = 300
export const MASTER_EDIT_MAX_INSTRUCTION_CHARS = 2000

const STRIP_TAGS = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'form']
const MAIN_SELECTORS = ['article', 'main', '.entry-content']

/** ตัด tag ที่ไม่ใช่เนื้อหาบทความทิ้งก่อนดึงข้อความ (in-place) */
function stripNonContent(root: HTMLElement): void {
  for (const tag of STRIP_TAGS) {
    root.querySelectorAll(tag).forEach((el) => el.remove())
  }
}

/**
 * ดึงเนื้อหาหลักจาก HTML เป็นข้อความล้วน คงโครง heading ไว้เป็น marker แบบ Markdown
 * ("## " = h2, "### " = h3 ...) เพื่อให้ AI เห็นโครงสร้างหัวข้อของบทความตัวอย่าง
 */
export function extractArticleText(html: string): string {
  const root = parse(html, { blockTextElements: { script: false, style: false } })
  stripNonContent(root)

  let main: HTMLElement | null = null
  for (const sel of MAIN_SELECTORS) {
    main = root.querySelector(sel)
    if (main) break
  }
  if (!main) main = root.querySelector('body') || root

  const lines: string[] = []
  const HEADING_RE = /^h([1-6])$/

  function walk(node: Node): void {
    const el = node as HTMLElement
    if (!el.childNodes) return
    for (const child of el.childNodes) {
      const tagName = (child as HTMLElement).tagName
      if (!tagName) continue // text node — เก็บผ่าน .text ของ element ที่ครอบอยู่แล้ว ไม่ต้องแยก
      const tag = tagName.toLowerCase()
      const headingMatch = HEADING_RE.exec(tag)
      if (headingMatch) {
        const txt = (child as HTMLElement).text?.replace(/\s+/g, ' ').trim()
        if (txt) lines.push(`${'#'.repeat(Number(headingMatch[1]))} ${txt}`)
      } else if (tag === 'p' || tag === 'li' || tag === 'td' || tag === 'blockquote') {
        const txt = (child as HTMLElement).text?.replace(/\s+/g, ' ').trim()
        if (txt) lines.push(txt)
      } else {
        walk(child)
      }
    }
  }
  walk(main)

  const text = (lines.join('\n') || main.text.replace(/\s+/g, ' ').trim()).trim()
  return text.slice(0, MASTER_EXAMPLES_MAX_CHARS_PER_SOURCE)
}

export interface MasterExampleSourceInput {
  url?: string
  text?: string
}

export interface ExtractedExample {
  label: string
  text: string
}

export interface ExtractSourcesResult {
  ok: boolean
  sources: ExtractedExample[]
  /** ข้อความ error เมื่อ ok=false — ระบุว่าตัวอย่างไหนสกัดข้อความไม่พอ/ดึงไม่สำเร็จ */
  error?: string
}

/**
 * สกัดข้อความจากตัวอย่างที่ส่งมา (url หรือ text) — คืน error รวมเดียวถ้าตัวอย่างไหนไม่ผ่านเกณฑ์
 * (จำนวน / ความยาวขั้นต่ำหลังสกัด) กันเปลืองรอบ AI เมื่อ input ไม่พอ
 */
export async function extractExampleSources(sources: MasterExampleSourceInput[]): Promise<ExtractSourcesResult> {
  if (!Array.isArray(sources) || sources.length < MASTER_EXAMPLES_MIN_SOURCES || sources.length > MASTER_EXAMPLES_MAX_SOURCES) {
    return { ok: false, sources: [], error: `ต้องมีตัวอย่างบทความ ${MASTER_EXAMPLES_MIN_SOURCES}-${MASTER_EXAMPLES_MAX_SOURCES} ชิ้น` }
  }

  const results: ExtractedExample[] = []
  const failed: string[] = []

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]
    const label = `ตัวอย่างที่ ${i + 1}`
    const rawText = typeof src.text === 'string' ? src.text.trim() : ''
    const rawUrl = typeof src.url === 'string' ? src.url.trim() : ''

    let text = ''
    if (rawText) {
      text = rawText.slice(0, MASTER_EXAMPLES_MAX_CHARS_PER_SOURCE)
    } else if (rawUrl) {
      const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
      const res = await safeFetchHtml(url)
      if (!res.ok) {
        failed.push(`${label}: ดึงลิงก์ไม่สำเร็จ (${res.error || 'unknown'})`)
        continue
      }
      text = extractArticleText(res.html)
    } else {
      failed.push(`${label}: ต้องมี url หรือ text อย่างใดอย่างหนึ่ง`)
      continue
    }

    if (text.length < MASTER_EXAMPLES_MIN_EXTRACTED_CHARS) {
      failed.push(`${label}: ข้อความสั้นเกินไป (${text.length} ตัวอักษร ต้องมีอย่างน้อย ${MASTER_EXAMPLES_MIN_EXTRACTED_CHARS})`)
      continue
    }
    results.push({ label, text })
  }

  if (failed.length > 0) {
    return { ok: false, sources: results, error: failed.join(' | ') }
  }
  return { ok: true, sources: results }
}

const MASTER_FROM_EXAMPLES_SYSTEM = () => `คุณคือ Prompt Engineer ที่อ่าน "บทความตัวอย่าง" หลายชิ้นจากลูกค้ารายเดียวกัน แล้วถอดแพทเทิร์นการเขียนร่วมของทุกชิ้น
ออกมาเป็น "Master Prompt" ฉบับเดียว ให้ระบบเขียนบทความใหม่ตามแพทเทิร์นเดิมได้

วิเคราะห์และเขียน Master Prompt เป็นข้อความไทยล้วน (ไม่ใช่ JSON ไม่ใช่ Markdown code fence) ให้ครอบคลุมทุกหัวข้อนี้:
1. โทนเสียง/บุคลิกของนักเขียน (voice, tone, persona)
2. กลุ่มผู้อ่านเป้าหมาย
3. รูปแบบการเกริ่นนำ (intro pattern)
4. โครงหัวข้อ/ลำดับชั้น heading และสไตล์การตั้งชื่อหัวข้อ
5. ความยาวย่อหน้าโดยประมาณ
6. การใช้ list/ตาราง — ใช้ตอนไหน รูปแบบอย่างไร
7. สัญญาณ E-E-A-T (ความเชี่ยวชาญ/แหล่งอ้างอิง/ความน่าเชื่อถือ)
8. สไตล์ FAQ (ถ้ามี)
9. สไตล์ CTA
10. ช่วงความยาวบทความโดยประมาณ (จำนวนคำ)
11. กติกาการจัดรูปแบบอื่น ๆ ที่สังเกตเห็นร่วมกัน
12. สิ่งที่ควรหลีกเลี่ยง
13. กติกาภาษาให้อ่านแล้วเหมือนคนเขียน ไม่ใช่ AI — ยกสำนวน/จังหวะประโยคที่ตัวอย่างใช้จริงเป็นแนวทาง และห้ามสำนวนแบบ AI ต่อไปนี้:
${humanBodyRulesBlock()}
กฎตั้งชื่อ H1/หัวข้อ:
${humanTitleRulesBlock()}

กฎสำคัญ
- ถอดเป็น "แพทเทิร์น/กติกา" ทั่วไป ห้ามคัดลอกข้อเท็จจริง ชื่อเฉพาะ ตัวเลข หรือเนื้อหาของบทความตัวอย่างมาใส่ตรง ๆ
- เขียนเป็น "คำสั่ง" ให้นักเขียน AI ทำตาม ไม่ใช่บทสรุปของตัวอย่าง
- ตอบเป็นข้อความไทยล้วน ห้ามมี markdown code fence ห้ามห่อด้วย JSON`

export interface MasterFromExamplesResult {
  text: string
  usage: ORUsage
}

/** สร้าง Master Prompt (plain text ภาษาไทย) จากตัวอย่างบทความที่สกัดข้อความแล้ว */
export async function buildMasterPromptFromExamples(
  sources: ExtractedExample[],
  clientSlug: string,
): Promise<MasterFromExamplesResult> {
  const user = sources
    .map((s) => `${s.label}:\n${s.text}`)
    .join('\n\n---\n\n')

  const res = await orChat({
    trace: 'ce_master_prompt_from_examples',
    client: clientSlug,
    messages: [
      { role: 'system', content: MASTER_FROM_EXAMPLES_SYSTEM() },
      { role: 'user', content: `บทความตัวอย่าง ${sources.length} ชิ้น:\n\n${user}` },
    ],
    model: OR_MODELS.writer(),
    maxTokens: 8000,
    temperature: 0.3,
    timeoutMs: 240_000,
  })

  return { text: res.text.trim(), usage: res.usage }
}

const MASTER_EDIT_SYSTEM_JSON = `คุณคือ Prompt Engineer ที่แก้ไข Master Prompt ของ Content Engine ตามคำสั่งที่ทีมให้มา
Master Prompt ปัจจุบันอยู่ในรูปแบบ JSON — ต้องตอบกลับเป็น JSON เท่านั้น ห้ามมี markdown code fence ตามโครงนี้:
{"promptText": "<Master Prompt ฉบับแก้ไข ต้องเป็น JSON string ที่ parse แล้วได้ object schema เดียวกับต้นฉบับทุกประการ (key ครบเหมือนเดิม)>", "summary": "<สรุปสิ่งที่แก้ ภาษาไทย ไม่เกิน 3 ข้อ แบบ bullet คั่นด้วยขึ้นบรรทัดใหม่>"}

กฎ
1. แก้เฉพาะส่วนที่คำสั่งขอ ส่วนอื่นที่ไม่เกี่ยวข้องต้องคงเดิมทุกตัวอักษร
2. promptText ต้องเป็น JSON ที่ valid และมี key ครบเหมือน JSON ต้นฉบับ ห้ามเพิ่ม/ลบ key
3. ห้ามเปลี่ยนกติกาบังคับเรื่องเอกสาร HTML เดียว/JSON-LD schema เว้นแต่คำสั่งจะขอโดยตรง`

const MASTER_EDIT_SYSTEM_RAW = `คุณคือ Prompt Engineer ที่แก้ไข Master Prompt ของ Content Engine ตามคำสั่งที่ทีมให้มา
Master Prompt ปัจจุบันเป็นข้อความไทยล้วน (raw text) — ต้องตอบกลับเป็น JSON เท่านั้น ห้ามมี markdown code fence ตามโครงนี้:
{"promptText": "<Master Prompt ฉบับแก้ไข เป็นข้อความไทยล้วนแบบเดียวกับต้นฉบับ>", "summary": "<สรุปสิ่งที่แก้ ภาษาไทย ไม่เกิน 3 ข้อ แบบ bullet คั่นด้วยขึ้นบรรทัดใหม่>"}

กฎ
1. แก้เฉพาะส่วนที่คำสั่งขอ ส่วนอื่นที่ไม่เกี่ยวข้องต้องคงเดิมให้มากที่สุด
2. ห้ามลดทอนความยาว/รายละเอียดของ Master Prompt เดิมลงมาก เว้นแต่คำสั่งขอให้ตัดออก`

export interface MasterEditResult {
  promptText: string
  summary: string
  usage: ORUsage
}

/**
 * เสนอ Master Prompt ฉบับแก้ไขตาม instruction — ไม่บันทึกลง DB
 * isJson=true เมื่อ promptText เดิม parse เป็น JSON ได้ (โหมด structured ของฟอร์ม)
 */
export async function proposeMasterPromptEdit(
  currentPromptText: string,
  instruction: string,
  isJson: boolean,
  clientSlug: string,
): Promise<MasterEditResult> {
  const system = isJson ? MASTER_EDIT_SYSTEM_JSON : MASTER_EDIT_SYSTEM_RAW
  const user = `Master Prompt ปัจจุบัน:\n${currentPromptText}\n\nคำสั่งแก้ไข:\n${instruction}`

  const res = await orChat({
    trace: 'ce_master_prompt_edit',
    client: clientSlug,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    model: OR_MODELS.writer(),
    maxTokens: 8000,
    temperature: 0.2,
    jsonMode: true,
    timeoutMs: 240_000,
  })

  let parsed: { promptText?: unknown; summary?: unknown }
  try {
    parsed = JSON.parse(res.text)
  } catch {
    throw new Error('AI ตอบกลับไม่ใช่ JSON ที่ถูกต้อง')
  }

  const promptText = typeof parsed.promptText === 'string' ? parsed.promptText.trim() : ''
  if (!promptText) throw new Error('AI ไม่ได้ส่ง promptText กลับมา')

  if (isJson) {
    try {
      JSON.parse(promptText)
    } catch {
      throw new Error('AI ตอบ promptText ที่ไม่ใช่ JSON ถูกต้องตามโครงเดิม')
    }
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  return { promptText, summary, usage: res.usage }
}
