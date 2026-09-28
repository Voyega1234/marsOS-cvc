// ─── Mars Human Voice Skill — บทความและชื่อเรื่องต้องอ่านแล้วเหมือนคนเขียน อ่านรู้เรื่อง ได้ใจความ ───
// เจ้าของสั่ง 2026-09-28: "ปรับให้เขียนเป็นภาษามนุษย์อ่านเข้าใจ ไม่ใช่เรียงประโยคเป็น AI อ่านไม่รู้เรื่อง ไม่ได้ใจความ
// รวมถึง title ด้วย แก้ทุกจุดที่เขียนบทความ ทำเป็น skill หลักตอนกดเขียนบทความทุกครั้ง"
// → แนบทุกครั้งที่สั่งเขียนบทความ/ตั้งชื่อเรื่อง ทุกหน้า (Upload Article, Clients, Clients Lab, Studio, WordGod, Articles)
// ไม่ใช่ prompt สำรองแทน Content Engine — เป็นข้อบังคับรูปแบบภาษาเพิ่มจาก layer ใน DB เสมอ (เหมือนสัญญารูปแบบ HTML)
// pure text builder: ไม่เรียก DB/AI

export const HUMAN_VOICE_SKILL_NAME = 'Mars Human Voice Skill'

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

export const AI_TELL_PHRASES_EN = [
  "in today's world",
  'in the digital age',
  'ever-evolving',
  'unlock',
  'delve',
  'dive into',
  'game-changer',
  'look no further',
  'the ultimate guide',
  'everything you need to know',
  'navigate the',
  'seamless',
  'elevate',
  'in conclusion',
] as const

/** กฎภาษาสำหรับ Title/H1/Meta Title (ภาษาไทย) — ข้อแรกห้ามแก้ข้อความ (ใช้ตรวจว่า Master Prompt มีกฎแล้ว) */
export const HUMAN_TITLE_RULES_TH = [
  'ตั้งชื่อแบบที่บรรณาธิการคนไทยตั้งจริง: อ่านเป็นประโยคธรรมชาติ ตรงประเด็น บอกว่าผู้อ่านจะได้อะไร',
  'ชื่อเรื่องต้องเป็นวลีหรือประโยคที่อ่านออกเสียงแล้วรู้เรื่องในครั้งเดียว ใส่ keyword แบบที่คนพูดจริง ห้ามเอาคำค้นมาเรียงต่อกันเป็นก้อน (เช่น "คอนโด ราคา ถูก กรุงเทพ ใกล้ BTS 2026") และห้ามยัดคำเดิมซ้ำ',
  'ห้ามรูปแบบ "หัวข้อ: คำขยาย" ที่ใช้โคลอนหรือขีดยาว (— –) คั่นสองท่อน และห้ามต่อท้ายด้วยคำโปรยลอย ๆ',
  'ห้ามคำฟุ่มเฟือยแบบ AI เช่น ' + AI_TELL_PHRASES_TH.slice(0, 14).map((p) => `"${p}"`).join(', '),
  'ห้ามอีโมจิ ห้ามเครื่องหมาย ! ห้ามตัวเลขปีถ้า keyword ไม่มีปี ห้ามคำเกินจริง (ที่สุด, อันดับ 1, 100%)',
  'ใช้เครื่องหมายคำถามได้เฉพาะเมื่อ keyword เป็นคำถามจริง ๆ',
  'ชื่อเรื่องต้องบอกทิศทางตรงกับ Search Intent: คนอยากรู้ = บอกคำตอบที่จะได้ · คนกำลังเลือก = บอกว่าช่วยเลือก/เทียบ · คนพร้อมซื้อ = บอกราคา/บริการ/วิธีติดต่อ',
]

/** กฎภาษาสำหรับเนื้อบทความทั้งหมด (ย่อหน้า หัวข้อ FAQ meta description) — ข้อแรกห้ามแก้ข้อความ */
export const HUMAN_BODY_RULES_TH = [
  'เขียนเหมือนคนที่รู้เรื่องนั้นจริงคุยกับผู้อ่าน ใช้ภาษาพูดที่สุภาพ ประโยคสั้นยาวสลับกัน ไม่เป็นทางการแข็ง ๆ',
  'ทุกประโยคต้องได้ใจความครบในตัว มีคนทำ/สิ่งที่พูดถึง และมีกริยาชัด อ่านจบแล้วรู้ว่าจะบอกอะไร ห้ามประโยคที่เอาคำนามหรือคำคุณศัพท์มาเรียงต่อกันโดยไม่มีกริยา ห้ามประโยคที่พูดวนไม่มีเนื้อ',
  'ประโยคต่อประโยคต้องเชื่อมกันเป็นเหตุเป็นผล ใช้คำเชื่อมแบบคนพูด (เพราะ, เลย, แต่, ถ้า…ก็, พอ…แล้ว) หนึ่งย่อหน้าพูดเรื่องเดียว ประโยคแรกบอกใจความหลักของย่อหน้า',
  'ใส่ keyword ตรงที่มันเข้ากับประโยคจริง ๆ เท่านั้น ห้ามยัด keyword จนประโยคฝืน ห้ามเอาคำค้นทั้งก้อนมาวางกลางประโยคถ้าคนจริงไม่พูดแบบนั้น',
  'เปิดบทความด้วยสิ่งที่ผู้อ่านเจออยู่จริงหรือคำตอบตรง ๆ ห้ามเปิดด้วยการปูพื้นกว้าง ๆ เช่น "ในยุคปัจจุบัน…" หรือ "…เป็นสิ่งที่หลายคนให้ความสำคัญ"',
  'ห้ามใช้สำนวนติดปาก AI: ' + AI_TELL_PHRASES_TH.map((p) => `"${p}"`).join(', '),
  'ห้ามขึ้นต้นย่อหน้าซ้ำแบบเดียวกัน ห้ามลงท้ายทุกหัวข้อด้วยประโยคสรุปซ้ำเนื้อหา ห้ามเรียงคุณศัพท์สามคำติดกัน (เช่น ปลอดภัย รวดเร็ว และมีประสิทธิภาพ)',
  'ห้ามใช้ขีดยาว (— –) และอีโมจิ ใช้ bullet เฉพาะเมื่อเป็นรายการจริง ไม่แตกทุกอย่างเป็น bullet',
  'ใส่รายละเอียดที่จับต้องได้ (ตัวเลข ขั้นตอน ตัวอย่างสถานการณ์ ข้อควรระวัง) แทนคำคุณศัพท์กว้าง ๆ แต่ตัวเลข ราคา ข้อมูลธุรกิจ ต้องมาจากข้อมูลที่ให้มาเท่านั้น',
  'หัวข้อ H2/H3 ใช้ภาษาคนพูด สั้น ชัด อ่านแล้วรู้ว่าย่อหน้าใต้หัวข้อจะบอกอะไร ห้ามรูปแบบ "หัวข้อ: คำขยาย"',
  'ย่อหน้าสรุปท้ายบทความห้ามขึ้นต้นด้วย "โดยสรุป" "สรุปแล้ว" หรือ "ท้ายที่สุดนี้"',
  'ภาษาไทยต้องถูกไวยากรณ์และสะกดถูก ห้ามแปลตรงตัวจากภาษาอังกฤษ (เช่น "มันเป็นสิ่งสำคัญที่จะ…", "ทำการ…", "ได้รับการ…" ที่ไม่จำเป็น)',
]

export const HUMAN_TITLE_RULES_EN = [
  'Write the title the way a human editor would: a natural phrase or sentence that says plainly what the reader gets',
  'Use the keyword the way people actually say it. Never stack search terms into a noun pile, never repeat the keyword',
  'No "Topic: subtitle" pattern with a colon or dash, no emoji, no "!", no year unless the keyword has one, no hype (best ever, #1, 100%)',
  'Avoid AI clichés such as ' + AI_TELL_PHRASES_EN.slice(0, 10).map((p) => `"${p}"`).join(', '),
  'Match the search intent: a question gets the answer promised, a comparison promises help choosing, a buying keyword mentions price/service/how to get it',
]

export const HUMAN_BODY_RULES_EN = [
  'Write like a knowledgeable person talking to the reader: plain words, varied sentence length, friendly but not sloppy',
  'Every sentence must make a complete, clear point with a real subject and verb. No noun piles, no filler sentences that say nothing',
  'Sentences must connect logically. One idea per paragraph, and the first sentence states that idea',
  'Place the keyword only where it fits naturally. Never force it or repeat it to hit a count',
  'Open with the reader’s real situation or a direct answer, never a broad scene-setting line',
  'Avoid AI clichés: ' + AI_TELL_PHRASES_EN.map((p) => `"${p}"`).join(', '),
  'No em dashes, no emoji, bullets only for real lists, no triple-adjective strings, no paragraph that just restates the heading',
  'Use concrete details (numbers, steps, examples, caveats), but business facts and prices must come only from the provided data',
  'H2/H3 headings are short and plain and tell what the section answers. The closing paragraph must not start with "In conclusion"',
]

export type HumanVoiceLanguage = 'th' | 'en' | 'both'

const list = (rules: readonly string[]) => rules.map((r) => `- ${r}`).join('\n')

export function humanTitleRulesBlock(language: HumanVoiceLanguage = 'th'): string {
  if (language === 'en') return list(HUMAN_TITLE_RULES_EN)
  if (language === 'both') return `${list(HUMAN_TITLE_RULES_TH)}\nถ้าชื่อเรื่องเป็นภาษาอังกฤษ:\n${list(HUMAN_TITLE_RULES_EN)}`
  return list(HUMAN_TITLE_RULES_TH)
}

export function humanBodyRulesBlock(language: HumanVoiceLanguage = 'th'): string {
  if (language === 'en') return list(HUMAN_BODY_RULES_EN)
  if (language === 'both') return `${list(HUMAN_BODY_RULES_TH)}\nถ้าเขียนภาษาอังกฤษ:\n${list(HUMAN_BODY_RULES_EN)}`
  return list(HUMAN_BODY_RULES_TH)
}

/** ขั้นตรวจทานก่อนส่ง — ให้ตัวเขียนอ่านทวนเองแล้วแก้ ไม่ใช่แค่ "พยายาม" ทำตามกฎ */
const SELF_CHECK_TH = [
  'ก่อนส่งงาน ให้อ่านทวนทีละประโยคเหมือนบรรณาธิการ (ห้ามเขียนขั้นตอนนี้ลงในบทความ):',
  '1. อ่านออกเสียงในใจ ประโยคไหนสะดุด ต้องอ่านซ้ำถึงเข้าใจ หรือไม่ได้ใจความ ให้เขียนใหม่ให้ง่ายขึ้น',
  '2. ประโยคไหนขาดกริยา เป็นคำเรียงกัน หรือยัด keyword จนฝืน ให้เรียบเรียงใหม่แบบที่คนพูดจริง',
  '3. ย่อหน้าไหนลบทิ้งแล้วบทความไม่เสียอะไร แปลว่าไม่มีเนื้อ ให้ใส่ข้อมูลที่ใช้ได้จริงแทนหรือตัดออก',
  '4. H1 และหัวข้อทุกหัวข้อ ต้องอ่านแล้วรู้เรื่องทันทีและตรงกับเนื้อหาใต้หัวข้อ',
]

const SELF_CHECK_EN = [
  'Before returning, reread every sentence like an editor (do not write this step into the article):',
  '1. Rewrite any sentence that is awkward, needs a second read, or does not say anything clear',
  '2. Rewrite noun piles, verbless fragments and keyword-stuffed lines the way a person would actually say them',
  '3. Cut or fill any paragraph that adds nothing',
  '4. The H1 and every heading must be instantly clear and match the section below it',
]

/** skill ถูกต่อท้าย prompt ที่มีรูปแบบคำตอบของตัวเอง (JSON/HTML) — ห้ามให้ skill ไปเปลี่ยนรูปแบบนั้น */
const FORMAT_GUARD = (en: boolean) => en
  ? 'This skill governs wording only. Keep the exact output format already required by the task (JSON, HTML, fields); do not add explanations.'
  : 'skill นี้คุมเฉพาะสำนวนภาษา — รูปแบบคำตอบ (JSON/HTML/ช่องข้อมูล) ให้ทำตามที่งานกำหนดไว้เดิมเป๊ะ ๆ ห้ามเขียนคำอธิบายเพิ่ม'

/** skill เต็มสำหรับตัวเขียนบทความ (เนื้อหา + H1/หัวข้อ/meta) — แนบทุกครั้งที่สั่งเขียน */
export function humanVoiceSkillBlock(language: HumanVoiceLanguage = 'th'): string {
  const en = language === 'en'
  return [
    `════ ${HUMAN_VOICE_SKILL_NAME} — ${en ? 'must read like a human wrote it, clear and meaningful' : 'ภาษาต้องอ่านแล้วเหมือนคนเขียน อ่านรู้เรื่อง ได้ใจความ ไม่ใช่ AI'} ════`,
    en
      ? 'Applies to everything: H1, headings, paragraphs, FAQ questions and answers, meta title and meta description. If any other instruction conflicts on wording style, this skill wins; facts still come only from the provided data.'
      : 'บังคับทุกส่วน: H1 หัวข้อ H2/H3 ย่อหน้า คำถาม-คำตอบ FAQ Meta Title และ Meta Description ถ้าคำสั่งอื่นขัดเรื่องสำนวนภาษา ให้ยึด skill นี้ ส่วนข้อเท็จจริงยังต้องมาจากข้อมูลที่ให้มาเท่านั้น',
    en ? 'Body rules:' : 'กฎเนื้อหา:',
    humanBodyRulesBlock(language),
    en ? 'Title / H1 / meta title rules:' : 'กฎตั้งชื่อ H1 / Title / Meta Title:',
    humanTitleRulesBlock(language),
    ...(en ? SELF_CHECK_EN : SELF_CHECK_TH),
    FORMAT_GUARD(en),
  ].join('\n')
}

/** skill สำหรับขั้นตั้งชื่อเรื่องอย่างเดียว (WordGod, Content Map, Upload Title Skill ฯลฯ) */
export function humanTitleSkillBlock(language: HumanVoiceLanguage = 'th'): string {
  const en = language === 'en'
  return [
    `════ ${HUMAN_VOICE_SKILL_NAME} — ${en ? 'titles must read like a human editor wrote them' : 'ชื่อเรื่องต้องอ่านแล้วเหมือนคนตั้ง อ่านรู้เรื่อง ได้ใจความ'} ════`,
    humanTitleRulesBlock(language),
    en
      ? 'Before returning, read each title aloud once. Rewrite any title that is awkward, a keyword pile, or unclear.'
      : 'ก่อนส่ง อ่านชื่อเรื่องทุกอันออกเสียงในใจหนึ่งรอบ อันไหนสะดุด เป็นคำเรียงกัน หรืออ่านแล้วไม่รู้ว่าบทความจะให้อะไร ให้ตั้งใหม่',
    FORMAT_GUARD(en),
  ].join('\n')
}

/** title ที่ยังมีร่องรอย AI ชัด ๆ (ใช้ตัดสินใจขอให้ AI ตั้งใหม่อีกรอบ) */
export function titleLooksMachineWritten(title: string): boolean {
  const t = title.trim()
  if (!t) return false
  if (/[:：—–]/.test(t)) return true
  if (/!|[\uD83C-\uD83E][\uDC00-\uDFFF]/.test(t)) return true
  const lower = t.toLowerCase()
  if (AI_TELL_PHRASES_EN.some((p) => lower.includes(p))) return true
  return AI_TELL_PHRASES_TH.some((p) => t.includes(p))
}
