import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import { removeStalePackage, updatePackage } from "@/lib/backlink-management/quota-server";
import { readConfirmOverwrite, readPackageInput } from "@/lib/backlink-management/quota-write";
import { quotaFail, readJson } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const body = await readJson(req);
    const input = readPackageInput(body);
    return NextResponse.json(await updatePackage(ctx, params.id, input, { port: googleSheetsPort(), confirmOverwrite: readConfirmOverwrite(body.confirmOverwrite) }));
  } catch (e) {
    return quotaFail(e);
  }
}

/** ลบแพ็กเกจที่ไม่พบในชีทแล้ว (stale) ออกจากระบบ — ผู้จัดการเท่านั้น, ลบเฉพาะใน DB ไม่แตะชีท */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    return NextResponse.json(await removeStalePackage(ctx, params.id, { port: googleSheetsPort() }));
  } catch (e) {
    return quotaFail(e);
  }
}
