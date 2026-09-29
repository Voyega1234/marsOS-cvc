/**
 * fetch /api/projects แบบใช้ร่วมกัน — ProTopBar และ SidebarClients เรียกพร้อมกันตอนโหลดหน้าแรก
 * รวมคำขอที่ยิงซ้อนกัน/ใกล้กันภายใน ~5s ให้ใช้ผลลัพธ์เดียวกัน ลด round-trip ที่ซ้ำกันโดยไม่จำเป็น
 */

type ProjectsListItem = Record<string, unknown>;

const CACHE_MS = 5000;

let cached: { promise: Promise<ProjectsListItem[]>; expiresAt: number } | null = null;

export function fetchProjectsList(): Promise<ProjectsListItem[]> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetch("/api/projects").then((r) => (r.ok ? r.json() : []));
  cached = { promise, expiresAt: now + CACHE_MS };
  // คำขอล้มเหลว — ล้าง cache ทันที ไม่ต้องรอครบ 5s ค่อยลองใหม่
  promise.catch(() => { cached = null; });

  return promise;
}

/** ล้าง cache — ใช้หลัง mutation ที่ทำให้รายการโปรเจกต์เปลี่ยน (สร้าง/ลบ/แก้ไข) เพื่อให้ครั้งถัดไปได้ข้อมูลใหม่ */
export function invalidateProjectsList(): void {
  cached = null;
}
