// ─── Mars Article Intent Skill — เขียนเนื้อหาให้ตรง Search Intent + ประเภทบทความ ───
// เจ้าของสั่ง 2026-09-28: ทุกหน้าที่เขียนบทความ (Upload Article, Clients, Studio) ต้องมี skill นี้
// เหตุผล: Google จัดอันดับหน้าที่ "ตอบสิ่งที่คนค้นอยากได้" — บทความ commercial ที่เขียนเป็นสารานุกรม หรือ
// how-to ที่ไม่มีขั้นตอน จะไม่ติดอันดับ ต่อให้ภาษาดีแค่ไหน
// ไฟล์นี้เป็น pure text builder (ไม่เรียก DB/AI) — ผู้เรียกส่ง intent/ประเภทที่มีอยู่แล้วเข้ามา ไม่มีก็ไม่แนบ

export type ArticleIntent = 'informational' | 'educational' | 'commercial' | 'transactional' | 'navigational'

export const ARTICLE_INTENT_SKILL_NAME = 'Mars Article Intent Skill'

/** รับค่าได้ทั้งตัวเล็ก/ตัวใหญ่ (Keyword.intent ใน DB เป็น INFORMATIONAL ฯลฯ) — ค่าไม่รู้จัก = '' */
export function normalizeArticleIntent(raw: unknown): ArticleIntent | '' {
  const v = String(raw ?? '').trim().toLowerCase()
  return (['informational', 'educational', 'commercial', 'transactional', 'navigational'] as const).includes(v as ArticleIntent)
    ? (v as ArticleIntent)
    : ''
}

const INTENT_GUIDE: Record<ArticleIntent, { label: string; reader: string; must: string[]; avoid: string[] }> = {
  informational: {
    label: 'Informational — อยากรู้/อยากเข้าใจ',
    reader: 'ผู้อ่านมีคำถามและอยากได้คำตอบที่ชัด ยังไม่ได้คิดจะซื้อ',
    must: [
      'ตอบคำถามหลักของ keyword ให้จบใน 2–3 ประโยคแรกหลังบทนำ ไม่ต้องให้เลื่อนหา',
      'ต่อด้วยรายละเอียดที่คนมักถามต่อ (ทำไม เกิดจากอะไร สังเกตยังไง ต่างจากอะไร)',
      'ยกตัวอย่างจริงหรือสถานการณ์ที่ผู้อ่านเจอ ให้เห็นภาพ',
      'ปิดท้ายด้วยสิ่งที่ควรทำต่อ แบบนุ่ม ๆ ไม่ขายแรง',
    ],
    avoid: ['ขายตั้งแต่ย่อหน้าแรก', 'เนื้อหากว้างเกินคำถาม', 'ยืดบทนำก่อนตอบ'],
  },
  educational: {
    label: 'Educational — อยากเรียนรู้/ทำเป็น',
    reader: 'ผู้อ่านอยากเข้าใจลึกหรือทำเองได้ ต้องการลำดับและเหตุผล',
    must: [
      'อธิบายเป็นลำดับจากพื้นฐานไปหาละเอียด ทีละขั้น',
      'บอกเหตุผลของแต่ละขั้น ไม่ใช่แค่สั่งให้ทำ',
      'มีข้อผิดพลาดที่พบบ่อยและวิธีเลี่ยง',
      'สรุปประเด็นสำคัญท้ายบทให้ทบทวนได้',
    ],
    avoid: ['ข้ามขั้น', 'ศัพท์เทคนิคโดยไม่อธิบาย', 'ขายสินค้าแทรกกลางบทเรียน'],
  },
  commercial: {
    label: 'Commercial — กำลังเปรียบเทียบก่อนตัดสินใจซื้อ',
    reader: 'ผู้อ่านรู้ว่าอยากได้อะไร กำลังชั่งว่าแบบไหน/เจ้าไหนดี',
    must: [
      'ให้เกณฑ์เลือกที่ใช้ได้จริง (ราคา คุณภาพ ความเหมาะกับกรณี) พร้อมเหตุผล',
      'เปรียบเทียบข้อดีข้อจำกัดตรง ๆ ใช้ตารางได้ถ้าช่วยให้เห็นชัด',
      'บอกว่าแบบไหนเหมาะกับใคร ให้ผู้อ่านเห็นตัวเองในนั้น',
      'เชื่อมไปที่สินค้า/บริการของลูกค้าอย่างมีเหตุผล ว่าตอบเกณฑ์ข้อไหน',
    ],
    avoid: ['อวยอย่างเดียวไม่มีข้อจำกัด', 'ข้อมูลทั่วไปยาว ๆ ที่ผู้อ่านรู้แล้ว', 'อ้างตัวเลขที่ไม่มีใน Business Skill'],
  },
  transactional: {
    label: 'Transactional — พร้อมซื้อ/พร้อมจ้าง',
    reader: 'ผู้อ่านพร้อมลงมือ ต้องการรู้ว่าซื้อ/จองที่ไหน ยังไง ราคาเท่าไหร่',
    must: [
      'บอกสิ่งที่ได้ ราคา/แพ็กเกจ (เฉพาะที่มีใน Business Skill) และขั้นตอนสั่งซื้อหรือติดต่อให้ชัดตั้งแต่ต้น',
      'ตอบข้อกังวลก่อนซื้อ (รับประกัน ระยะเวลา พื้นที่ให้บริการ) ในจุดที่คนสงสัย',
      'มีจุดชวนติดต่อ/สั่งซื้อที่ชัดเจน ไม่ต้องอ้อม',
      'เนื้อหากระชับ ตรงประเด็น ไม่ต้องสอนพื้นฐานยาว',
    ],
    avoid: ['บทนำยาวก่อนเข้าเรื่อง', 'เนื้อหาแบบสารานุกรม', 'แต่งราคา/โปรที่ไม่มีข้อมูล'],
  },
  navigational: {
    label: 'Navigational — หาแบรนด์/หน้าที่เจาะจง',
    reader: 'ผู้อ่านรู้จักชื่อแบรนด์หรือบริการแล้ว อยากเจอข้อมูลของที่นั้นโดยตรง',
    must: [
      'ยืนยันตั้งแต่ต้นว่านี่คือข้อมูลของแบรนด์/บริการที่ค้นหา',
      'ให้ข้อมูลที่คนมาหาบ่อย: บริการ ช่องทางติดต่อ พื้นที่ เวลา (เฉพาะที่มีใน Business Skill)',
      'จัดหัวข้อให้หาเจอเร็ว',
    ],
    avoid: ['พูดถึงคู่แข่ง', 'เนื้อหากว้างที่ไม่เกี่ยวกับแบรนด์'],
  },
}

/** ประเภทบทความ (ป้ายจากแท็บ Keyword / contentType) → โครงที่ต้องมี */
const TYPE_GUIDE: { match: RegExp; label: string; structure: string[] }[] = [
  {
    match: /how.?to|ขั้นตอน|วิธี|tutorial|guide/i,
    label: 'How-to / ขั้นตอน',
    structure: [
      'บอกก่อนว่าต้องเตรียมอะไร และทำแล้วได้ผลอะไร',
      'ขั้นตอนเป็นลำดับตัวเลข (ol) แต่ละขั้นเริ่มด้วยคำกริยา บอกวิธีและจุดที่ต้องระวัง',
      'มีส่วน "ถ้าทำแล้วไม่ได้ผล" หรือข้อผิดพลาดที่พบบ่อย',
    ],
  },
  {
    match: /listicle|ลิสต์|รวม\s*\d|อันดับ|\btop\s*\d|\d+\s*ข้อ/i,
    label: 'Listicle',
    structure: [
      'แต่ละข้อเป็น H2/H3 ของตัวเอง ชื่อข้อบอกประโยชน์ชัดเจน',
      'ทุกข้อมีเหตุผลหรือรายละเอียดที่ใช้ได้จริง ไม่ใช่ประโยคเดียวจบ',
      'เรียงข้อจากสำคัญที่สุดหรือตามลำดับที่ผู้อ่านจะใช้',
    ],
  },
  {
    match: /เปรียบเทียบ|compare|comparison|vs\.?|versus|ต่างกัน/i,
    label: 'เปรียบเทียบ',
    structure: [
      'บอกเกณฑ์ที่ใช้เทียบตั้งแต่ต้น',
      'มีตารางเปรียบเทียบอย่างน้อย 1 ตาราง',
      'สรุปว่าตัวเลือกไหนเหมาะกับใคร/กรณีไหน ไม่ใช่สรุปว่าดีทั้งคู่',
    ],
  },
  {
    match: /รีวิว|review|แนะนำสินค้า|product/i,
    label: 'รีวิว / แนะนำสินค้า',
    structure: [
      'บอกว่าเหมาะกับใคร ใช้ในสถานการณ์ไหน',
      'ข้อดี ข้อจำกัด และสิ่งที่ควรรู้ก่อนซื้อ แยกให้ชัด',
      'ใช้เฉพาะข้อมูลสินค้าที่มีใน Business Skill ห้ามแต่งสเปก/ราคา',
    ],
  },
  {
    match: /หน้าขาย|บริการ|landing|service|sales/i,
    label: 'หน้าขาย / บริการ',
    structure: [
      'เปิดด้วยปัญหาของลูกค้าและสิ่งที่บริการแก้ได้',
      'อธิบายบริการ ขั้นตอนการทำงาน สิ่งที่ลูกค้าได้ และเหตุผลที่ควรเลือก',
      'ตอบข้อกังวลก่อนตัดสินใจ แล้วปิดด้วยการชวนติดต่อที่ชัดเจน',
    ],
  },
  {
    match: /ความรู้|informational|seo_article|article|บทความ/i,
    label: 'บทความให้ความรู้',
    structure: [
      'ตอบคำถามหลักเร็ว แล้วขยายด้วยหัวข้อที่คนถามต่อ',
      'แต่ละ H2 ตอบคำถามเดียว ชื่อหัวข้อบอกว่าย่อหน้านั้นให้อะไร',
      'ใช้ตัวอย่าง ตาราง หรือลิสต์เมื่อช่วยให้อ่านง่ายขึ้นเท่านั้น',
    ],
  },
]

export interface ArticleIntentSkillInput {
  /** search intent ของ keyword (รับตัวใหญ่/เล็ก) — ว่าง = ไม่มีข้อมูล */
  intent?: string | null
  /** ประเภทบทความ เช่น "How-to / ขั้นตอน", "เปรียบเทียบ" หรือ contentType ของ Clients — ว่าง = ไม่มีข้อมูล */
  articleType?: string | null
  /** funnel stage จาก Keyword Bank (TOFU/MOFU/BOFU) ถ้ามี */
  funnelStage?: string | null
}

/**
 * โหมดพื้นฐาน — หน้าที่ไม่มีข้อมูล intent/ประเภทบทความ (เช่น Studio) ให้ตัวเขียนวิเคราะห์ intent จาก keyword เอง
 * ไม่ระบุ intent แทนผู้ใช้ (ห้ามเดา) แค่บอกวิธีคิดและแนวทางของแต่ละ intent
 */
function baseIntentSkillBlock(): string {
  const lines: string[] = [
    `════ ${ARTICLE_INTENT_SKILL_NAME} — เนื้อหาต้องตรงกับสิ่งที่คนค้นอยากได้ (ดีต่อ SEO) ════`,
    'งานนี้ไม่ได้ระบุ Search Intent และประเภทบทความมา — ก่อนเขียนให้อ่าน keyword/หัวข้อ แล้วตัดสินว่าคนค้นอยากได้อะไร จากแบบใดแบบหนึ่งด้านล่าง แล้วเขียนตามแนวทางของแบบนั้นทั้งบทความ',
  ]
  for (const key of Object.keys(INTENT_GUIDE) as ArticleIntent[]) {
    const g = INTENT_GUIDE[key]
    lines.push(`- ${g.label}: ${g.must[0]}`)
  }
  lines.push(
    'ถ้า keyword บอกรูปแบบชัด (วิธี/ขั้นตอน, รวม/อันดับ, เปรียบเทียบ/vs, รีวิว, ราคา/บริการ) ให้ใช้โครงแบบนั้น',
    'ห้ามเขียนแบบให้ความรู้กว้าง ๆ กับ keyword ที่คนค้นเพื่อเลือกหรือซื้อ และห้ามขายหนักกับ keyword ที่คนค้นเพื่อหาความรู้',
    'Skill นี้กำหนด "ทิศทางและโครง" เท่านั้น — ข้อเท็จจริง ราคา สินค้า ต้องมาจาก Business Skill/ข้อมูลที่ให้มาเท่านั้น',
  )
  return lines.join('\n')
}

/**
 * ข้อความ skill ที่แนบใน prompt ของตัวเขียนบทความ
 * ไม่มีทั้ง intent และประเภท = โหมดพื้นฐาน (ให้ตัวเขียนวิเคราะห์ intent จาก keyword เอง ไม่เดาแทน)
 */
export function articleIntentSkillBlock(input: ArticleIntentSkillInput): string {
  const intent = normalizeArticleIntent(input.intent)
  const typeRaw = String(input.articleType ?? '').trim()
  const type = typeRaw ? TYPE_GUIDE.find((t) => t.match.test(typeRaw)) : undefined
  const funnel = String(input.funnelStage ?? '').trim().toUpperCase()
  if (!intent && !typeRaw) return baseIntentSkillBlock()

  const lines: string[] = [
    `════ ${ARTICLE_INTENT_SKILL_NAME} — เนื้อหาต้องตรงกับสิ่งที่คนค้นอยากได้ (ดีต่อ SEO) ════`,
  ]
  if (intent) {
    const g = INTENT_GUIDE[intent]
    lines.push(`Search Intent: ${g.label}`, `ผู้อ่านคือ: ${g.reader}`, 'เนื้อหาต้อง:')
    lines.push(...g.must.map((m) => `- ${m}`))
    lines.push('ห้าม:', ...g.avoid.map((a) => `- ${a}`))
  }
  if (typeRaw) {
    lines.push(`ประเภทบทความ: ${typeRaw}${type && type.label !== typeRaw ? ` (โครงแบบ ${type.label})` : ''}`)
    if (type) lines.push('โครงที่ต้องมี:', ...type.structure.map((s) => `- ${s}`))
  }
  if (funnel === 'TOFU' || funnel === 'MOFU' || funnel === 'BOFU') {
    lines.push(
      funnel === 'TOFU'
        ? 'ช่วงการตัดสินใจ: TOFU (เพิ่งเริ่มหาข้อมูล) — เน้นให้ความรู้ ชวนติดต่อแบบนุ่ม'
        : funnel === 'MOFU'
          ? 'ช่วงการตัดสินใจ: MOFU (กำลังพิจารณา) — เน้นเกณฑ์เลือกและเหตุผลที่ควรเลือกแบรนด์'
          : 'ช่วงการตัดสินใจ: BOFU (พร้อมตัดสินใจ) — เน้นข้อเสนอ ขั้นตอนติดต่อ และตอบข้อกังวลสุดท้าย',
    )
  }
  lines.push(
    'ถ้า Intent กับประเภทบทความดูขัดกัน ให้ยึด Intent เป็นหลัก แล้วใช้โครงของประเภทบทความจัดเนื้อหา',
    'Skill นี้กำหนด "ทิศทางและโครง" เท่านั้น — ข้อเท็จจริง ราคา สินค้า ต้องมาจาก Business Skill/ข้อมูลที่ให้มาเท่านั้น',
  )
  return lines.join('\n')
}
