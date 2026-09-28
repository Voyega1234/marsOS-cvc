import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/logActivity";
import { LOGIN_ACTION } from "@/lib/activity-describe";

export const dynamic = "force-dynamic";

/** OAuth callback (Google) — แลก authorization code เป็น session cookie */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const dest = next && next.startsWith("/") ? next : "/";

  if (code) {
    const supabase = createSupabaseServer();
    if (supabase) {
      const { data } = await supabase.auth.exchangeCodeForSession(code);
      // จด "เข้าสู่ระบบ" — เฉพาะ User ที่มีในระบบแล้ว (คนใหม่ถูกสร้างตอนเปิดหน้าแรก จดจากการเปิดหน้าแทน)
      const email = data?.user?.email?.toLowerCase();
      if (email) {
        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, status: "ACTIVE" } }).catch(() => null);
        if (user?.organizationId) {
          await logActivity({ organizationId: user.organizationId, userId: user.id, action: LOGIN_ACTION, entityType: "User", entityId: user.id });
        }
      }
    }
  }
  return NextResponse.redirect(new URL(dest, url.origin));
}
