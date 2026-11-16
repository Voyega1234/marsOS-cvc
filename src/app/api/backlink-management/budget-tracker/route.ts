import { NextResponse } from "next/server";
import { getServiceIdentity } from "@/lib/google-auth";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { BUDGET_TRACKER_SHEET_ID, linkTrackerProjects, summarizeTracker } from "@/lib/backlink-management/budget-tracker";
import { loadTrackerProjectMap, syncTrackerProjects, type TrackerSyncResult } from "@/lib/backlink-management/budget-tracker-server";
import { listAllProjects } from "@/lib/backlink-management/projects";
import {
  readSourceSheet, sheetReadErrorMessage, spreadsheetUrl, SheetImportError, type SheetSource,
} from "@/lib/backlink-management/sheet-import-server";

// งบ Backlink จาก Google Sheet "Backlink Budget Tracker" สำหรับหน้า Report — อ่านชีทอย่างเดียว ไม่เขียนกลับ
// ชีทนี้คือรายชื่อโปรเจกต์ล่าสุดของทีม: โปรเจกต์ในชีทที่ยังไม่มีใน MarsOS ถูกสร้างให้อัตโนมัติ (syncTrackerProjects)
// links = แต่ละโปรเจกต์ในชีทตรงกับโปรเจกต์ไหนใน MarsOS · created = ชื่อที่เพิ่งสร้างในรอบนี้
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function serviceEmail(): Promise<string> {
  try { return (await getServiceIdentity()).email || ""; } catch { return ""; }
}

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  const id = BUDGET_TRACKER_SHEET_ID;
  const url = spreadsheetUrl(id);
  let source: SheetSource;
  try {
    source = await readSourceSheet(id);
  } catch (e) {
    const email = await serviceEmail();
    if (e instanceof SheetImportError) return NextResponse.json({ error: e.message, url, serviceEmail: email }, { status: e.status });
    return NextResponse.json({ error: sheetReadErrorMessage(e, email), url, serviceEmail: email }, { status: 400 });
  }
  try {
    const summary = summarizeTracker(source.budgetGrid, source.expenseGrid);
    let sync: TrackerSyncResult;
    try {
      sync = await syncTrackerProjects(ctx.orgId, ctx.userId, summary.rows);
    } catch (e) {
      // ซิงก์โปรเจกต์ไม่สำเร็จ ไม่ควรทำให้รายงานงบเปิดไม่ได้
      console.error("[budget-tracker] project sync failed", e);
      const [projects, projectMap] = await Promise.all([listAllProjects(ctx.orgId), loadTrackerProjectMap(ctx.orgId)]);
      sync = { links: linkTrackerProjects(summary.rows, projects, projectMap), created: [], skipped: true };
    }
    return NextResponse.json({
      title: source.title,
      url,
      budgetTab: source.budgetTab,
      expenseTab: source.expenseTab,
      fetchedAt: new Date().toISOString(),
      ...summary,
      links: sync.links,
      created: sync.created,
    });
  } catch (e) {
    return serverError(e);
  }
}
