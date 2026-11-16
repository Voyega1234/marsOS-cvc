import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import { packageTypeOptions } from "@/lib/backlink-management/quota-server";
import { quotaFail } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * รายการ dropdown ของช่อง Type ในชีท — อ่านอย่างเดียว
 * id = แพ็กเกจที่กำลังแก้ · id = "new" ใช้ ?sourceId=&tabTitle= (เพิ่มแพ็กเกจในแท็บนั้น)
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const sp = req.nextUrl.searchParams;
    const q = params.id === "new"
      ? { sourceId: sp.get("sourceId") ?? undefined, tabTitle: sp.get("tabTitle") ?? undefined }
      : { packageId: params.id };
    return NextResponse.json(await packageTypeOptions(ctx, q, { port: googleSheetsPort() }));
  } catch (e) {
    return quotaFail(e);
  }
}
