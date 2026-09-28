// ─── Upload Article — กฎ "ภาษามนุษย์" ที่ทุก prompt ของเมนูนี้ต้องแนบไปด้วย ─────────
// เจ้าของสั่ง 2026-09-28: บทความต้องอ่านแล้วเหมือนคนเขียน ไม่ใช่ AI โดยเฉพาะ Title/H1 แต่ใช้กับทุกส่วน
// ไม่ใช่ prompt สำรองแทน Content Engine — เป็นข้อบังคับรูปแบบภาษาเพิ่มจาก layer ใน DB เสมอ (เหมือนสัญญารูปแบบ HTML)

/** สำนวนที่คนอ่านจับได้ทันทีว่า AI เขียน — ใช้ทั้งใน prompt และตรวจ title หลังได้ผล */
export const AI_TELL_PHRASES_TH = [
  'ในยุคปัจจุบัน',
  'ในยุคดิจิทัล',
  'ในโลกปัจจุบัน',
  'ไม่ว่าจะเป็น',
  'ครบจบในที่เดียว',
  'ครบวงจร',
  'ฉบับสมบูรณ์',
  'คู่มือฉบับ',
  'เจาะลึก',
  'ปลดล็อก',
  'ไขข้อสงสัย',
  'ที่คุณต้องรู้',
  'ที่คุณไม่ควรพลาด',
  'มาดูกัน',
  'มาทำความรู้จัก',
  'อย่างมีประสิทธิภาพ',
  'ยกระดับ',
  'ขั้นเทพ',
  'สรุปครบ',
  'ทุกสิ่งที่',
] as const

/** กฎภาษาสำหรับ Title/H1/Meta Title */
export const HUMAN_TITLE_RULES_TH = [
  'ตั้งชื่อแบบที่บรรณาธิการคนไทยตั้งจริง: อ่านเป็นประโยคธรรมชาติ ตรงประเด็น บอกว่าผู้อ่านจะได้อะไร',
  'ห้ามรูปแบบ "หัวข้อ: คำขยาย" ที่ใช้โคลอนหรือขีดยาว (— –) คั่นสองท่อน และห้ามต่อท้ายด้วยคำโปรยลอย ๆ',
  'ห้ามคำฟุ่มเฟือยแบบ AI เช่น ' + AI_TELL_PHRASES_TH.slice(0, 14).map((p) => `"${p}"`).join(', '),
  'ห้ามอีโมจิ ห้ามเครื่องหมาย ! ห้ามตัวเลขปีถ้า keyword ไม่มีปี ห้ามคำเกินจริง (ที่สุด, อันดับ 1, 100%)',
  'ใช้เครื่องหมายคำถามได้เฉพาะเมื่อ keyword เป็นคำถามจริง ๆ',
]

/** กฎภาษาสำหรับเนื้อบทความทั้งหมด (ย่อหน้า หัวข้อ FAQ meta description) */
export const HUMAN_BODY_RULES_TH = [
  'เขียนเหมือนคนที่รู้เรื่องนั้นจริงคุยกับผู้อ่าน ใช้ภาษาพูดที่สุภาพ ประโยคสั้นยาวสลับกัน ไม่เป็นทางการแข็ง ๆ',
  'เปิดบทความด้วยสิ่งที่ผู้อ่านเจออยู่จริงหรือคำตอบตรง ๆ ห้ามเปิดด้วยการปูพื้นกว้าง ๆ เช่น "ในยุคปัจจุบัน…" หรือ "…เป็นสิ่งที่หลายคนให้ความสำคัญ"',
  'ห้ามใช้สำนวนติดปาก AI: ' + AI_TELL_PHRASES_TH.map((p) => `"${p}"`).join(', '),
  'ห้ามขึ้นต้นย่อหน้าซ้ำแบบเดียวกัน ห้ามลงท้ายทุกหัวข้อด้วยประโยคสรุปซ้ำเนื้อหา ห้ามเรียงคุณศัพท์สามคำติดกัน (เช่น ปลอดภัย รวดเร็ว และมีประสิทธิภาพ)',
  'ห้ามใช้ขีดยาว (— –) และอีโมจิ ใช้ bullet เฉพาะเมื่อเป็นรายการจริง ไม่แตกทุกอย่างเป็น bullet',
  'ใส่รายละเอียดที่จับต้องได้ (ตัวเลข ขั้นตอน ตัวอย่างสถานการณ์ ข้อควรระวัง) แทนคำคุณศัพท์กว้าง ๆ',
  'หัวข้อ H2/H3 ใช้ภาษาคนพูด สั้น ชัด ห้ามรูปแบบ "หัวข้อ: คำขยาย"',
  'ย่อหน้าสรุปท้ายบทความห้ามขึ้นต้นด้วย "โดยสรุป" "สรุปแล้ว" หรือ "ท้ายที่สุดนี้"',
]

export function humanTitleRulesBlock(): string {
  return HUMAN_TITLE_RULES_TH.map((r) => `- ${r}`).join('\n')
}

export function humanBodyRulesBlock(): string {
  return HUMAN_BODY_RULES_TH.map((r) => `- ${r}`).join('\n')
}

/** title ที่ยังมีร่องรอย AI ชัด ๆ (ใช้ตัดสินใจขอให้ AI ตั้งใหม่อีกรอบ) */
export function titleLooksMachineWritten(title: string): boolean {
  const t = title.trim()
  if (!t) return false
  if (/[:：—–]/.test(t)) return true
  if (/!|[\uD83C-\uD83E][\uDC00-\uDFFF]/.test(t)) return true
  return AI_TELL_PHRASES_TH.some((p) => t.includes(p))
}

// ─── แนบกฎภาษามนุษย์ไว้ใน Master Prompt ของลูกค้า (เก็บใน DB แก้ต่อได้ใน Content Engine) ───
// เจ้าของสั่ง 2026-09-28: ไม่ฝังตอนเขียน แต่แนบใน Master Prompt ทุกอันแทน
// แนบตอน seed จาก Studio / เพิ่ม layer ใหม่ / สร้างจากบทความตัวอย่าง / สั่ง AI แก้ — ถ้ามีหัวข้อนี้อยู่แล้วไม่แนบซ้ำ

export const HUMAN_VOICE_HEADING = '════ ภาษาต้องอ่านแล้วเหมือนคนเขียน ไม่ใช่ AI ════'
const HUMAN_VOICE_JSON_KEY = 'human_voice_rules'

export function humanVoiceSection(): string {
  return [
    HUMAN_VOICE_HEADING,
    'บังคับทุกส่วน รวมถึง H1 หัวข้อ H2/H3 คำถาม FAQ และ Meta Description',
    humanBodyRulesBlock(),
    'กฎตั้งชื่อ H1 / Title:',
    humanTitleRulesBlock(),
  ].join('\n')
}

/** แนบกฎภาษามนุษย์ท้าย Master Prompt ถ้ายังไม่มี — Master Prompt แบบ JSON ใส่เป็น key แยก */
export function withHumanVoice(promptText: string): string {
  const text = promptText.trim()
  if (!text || text.includes(HUMAN_VOICE_HEADING)) return text
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        if (HUMAN_VOICE_JSON_KEY in obj) return text
        return JSON.stringify({ ...obj, [HUMAN_VOICE_JSON_KEY]: [...HUMAN_BODY_RULES_TH, ...HUMAN_TITLE_RULES_TH.map((r) => `H1/Title: ${r}`)] }, null, 2)
      }
    } catch {
      /* ไม่ใช่ JSON จริง — แนบเป็นข้อความตามปกติ */
    }
  }
  return `${text}\n\n${humanVoiceSection()}`
}
