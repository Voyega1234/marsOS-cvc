import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { loadSheetTables } from "@/lib/backlink-management/sheet-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ชื่อ worksheet ต้อง ≤ 31 ตัว และไม่มี []:*?/\
const SHEET_NAMES = ["คำขอ Backlink", "คลังเว็บ", "งบประมาณ"];

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const tables = await loadSheetTables(ctx.orgId);
    const wb = new ExcelJS.Workbook();
    tables.forEach((t, i) => {
      const ws = wb.addWorksheet(SHEET_NAMES[i] ?? `Sheet${i + 1}`, { views: [{ state: "frozen", ySplit: 1 }] });
      const head = ws.addRow(t.header);
      head.font = { bold: true };
      // เขียนเป็นค่าล้วนเสมอ (ไม่ใช่สูตร)
      for (const r of t.rows) ws.addRow(r);
      ws.columns.forEach((c, ci) => { c.width = Math.min(40, Math.max(12, (t.header[ci]?.length ?? 10) + 4)); });
    });
    const buffer = await wb.xlsx.writeBuffer();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="backlink-management-${today}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
