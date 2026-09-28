import { cache } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { AppSession } from "@/lib/session-types";
import type { Role } from "@/types";
import { isClientApiAllowed } from "@/lib/client-access";
import { recordApiRequest } from "@/lib/logActivity";

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
]);

/**
 * ADMIN ที่เจ้าของระบบกำหนดไว้ในโค้ด — login ครั้งแรกสร้างเป็น ADMIN เลย
 * ถ้ามี User อยู่แล้วแต่ role ยังไม่ใช่ ADMIN จะยกเป็น ADMIN ให้ตอนเข้าใช้ครั้งถัดไป (บันทึกลง DB + Activity Log)
 * เอาชื่อออกจากชุดนี้ = ไม่ยกให้อีก แต่ role ใน DB ยังอยู่ ต้องไปลดสิทธิ์ที่หน้า Users
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
    const user =
      (await prisma.user.findFirst({ where: { status: "ACTIVE", role: "ADMIN" }, orderBy: { createdAt: "asc" } })) ??
      (await prisma.user.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } }));
    return user ? toSession(user) : null;
  }

  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser?.email) return null;
  const email = authUser.email.toLowerCase();

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  if (existing) {
    // INACTIVE = ถูกปิดสิทธิ์ (เช่น adminseo/userseo เก่า) — ห้ามเข้าแม้ login ผ่าน
    if (existing.status !== "ACTIVE") return null;
    if (ADMIN_EMAILS.has(email) && existing.role !== "ADMIN") {
      const promoted = await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
      if (existing.organizationId) {
        await prisma.activityLog.create({
          data: {
            organizationId: existing.organizationId,
            userId: existing.id,
            action: "ROLE_CHANGED",
            entityType: "User",
            entityId: existing.id,
            oldValue: existing.role,
            newValue: "ADMIN",
          },
        }).catch(() => {});
      }
      return toSession(promoted);
    }
    return toSession(existing);
  }

  // ── auto-provision: เฉพาะรายชื่อที่เจ้าของอนุมัติ เข้าครั้งแรก สร้าง User ให้เอง ──
  if (ALLOWED_EMAILS.has(email) || ADMIN_EMAILS.has(email)) {
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
 * หน้าเว็บ (non-/api) ไม่กรองที่นี่ ใช้ด่านฝั่ง layout ของกลุ่ม (app) แทน
 * เพื่อให้ redirect ได้สวย ๆ แทนที่จะ render หน้าเปล่า
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
  if (!pathname || !pathname.startsWith("/api/")) return session;
  return isClientApiAllowed(pathname, method) ? session : null;
}
