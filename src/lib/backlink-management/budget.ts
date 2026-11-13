/** คำนวณงบ backlink (ไฟล์บริสุทธิ์) */

export function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/** "YYYY-MM" ตามเวลา Asia/Bangkok */
export function currentPeriod(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

export function isValidPeriod(p: unknown): p is string {
  return typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

export interface BudgetRequestLike {
  status: string;
  quotedPrice: number;
  actualPrice: number | null;
}

export interface BudgetSummary {
  approved: number;
  pending: number;
  reserved: number;
  actual: number;
  remaining: number;
  overBudget: boolean;
}

export function summarizeBudget(approved: number, requests: BudgetRequestLike[]): BudgetSummary {
  let pending = 0;
  let reserved = 0;
  let actual = 0;
  for (const r of requests) {
    const q = Number(r.quotedPrice) || 0;
    if (r.status === "REQUESTED") pending += q;
    else if (r.status === "APPROVED" || r.status === "IN_PROGRESS") reserved += q;
    else if (r.status === "PUBLISHED" || r.status === "VERIFIED" || r.status === "LOST") {
      actual += r.actualPrice ?? q;
    }
  }
  const a = round2(approved);
  const remaining = round2(a - reserved - actual);
  return {
    approved: a,
    pending: round2(pending),
    reserved: round2(reserved),
    actual: round2(actual),
    remaining,
    overBudget: remaining < 0,
  };
}
