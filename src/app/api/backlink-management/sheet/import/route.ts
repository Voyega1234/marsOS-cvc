import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceIdentity } from "@/lib/google-auth";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { isMissingTable } from "@/lib/backlink-management/projects";
import { isApprover } from "@/lib/backlink-management/types";
import { parseSpreadsheetId } from "@/lib/backlink-management/sheet-tables";
import {
  readSourceSheet, runSheetImport, sheetReadErrorMessage, SheetImportError, type SheetSource,
} from "@/lib/backlink-management/sheet-import-server";

// นำเข้าจาก Google Sheet ของทีม (Sheet → MarsOS) — อ่านชีทอย่างเดียว ไม่เขียนกลับ
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MISSING_TABLE_MSG = "ยังไม่ได้สร้างตารางสำหรับนำเข้าจาก Google Sheet ให้ผู้ดูแลรันไฟล์ scripts/sql/add-blm-sheet-import-tables.sql ก่อน";

async function serviceEmail(): Promise<string> {
  try { return (await getServiceIdentity()).email || ""; } catch { return ""; }
}

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  const canEdit = isApprover(ctx.role);
  try {
    const [cfg, email] = await Promise.all([
      prisma.blmSheetImportConfig.findUnique({ where: { organizationId: ctx.orgId } }),
      serviceEmail(),
    ]);
    return NextResponse.json({
      serviceEmail: email,
      canEdit,
      config: cfg
        ? { spreadsheetUrl: cfg.spreadsheetUrl, title: cfg.title, budgetPeriod: cfg.budgetPeriod, lastImportedAt: cfg.lastImportedAt, lastSummary: cfg.lastSummary ?? null }
        : null,
    });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ serviceEmail: await serviceEmail(), canEdit, tableMissing: true, config: null });
    return serverError(e);
  }
}

/** ดูตัวอย่าง (ค่าเริ่มต้น) หรือเขียนจริงเมื่อ apply: true — ทุกครั้งอ่านชีทใหม่ฝั่งเซิร์ฟเวอร์ ไม่เชื่อแถวจาก client */
export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  if (!isApprover(ctx.role)) return NextResponse.json({ error: "เฉพาะ ADMIN หรือ SEO Manager เท่านั้นที่นำเข้าจาก Google Sheet ได้" }, { status: 403 });
  try {
    const b = await req.json().catch(() => ({}));
    const id = parseSpreadsheetId(b?.url);
    if (!id) return NextResponse.json({ error: "ลิงก์ Google Sheet ไม่ถูกต้อง" }, { status: 400 });

    let source: SheetSource;
    try {
      source = await readSourceSheet(id);
    } catch (e) {
      if (e instanceof SheetImportError) return NextResponse.json({ error: e.message }, { status: e.status });
      return NextResponse.json({ error: sheetReadErrorMessage(e, await serviceEmail()) }, { status: 400 });
    }

    const out = await runSheetImport({ orgId: ctx.orgId, userId: ctx.userId }, source, {
      budgetPeriod: b?.budgetPeriod,
      projectMap: b?.projectMap,
      update: b?.update !== false,
      cancelMissing: b?.cancelMissing === true,
      apply: b?.apply === true,
      expectedHash: b?.expectedHash,
    });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof SheetImportError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (isMissingTable(e)) return NextResponse.json({ error: MISSING_TABLE_MSG }, { status: 503 });
    if ((e as { code?: unknown } | null)?.code === "P2002") {
      return NextResponse.json({ error: "มีการนำเข้าซ้อนกัน หรือข้อมูลเปลี่ยนระหว่างนำเข้า — ไม่มีอะไรถูกบันทึก กดอ่านชีทแล้วลองใหม่" }, { status: 409 });
    }
    return serverError(e);
  }
}
