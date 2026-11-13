import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/logActivity";
import { LOGIN_ACTION } from "@/lib/activity-describe";
import { setActiveCookie } from "@/lib/idle-session";
import { safeNextPath } from "@/lib/safe-redirect";
import { checkLoginPolicy } from "@/lib/login-policy";

export const dynamic = "force-dynamic";

/** OAuth callback (Google) — แลก authorization code เป็น session cookie */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  // path ภายในเว็บเท่านั้น — กัน //evil.com, /\evil.com, /<tab>/evil.com พาออกไปเว็บอื่น (open redirect)
  const dest = safeNextPath(next) ?? "/";

  let loggedIn = false;
  if (code) {
    const supabase = createSupabaseServer();
    if (supabase) {
      const { data } = await supabase.auth.exchangeCodeForSession(code);
      loggedIn = !!data?.session;
      // จด "เข้าสู่ระบบ" — เฉพาะ User ที่มีในระบบแล้ว (คนใหม่ถูกสร้างตอนเปิดหน้าแรก จดจากการเปิดหน้าแทน)
      // อ่าน user จาก /user ด้วย token ตัวเดียวกัน — ทางเดียวกับ src/lib/auth.ts (ได้ identities ครบเหมือนด่านจริง)
      const accessToken = data?.session?.access_token;
      const authUser = accessToken ? (await supabase.auth.getUser(accessToken)).data.user : null;
      const email = authUser?.email?.toLowerCase();
      if (accessToken && authUser && email) {
        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, status: "ACTIVE" } }).catch(() => null);
        if (user?.organizationId) {
          // กติกาเดียวกับ getSession (src/lib/login-policy.ts) — session ที่ถูกปฏิเสธจะไม่ถูกจดว่า "เข้าสู่ระบบ"
          // ตัวกันเข้าจริงอยู่ที่ src/lib/auth.ts ตรงนี้คุมแค่ความถูกต้องของ Activity Log
          const decision = checkLoginPolicy({ email, role: user.role, accessToken, authUser, userId: user.id });
          if (decision.ok) {
            await logActivity({ organizationId: user.organizationId, userId: user.id, action: LOGIN_ACTION, entityType: "User", entityId: user.id });
          } else {
            console.warn(`[auth] denied at callback: ${decision.reason} (role ${user.role}) — ${email}`);
          }
        }
      }
    }
  }
  const res = NextResponse.redirect(new URL(dest, url.origin));
  // เริ่มนับเวลาใช้งานใหม่ (idle logout 12 ชม. ใน middleware)
  if (loggedIn) setActiveCookie(res);
  return res;
}
