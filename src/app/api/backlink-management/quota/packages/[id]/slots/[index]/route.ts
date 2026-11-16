import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import { updateSlot } from "@/lib/backlink-management/quota-server";
import { readConfirmOverwrite, readSlotInput } from "@/lib/backlink-management/quota-write";
import { quotaFail, readJson } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function PATCH(req: NextRequest, { params }: { params: { id: string; index: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    if (!/^\d+$/.test(params.index)) return NextResponse.json({ error: "ไม่มีช่องนี้ในแพ็กเกจ" }, { status: 400 });
    const body = await readJson(req);
    const input = readSlotInput(body);
    return NextResponse.json(await updateSlot(ctx, params.id, Number(params.index), input, { port: googleSheetsPort(), confirmOverwrite: readConfirmOverwrite(body.confirmOverwrite) }));
  } catch (e) {
    return quotaFail(e);
  }
}
