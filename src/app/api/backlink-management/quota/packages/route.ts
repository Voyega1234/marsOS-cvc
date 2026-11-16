import { NextRequest, NextResponse } from "next/server";
import { requireStaff, isCtx } from "@/lib/backlink-management/server";
import { googleSheetsPort } from "@/lib/backlink-management/quota-sheets-port";
import { createPackage } from "@/lib/backlink-management/quota-server";
import { readConfirmOverwrite, readPackageInput } from "@/lib/backlink-management/quota-write";
import { quotaFail, readJson } from "@/lib/backlink-management/quota-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const body = await readJson(req);
    const input = readPackageInput(body);
    return NextResponse.json(await createPackage(ctx, input, { port: googleSheetsPort(), confirmOverwrite: readConfirmOverwrite(body.confirmOverwrite) }));
  } catch (e) {
    return quotaFail(e);
  }
}
