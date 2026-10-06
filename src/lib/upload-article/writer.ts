// ─── Upload Article — เขียนบทความจริงจาก Content Engine + keyword ────────────────
// ฟังก์ชันล้วน (prompt building / parsing ผลลัพธ์) — เรียกตรงจาก unit test ได้
// งาน DB/stream จริงอยู่ที่ route (ต้องใช้ prisma + orChatStream ตรง ๆ)

import type { UploadKeyword, UploadLinkPair } from './types'
import { articleIntentSkillBlock } from '@/lib/article-intent-skill'
import { humanVoiceSkillBlock } from '@/lib/article-human-voice-skill'

/** WRITING ที่ค้างเกินนี้ถือว่าตาย (proc ตายกลางทาง) — ลบทิ้งแล้วเขียนใหม่ได้ */
export const WRITER_STALE_MS = 6 * 60 * 1000

/** เนื้อหาที่ clean แล้วสั้นกว่านี้ถือว่าล้มเหลว (โมเดลตอบว่าง/ตัดกลางทาง) */
export const MIN_CLEANED_HTML_LENGTH = 300

export function isWritingStale(updatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - updatedAt.getTime() >= WRITER_STALE_MS
}

export interface WriterCELayers {
  masterPrompt: string
  businessSkill: string
  articleBrief: string
  validatorPack: string
}

/** 4 layer ที่ writer ต้องมีครบ (ไม่รวม Image Prompt — writer ไม่ยุ่งกับรูป) */
export interface WriterRequiredCE {
  businessSkill: unknown
  masterPrompt: unknown
  articleBrief: unknown
  validatorPack: unknown
}

const WRITER_REQUIRED_LABELS: Record<keyof WriterRequiredCE, string> = {
  businessSkill: 'Business Skill',
  masterPrompt: 'Master Prompt',
  articleBrief: 'Article Brief',
  validatorPack: 'Validator Pack',
}

/** ชื่อไทยของ layer ที่ยังไม่ตั้งค่า (ว่าง = ครบ เขียนได้) */
export function missingWriterLayers(ce: WriterRequiredCE): string[] {
  return (Object.keys(WRITER_REQUIRED_LABELS) as (keyof WriterRequiredCE)[])
    .filter((k) => !ce[k])
    .map((k) => WRITER_REQUIRED_LABELS[k])
}

/** system prompt = Master Prompt + Business Skill + Article Brief + Validator Pack เรียงตามลำดับ CE (ห้ามแต่งเอง) */
export function buildWriterSystemPrompt(ce: WriterCELayers): string {
  return (
    ce.masterPrompt +
    '\n\n# Business Skill\n' + ce.businessSkill +
    '\n\n# Article Brief\n' + ce.articleBrief +
    '\n\n# Validator Pack (ตรวจตัวเองก่อนส่ง)\n' + ce.validatorPack
  )
}

export interface WriterTask {
  keyword: UploadKeyword
  links: UploadLinkPair[]
  /** ภาษาของบทความนี้ (resolve จากโหมดภาษาของลูกค้า + title/keyword แล้ว) — ไม่ส่ง = ไม่กำหนด */
  language?: 'th' | 'en'
  /** ชื่อลูกค้า/แบรนด์ — ใช้ตอนวิเคราะห์ intent เอง (keyword ที่มีชื่อแบรนด์ = navigational) */
  brandNames?: string[]
  /** PBN Backlinks: เขียนหลายบทความจาก title + keyword เดียวกัน — เวอร์ชันที่ index จาก total (total ≤ 1 = ไม่แนบอะไร) */
  variant?: { index: number; total: number }
}

/** มุมเล่าเรื่องของแต่ละเวอร์ชัน (PBN) — เวอร์ชันเดียวกันได้มุมเดิมเสมอ เขียนซ้ำก็ไม่ชนกับเวอร์ชันอื่น */
export const VARIANT_ANGLES: readonly string[] = [
  'คู่มือแบบครบถ้วน ไล่ทีละหัวข้อจากพื้นฐานไปถึงรายละเอียด',
  'เริ่มจากปัญหาที่ผู้อ่านเจอ แล้วพาไปสู่ทางแก้ทีละขั้น',
  'เปรียบเทียบตัวเลือก/แนวทาง ข้อดีข้อจำกัด และเหมาะกับใคร',
  'เล่าผ่านสถานการณ์ตัวอย่างที่ผู้อ่านนึกภาพตามได้',
  'เช็กลิสต์ที่ผู้อ่านนำไปทำตามได้ทันที',
  'ถาม-ตอบ ตอบคำถามที่คนสงสัยจริงเป็นแกนของบทความ',
  'ข้อผิดพลาดที่พบบ่อยและวิธีหลีกเลี่ยง',
  'มุมงบประมาณ ความคุ้มค่า และสิ่งที่ควรรู้ก่อนตัดสินใจ',
  'สำหรับมือใหม่ อธิบายศัพท์และเหตุผลแบบเข้าใจง่าย',
  'สรุปกระชับ ประเด็นสำคัญก่อน แล้วค่อยขยายรายละเอียด',
]

/** บล็อกสั่งให้เขียนเวอร์ชันนี้ให้ต่างจากเวอร์ชันอื่น แต่ยังตอบ intent เดียวกัน — '' ถ้าไม่ได้เขียนหลายเวอร์ชัน */
export function variantBlock(variant: WriterTask['variant']): string {
  if (!variant || variant.total <= 1) return ''
  const index = Math.min(Math.max(1, Math.floor(variant.index)), variant.total)
  const angle = VARIANT_ANGLES[(index - 1) % VARIANT_ANGLES.length]
  return [
    `# เวอร์ชันที่ ${index} จาก ${variant.total} (บทความชุดนี้จะขึ้นคนละเว็บ ต้องไม่ซ้ำกัน)`,
    `- มุมเล่าของเวอร์ชันนี้: ${angle}`,
    '- ใช้ H1 / หัวข้อ / keyword หลัก / Search Intent เดียวกับที่กำหนดด้านบน — ผู้อ่านต้องได้คำตอบเรื่องเดียวกัน',
    '- โครงหัวข้อ H2/H3 ลำดับเนื้อหา บทนำ ตัวอย่าง คำถาม FAQ และสำนวน ต้องต่างจากเวอร์ชันอื่นอย่างชัดเจน',
    '- ห้ามใช้ประโยคซ้ำหรือเรียบเรียงใหม่จากบทความเวอร์ชันอื่น เขียนใหม่ทั้งหมด',
    '- ข้อเท็จจริง ตัวเลข ราคา ชื่อบริการ ยังต้องมาจาก Business Skill เท่านั้น ห้ามแต่งเพิ่มเพื่อให้ต่าง',
  ].join('\n')
}

/** โน้ตจากทีม (ช่อง Note แท็บ Keyword) ยาวสุดที่ส่งให้ writer */
export const WRITER_NOTE_MAX = 2000

/** user prompt: บรีฟงาน + ลิงก์ภายในที่ต้องแทรก + สัญญารูปแบบผลลัพธ์ (output format contract) */
export function buildWriterUserPrompt(task: WriterTask): string {
  const { keyword, links } = task
  const linkLines = links.length
    ? links.map((l) => `- anchor: "${l.keyword || keyword.keyword}" → url: ${l.url}`).join('\n')
    : '(ไม่มี internal link ให้ใช้รอบนี้)'

  const lines: string[] = [
    '# งานที่ต้องทำ',
    'เขียนบทความ SEO เต็มบทความ 1 ชิ้น ตาม Business Skill / Master Prompt / Article Brief / Validator Pack ด้านบนอย่างเคร่งครัด',
    '',
    `- Keyword หลัก: ${keyword.keyword}`,
  ]
  if (keyword.title) lines.push(`- หัวข้อบทความ (ใช้เป็น <h1> คำต่อคำ): ${keyword.title}`)
  lines.push(`- Slug: ${keyword.slug || '(ไม่ระบุ)'}`)
  lines.push(`- Search Intent: ${keyword.intent || '(ไม่ได้ระบุมา — ดู Mars Article Intent Skill ด้านล่าง)'}`)
  lines.push(`- ประเภทบทความ: ${keyword.articleType || '(ไม่ระบุ)'}`)
  if (task.language) {
    lines.push(task.language === 'en'
      ? '- ภาษาของบทความ: อังกฤษทั้งบทความ (Write the whole article, meta description and FAQ in natural English)'
      : '- ภาษาของบทความ: ไทยทั้งบทความ (คงชื่อเฉพาะ/ชื่อแบรนด์ภาษาอังกฤษไว้ได้)')
  }
  // Note ว่าง = ไม่แนบอะไรเลย, มีข้อความ = ทีมสั่งเพิ่มสำหรับบทความนี้ ต้องทำตาม (เจ้าของสั่ง 2026-09-28)
  const note = (keyword.note || '').trim().slice(0, WRITER_NOTE_MAX)
  if (note) {
    lines.push('')
    lines.push('# หมายเหตุจากทีมสำหรับบทความนี้ (ต้องทำตาม ถ้าขัดกับ Article Brief ให้ยึดหมายเหตุนี้ แต่ข้อเท็จจริงยังต้องมาจาก Business Skill เท่านั้น)')
    lines.push(note)
  }
  // Mars Article Intent Skill — ให้เนื้อหาตรงกับ Search Intent + ประเภทบทความ (ไม่มีทั้งคู่ = โหมดพื้นฐาน วิเคราะห์จาก keyword)
  // intent ติดมา = ใช้ตามนั้น · ไม่มี = วิเคราะห์จาก keyword/title (ดู src/lib/intent-classify.ts)
  const intentSkill = articleIntentSkillBlock({
    intent: keyword.intent,
    articleType: keyword.articleType,
    keyword: keyword.keyword,
    title: keyword.title,
    brandNames: task.brandNames,
  })
  if (intentSkill) {
    lines.push('')
    lines.push(intentSkill)
  }
  // Mars Human Voice Skill — skill หลักแนบทุกครั้งที่เขียน (เจ้าของสั่ง 2026-09-28): อ่านรู้เรื่อง ได้ใจความ รวม H1/meta
  lines.push('')
  lines.push(humanVoiceSkillBlock(task.language ?? 'th'))
  lines.push('')
  lines.push('# Internal Link ที่ต้องแทรกในเนื้อหา (ใช้แต่ละลิงก์ไม่เกิน 1 ครั้ง แทรก anchor text ให้เนียนเข้ากับประโยค ห้ามยัดทุกลิงก์ในย่อหน้าเดียว)')
  lines.push(linkLines)
  const variantText = variantBlock(task.variant)
  if (variantText) {
    lines.push('')
    lines.push(variantText)
  }
  lines.push('')
  lines.push('# OUTPUT FORMAT CONTRACT (ต้องตอบตามนี้เป๊ะ ๆ)')
  lines.push('บรรทัดแรก:')
  lines.push('META_DESCRIPTION: <คำโปรยไม่เกิน 155 ตัวอักษร>')
  lines.push('บรรทัดถัดไป:')
  lines.push('---HTML---')
  lines.push('ตามด้วย semantic HTML ล้วน ๆ เท่านั้น (ห้ามมี markdown code fence เช่น ``` ห้ามมีคำอธิบายอื่นปน):')
  lines.push(`- มี <h1> เดียวเท่านั้น (${keyword.title ? `ใช้ข้อความ "${keyword.title}" เป๊ะ ๆ` : 'ตั้งตามหัวข้อบทความที่เหมาะกับ keyword'})`)
  lines.push('- โครงสร้างใช้ <h2>/<h3>, <p>, <ul>/<ol>/<li>, <table>, <strong>/<em>, <a href="...">')
  lines.push('- ส่วน FAQ ให้ทำเป็น <h2> ที่มีคำว่า "FAQ" หรือ "คำถามที่พบบ่อย" ตามด้วยแต่ละคำถามเป็น <h3> และคำตอบเป็น <p>')
  lines.push('- ห้ามมี <style>, inline style (style="..."), class="...", <html>, <body>, รูปภาพ (<img>) เด็ดขาด')

  return lines.join('\n')
}

export interface ParsedWriterOutput {
  metaDescription: string
  html: string
}

function stripFences(s: string): string {
  return s.trim().replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim()
}

/** parse ผลลัพธ์ดิบจาก AI → { metaDescription, html } — ทนกรณีไม่มี ---HTML--- และมี ``` โผล่มาปน */
export function parseWriterOutput(raw: string): ParsedWriterOutput {
  const text = stripFences(raw)

  const metaMatch = /^META_DESCRIPTION:\s*(.*)$/im.exec(text)
  const metaDescription = metaMatch ? metaMatch[1].trim().slice(0, 155) : ''

  const delimIdx = text.indexOf('---HTML---')
  let html: string
  if (delimIdx >= 0) {
    html = text.slice(delimIdx + '---HTML---'.length)
  } else if (metaMatch) {
    html = text.slice(metaMatch.index + metaMatch[0].length)
  } else {
    html = text
  }

  return { metaDescription, html: stripFences(html) }
}

// ─── เขียนให้จบ: บทความยาวจนชน max_tokens / FAQ ขาด ─────────────────────────────
// ไม่แก้ prompt ของ Content Engine — รอบเสริมส่ง system + user เดิมทุกคำ แล้วต่อด้วยคำสั่งเทคนิคสั้น ๆ ด้านล่าง

/** รอบเขียนต่อสูงสุดเมื่อชน max_tokens (ยังไม่จบอีก = ล้มเหลว ให้ทีมกดเขียนใหม่) */
export const WRITER_MAX_CONTINUATIONS = 2
/** FAQ ต้องมีอย่างน้อยกี่ข้อถึงนับว่ามี FAQ — ต่ำกว่านี้ (0 หรือ 1 ข้อ) เขียนส่วน FAQ ใหม่ทั้งส่วน */
export const WRITER_MIN_FAQ_ITEMS = 2

/** สตรีมจบเพราะชน max_tokens = เนื้อหาถูกตัดกลางทาง */
export function isTruncatedFinish(finishReason: string | undefined): boolean {
  return finishReason === 'length' || finishReason === 'max_tokens' || finishReason === 'max_output_tokens'
}

/** คำสั่งเขียนต่อจากจุดที่ถูกตัด (ส่งหลังข้อความ assistant ที่เขียนค้างไว้) */
export function buildContinuePrompt(language: 'th' | 'en' | undefined): string {
  return [
    'คำตอบก่อนหน้าถูกตัดกลางทางเพราะยาวเกินขีดจำกัด — เขียนต่อจากตัวอักษรสุดท้ายทันทีจนจบบทความ (รวมส่วน FAQ ตามสัญญารูปแบบเดิม)',
    '- ห้ามเขียนซ้ำส่วนที่เขียนไปแล้ว ห้ามขึ้นต้นใหม่ ห้ามมี META_DESCRIPTION หรือ ---HTML--- อีก',
    '- ถ้าถูกตัดกลางแท็กหรือกลางประโยค ให้ต่อจากตรงนั้นเลย',
    `- ภาษาเดิมของบทความ (${language === 'en' ? 'English' : 'ไทย'}) ตอบเป็น HTML ล้วนตามกฎเดิม`,
  ].join('\n')
}

/** คำสั่งเขียนส่วน FAQ ใหม่ทั้งส่วน (บทความเขียนจบแล้ว แต่ไม่มี FAQ หรือมีแค่ข้อเดียว) */
export function buildFaqFillPrompt(language: 'th' | 'en' | undefined): string {
  return [
    'บทความด้านบนส่วน FAQ ขาดหรือไม่ครบ — เขียนเฉพาะส่วน FAQ ใหม่ทั้งส่วนสำหรับบทความนี้',
    '- จำนวนคำถามและรูปแบบคำตอบตาม Business Skill / Master Prompt / Article Brief / Validator Pack ด้านบน ถ้าไม่ได้กำหนดจำนวน ให้ครอบคลุมคำถามสำคัญที่ผู้อ่านของ keyword นี้น่าจะถามจริง (มากกว่า 1 ข้อ)',
    '- ข้อเท็จจริงต้องมาจาก Business Skill และเนื้อหาบทความเท่านั้น ห้ามแต่งตัวเลข/ราคา/ข้อมูลใหม่',
    `- ภาษา: ${language === 'en' ? 'English' : 'ไทย'} และใช้น้ำเสียงเดียวกับบทความ`,
    '- ตอบเป็น HTML ล้วน ขึ้นต้นด้วย <h2> ที่มีคำว่า "FAQ" หรือ "คำถามที่พบบ่อย" ตามด้วยแต่ละคำถามเป็น <h3> และคำตอบเป็น <p>',
    '- ห้ามมีส่วนอื่นของบทความ ห้ามมี META_DESCRIPTION, ---HTML---, markdown code fence, style, class',
  ].join('\n')
}

/** ส่วนที่เขียนต่อ — ตัด fence/หัวสัญญาที่โมเดลอาจใส่มาซ้ำ ก่อนต่อท้ายข้อความเดิม */
export function cleanContinuation(raw: string): string {
  return raw
    .replace(/^\s*```[a-z]*\n?/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^\s*META_DESCRIPTION:.*\n?/i, '')
    .replace(/^\s*---HTML---\s*\n?/, '')
}

/** HTML ส่วน FAQ ที่ได้จากรอบเติม FAQ — ตัด fence และข้อความนอกแท็กก่อน <h2> แรก */
export function cleanFaqFill(raw: string): string {
  const text = stripFences(raw)
  const idx = text.search(/<h2[\s>]/i)
  if (idx === -1) return ''
  const faq = text.slice(idx)
  // โมเดลแถมหัวข้ออื่นต่อท้าย (เช่น สรุป) — เก็บแค่ส่วน FAQ
  const next = faq.slice(3).search(/<h2[\s>]/i)
  return (next === -1 ? faq : faq.slice(0, next + 3)).trim()
}
