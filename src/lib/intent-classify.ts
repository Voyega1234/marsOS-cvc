// ─── วิเคราะห์ Search Intent จาก keyword/หัวข้อ ด้วยกฎคำบ่งชี้ (ไม่เรียก AI ไม่มีค่าใช้จ่าย) ───
// เจ้าของสั่ง 2026-09-28: intent ที่ติดมากับ keyword ให้ใช้ตามนั้น ไม่มีค่อยวิเคราะห์เอง และต้องแม่นที่สุด
// ใช้เฉพาะตอน "ไม่มี intent ติดมา" — confidence 'high' = คำบ่งชี้ชัดและไม่ขัดกัน ใช้เป็น intent ได้เลย
// 'low' = มีคำบ่งชี้แต่ขัดกัน/อ่อน → ส่งเป็นข้อสังเกตให้ตัวเขียนตัดสินตามขั้นตอนใน Intent Skill อีกชั้น

import type { ArticleIntent } from './article-intent-skill'

export interface IntentClassification {
  intent: ArticleIntent | ''
  confidence: 'high' | 'low' | 'none'
  /** คำบ่งชี้ที่เจอ เช่น ["ราคา → transactional"] ใช้อธิบายให้ตัวเขียนและคนอ่าน log */
  signals: string[]
}

interface Rule {
  re: RegExp
  intent: ArticleIntent
  /** 3 = ชี้ขาด, 2 = ชัด, 1 = อ่อน */
  weight: 1 | 2 | 3
  label: string
}

// ลำดับไม่สำคัญ — ให้คะแนนรวมตาม intent · ภาษาไทยไม่มีช่องว่างระหว่างคำ จึงเลือกคำที่ไม่ชนกับคำอื่นง่าย
const RULES: Rule[] = [
  // ── commercial: กำลังเลือก/เทียบก่อนซื้อ (ต้องมาก่อน "วิธี" เพราะ "วิธีเลือก" = commercial) ──
  { re: /วิธี(การ)?เลือก|เลือก\S*(ยังไง|อย่างไร|แบบไหน)|เลือกซื้อ/, intent: 'commercial', weight: 3, label: 'วิธีเลือก/เลือกซื้อ' },
  { re: /เปรียบเทียบ|\bvs\.?\b|versus|\bcompare\b|comparison/i, intent: 'commercial', weight: 3, label: 'เปรียบเทียบ/vs' },
  { re: /ยี่ห้อไหน|รุ่นไหน|เจ้าไหน|ร้านไหน|ไหนดี/, intent: 'commercial', weight: 3, label: 'ไหนดี' },
  { re: /ดีไหม|ดีมั้ย|ดีมั๊ย|ดีป่ะ|คุ้มไหม|คุ้มมั้ย|น่าซื้อ|ควรซื้อ|ข้อดีข้อเสีย/, intent: 'commercial', weight: 3, label: 'ดีไหม/คุ้มไหม' },
  { re: /รีวิว|\breview/i, intent: 'commercial', weight: 2, label: 'รีวิว' },
  { re: /แนะนำ|ยอดนิยม|ขายดี|อันดับ|\bbest\b|\btop\s*\d*\b|ที่ดีที่สุด/i, intent: 'commercial', weight: 2, label: 'แนะนำ/อันดับ/best' },
  { re: /^รวม|รวม\s*\d+|\d+\s*(อันดับ|ร้าน|ที่|แบบ|ยี่ห้อ)/, intent: 'commercial', weight: 1, label: 'รวม N รายการ' },

  // ── transactional: พร้อมซื้อ/จ้าง/ติดต่อ ──
  { re: /สั่งซื้อ|ซื้อ(ที่|ได้ที่|ออนไลน์)|ขายส่ง|ขายปลีก|\bbuy\b|\border\b|\bshop\b/i, intent: 'transactional', weight: 3, label: 'สั่งซื้อ/buy' },
  { re: /รับ(ทำ|สร้าง|ออกแบบ|ติดตั้ง|ซ่อม|จ้าง|เหมา|แปล|ผลิต|ตกแต่ง|รีโนเวท)|หาช่าง|จ้าง(ทำ|คน)|บริษัทรับ/, intent: 'transactional', weight: 3, label: 'รับทำ/จ้าง' },
  { re: /ใกล้ฉัน|ใกล้ๆ|แถว\S+|near me/i, intent: 'transactional', weight: 3, label: 'ใกล้ฉัน/แถว…' },
  { re: /จอง|สมัคร|ลงทะเบียน|โปรโมชั่น|โปรโมชัน|ส่วนลด|โค้ดลด|คูปอง|ผ่อน\s*0|ผ่อนได้|ราคาถูก|ราคาพิเศษ|\bbooking\b|\bdiscount\b|\bcoupon\b/i, intent: 'transactional', weight: 3, label: 'จอง/โปร/ส่วนลด' },
  { re: /ราคา|ค่าบริการ|ค่าใช้จ่าย|เรท|แพ็กเกจ|แพ็คเกจ|\bprice\b|\bpricing\b|\bcost\b/i, intent: 'transactional', weight: 2, label: 'ราคา/แพ็กเกจ' },
  { re: /(ให้)?เช่า|ขาย(?!ดี)|มือสอง|\bfor sale\b|\brent\b/i, intent: 'transactional', weight: 2, label: 'เช่า/ขาย' },
  { re: /บริการ|\bservice/i, intent: 'transactional', weight: 1, label: 'บริการ' },

  // ── navigational: หาหน้าเจาะจงของแบรนด์ (ต้องมีชื่อแบรนด์ร่วมด้วย ดู brandNames) ──
  { re: /เข้าสู่ระบบ|ล็อกอิน|\blogin\b|\bsign in\b|เว็บไซต์ทางการ|official/i, intent: 'navigational', weight: 3, label: 'login/เว็บทางการ' },
  { re: /เบอร์โทร|ช่องทางติดต่อ|ติดต่อ|สาขา|ที่อยู่|เวลาเปิด|เวลาทำการ|\bcontact\b/i, intent: 'navigational', weight: 1, label: 'ติดต่อ/สาขา' },

  // ── educational: อยากทำเป็น/เรียนรู้เป็นขั้น ──
  { re: /วิธี(ทำ|ใช้|ติดตั้ง|แก้|ดูแล|ตั้งค่า|สมัคร|คำนวณ|เขียน|ปลูก|เก็บ|ล้าง)|ขั้นตอน|สอน|ทำเอง|\bdiy\b|how to|tutorial|step by step/i, intent: 'educational', weight: 3, label: 'วิธีทำ/ขั้นตอน/how to' },
  { re: /วิธี|เทคนิค|เคล็ดลับ|คู่มือ|\bguide\b|\btips\b/i, intent: 'educational', weight: 2, label: 'วิธี/เทคนิค/คู่มือ' },

  // ── informational: อยากรู้/อยากเข้าใจ ──
  { re: /คืออะไร|หมายถึง|ความหมาย|แปลว่า|what is|meaning|definition/i, intent: 'informational', weight: 3, label: 'คืออะไร/ความหมาย' },
  { re: /ทำไม|สาเหตุ|เกิดจาก|อาการ|เพราะอะไร|\bwhy\b/i, intent: 'informational', weight: 3, label: 'ทำไม/สาเหตุ/อาการ' },
  { re: /กี่|เท่าไหร่|เท่าไร|เมื่อไหร่|เมื่อไร|ยังไง|อย่างไร|ไหม$|มั้ย$|หรือไม่|\bhow\b|\bwhen\b/i, intent: 'informational', weight: 2, label: 'คำถาม (กี่/ยังไง/ไหม)' },
  { re: /ประโยชน์|ข้อควรรู้|ข้อควรระวัง|ประเภท|ชนิด|ต่างกัน|ความแตกต่าง|กฎหมาย|ภาษี|\bbenefits?\b|\btypes?\b/i, intent: 'informational', weight: 2, label: 'ประโยชน์/ประเภท/ข้อควรรู้' },
]

/** ใช้ตัดสินตอนคะแนนเท่ากัน — intent ที่ผิดแล้วเสียหายมากกว่า (ขายผิดจังหวะ) อยู่หลัง */
const TIE_ORDER: ArticleIntent[] = ['transactional', 'commercial', 'navigational', 'educational', 'informational']

/**
 * "ราคา" + คำถาม (เท่าไหร่/กี่บาท) ส่วนใหญ่คือคนเตรียมจ่าย ไม่ใช่อยากรู้ทั่วไป → คงเป็น transactional
 * "วิธี" + ชื่อแบรนด์/login → คนใช้งานแบรนด์อยู่แล้ว ให้ educational ชนะ navigational
 */
function applyCombos(text: string, score: Record<ArticleIntent, number>): string[] {
  const notes: string[] = []
  if (/ราคา|ค่าบริการ|ค่าใช้จ่าย|price|cost/i.test(text) && /เท่าไหร่|เท่าไร|กี่บาท|how much/i.test(text)) {
    score.transactional += 2
    notes.push('ราคา + เท่าไหร่ → คนเตรียมจ่าย (transactional)')
  }
  return notes
}

/**
 * วิเคราะห์ intent จาก keyword (และ title ถ้ามี — title เป็นตัวบอกทิศทางที่ทีมตั้งใจ ให้น้ำหนักรอง)
 * brandNames = ชื่อลูกค้า/แบรนด์ ถ้า keyword มีชื่อแบรนด์ + ไม่มีคำบ่งชี้อื่น = navigational
 */
export function classifyKeywordIntent(keyword: string, opts: { title?: string; brandNames?: string[] } = {}): IntentClassification {
  const kw = String(keyword ?? '').trim().toLowerCase()
  const title = String(opts.title ?? '').trim().toLowerCase()
  if (!kw && !title) return { intent: '', confidence: 'none', signals: [] }

  const score: Record<ArticleIntent, number> = { informational: 0, educational: 0, commercial: 0, transactional: 0, navigational: 0 }
  const strong: Record<ArticleIntent, boolean> = { informational: false, educational: false, commercial: false, transactional: false, navigational: false }
  const signals: string[] = []

  const scan = (text: string, factor: number, source: string) => {
    const hitIntents = new Set<ArticleIntent>()
    for (const r of RULES) {
      if (!r.re.test(text)) continue
      // "วิธีเลือก" ถูกนับเป็น commercial แล้ว — ไม่ต้องนับ "วิธี" ซ้ำเป็น educational
      if (r.intent === 'educational' && hitIntents.has('commercial') && /วิธี(การ)?เลือก/.test(text)) continue
      hitIntents.add(r.intent)
      score[r.intent] += r.weight * factor
      if (r.weight === 3 && factor === 1) strong[r.intent] = true
      signals.push(`${source}: ${r.label} → ${r.intent}`)
    }
  }
  scan(kw, 1, 'keyword')
  if (title && title !== kw) scan(title, 0.5, 'title')
  signals.push(...applyCombos(kw, score))

  const brands = (opts.brandNames ?? []).map((b) => b.trim().toLowerCase()).filter((b) => b.length >= 3)
  const hasBrand = brands.some((b) => kw.includes(b))
  if (hasBrand) {
    signals.push('keyword มีชื่อแบรนด์ลูกค้า')
    const other = Math.max(score.informational, score.educational, score.commercial, score.transactional)
    if (other === 0 || score.navigational > 0) {
      score.navigational += 3
      strong.navigational = true
    }
  } else if (score.navigational > 0 && !strong.navigational) {
    // "ติดต่อ/สาขา" โดยไม่มีชื่อแบรนด์ = คนหาผู้ให้บริการ ไม่ใช่หาแบรนด์เจาะจง
    score.transactional += score.navigational
    score.navigational = 0
  }

  const ranked = (Object.keys(score) as ArticleIntent[])
    .filter((k) => score[k] > 0)
    .sort((a, b) => score[b] - score[a] || TIE_ORDER.indexOf(a) - TIE_ORDER.indexOf(b))
  if (ranked.length === 0) return { intent: '', confidence: 'none', signals }

  const top = ranked[0]
  const second = ranked[1]
  // informational กับ educational ใกล้กัน (ไม่ขายทั้งคู่) — ขัดกันก็ไม่เสียหาย ถือว่าไม่ขัด
  const nonCommercial = (i: ArticleIntent) => i === 'informational' || i === 'educational'
  const conflicting = second && !(nonCommercial(top) && nonCommercial(second)) && score[second] >= score[top] * 0.67
  const confident = strong[top] && !conflicting
  return { intent: top, confidence: confident ? 'high' : 'low', signals }
}
