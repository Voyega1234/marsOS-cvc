/**
 * บริบท "ลูกค้าคนไหน" ของ request ปัจจุบัน — ใช้ประกอบ generation_name ของ OpenRouter
 * รูปแบบที่ตกลงกันไว้: mars_<client>_<action>  (SOP §3 Label Function usage)
 *
 * ทำไมต้องเป็น AsyncLocalStorage: จุดที่ยิง OpenRouter จริงอยู่ลึกหลายชั้น (wordgod,
 * competitor-gap, geminiImage) การส่ง client ลงไปทีละชั้นจะต้องแก้ signature เป็นสิบจุด
 * ตั้งค่าไว้ครั้งเดียวที่ route แล้วทุกชั้นข้างในอ่านได้เอง
 *
 * ข้อควรระวัง: callback ของ ReadableStream อาจถูกเรียกนอก context เดิม — route ที่เป็น
 * SSE ต้องครอบ withOrClient() รอบ "งานจริง" ข้างใน callback ไม่ใช่แค่รอบ handler
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<string>()

/** ไม่มีบริบทลูกค้า (งานระดับระบบ เช่น digest ข่าวรวม) */
export const OR_CLIENT_SYSTEM = 'system'

/**
 * ชื่อลูกค้า → slug สำหรับ generation_name
 * ชื่อไทยล้วนจะเหลือค่าว่างหลังกรอง — ผู้เรียกต้องส่ง fallback (ท้าย projectId) มาเอง
 */
export function slugifyClient(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

/** เลือกชื่อที่อ่านรู้เรื่องที่สุด: clientName → name → ท้าย id → system */
export function clientSlugFromProject(p: { id?: string | null; name?: string | null; clientName?: string | null } | null | undefined): string {
  if (!p) return OR_CLIENT_SYSTEM
  return (
    slugifyClient(p.clientName) ||
    slugifyClient(p.name) ||
    (p.id ? `p${p.id.slice(-6)}` : '') ||
    OR_CLIENT_SYSTEM
  )
}

export function currentOrClient(): string {
  return store.getStore() || OR_CLIENT_SYSTEM
}

/** รันงานภายใต้บริบทลูกค้าหนึ่งราย — ทุก orChat/orImage ข้างในจะติดป้ายชื่อนี้ */
export function withOrClient<T>(client: string, fn: () => T): T {
  return store.run(client || OR_CLIENT_SYSTEM, fn)
}

/**
 * หา slug ลูกค้าจาก projectId — cache ไว้ในหน่วยความจำของ instance
 * (ชื่อโปรเจกต์เปลี่ยนไม่บ่อย และผิดพลาดแค่ป้ายกำกับ ไม่กระทบผลงาน)
 */
const slugCache = new Map<string, string>()

export async function clientSlugForProject(projectId: string | null | undefined): Promise<string> {
  if (!projectId) return OR_CLIENT_SYSTEM
  const cached = slugCache.get(projectId)
  if (cached) return cached
  try {
    const { prisma } = await import('@/lib/prisma')
    const p = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, clientName: true },
    })
    const slug = clientSlugFromProject(p ?? { id: projectId })
    slugCache.set(projectId, slug)
    return slug
  } catch {
    return `p${projectId.slice(-6)}`
  }
}
