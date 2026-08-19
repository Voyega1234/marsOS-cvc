import { AppLayout } from "@/components/layout/AppLayout";

// ทุกหน้าใน (app) แสดงข้อมูลสดจาก DB — ห้ามให้ Next prerender เป็น static
// (เคยโดน: /projects ถูกแช่แข็งตอน build ขณะ DB ว่าง เลยขึ้น "0 clients"
//  ทั้งที่สร้าง project ใหม่ไปแล้ว) การประกาศที่ layout มีผลถึง child ทุก segment
export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}
