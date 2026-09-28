/**
 * Central activity logger — call after any meaningful state change.
 * Fire-and-forget: never throws, never blocks the response.
 */
import { prisma } from '@/lib/prisma'

export async function logActivity(opts: {
  organizationId: string
  userId: string
  action: string          // e.g. 'CREATE' | 'UPDATE' | 'DELETE' | 'RUN' | 'PUBLISH'
  entityType: string      // e.g. 'Project' | 'Article' | 'Keyword' | 'KeywordResearch'
  entityId: string
  oldValue?: string
  newValue?: string
}): Promise<void> {
  try {
    await prisma.activityLog.create({ data: opts })
  } catch { /* non-fatal */ }
}

// ── Activity Log อัตโนมัติ: ทุก API ที่แก้ข้อมูล ────────────────────────────
import { headers } from 'next/headers'
import type { AppSession } from '@/lib/session-types'
import { AUTO_API_PREFIX } from '@/lib/activity-describe'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/** path ที่ไม่จด: ตัว log เอง (กันวน) */
const SKIP_PREFIXES = ['/api/activity-logs']
/** กันจดซ้ำใน request เดียว (route เรียก getSession หลายครั้ง) — headers() เป็น object เดียวกันตลอด request */
const recorded = new WeakSet<object>()

const ID_LIKE = /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i

/** id ของสิ่งที่ถูกกระทำ = ช่วง path สุดท้ายที่หน้าตาเป็น id (ไม่มี = ชื่อกลุ่ม API) */
export function entityFromApiPath(path: string): { entityType: string; entityId: string } {
  const segs = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const group = segs[0] ?? 'api'
  const ids = segs.filter((s) => ID_LIKE.test(s))
  return { entityType: group, entityId: ids[ids.length - 1] ?? '-' }
}

/** จด request ที่แก้ข้อมูลของ user ที่ login แล้ว — ไม่ throw ไม่พังงานหลัก */
export async function recordApiRequest(session: AppSession): Promise<void> {
  const orgId = session.user?.organizationId
  const userId = session.user?.id
  if (!orgId || !userId) return
  let h: ReturnType<typeof headers>
  try {
    h = headers()
  } catch {
    return // ไม่มี request context (build/prerender/script)
  }
  const path = h.get('x-pathname')
  const method = (h.get('x-method') ?? 'GET').toUpperCase()
  if (!path || !path.startsWith('/api/') || !MUTATING.has(method)) return
  if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return
  if (recorded.has(h)) return
  recorded.add(h)
  const { entityType, entityId } = entityFromApiPath(path)
  await logActivity({
    organizationId: orgId,
    userId,
    action: `${AUTO_API_PREFIX}${method}`,
    entityType,
    entityId,
    newValue: JSON.stringify({ path, method }),
  })
}
