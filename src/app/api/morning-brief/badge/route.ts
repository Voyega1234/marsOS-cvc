import { NextResponse } from "next/server";

import { getSession, getSessionRaw } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Badge เบาสำหรับ sidebar — query เดียวจบ
// เดิม sidebar เรียก /api/morning-brief ตัวเต็ม (query 4 ชุด + ยิง GSC ภายนอก, 6-7 วิ)
// ทุกครั้งที่เปิดหน้าใดก็ตาม เพื่อเอาเลข criticalCount ตัวเดียว
// นับเฉพาะ critical ที่รู้จาก DB: บทความค้าง SEO_REVIEW เกิน 2 วัน (cap 3 ตามหน้าเต็ม)
// trade-off: critical จาก GSC traffic drop ไม่รวมใน badge — เห็นเมื่อเปิดหน้า SEO News & Update
export async function GET() {
  // role CLIENT ไม่มีสิทธิ์ใน endpoint นี้ (route เดิมไม่ได้ปิดเคส session ว่าง)
  if ((await getSessionRaw())?.user?.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ criticalCount: 0 });

  const stuck = await prisma.article.count({
    where: {
      project: { organizationId: orgId },
      status: "SEO_REVIEW",
      updatedAt: { lt: new Date(Date.now() - 2 * 86400000) },
    },
  });
  return NextResponse.json({ criticalCount: Math.min(stuck, 3) });
}
