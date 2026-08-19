import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/logActivity";

// ─── Keyword Bank ────────────────────────────────────────────────────────────
// คลัง keyword ถาวรของ project (ตาราง Keyword ใน DB — refresh ไม่หาย)
// รับ keyword จากหน้า Keyword Research / Keywords Input แบบ bulk
// dedupe ด้วยชื่อ keyword: ถ้ามีอยู่แล้วจะอัปเดตข้อมูล (title/volume/ฯลฯ) แทนการสร้างซ้ำ

interface BankRow {
  keyword: string;
  title?: string;
  volume?: number;
  difficulty?: number;
  intent?: string;
  funnelStage?: string;
  priority?: number;
  seedKeyword?: string;
  meta?: Record<string, unknown>;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session!.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: orgId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await req.json();
  const rows: BankRow[] = Array.isArray(body.rows) ? body.rows : [];
  const source: string = body.source ?? "manual";
  const valid = rows.filter((r) => r?.keyword?.trim());
  if (!valid.length) return NextResponse.json({ error: "rows is empty" }, { status: 400 });

  const existing = await prisma.keyword.findMany({
    where: { projectId: project.id, keyword: { in: valid.map((r) => r.keyword.trim()) } },
    select: { id: true, keyword: true, meta: true },
  });
  const byKeyword = new Map(existing.map((k) => [k.keyword, k]));

  let created = 0;
  let updated = 0;

  for (const r of valid) {
    const kw = r.keyword.trim();
    const found = byKeyword.get(kw);
    const metaPatch = { ...(r.meta ?? {}), source };

    if (found) {
      let mergedMeta: Record<string, unknown> = metaPatch;
      try { mergedMeta = { ...JSON.parse(found.meta || "{}"), ...metaPatch }; } catch { /* keep patch */ }
      await prisma.keyword.update({
        where: { id: found.id },
        data: {
          ...(r.title !== undefined ? { title: r.title } : {}),
          ...(r.volume !== undefined ? { volume: r.volume } : {}),
          ...(r.difficulty !== undefined ? { difficulty: r.difficulty } : {}),
          ...(r.intent ? { intent: r.intent } : {}),
          ...(r.funnelStage ? { funnelStage: r.funnelStage } : {}),
          ...(r.priority !== undefined ? { priority: r.priority } : {}),
          meta: JSON.stringify(mergedMeta),
        },
      });
      updated++;
    } else {
      await prisma.keyword.create({
        data: {
          projectId: project.id,
          seedKeyword: r.seedKeyword ?? kw,
          keyword: kw,
          title: r.title ?? null,
          volume: r.volume ?? null,
          difficulty: r.difficulty ?? null,
          intent: r.intent ?? "INFORMATIONAL",
          funnelStage: r.funnelStage ?? "TOFU",
          priority: r.priority ?? 0,
          status: "NEW",
          meta: JSON.stringify(metaPatch),
        },
      });
      created++;
    }
  }

  logActivity({
    organizationId: orgId,
    userId: session!.user.id,
    action: "KEYWORD_BANK_IMPORT",
    entityType: "Project",
    entityId: project.id,
    newValue: JSON.stringify({ source, created, updated }),
  });

  return NextResponse.json({ created, updated, total: created + updated }, { status: 201 });
}
