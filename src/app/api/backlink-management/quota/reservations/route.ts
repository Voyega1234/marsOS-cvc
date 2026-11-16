import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import { createReservation } from "@/lib/backlink-management/quota-server";
import { readConfirmOverwrite, readReservationInput } from "@/lib/backlink-management/quota-write";
import { quotaFail, readJson } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const body = await readJson(req);
    const input = readReservationInput(body);
    return NextResponse.json(await createReservation(ctx, input, { port: googleSheetsPort(), confirmOverwrite: readConfirmOverwrite(body.confirmOverwrite) }));
  } catch (e) {
    return quotaFail(e);
  }
}
