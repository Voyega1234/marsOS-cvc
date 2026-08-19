import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// สถานะการเชื่อมต่อ AI จริง — ใช้ตัดสินว่าจะโชว์แบนเนอร์ "ยังไม่ได้เชื่อมต่อ" หรือไม่
// ทั้งระบบวิ่งผ่าน OpenRouter ด้วย key เดียว (writer/image/util — ดู src/lib/openrouter.ts)
// ของเก่า (ANTHROPIC_API_KEY + GCP OIDC/ADC) เลิกใช้แล้วตั้งแต่ย้าย OpenRouter
export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  // คง shape เดิม (claude/gemini) ให้ UI เก่าไม่พัง — ทั้งคู่สะท้อน key เดียวกัน
  return NextResponse.json({ claude: openrouter, gemini: openrouter, connected: openrouter, mode: "openrouter" });
}
