import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runSeoAudit } from "@/lib/seo-audit";

export const maxDuration = 300;

/**
 * สแกนเว็บไซต์ของโปรเจกต์แล้วคืนรายการปัญหา SEO พร้อมหลักฐาน
 * body: { url?: string; maxPages?: number }
 * ไม่บันทึกลง DB — ทีมเลือกเองว่าจะสร้างเป็นงานข้อไหน (POST /api/projects/[id]/seo-tasks)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session!.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: { id: true, website: true },
  });
  if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const raw = (typeof body.url === "string" && body.url.trim()) || project.website || "";
  if (!raw.trim()) {
    return NextResponse.json({ error: "โปรเจกต์นี้ยังไม่ได้ตั้งค่า website" }, { status: 400 });
  }
  const maxPages = typeof body.maxPages === "number" ? body.maxPages : undefined;

  try {
    const result = await runSeoAudit(raw, { maxPages });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: `สแกนไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 });
  }
}
