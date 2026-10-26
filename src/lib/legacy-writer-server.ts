import { NextResponse } from "next/server";
import { LEGACY_AI_WRITER_ENABLED, LEGACY_WRITER_GONE_MESSAGE } from "@/lib/legacy-writer";

export { LEGACY_WRITER_GONE_MESSAGE };

// route เขียนบทความแบบเก่า: ตอบ 410 ทันทีเมื่อปิดใช้งาน (เรียกเป็นคำสั่งแรกของ POST)
export function legacyWriterGuard(): NextResponse | null {
  if (LEGACY_AI_WRITER_ENABLED) return null;
  return NextResponse.json(
    { error: LEGACY_WRITER_GONE_MESSAGE, code: "LEGACY_WRITER_DISABLED" },
    { status: 410 },
  );
}
