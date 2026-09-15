import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { runLayerScan, type CELayerScanType } from "@/lib/ce-layer-scan";
import { prisma } from "@/lib/prisma";
import { canEditPrompts } from "@/services/prompts";

export const maxDuration = 300;

const VALID_LAYERS: CELayerScanType[] = [
  "CE_MASTER_PROMPT",
  "CE_ARTICLE_BRIEF",
  "CE_VALIDATOR_PACK",
  "CE_IMAGE_PROMPT",
];

/**
 * สแกน layer ของ Content Engine (Master Prompt / Article Brief / Validator Pack / Image Prompt)
 * แล้วร่างค่าฟอร์มให้ — วางลิงก์หรือวางข้อความก็ได้
 * body: { layer: CELayerScanType, url?: string, text?: string, projectId?: string|null }
 * ไม่บันทึกลง DB — ทีมกดรับในฟอร์ม แก้ต่อ แล้วกดบันทึกเอง
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const layer = typeof body.layer === "string" ? (body.layer as CELayerScanType) : null;
  if (!layer || !VALID_LAYERS.includes(layer)) {
    return NextResponse.json({ error: "layer ไม่ถูกต้อง" }, { status: 400 });
  }

  let fallbackUrl = "";
  if (typeof body.projectId === "string" && body.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: body.projectId, organizationId: session.user.organizationId! },
      select: { website: true },
    });
    if (!project) return NextResponse.json({ error: "ไม่พบโปรเจกต์" }, { status: 404 });
    fallbackUrl = project.website ?? "";
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const url = ((typeof body.url === "string" && body.url.trim()) || (!text && fallbackUrl) || "").trim();

  if (!url && !text) {
    return NextResponse.json({ error: "ต้องวางลิงก์หรือวางข้อความก่อนสแกน" }, { status: 400 });
  }

  try {
    const result = await runLayerScan({ layer, url: url || undefined, text: text || undefined });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: `สแกนไม่สำเร็จ: ${(err as Error).message}` }, { status: 502 });
  }
}
