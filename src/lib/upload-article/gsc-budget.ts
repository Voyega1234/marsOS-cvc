// ─── Budget for GSC Search Analytics calls made by Report > Keyword ที่ติดตาม ───
// Every client shares one service account. Google allows about 1,200 queries per minute
// per account (and per site). Another workload uses about half of that, so these routes
// keep their share at about 25% (300 a minute) and refuse with "wait a moment" instead
// of tripping Google's quota for everyone.
//
// The counter lives in memory, so each server instance has its own. 300 leaves room for
// a second warm instance before the combined total reaches 50%.

export const GSC_TRACKER_QUERIES_PER_MINUTE = 300

export function createQueryBudget(limit: number, windowMs = 60_000) {
  const stamps: number[] = []
  const prune = (now: number) => {
    while (stamps.length && now - stamps[0] >= windowMs) stamps.shift()
  }
  return {
    /** Reserve n queries; false = over budget (nothing is reserved). */
    take(n: number, now = Date.now()): boolean {
      prune(now)
      if (n <= 0) return true
      if (stamps.length + n > limit) return false
      for (let i = 0; i < n; i++) stamps.push(now)
      return true
    },
    used(now = Date.now()): number {
      prune(now)
      return stamps.length
    },
  }
}

/** Shared by the tracker performance and keyword-suggestion routes. */
export const gscTrackerBudget = createQueryBudget(GSC_TRACKER_QUERIES_PER_MINUTE)

export const GSC_BUDGET_BUSY_MESSAGE = 'ระบบดึง GSC ถี่เกินไปชั่วคราว (จำกัดไว้ไม่ให้กินโควต้าของงานอื่น) — รอประมาณ 1 นาทีแล้วกดรีเฟรช'
