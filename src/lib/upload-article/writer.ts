// ─── Upload Article — เขียนบทความจริงจาก Content Engine + keyword ────────────────
// ฟังก์ชันล้วน (prompt building / parsing ผลลัพธ์) — เรียกตรงจาก unit test ได้
// งาน DB/stream จริงอยู่ที่ route (ต้องใช้ prisma + orChatStream ตรง ๆ)

import type { UploadKeyword, UploadLinkPair } from './types'

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
}

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
  lines.push(`- Search Intent: ${keyword.intent || '(ไม่ระบุ)'}`)
  lines.push(`- ประเภทบทความ: ${keyword.articleType || '(ไม่ระบุ)'}`)
  if (keyword.note) lines.push(`- โน้ตเพิ่มเติมจากทีม: ${keyword.note}`)
  lines.push('')
  lines.push('# Internal Link ที่ต้องแทรกในเนื้อหา (ใช้แต่ละลิงก์ไม่เกิน 1 ครั้ง แทรก anchor text ให้เนียนเข้ากับประโยค ห้ามยัดทุกลิงก์ในย่อหน้าเดียว)')
  lines.push(linkLines)
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
