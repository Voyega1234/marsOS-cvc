import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import { cancelReservation, updateReservation } from "@/lib/backlink-management/quota-server";
import { readConfirmOverwrite, readReservationInput } from "@/lib/backlink-management/quota-write";
import { quotaFail, readJson } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const { reservedById, website, projectId, note } = readReservationInput(await readJson(req));
    return NextResponse.json(await updateReservation(ctx, params.id, { reservedById, website, projectId, note }, { port: googleSheetsPort() }));
  } catch (e) {
    return quotaFail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const body = await readJson(req);
    return NextResponse.json(await cancelReservation(ctx, params.id, { port: googleSheetsPort(), confirmOverwrite: readConfirmOverwrite(body.confirmOverwrite) }));
  } catch (e) {
    return quotaFail(e);
  }
}
