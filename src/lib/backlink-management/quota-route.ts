/** ตัวช่วยของ route โควต้า: แปลง QuotaError เป็น JSON ที่ถูกสถานะ */
import { NextResponse } from "next/server";
import { serverError } from "./server";
import { QuotaError } from "./quota-write";

export function quotaFail(e: unknown): NextResponse {
  if (e instanceof QuotaError) {
    return NextResponse.json(
      {
        error: e.message,
        ...(e.tableMissing ? { tableMissing: true } : {}),
        ...(e.overwrites ? { needsConfirm: true, overwrites: e.overwrites } : {}),
      },
      { status: e.status },
    );
  }
  return serverError(e);
}

/** body JSON ที่ไม่ใช่ object = {} (ไม่ throw) */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const b: unknown = await req.json().catch(() => ({}));
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}
