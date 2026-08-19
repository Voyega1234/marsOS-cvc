import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session-types";
import type { Role } from "@/types";

export type { AppSession };

/**
 * ระบบล็อกอินถูกถอดออกแล้ว — ไม่มีหน้า /login และไม่มี middleware กั้นหน้าใด ๆ
 * เข้าแอปได้ทันที รอสลับไปใช้ Supabase Auth ตอน deploy
 *
 * getSession() ยังคืน session หน้าตาเดิม (id / role / organizationId) เพื่อให้
 * การ scope ข้อมูลด้วย organizationId และการเช็ค role ที่กระจายอยู่ทั้งแอป
 * ทำงานต่อได้โดยไม่ต้องแก้ตาม ~150 ไฟล์
 *
 * ตอนต่อ Supabase ให้แก้เฉพาะฟังก์ชันนี้ฟังก์ชันเดียว: อ่าน user จาก Supabase
 * แล้ว map ลง AppSession รูปแบบเดิม ที่เหลือไม่ต้องแตะ
 *
 * cache() ของ React ทำให้ query นี้ยิงครั้งเดียวต่อ request (layout + page + API
 * เรียกซ้ำกันได้ฟรี) และไม่ค้างข้ามคำขอ — ข้อมูลจึงไม่มีทางเก่าหลังแก้ผู้ใช้ใน DB
 */
export const getSession = cache(async (): Promise<AppSession | null> => {
  // เลือก ADMIN ที่ active ก่อน ถ้าไม่มีจริง ๆ ค่อยรูดเอา user ที่ active คนแรก
  const user =
    (await prisma.user.findFirst({
      where: { status: "ACTIVE", role: "ADMIN" },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.user.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    }));

  if (!user) return null;

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
});
