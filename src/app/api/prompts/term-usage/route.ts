import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { CE_RESTRICTION_FILE, parseRestrictionFileMeta } from "@/lib/ce-restrictions";
import { prisma } from "@/lib/prisma";
import { canEditPrompts } from "@/services/prompts";

export const dynamic = "force-dynamic";

const MAX_TERMS = 3000;
/** ไฟล์ที่มีคำเกินสัดส่วนนี้ = ตัวตารางกฎหมายเอง ไม่ใช่ข้อมูลสินค้า นับรวมแล้วจะเตือนทุกคำ */
const SAME_TABLE_RATIO = 0.5;
const SAME_TABLE_MIN_TERMS = 20;

function key(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/**
 * POST /api/prompts/term-usage — คำไหนในรายการปรากฏในไฟล์ข้อมูลของลูกค้าบ้าง
 * ใช้เตือนตอนนำเข้าคำต้องห้าม ไม่ให้ห้ามคำที่เป็นตัวสินค้า · อ่านอย่างเดียว ค้นเฉพาะแถวขององค์กรนี้
 * body: { projectId, terms[] }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditPrompts(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  const terms = Array.isArray(body.terms) ? body.terms.filter((t): t is string => typeof t === "string" && !!t.trim()).slice(0, MAX_TERMS) : [];
  if (!terms.length) return NextResponse.json({ usedTerms: [] });

  const rows = await prisma.promptTemplate.findMany({
    where: { organizationId: session.user.organizationId, projectId, type: CE_RESTRICTION_FILE },
    select: { id: true, description: true, promptText: true },
  });

  // ข้อกำหนดและตัวอย่างที่ลูกค้าติ ไม่ใช่ข้อมูลสินค้า · ไฟล์แบ่งส่วนรวมเป็นไฟล์เดียวก่อนตัดสิน
  const files = new Map<string, string>();
  for (const r of rows) {
    const meta = parseRestrictionFileMeta(r.description);
    if (meta.kind === "rules" || meta.kind === "criticized") continue;
    const id = meta.group ?? r.id;
    files.set(id, (files.get(id) ?? "") + key(r.promptText));
  }

  const used = new Set<string>();
  for (const text of Array.from(files.values())) {
    const found = terms.filter((t) => text.includes(key(t)));
    if (terms.length >= SAME_TABLE_MIN_TERMS && found.length > terms.length * SAME_TABLE_RATIO) continue;
    for (const t of found) used.add(t);
  }
  return NextResponse.json({ usedTerms: Array.from(used) });
}
