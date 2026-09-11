// ─────────────────────────────────────────────────────────────────────────────
//  Project.timeline — รูปแบบข้อมูลกลาง
//
//  เดิม Project.timeline เก็บเป็น JSON array ของรายการบทความอย่างเดียว
//  คำสั่งเจ้าของ 2026-09-11: ทีมต้องตั้ง "วันเริ่มงาน / วันจบงาน" ของทั้งโปรเจกต์เองได้
//  และตารางบทความเป็นแค่งานย่อยที่ต้องอยู่ในช่วงนั้น
//
//  เพื่อไม่ต้องเพิ่มคอลัมน์ใน Prisma (โปรเจกต์นี้ใช้ prisma db push ไม่มี migration)
//  จึงขยายค่าในคอลัมน์เดิมเป็น object:
//
//      { "plan": { "startDate": "2026-09-15", "endDate": "2026-12-31" }, "entries": [...] }
//
//  ของเก่าที่เป็น array ล้วนยังอ่านได้ปกติ (plan ว่าง) และตัวเขียนที่ยังส่ง array มา
//  จะถูก mergeTimelineWrite รักษา plan เดิมไว้ให้ ไม่ทับหาย
// ─────────────────────────────────────────────────────────────────────────────

export interface TimelinePlan {
  /** YYYY-MM-DD — วันเริ่มงานของทั้งโปรเจกต์ (null = ทีมยังไม่ได้ตั้ง) */
  startDate: string | null
  /** YYYY-MM-DD — วันจบงานของทั้งโปรเจกต์ */
  endDate: string | null
  /** บันทึกสั้น ๆ ของทีม เช่น ขอบเขตงวดงาน */
  note?: string
}

export interface TimelineDoc<E = Record<string, unknown>> {
  plan: TimelinePlan
  entries: E[]
}

export const EMPTY_PLAN: TimelinePlan = { startDate: null, endDate: null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** คืนค่าเฉพาะสตริงวันที่รูปแบบ YYYY-MM-DD ที่ใช้ได้จริง ไม่งั้น null */
export function normalizePlanDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, 10)
  if (!DATE_RE.test(s)) return null
  const d = new Date(`${s}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : s
}

function toPlan(v: unknown): TimelinePlan {
  if (!v || typeof v !== 'object') return { ...EMPTY_PLAN }
  const o = v as Record<string, unknown>
  const plan: TimelinePlan = {
    startDate: normalizePlanDate(o.startDate),
    endDate: normalizePlanDate(o.endDate),
  }
  if (typeof o.note === 'string' && o.note.trim()) plan.note = o.note.trim()
  // ป้องกันช่วงกลับหัว — ถ้าจบก่อนเริ่ม ถือว่าวันจบไม่ถูกต้อง
  if (plan.startDate && plan.endDate && plan.endDate < plan.startDate) plan.endDate = null
  return plan
}

/** แปลงค่าดิบจาก DB (array เก่า หรือ object ใหม่) เป็นโครงเดียวกันเสมอ */
export function parseTimeline<E = Record<string, unknown>>(raw: unknown): TimelineDoc<E> {
  let value: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return { plan: { ...EMPTY_PLAN }, entries: [] }
    try {
      value = JSON.parse(raw)
    } catch {
      return { plan: { ...EMPTY_PLAN }, entries: [] }
    }
  }
  if (Array.isArray(value)) return { plan: { ...EMPTY_PLAN }, entries: value as E[] }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return {
      plan: toPlan(o.plan),
      entries: Array.isArray(o.entries) ? (o.entries as E[]) : [],
    }
  }
  return { plan: { ...EMPTY_PLAN }, entries: [] }
}

/** เอาเฉพาะรายการบทความ — ใช้กับที่เดิมที่คาดว่าเป็น array */
export function timelineEntries<E = Record<string, unknown>>(raw: unknown): E[] {
  return parseTimeline<E>(raw).entries
}

export function serializeTimeline(doc: TimelineDoc): string {
  return JSON.stringify({ plan: toPlan(doc.plan), entries: doc.entries })
}

/**
 * รวมค่าที่ผู้เขียนส่งมากับ plan เดิมใน DB แล้วคืนสตริงพร้อมบันทึก
 *
 * - ส่ง array มา (ตัวเขียนเก่า เช่น /api/scheduler) → เก็บ plan เดิมไว้
 * - ส่ง object { plan, entries } มา → ใช้ตามที่ส่ง
 * - ส่งสตริง JSON มา (เช่น ContentMapClient) → parse ก่อนแล้วทำแบบเดียวกัน
 */
export function mergeTimelineWrite(existingRaw: unknown, incoming: unknown): string {
  const current = parseTimeline(existingRaw)
  let value: unknown = incoming
  if (typeof incoming === 'string') {
    try {
      value = JSON.parse(incoming)
    } catch {
      value = []
    }
  }
  if (Array.isArray(value)) {
    return serializeTimeline({ plan: current.plan, entries: value as Record<string, unknown>[] })
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    const hasPlanKey = 'plan' in o
    return serializeTimeline({
      plan: hasPlanKey ? toPlan(o.plan) : current.plan,
      entries: Array.isArray(o.entries) ? (o.entries as Record<string, unknown>[]) : current.entries,
    })
  }
  return serializeTimeline({ plan: current.plan, entries: [] })
}

/** true เมื่อทีมตั้งช่วงเวลาไว้แล้ว (อย่างน้อยหนึ่งด้าน) */
export function hasPlanRange(plan: TimelinePlan): boolean {
  return Boolean(plan.startDate || plan.endDate)
}

/** วันที่อยู่ในช่วงที่ทีมตั้งไว้หรือไม่ — ด้านที่ยังไม่ตั้งถือว่าไม่จำกัด */
export function isDateWithinPlan(plan: TimelinePlan, iso: string | null | undefined): boolean {
  const d = normalizePlanDate(iso)
  if (!d) return true
  if (plan.startDate && d < plan.startDate) return false
  if (plan.endDate && d > plan.endDate) return false
  return true
}

/** ข้อความไทยอธิบายว่าวันที่หลุดช่วงยังไง (null = ไม่หลุด) */
export function planViolation(plan: TimelinePlan, iso: string | null | undefined): string | null {
  const d = normalizePlanDate(iso)
  if (!d) return null
  if (plan.startDate && d < plan.startDate) return `ก่อนวันเริ่มงาน (${plan.startDate})`
  if (plan.endDate && d > plan.endDate) return `เลยวันจบงาน (${plan.endDate})`
  return null
}
