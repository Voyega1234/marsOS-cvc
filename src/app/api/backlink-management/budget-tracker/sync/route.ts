import { NextResponse } from "next/server";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { BUDGET_TRACKER_SHEET_ID, summarizeTracker } from "@/lib/backlink-management/budget-tracker";
import { syncTrackerProjects } from "@/lib/backlink-management/budget-tracker-server";
import { readSourceSheet, SheetImportError } from "@/lib/backlink-management/sheet-import-server";

// ชีท Backlink Budget Tracker = รายชื่อโปรเจกต์ล่าสุดของทีม — หน้า Backlink Management เรียกเบื้องหลังตอนเปิดหน้า
// เพื่อสร้างโปรเจกต์ที่เพิ่มในชีทให้มีในระบบ (อ่านชีทอย่างเดียว ไม่เขียนกลับ ไม่ลบโปรเจกต์)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const source = await readSourceSheet(BUDGET_TRACKER_SHEET_ID);
    const summary = summarizeTracker(source.budgetGrid, source.expenseGrid);
    const r = await syncTrackerProjects(ctx.orgId, ctx.userId, summary.rows);
    return NextResponse.json({ created: r.created, skipped: r.skipped, total: summary.rows.length });
  } catch (e) {
    if (e instanceof SheetImportError) return NextResponse.json({ error: e.message }, { status: e.status });
    return serverError(e);
  }
}
