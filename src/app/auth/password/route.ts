import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/logActivity";
import { LOGIN_ACTION } from "@/lib/activity-describe";
import { setActiveCookie } from "@/lib/idle-session";
import { amrTimestamp, checkLoginPolicy, decodeJwtPayload } from "@/lib/login-policy";
import { isFreshPasswordLogin, type PasswordSessionDenialCode } from "@/lib/client-login";

export const dynamic = "force-dynamic";

/** ข้อความเดียวทุกกรณี — ไม่บอกว่าชื่อผู้ใช้มีอยู่หรือไม่ หรือถูกปฏิเสธเพราะอะไร */
const GENERIC_ERROR = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
/**
 * code คู่กับข้อความกลาง — บอกแค่ว่า "ไม่มี session มาถึง" หรือ "กติกาไม่ให้เข้า" ให้หน้า login เลือกข้อความถูก
 * เหตุผลละเอียดอยู่ใน log ของเซิร์ฟเวอร์เท่านั้น (ช่วงเวลาที่รับการกรอกรหัสผ่าน: isFreshPasswordLogin ใน client-login.ts)
 */
const denied = (code: PasswordSessionDenialCode) => NextResponse.json({ error: GENERIC_ERROR, code }, { status: 401 });

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

  const deny = async (reason: string, email?: string, code: PasswordSessionDenialCode = "denied") => {
    console.warn(`[auth] denied at password login: ${reason} — ${email ?? "unknown"}`);
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return denied(code);
  };

  const { data: { session: authSession } } = await supabase.auth.getSession();
  const accessToken = authSession?.access_token;
  if (!accessToken) return denied("no_session");

  // ยืนยัน token กับ Supabase — ห้ามเชื่อ session.user จาก cookie ตรง ๆ
  const { data: { user: authUser } } = await supabase.auth.getUser(accessToken);
  const email = authUser?.email?.toLowerCase();
  if (!authUser || !email) return deny("invalid_session", undefined, "no_session");

  const user = await prisma.user
    .findFirst({ where: { email: { equals: email, mode: "insensitive" }, status: "ACTIVE" } })
    .catch(() => null);
  if (!user) return deny("no_active_user", email);
  if (user.role !== "CLIENT") return deny(`role_not_client (${user.role})`, email);

  const decision = checkLoginPolicy({ email, role: user.role, accessToken, authUser, userId: user.id });
  if (!decision.ok) return deny(decision.reason, email);

  const signedInAt = amrTimestamp(decodeJwtPayload(accessToken), "password");
  const now = Math.floor(Date.now() / 1000);
  if (!isFreshPasswordLogin(signedInAt, now)) {
    return deny(`stale_password_login (amr ${signedInAt ?? "none"}, now ${now})`, email);
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
