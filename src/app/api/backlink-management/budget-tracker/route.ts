import { NextResponse } from "next/server";
import { getServiceIdentity } from "@/lib/google-auth";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { BUDGET_TRACKER_SHEET_ID, summarizeTracker } from "@/lib/backlink-management/budget-tracker";
import {
  readSourceSheet, sheetReadErrorMessage, spreadsheetUrl, SheetImportError, type SheetSource,
} from "@/lib/backlink-management/sheet-import-server";

// งบ Backlink จาก Google Sheet "Backlink Budget Tracker" สำหรับหน้า Report — อ่านอย่างเดียว ไม่เขียนกลับ ไม่เก็บลง DB
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
    return NextResponse.json({
      title: source.title,
      url,
      budgetTab: source.budgetTab,
      expenseTab: source.expenseTab,
      fetchedAt: new Date().toISOString(),
      ...summary,
    });
  } catch (e) {
    return serverError(e);
  }
}
