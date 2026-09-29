/**
 * Keyword Intent Skill — โหมด standalone (รัน Keyword Research โดยไม่ผูกกับโปรเจกต์)
 *
 * ตาราง LocalKeywordResearchRun.projectId เป็น string ธรรมดา ไม่มี FK ไปตาราง Project
 * (resumable pipeline ต้องมี flags.projectId เสมอ) — จึงใช้ sentinel ผูกกับ organizationId
 * แทนการอนุญาตให้ projectId เป็น null ทำให้ resume/checkpoint เดิมทำงานเหมือนเดิมทุกจุด
 *
 * ข้อควรระวัง: sentinel นี้ "ห้าม" เดินทางไปแตะตารางที่มี FK จริงไปที่ Project
 * (เช่น AIJob.projectId) — จุดที่ใช้ flags.projectId ต่อกับตารางเหล่านั้นต้อง guard
 * ด้วย isStandaloneProjectId() แล้ว fallback เป็น null/ค่าว่างเสมอ
 */

export const STANDALONE_PREFIX = 'kr-standalone:';

/** ป้าย client slug ของงาน standalone — ใช้แทน clientSlugForProject() ที่ query ตาราง Project */
export const STANDALONE_CLIENT_SLUG = 'kr_standalone';

/** projectId สมมติของงาน Keyword Research แบบไม่มีโปรเจกต์ — ผูกกับ organization เดียวกันเสมอ */
export function standaloneProjectId(orgId: string): string {
  return `${STANDALONE_PREFIX}${orgId}`;
}

/** true เมื่อ id เป็น sentinel ของโหมด standalone (ไม่ใช่ projectId จริงจากตาราง Project) */
export function isStandaloneProjectId(id?: string | null): boolean {
  return typeof id === 'string' && id.startsWith(STANDALONE_PREFIX);
}
