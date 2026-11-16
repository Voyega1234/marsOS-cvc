import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { cleanProjectName } from "@/lib/backlink-management/project-name";
import { isMissingTable, listManualProjects } from "@/lib/backlink-management/projects";

export const dynamic = "force-dynamic";

const MISSING_TABLE_MSG = "ยังไม่ได้สร้างตาราง BlmProject ในฐานข้อมูล ให้ผู้ดูแลรันไฟล์ scripts/sql/add-blm-project-sheet-tables.sql ก่อน";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const list = await listManualProjects(ctx.orgId);
    const ids = list.map((p) => p.id);
    const [reqs, buds] = ids.length
      ? await Promise.all([
          prisma.blmRequest.groupBy({ by: ["projectId"], where: { organizationId: ctx.orgId, projectId: { in: ids } }, _count: { _all: true } }),
          prisma.blmBudget.groupBy({ by: ["projectId"], where: { organizationId: ctx.orgId, projectId: { in: ids } }, _count: { _all: true } }),
        ])
      : [[], []];
    const rc = new Map(reqs.map((r) => [r.projectId, r._count._all]));
    const bc = new Map(buds.map((r) => [r.projectId, r._count._all]));
    return NextResponse.json({
      projects: list.map((p) => ({
        id: p.id, name: p.name, clientName: p.clientName, note: p.note, createdById: p.createdById,
        requests: rc.get(p.id) ?? 0, budgets: bc.get(p.id) ?? 0,
      })),
    });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: MISSING_TABLE_MSG }, { status: 503 });
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const b = await req.json().catch(() => ({}));
    const name = cleanProjectName(b.name);
    if (!name) return NextResponse.json({ error: "กรุณาระบุชื่อโปรเจกต์" }, { status: 400 });
    const dup = await prisma.blmProject.findUnique({ where: { organizationId_name: { organizationId: ctx.orgId, name } } });
    if (dup) return NextResponse.json({ error: "มีโปรเจกต์ชื่อนี้อยู่แล้ว" }, { status: 409 });
    const sys = await prisma.project.findFirst({ where: { organizationId: ctx.orgId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (sys) return NextResponse.json({ error: "มีโปรเจกต์ชื่อนี้ในเมนู Clients อยู่แล้ว เลือกจากรายการได้เลย" }, { status: 409 });
    const project = await prisma.blmProject.create({
      data: { organizationId: ctx.orgId, name, clientName: text(b.clientName, 200), note: text(b.note, 500), createdById: ctx.userId },
    });
    return NextResponse.json({ project });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: MISSING_TABLE_MSG }, { status: 503 });
    return serverError(e);
  }
}
