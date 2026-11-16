/** Compliance — ตัวช่วยกันพังรอบการเรียก AI (pure, ไม่มี I/O): งบขนาดกฎ, ตัวคั่นใน prompt, อ่าน JSON ที่โดนตัดกลางทาง */

/** ขนาดรวมของ RULES ที่ส่งให้ AI ต่อ 1 รอบ (ตัวอักษรของ JSON) */
export const MAX_RULES_CHARS = 120_000

export interface AiRule {
  id: string
  code: string
  title: string
  description: string
  ruleType: string
  severity: string
  terms: string[]
  guidance: string
}

const size = (rules: AiRule[]): number => JSON.stringify(rules).length

/** คุมขนาด RULES ที่ส่งให้ AI
 *  อยู่ในงบ = ส่งตามเดิมทุกตัวอักษร · เกินงบ = ย่อคำอธิบาย/คำแนะนำ/รายการคำ · ยังเกิน = เก็บกฎที่จับคำได้ (keepIds) ก่อน แล้วเติมกฎอื่นเท่าที่งบเหลือ
 *  การจับคำในบทความทำที่ engine ด้วยกฎชุดเต็มเสมอ — ที่ย่อคือบริบทที่ AI เห็นเท่านั้น */
export function budgetRules(rules: AiRule[], keepIds: string[], budget = MAX_RULES_CHARS): { rules: AiRule[]; omitted: number; compacted: boolean } {
  if (size(rules) <= budget) return { rules, omitted: 0, compacted: false }
  const compact = rules.map((r) => ({
    ...r,
    description: r.description.slice(0, 400),
    guidance: r.guidance.slice(0, 400),
    terms: r.terms.slice(0, 30).map((t) => t.slice(0, 80)),
  }))
  if (size(compact) <= budget) return { rules: compact, omitted: 0, compacted: true }
  const keep = new Set(keepIds)
  const ordered = compact.filter((r) => keep.has(r.id)).concat(compact.filter((r) => !keep.has(r.id)))
  const out: AiRule[] = []
  let used = 2
  for (const r of ordered) {
    const cost = JSON.stringify(r).length + 1
    if (used + cost > budget) continue
    out.push(r)
    used += cost
  }
  return { rules: out, omitted: rules.length - out.length, compacted: true }
}

/** ข้อความจากลูกค้า (บทความ / Brand voice) ต้องปิดหรือเปิดบล็อกใน prompt เองไม่ได้ — แยกตัวคั่นที่ปนมาให้ไม่ตรงรูป */
export function defuseMarkers(s: string): string {
  return s.replace(/<<<(?=\s*(?:BRAND_VOICE|ARTICLE))/g, '< < <').replace(/(BRAND_VOICE|ARTICLE)(\s*)>>>/g, '$1$2> > >')
}

function isRecord(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** อ่าน JSON จากคำตอบ AI — ถ้าคำตอบโดนตัดกลางทาง (ชนเพดาน token) ให้เก็บรายการที่ครบแล้วไว้ แทนที่จะทิ้งทั้งคำตอบ
 *  partial = true เมื่อได้ผลจากการตัดท้ายที่ไม่ครบออก */
export function parseJsonLenient(raw: string): { value: unknown; partial: boolean } {
  let s = String(raw ?? '').trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = s.indexOf('{')
  if (start < 0) throw new Error('AI response is not JSON')
  s = s.slice(start)
  let i = s.lastIndexOf('}')
  if (i > 0) {
    try {
      return { value: JSON.parse(s.slice(0, i + 1)), partial: false }
    } catch {
      // ไม่ใช่ JSON ที่ครบ — ไล่ถอยหารายการสุดท้ายที่ปิดครบ
    }
  }
  for (let tries = 0; i > 0 && tries < 60; tries++) {
    const head = s.slice(0, i + 1)
    for (const tail of [']}', '}']) {
      let v: unknown
      try {
        v = JSON.parse(head + tail)
      } catch {
        continue
      }
      if (isRecord(v)) return { value: v, partial: true }
    }
    i = s.lastIndexOf('}', i - 1)
  }
  throw new Error('AI response is not JSON')
}
