import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { runBusinessSkillScan } from "@/lib/business-skill-scan";
import { prisma } from "@/lib/prisma";
import { canEditPrompts } from "@/services/prompts";

export const maxDuration = 300;

/**
 * สแกนเว็บไซต์ลูกค้าแล้วร่างฟอร์ม Business Skill ให้
 * body: { url?: string, projectId?: string }
 *   - url ว่าง + มี projectId → ใช้ Project.website
 *   - ขอบเขต Studio ต้องส่ง url มาเอง
 * ไม่บันทึกลง DB — ทีมกดรับในฟอร์ม แก้ต่อ แล้วกดบันทึกเอง
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  let fallback = "";
  if (typeof body.projectId === "string" && body.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: body.projectId, organizationId: session.user.organizationId! },
      select: { website: true },
    });
    if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });
    fallback = project.website ?? "";
  }

  const raw = ((typeof body.url === "string" && body.url.trim()) || fallback).trim();
  if (!raw) {
    return NextResponse.json({ error: "ยังไม่มี URL เว็บไซต์ — วางลิงก์ก่อนสแกน" }, { status: 400 });
  }
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const result = await runBusinessSkillScan(url);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: `สแกนไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 });
  }
}
