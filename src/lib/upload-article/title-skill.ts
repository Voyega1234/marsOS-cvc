// ─── Upload Article — Title Skill ของปุ่ม "ให้ Mars เขียนใหม่" / "ให้ Mars เติมช่องที่ว่าง" (แท็บ Keyword) ───
// เจ้าของสั่ง 2026-09-28: title ที่ได้อ่านไม่ต่อเนื่อง ไม่มีความหมาย เช่น keyword "ปลวกหน้าตาเป็นยังไง"
// ได้ title "ปลวกหน้าตาเป็นยังไง สังเกตลักษณะและแยกจากมด" (เอา keyword มาแปะแล้วต่อวลีห้วน ๆ)
// skill นี้คือวิธีคิดของบรรณาธิการตอนตั้งชื่อ: ต้องเป็นประโยคเดียวที่อ่านออกเสียงแล้วลื่น มีคำเชื่อม มีความหมายครบ
// ใช้คู่กับกฎภาษามนุษย์ใน human-voice.ts (ห้ามโคลอน/คำติดปาก ฯลฯ) — ไฟล์นี้เพิ่ม "ความต่อเนื่อง" ซึ่งกฎเดิมไม่ครอบคลุม

import { humanTitleRulesBlock, titleLooksMachineWritten } from './human-voice'

export const TITLE_SKILL_NAME = 'Mars Title Skill'

/** ขั้นคิดก่อนตั้งชื่อ (ภาษาไทย) */
const TITLE_SKILL_STEPS_TH = [
  'อ่าน keyword แล้วตอบให้ได้ก่อนว่าคนค้นคำนี้อยากรู้อะไรจริง ๆ (ปัญหา คำถาม หรือสิ่งที่อยากทำให้ได้)',
  'ตั้งชื่อเป็น "ประโยคเดียว" ที่พูดกับผู้อ่านได้จริง อ่านออกเสียงแล้วลื่น ไม่สะดุด ไม่ต้องเดาความหมาย',
  'ส่วนต่อท้าย keyword ต้องต่อความกันด้วยคำเชื่อม เช่น และ แล้ว ให้ ว่า จะ ทำไม ยังไง แบบไหน ตรงไหน เพราะ พร้อม ถึง',
  'ถ้าอยากบอกสองเรื่องในชื่อเดียว ให้เชื่อมเป็นประโยคเดียว เช่น "…แบบไหน และดูยังไงให้รู้ว่า…" ไม่ใช่วางวลีสองก้อนติดกัน',
  'คงคำหลักของ keyword ไว้ แต่ปรับลำดับหรือเติมคำให้ถูกไวยากรณ์ได้ ห้ามเอา keyword มาแปะหน้าแล้วต่อด้วยวลีคำกริยาห้วน ๆ',
  'ห้ามเรียงคำกริยาลอย ๆ ไม่มีประธาน/ไม่มีคำเชื่อม เช่น "สังเกตลักษณะและแยกจากมด" "เลือกใช้และดูแลรักษา"',
  'ตรวจก่อนส่ง: ถ้าเพื่อนที่ไม่รู้เรื่องอ่านแล้วเข้าใจทันทีว่าบทความพาไปรู้อะไร และพูดประโยคนี้ออกมาได้เป็นธรรมชาติ ถึงจะใช้ได้',
]

/** ตัวอย่างเทียบ (แย่ → ดี) — ให้เห็นรูปแบบ ไม่ให้ลอกคำ */
const TITLE_SKILL_EXAMPLES_TH: { keyword: string; bad: string; good: string }[] = [
  { keyword: 'ปลวกหน้าตาเป็นยังไง', bad: 'ปลวกหน้าตาเป็นยังไง สังเกตลักษณะและแยกจากมด', good: 'ปลวกหน้าตาเป็นยังไง และดูยังไงให้รู้ว่าไม่ใช่มด' },
  { keyword: 'กำจัดปลวกด้วยตัวเอง', bad: 'กำจัดปลวกด้วยตัวเอง วิธีทำและข้อควรระวัง', good: 'กำจัดปลวกด้วยตัวเองทำได้แค่ไหน และเมื่อไหร่ควรเรียกช่าง' },
  { keyword: 'คอนโดใกล้ BTS', bad: 'คอนโดใกล้ BTS เลือกทำเลและเปรียบเทียบราคา', good: 'เลือกคอนโดใกล้ BTS ยังไงให้คุ้มทั้งทำเลและราคา' },
  { keyword: 'ทำฟันคุด', bad: 'ทำฟันคุด ขั้นตอน ราคา การดูแล', good: 'ทำฟันคุดเจ็บไหม ต้องเตรียมตัวยังไง และหลังผ่าต้องดูแลแบบไหน' },
]

/** ขั้นคิดก่อนตั้งชื่อ (ภาษาอังกฤษ) — ใช้เมื่อ keyword เป็นภาษาอังกฤษ */
const TITLE_SKILL_STEPS_EN = [
  'Work out what the searcher actually wants to know before writing.',
  'Write one natural sentence a person would say out loud, not a keyword followed by a loose fragment.',
  'Join ideas with real connectors (and, so, how, why, what, when) instead of stacking bare verb phrases.',
  'No colon or dash splitting the title into two halves, no clickbait, no filler like "Ultimate Guide", "Everything You Need to Know", "Unlock".',
]

export interface TitleSkillOptions {
  /** ภาษาของลูกค้า: th = ไทยเท่านั้น, en = อังกฤษเท่านั้น, both = ตามภาษาของ keyword แต่ละคำ */
  language: 'th' | 'en' | 'both'
}

/** ข้อความ skill ที่แนบใน system prompt ของการตั้ง title */
export function titleSkillBlock(opts: TitleSkillOptions): string {
  const lines: string[] = [`════ ${TITLE_SKILL_NAME} — วิธีตั้งชื่อบทความให้เป็นภาษาคน อ่านต่อเนื่อง มีความหมาย ════`]
  lines.push(...TITLE_SKILL_STEPS_TH.map((s, i) => `${i + 1}. ${s}`))
  lines.push('ตัวอย่าง (ดูรูปแบบ ห้ามลอกคำ):')
  for (const ex of TITLE_SKILL_EXAMPLES_TH) {
    lines.push(`- keyword "${ex.keyword}" ✗ "${ex.bad}" ✓ "${ex.good}"`)
  }
  lines.push('กฎภาษาเพิ่มเติม:', humanTitleRulesBlock())
  if (opts.language !== 'th') {
    lines.push('For English keywords:', ...TITLE_SKILL_STEPS_EN.map((s) => `- ${s}`))
  }
  lines.push(
    opts.language === 'th'
      ? 'ภาษาของ title: ไทยเท่านั้น (keyword ภาษาอังกฤษให้ตั้งชื่อเป็นภาษาไทย คงชื่อเฉพาะ/ชื่อแบรนด์ไว้ได้)'
      : opts.language === 'en'
        ? 'Title language: English only (translate the intent of Thai keywords into a natural English title).'
        : 'ภาษาของ title: ใช้ภาษาเดียวกับ keyword นั้น (keyword ไทย = title ไทย, keyword อังกฤษ = title อังกฤษ)',
  )
  return lines.join('\n')
}

/** คำที่ทำให้ส่วนต่อท้าย keyword เป็นประโยคต่อเนื่อง (ใช้ตรวจ title ที่ "แปะ keyword แล้วต่อวลีห้วน ๆ") */
const TH_CONNECTORS = [
  'และ', 'แล้ว', 'ให้', 'ว่า', 'จะ', 'ทำไม', 'ยังไง', 'อย่างไร', 'แบบไหน', 'ตรงไหน', 'เพราะ', 'พร้อม', 'ถึง', 'ก่อน', 'หลัง',
  'ที่', 'ของ', 'กับ', 'ใน', 'สำหรับ', 'เมื่อ', 'ถ้า', 'หรือ', 'ต้อง', 'ควร', 'ได้', 'ไหม', 'มั้ย', 'เท่าไหร่', 'กี่', 'ดูยังไง', 'รู้ได้ยังไง', 'คือ', 'เป็น',
]

/**
 * title ที่เป็นรูป "keyword + ช่องว่าง + วลีห้วน ๆ" (ไม่มีคำเชื่อมนำหน้าส่วนต่อท้าย) — อ่านแล้วไม่ต่อเนื่อง
 * ใช้ตัดสินใจขอตั้งใหม่อีกรอบ ไม่ได้ใช้บล็อกผลลัพธ์
 */
export function titleReadsDisjointed(title: string, keyword: string): boolean {
  const t = title.trim()
  const k = keyword.trim()
  if (!t || !k || !/[฀-๿]/.test(k)) return false
  if (!t.toLowerCase().startsWith(k.toLowerCase())) return false
  const rest = t.slice(k.length)
  if (!/^\s+/.test(rest)) return false
  const tail = rest.trim()
  if (!tail) return false
  return !TH_CONNECTORS.some((c) => tail.startsWith(c))
}

/** title ที่ต้องขอตั้งใหม่: ร่องรอย AI (โคลอน/คำติดปาก) หรืออ่านไม่ต่อเนื่อง */
export function titleNeedsRewrite(title: string, keyword: string): string | null {
  if (titleLooksMachineWritten(title)) return 'title เดิมมีรูปแบบที่คนอ่านรู้ว่าเครื่องเขียน (โคลอน/ขีดยาว/คำติดปาก) ห้ามใช้รูปแบบเดิม'
  if (titleReadsDisjointed(title, keyword)) return 'title เดิมเอา keyword มาแปะแล้วต่อวลีห้วน ๆ อ่านไม่ต่อเนื่อง ให้เขียนเป็นประโยคเดียวที่มีคำเชื่อม อ่านแล้วเข้าใจทันที'
  return null
}
