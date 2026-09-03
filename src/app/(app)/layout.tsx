import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppLayout } from "@/components/layout/AppLayout";
import { getSessionRaw } from "@/lib/auth";
import { isClientPageAllowed } from "@/lib/client-access";

// ทุกหน้าใน (app) แสดงข้อมูลสดจาก DB — ห้ามให้ Next prerender เป็น static
// (เคยโดน: /projects ถูกแช่แข็งตอน build ขณะ DB ว่าง เลยขึ้น "0 clients"
//  ทั้งที่สร้าง project ใหม่ไปแล้ว) การประกาศที่ layout มีผลถึง child ทุก segment
export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  // ด่านหน้าเว็บของ role CLIENT — เข้าได้เฉพาะ /projects และ /projects/[id] ของตัวเอง
  // ที่เหลือเด้งกลับไป /projects (ซึ่ง redirect ต่อไปยังโปรเจกต์ที่ถูก assign)
  // role อื่นไม่โดนเงื่อนไขนี้เลย
  const session = await getSessionRaw();
  if (session?.user?.role === "CLIENT") {
    const pathname = headers().get("x-pathname");
    if (pathname && !isClientPageAllowed(pathname)) redirect("/projects");
  }

  return <AppLayout>{children}</AppLayout>;
}
