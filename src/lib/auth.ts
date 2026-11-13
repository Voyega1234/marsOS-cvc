import { cache } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { AppSession } from "@/lib/session-types";
import type { Role } from "@/types";
import { isClientApiAllowed, isClientPageAllowed } from "@/lib/client-access";
import { recordApiRequest } from "@/lib/logActivity";
import { checkLoginPolicy } from "@/lib/login-policy";

export type { AppSession };

/**
 * getSession — Supabase Auth (user pool เดียวกับ plasai) → map เข้า User ของระบบ
 *
 * กติกาเข้าระบบ (คำสั่งเจ้าของ 2026-08-19 — ปรับเป็น allowlist คืนเดียวกัน):
 * 1. email ตรงกับ User ในระบบและ ACTIVE → เข้าได้ตาม role เดิม
 * 2. email อยู่ใน ALLOWED_EMAILS แต่ยังไม่มี User → สร้างให้อัตโนมัติ (SEO_MANAGER)
 *    (เจ้าของสั่ง: ให้เฉพาะรายชื่อนี้ก่อน ยังไม่เปิดทั้งโดเมน @convertcake.com)
 * 3. User ที่ INACTIVE หรือ email นอกเหนือจากนี้ → ปฏิเสธ (คืน null)
 * เพิ่มคนทีหลังได้สองทาง: ADMIN เพิ่มในหน้า Users (เข้าเกณฑ์ข้อ 1) หรือเติมรายชื่อในไฟล์นี้
 *
 * ด่านเพิ่ม (คำสั่งเจ้าของ 2026-11-13: "เข้าผ่าน Google ได้ แต่ต้องเป็นเมล @convertcake.com เท่านั้น")
 * ใช้กับข้อ 1 และ 2 ทุกครั้ง — ตัวกติกาอยู่ที่ src/lib/login-policy.ts:
 * - session ต้องมาจากการ login ด้วย Google (รหัสผ่าน / OTP / magic link ถูกปฏิเสธ)
 * - บัญชีต้องไม่มีทางเข้าอื่นผูกอยู่ (OAuth เจ้าอื่น หรือ Google อีกบัญชี)
 * - อีเมลต้องเป็น @convertcake.com — ยกเว้น role CLIENT (ลูกค้า) ที่ใช้อีเมลของตัวเองได้
 *   ผลคือ User ของทีมที่แอดมินเพิ่มด้วยอีเมลโดเมนอื่นจะเข้าไม่ได้
 * - ข้อยกเว้นเดียวของ "ต้อง Google": role CLIENT ที่ทีมสร้างในหน้า "จัดการ Users" เข้าด้วยชื่อผู้ใช้ + รหัสผ่านได้
 *   เฉพาะบัญชี Supabase ที่ MarsOS สร้างให้ User คนนั้นเอง (src/lib/supabase/admin.ts) — ทีมยังต้องใช้ Google เสมอ
 *
 * ถ้า env Supabase ไม่ครบ (local dev) → fallback โหมดไม่มี login แบบเดิม
 * (คืน ADMIN ที่ active คนแรก) — middleware ก็ผ่านหมดในโหมดนี้เช่นกัน
 *
 * cache() ของ React = ยิงครั้งเดียวต่อ request (ตัว cache 60 วิ ระดับ instance
 * ที่เคยมีถูกถอดออกแล้ว — ใช้ไม่ได้เมื่อ session ต่างกันต่อคน)
 */

const ALLOWED_EMAILS = new Set([
  "giggs@convertcake.com",
  "masia@convertcake.com",
  "karn@convertcake.com",
  "nut.j@convertcake.com",
  "pran@convertcake.com",
  "tommy@convertcake.com",
  "top@convertcake.com",
  "gift.a@convertcake.com",
  "nutt@convertcake.com",
  "wave@convertcake.com",
  "apps@convertcake.com",
  "mickey@convertcake.com",
  "tata@convertcake.com",
]);

/**
 * ADMIN ที่เจ้าของระบบกำหนดไว้ในโค้ด — ใช้แค่ตอน login ครั้งแรก (สร้าง User เป็น ADMIN เลย)
 * มี User อยู่แล้ว = ใช้ role ใน DB ตามจริง ไม่ยกสิทธิ์ซ้ำทุกครั้งที่ login (เปลี่ยน role ที่หน้า Users)
 */
const ADMIN_EMAILS = new Set([
  "apps@convertcake.com",
]);

function toSession(user: {
  id: string; name: string | null; email: string; image: string | null;
  role: string; organizationId: string | null;
}): AppSession {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role as Role,
      organizationId: user.organizationId,
    },
  };
}

const resolveSession = cache(async (): Promise<AppSession | null> => {
  const supabase = createSupabaseServer();

  // ── โหมด local dev (ไม่มี env Supabase) — พฤติกรรมเดิมก่อนมี login ──
  if (!supabase) {
    // บน Vercel ห้าม fallback เป็น ADMIN คนแรก (middleware ปิดเว็บไว้แล้ว กันซ้ำอีกชั้น)
    if (process.env.VERCEL) return null;
    const user =
      (await prisma.user.findFirst({ where: { status: "ACTIVE", role: "ADMIN" }, orderBy: { createdAt: "asc" } })) ??
      (await prisma.user.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } }));
    return user ? toSession(user) : null;
  }

  // access token ของ session — ใช้อ่าน claim `amr` (วิธี login) เท่านั้น
  // ห้ามใช้ session.user จาก getSession() (มาจาก cookie ตรง ๆ ยังไม่ผ่านการยืนยัน)
  const { data: { session: authSession } } = await supabase.auth.getSession();
  const accessToken = authSession?.access_token;
  if (!accessToken) return null;

  // ยืนยัน token ตัวนี้กับ Supabase — authUser คือเจ้าของ token ตัวเดียวกับที่ด่าน login-policy จะอ่าน
  const { data: { user: authUser } } = await supabase.auth.getUser(accessToken);
  if (!authUser?.email) return null;
  const email = authUser.email.toLowerCase();

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  if (existing) {
    // INACTIVE = ถูกปิดสิทธิ์ (เช่น adminseo/userseo เก่า) — ห้ามเข้าแม้ login ผ่าน
    if (existing.status !== "ACTIVE") {
      // จดไว้ใน log ของเซิร์ฟเวอร์ — ใช้ไล่ดูว่ามีใครพยายามเข้าด้วยบัญชีที่ถูกปิด
      console.warn(`[auth] denied: account not ACTIVE (${existing.status}) — ${email}`);
      return null;
    }
    // ต้องเข้าด้วย Google + ทีมต้องเป็น @convertcake.com (CLIENT ใช้อีเมลของตัวเองได้)
    // userId ใช้กับทางรหัสผ่านของ CLIENT — บัญชี Supabase ต้องถูกสร้างมาเพื่อ User คนนี้เท่านั้น
    const decision = checkLoginPolicy({ email, role: existing.role, accessToken, authUser, userId: existing.id });
    if (!decision.ok) {
      console.warn(`[auth] denied: ${decision.reason} (role ${existing.role}) — ${email}`);
      return null;
    }
    return toSession(existing);
  }

  // ── auto-provision: เฉพาะรายชื่อที่เจ้าของอนุมัติ เข้าครั้งแรก สร้าง User ให้เอง ──
  if (ALLOWED_EMAILS.has(email) || ADMIN_EMAILS.has(email)) {
    // ด่านเดียวกันก่อนสร้างบัญชี — role null = นับเป็นทีม ต้องเป็น Google @convertcake.com
    const decision = checkLoginPolicy({ email, role: null, accessToken, authUser });
    if (!decision.ok) {
      console.warn(`[auth] denied: ${decision.reason} (auto-provision) — ${email}`);
      return null;
    }
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) return null;
    const created = await prisma.user.create({
      data: {
        email,
        name: (authUser.user_metadata?.full_name as string | undefined)
          ?? email.split("@")[0],
        role: ADMIN_EMAILS.has(email) ? "ADMIN" : "SEO_MANAGER",
        status: "ACTIVE",
        organizationId: org.id,
        password: "",
      },
    });
    return toSession(created);
  }

  // login Google ผ่านแต่ไม่มีชื่อในระบบ — จดไว้ใน log ของเซิร์ฟเวอร์ (ไม่มี user ให้ผูก Activity Log)
  console.warn(`[auth] denied: no MarsOS user for ${email}`);
  return null;
});

/**
 * getSessionRaw — session จาก Supabase + จด Activity Log อัตโนมัติ
 * ทุก API ที่แก้ข้อมูล (POST/PUT/PATCH/DELETE) ผ่านจุดนี้ → บันทึกว่าใครทำอะไร (ครั้งเดียวต่อ request)
 */
export async function getSessionRaw(): Promise<AppSession | null> {
  const session = await resolveSession();
  if (session) await recordApiRequest(session);
  return session;
}

/**
 * getSession — session ปกติ + ด่านของ role CLIENT
 *
 * CLIENT ถูกจำกัดให้ยิงได้เฉพาะ API ใน allowlist (src/lib/client-access.ts) เท่านั้น
 * path นอกลิสต์จะได้ session = null → route เดิมตอบ 401 ตามตรรกะที่มีอยู่แล้ว
 * (deny by default โดยไม่ต้องแก้ route ทั้ง 127 ไฟล์)
 *
 * role อื่นไม่ถูกแตะเลย — คืนค่าเท่ากับ getSessionRaw ทุกกรณี
 *
 * หน้าเว็บ (non-/api): ด่านหลักคือ layout ของกลุ่ม (app) ซึ่ง redirect กลับ /projects
 * แต่ Next ไม่รัน layout ซ้ำเมื่อเปลี่ยนหน้าแบบ client-side (RSC request) ด่านนั้นจึงข้ามได้
 * ที่นี่จึงกันซ้ำอีกชั้น: CLIENT ที่ขอหน้านอก allowlist ได้ session = null เหมือน API
 * (หน้าในลิสต์ของ CLIENT ได้ session ตามเดิม)
 */
export async function getSession(): Promise<AppSession | null> {
  const session = await getSessionRaw();
  if (session?.user?.role !== "CLIENT") return session;

  let pathname: string | null = null;
  let method = "GET";
  try {
    const h = headers();
    pathname = h.get("x-pathname");
    method = h.get("x-method") ?? "GET";
  } catch {
    return session; // ไม่มี request context (build/prerender) — ไม่มีอะไรต้องกัน
  }
  // ไม่มี x-pathname = request ไม่ผ่าน middleware (ค่า header อาจมาจากผู้ใช้) — CLIENT ไม่ได้ session
  if (!pathname) return null;
  if (!pathname.startsWith("/api/")) return isClientPageAllowed(pathname) ? session : null;
  return isClientApiAllowed(pathname, method) ? session : null;
}
