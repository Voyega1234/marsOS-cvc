import { NextRequest, NextResponse } from "next/server";
import { markSheetDirty } from "@/lib/backlink-management/sheet-sync";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { cleanProjectName } from "@/lib/backlink-management/project-name";
import { isMissingTable } from "@/lib/backlink-management/projects";
import { isApprover } from "@/lib/backlink-management/types";

export const dynamic = "force-dynamic";

const MISSING_TABLE_MSG = "ยังไม่ได้สร้างตาราง BlmProject ในฐานข้อมูล ให้ผู้ดูแลรันไฟล์ scripts/sql/add-blm-project-sheet-tables.sql ก่อน";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const cur = await prisma.blmProject.findFirst({ where: { id: params.id, organizationId: ctx.orgId } });
    if (!cur) return NextResponse.json({ error: "ไม่พบโปรเจกต์นี้" }, { status: 404 });
    if (cur.createdById !== ctx.userId && !isApprover(ctx.role)) return NextResponse.json({ error: "ไม่มีสิทธิ์แก้ไขโปรเจกต์นี้" }, { status: 403 });
    const b = await req.json().catch(() => ({}));
    const data: { name?: string; clientName?: string; note?: string } = {};
    if (b.name !== undefined) {
      const name = cleanProjectName(b.name);
      if (!name) return NextResponse.json({ error: "กรุณาระบุชื่อโปรเจกต์" }, { status: 400 });
      if (name !== cur.name) {
        const dup = await prisma.blmProject.findFirst({ where: { organizationId: ctx.orgId, name, id: { not: cur.id } }, select: { id: true } });
        if (dup) return NextResponse.json({ error: "มีโปรเจกต์ชื่อนี้อยู่แล้ว" }, { status: 409 });
        const sys = await prisma.project.findFirst({ where: { organizationId: ctx.orgId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
        if (sys) return NextResponse.json({ error: "มีโปรเจกต์ชื่อนี้ในเมนู Clients อยู่แล้ว เลือกจากรายการได้เลย" }, { status: 409 });
        data.name = name;
      }
    }
    if (b.clientName !== undefined) data.clientName = text(b.clientName, 200);
    if (b.note !== undefined) data.note = text(b.note, 500);
    const project = await prisma.blmProject.update({ where: { id: cur.id }, data });
    await markSheetDirty(ctx.orgId);
    return NextResponse.json({ project });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: MISSING_TABLE_MSG }, { status: 503 });
    return serverError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const cur = await prisma.blmProject.findFirst({ where: { id: params.id, organizationId: ctx.orgId } });
    if (!cur) return NextResponse.json({ error: "ไม่พบโปรเจกต์นี้" }, { status: 404 });
    if (cur.createdById !== ctx.userId && !isApprover(ctx.role)) return NextResponse.json({ error: "ไม่มีสิทธิ์ลบโปรเจกต์นี้" }, { status: 403 });
    const [r, bu] = await Promise.all([
      prisma.blmRequest.count({ where: { organizationId: ctx.orgId, projectId: cur.id } }),
      prisma.blmBudget.count({ where: { organizationId: ctx.orgId, projectId: cur.id } }),
    ]);
    if (r + bu > 0) return NextResponse.json({ error: "โปรเจกต์นี้มีคำขอหรืองบประมาณอยู่ ลบไม่ได้" }, { status: 409 });
    await prisma.blmProject.delete({ where: { id: cur.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: MISSING_TABLE_MSG }, { status: 503 });
    return serverError(e);
  }
}
