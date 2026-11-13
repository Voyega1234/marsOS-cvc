import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/logActivity";
import { LOGIN_ACTION } from "@/lib/activity-describe";
import { setActiveCookie } from "@/lib/idle-session";
import { amrTimestamp, checkLoginPolicy, decodeJwtPayload } from "@/lib/login-policy";

export const dynamic = "force-dynamic";

/** ข้อความเดียวทุกกรณี — ไม่บอกว่าชื่อผู้ใช้มีอยู่หรือไม่ หรือถูกปฏิเสธเพราะอะไร */
const GENERIC_ERROR = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
/** ต้องเป็นการกรอกรหัสผ่านเมื่อครู่นี้ — session รหัสผ่านเก่าใช้เปิดทางเข้าใหม่ไม่ได้ */
const PASSWORD_MAX_AGE_S = 300;
const CLOCK_SKEW_S = 60;

/**
 * ปิดท้ายการ login ด้วยชื่อผู้ใช้ + รหัสผ่านของลูกค้า (role CLIENT)
 *
 * หน้า login เรียก signInWithPassword ในเบราว์เซอร์ก่อน แล้ว POST มาที่นี่ทันที
 * ที่นี่ตรวจกติกาเดียวกับ getSession (src/lib/login-policy.ts) แล้วจึงเริ่มนับเวลาใช้งาน (idle cookie) และจด Activity Log
 * ไม่ผ่าน = ออกจากระบบ session นั้นทันที · ตัวกันเข้าจริงยังอยู่ที่ src/lib/auth.ts ทุก request
 * ทีมงานเข้าทางนี้ไม่ได้ — role ที่ไม่ใช่ CLIENT ถูกปฏิเสธเสมอ
 */
export async function POST() {
  const supabase = createSupabaseServer();
  if (!supabase) return NextResponse.json({ error: "ระบบ login ยังไม่พร้อม" }, { status: 503 });

  const deny = async (reason: string, email?: string) => {
    console.warn(`[auth] denied at password login: ${reason} — ${email ?? "unknown"}`);
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  };

  const { data: { session: authSession } } = await supabase.auth.getSession();
  const accessToken = authSession?.access_token;
  if (!accessToken) return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });

  // ยืนยัน token กับ Supabase — ห้ามเชื่อ session.user จาก cookie ตรง ๆ
  const { data: { user: authUser } } = await supabase.auth.getUser(accessToken);
  const email = authUser?.email?.toLowerCase();
  if (!authUser || !email) return deny("invalid_session");

  const user = await prisma.user
    .findFirst({ where: { email: { equals: email, mode: "insensitive" }, status: "ACTIVE" } })
    .catch(() => null);
  if (!user) return deny("no_active_user", email);
  if (user.role !== "CLIENT") return deny(`role_not_client (${user.role})`, email);

  const decision = checkLoginPolicy({ email, role: user.role, accessToken, authUser, userId: user.id });
  if (!decision.ok) return deny(decision.reason, email);

  const signedInAt = amrTimestamp(decodeJwtPayload(accessToken), "password");
  const now = Math.floor(Date.now() / 1000);
  if (signedInAt === null || signedInAt > now + CLOCK_SKEW_S || now - signedInAt > PASSWORD_MAX_AGE_S) {
    return deny("stale_password_login", email);
  }

  if (user.organizationId) {
    await logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      action: LOGIN_ACTION,
      entityType: "User",
      entityId: user.id,
    });
  }

  const res = NextResponse.json({ ok: true });
  // เริ่มนับเวลาใช้งาน (idle logout 12 ชม. ใน middleware) — ไม่มี cookie นี้ request ถัดไปจะถูกนับว่าหมดเวลา
  setActiveCookie(res);
  return res;
}
