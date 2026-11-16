import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceIdentity } from "@/lib/google-auth";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { isMissingTable } from "@/lib/backlink-management/projects";
import { isApprover } from "@/lib/backlink-management/types";
import { parseSpreadsheetId } from "@/lib/backlink-management/sheet-tables";
import { checkAccess, sheetErrorMessage, syncSheet } from "@/lib/backlink-management/sheet-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MISSING_TABLE_MSG = "ยังไม่ได้สร้างตาราง BlmSheetConfig ในฐานข้อมูล ให้ผู้ดูแลรันไฟล์ scripts/sql/add-blm-project-sheet-tables.sql ก่อน";

async function serviceEmail(): Promise<string> {
  try { return (await getServiceIdentity()).email || ""; } catch { return ""; }
}

async function view(orgId: string, canEdit: boolean) {
  // เรียก prisma ตรง ๆ (ไม่ผ่าน getSheetConfig) เพื่อให้ "ตารางยังไม่มี" โผล่เป็น error ให้ GET ตอบ tableMissing ได้
  const [cfg, email] = await Promise.all([
    prisma.blmSheetConfig.findUnique({ where: { organizationId: orgId } }),
    serviceEmail(),
  ]);
  return {
    connected: !!cfg,
    spreadsheetUrl: cfg?.spreadsheetUrl ?? "",
    title: cfg?.title ?? "",
    lastSyncedAt: cfg?.lastSyncedAt ?? null,
    lastError: cfg?.lastError ?? "",
    pending: !!cfg?.dirtyAt,
    serviceEmail: email,
    canEdit,
  };
}

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  const canEdit = isApprover(ctx.role);
  try {
    return NextResponse.json(await view(ctx.orgId, canEdit));
  } catch (e) {
    if (isMissingTable(e)) {
      return NextResponse.json({
        connected: false, spreadsheetUrl: "", title: "", lastSyncedAt: null, lastError: "", pending: false,
        serviceEmail: await serviceEmail(), canEdit, tableMissing: true,
      });
    }
    return serverError(e);
  }
}

export async function PUT(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  if (!isApprover(ctx.role)) return NextResponse.json({ error: "เฉพาะ ADMIN หรือ SEO Manager เท่านั้นที่เชื่อม Google Sheet ได้" }, { status: 403 });
  try {
    const b = await req.json().catch(() => ({}));
    const id = parseSpreadsheetId(b?.url);
    if (!id) return NextResponse.json({ error: "ลิงก์ Google Sheet ไม่ถูกต้อง" }, { status: 400 });
    try {
      await checkAccess(id);
    } catch (e) {
      return NextResponse.json({ error: sheetErrorMessage(e, await serviceEmail()) }, { status: 400 });
    }
    const url = `https://docs.google.com/spreadsheets/d/${id}/edit`;
    await prisma.blmSheetConfig.upsert({
      where: { organizationId: ctx.orgId },
      create: { organizationId: ctx.orgId, spreadsheetId: id, spreadsheetUrl: url, dirtyAt: new Date(), connectedById: ctx.userId },
      update: { spreadsheetId: id, spreadsheetUrl: url, title: "", dirtyAt: new Date(), lastSyncedAt: null, lastError: "", connectedById: ctx.userId },
    });
    const sync = await syncSheet(ctx.orgId, { force: true });
    return NextResponse.json({ ...(await view(ctx.orgId, true)), sync });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: MISSING_TABLE_MSG }, { status: 503 });
    return serverError(e);
  }
}

export async function DELETE() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  if (!isApprover(ctx.role)) return NextResponse.json({ error: "เฉพาะ ADMIN หรือ SEO Manager เท่านั้น" }, { status: 403 });
  try {
    await prisma.blmSheetConfig.deleteMany({ where: { organizationId: ctx.orgId } });
    return NextResponse.json(await view(ctx.orgId, true));
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: MISSING_TABLE_MSG }, { status: 503 });
    return serverError(e);
  }
}
