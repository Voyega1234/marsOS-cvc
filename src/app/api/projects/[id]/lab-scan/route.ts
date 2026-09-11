import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { runLabScan } from "@/lib/lab-scan";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

/**
 * สแกนเว็บไซต์ลูกค้าแล้วเสนอค่าตั้งต้นของหน้า Article Lab
 * body: { url?: string }  — ไม่ส่งใช้ Project.website
 * ไม่บันทึกลง DB — ทีมกดรับในหน้า Article Lab แล้วกดบันทึกเอง
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId! },
    select: { id: true, website: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const raw = (typeof body.url === "string" && body.url.trim()) || project.website || "";
  if (!raw.trim()) {
    return NextResponse.json({ error: "ยังไม่มี URL เว็บไซต์ — กรอก URL ก่อนสแกน" }, { status: 400 });
  }
  const url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;

  try {
    const result = await runLabScan(url, project.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: `สแกนไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 });
  }
}
