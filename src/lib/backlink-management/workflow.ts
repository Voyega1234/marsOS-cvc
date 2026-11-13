/** เวิร์กโฟลว์สถานะคำขอ backlink (ไฟล์บริสุทธิ์) */
import { isApprover, type BlmStatus } from "./types";

export type BlmAction =
  | "approve" | "reject" | "start" | "publish" | "cancel" | "resubmit" | "markLost" | "markVerified";

export interface ActionRequestLike {
  status: string;
  liveUrl?: string | null;
  reason?: string | null;
}

export interface ActionInput {
  reason?: string;
  liveUrl?: string;
}

export type ActionResult = { ok: true; toStatus: BlmStatus } | { ok: false; error: string };

export const ACTIONS: BlmAction[] = [
  "approve", "reject", "start", "publish", "cancel", "resubmit", "markLost", "markVerified",
];

export const ACTION_LABEL: Record<BlmAction, string> = {
  approve: "อนุมัติงบ",
  reject: "ไม่อนุมัติ",
  start: "เริ่มดำเนินการ",
  publish: "บันทึกว่าเผยแพร่แล้ว",
  cancel: "ยกเลิก",
  resubmit: "ส่งขออนุมัติใหม่",
  markLost: "ทำเครื่องหมายลิงก์หาย",
  markVerified: "ยืนยันว่าลิงก์อยู่",
};

const RULES: Record<BlmAction, { from: string[]; to: BlmStatus; approver: boolean }> = {
  approve: { from: ["REQUESTED"], to: "APPROVED", approver: true },
  reject: { from: ["REQUESTED"], to: "REJECTED", approver: true },
  start: { from: ["APPROVED"], to: "IN_PROGRESS", approver: false },
  publish: { from: ["APPROVED", "IN_PROGRESS"], to: "PUBLISHED", approver: false },
  cancel: { from: ["REQUESTED", "APPROVED", "IN_PROGRESS"], to: "CANCELLED", approver: false },
  resubmit: { from: ["REJECTED", "CANCELLED"], to: "REQUESTED", approver: false },
  markLost: { from: ["PUBLISHED", "VERIFIED"], to: "LOST", approver: true },
  markVerified: { from: ["PUBLISHED", "LOST"], to: "VERIFIED", approver: true },
};

export function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** action ที่ role + สถานะนี้ทำได้ (ใช้แสดงปุ่ม) */
export function allowedActions(status: string, role: string): BlmAction[] {
  return ACTIONS.filter((a) => {
    const r = RULES[a];
    return r.from.includes(status) && (!r.approver || isApprover(role));
  });
}

export function resolveAction(
  action: string,
  request: ActionRequestLike,
  role: string,
  input: ActionInput = {},
): ActionResult {
  const rule = RULES[action as BlmAction];
  if (!rule) return { ok: false, error: "ไม่รู้จักการกระทำนี้" };
  if (rule.approver && !isApprover(role)) {
    return { ok: false, error: "เฉพาะ ADMIN หรือ SEO Manager เท่านั้นที่ทำรายการนี้ได้" };
  }
  if (!rule.from.includes(request.status)) {
    return { ok: false, error: "สถานะปัจจุบันของคำขอไม่รองรับการกระทำนี้" };
  }
  if (action === "reject" && !(input.reason ?? request.reason ?? "").trim()) {
    return { ok: false, error: "กรุณาระบุเหตุผลที่ไม่อนุมัติ" };
  }
  if (action === "publish") {
    const url = (input.liveUrl ?? request.liveUrl ?? "").trim();
    if (!isHttpUrl(url)) {
      return { ok: false, error: "กรุณาระบุ URL ของหน้าที่ลิงก์อยู่จริง (http/https)" };
    }
  }
  return { ok: true, toStatus: rule.to };
}
