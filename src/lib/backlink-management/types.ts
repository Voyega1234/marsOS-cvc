/** Backlink Management — ชนิดข้อมูลร่วม (ไฟล์บริสุทธิ์ ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์) */

export type BlmStatus =
  | "REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "IN_PROGRESS"
  | "PUBLISHED"
  | "VERIFIED"
  | "LOST"
  | "CANCELLED";

export type BlmChipTone = "muted" | "ok" | "warn" | "bad" | "info";

export const BLM_STATUSES: BlmStatus[] = [
  "REQUESTED", "APPROVED", "IN_PROGRESS", "PUBLISHED", "VERIFIED", "LOST", "REJECTED", "CANCELLED",
];

export const STATUS_LABEL: Record<BlmStatus, string> = {
  REQUESTED: "รออนุมัติ",
  APPROVED: "อนุมัติงบแล้ว",
  REJECTED: "ไม่อนุมัติ",
  IN_PROGRESS: "กำลังดำเนินการ",
  PUBLISHED: "เผยแพร่แล้ว",
  VERIFIED: "ตรวจพบลิงก์แล้ว",
  LOST: "ลิงก์หาย",
  CANCELLED: "ยกเลิก",
};

export const STATUS_TONE: Record<BlmStatus, BlmChipTone> = {
  REQUESTED: "warn",
  APPROVED: "info",
  REJECTED: "bad",
  IN_PROGRESS: "info",
  PUBLISHED: "ok",
  VERIFIED: "ok",
  LOST: "bad",
  CANCELLED: "muted",
};

export const APPROVER_ROLES: string[] = ["ADMIN", "SEO_MANAGER"];

export function isApprover(role: string | null | undefined): boolean {
  return !!role && APPROVER_ROLES.includes(role);
}

export type CheckStatus = "LIVE" | "NOFOLLOW" | "LOST" | "PAGE_ERROR" | "BLOCKED";

export const CHECK_LABEL: Record<CheckStatus, string> = {
  LIVE: "ลิงก์ปกติ",
  NOFOLLOW: "Nofollow",
  LOST: "ลิงก์หาย",
  PAGE_ERROR: "เปิดหน้าไม่ได้",
  BLOCKED: "ถูกบล็อก",
};

export const CHECK_TONE: Record<CheckStatus, BlmChipTone> = {
  LIVE: "ok",
  NOFOLLOW: "warn",
  LOST: "bad",
  PAGE_ERROR: "warn",
  BLOCKED: "muted",
};

export const LINK_TYPES = ["dofollow", "nofollow", "sponsored"] as const;

export const TERMINAL_STATUSES: BlmStatus[] = ["PUBLISHED", "VERIFIED", "LOST", "REJECTED", "CANCELLED"];

export function statusLabel(s: string): string {
  return STATUS_LABEL[s as BlmStatus] ?? s;
}
