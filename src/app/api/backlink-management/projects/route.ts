import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { cleanProjectName } from "@/lib/backlink-management/project-name";
import { createTask, resolveToken } from "@/lib/backlink-management/asana";
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
    if (b.asana && typeof b.asana === "object") {
      const asana = await createAsanaTask(ctx, b.asana, project.name, project.clientName);
      return NextResponse.json({ project, asana });
    }
    return NextResponse.json({ project });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: MISSING_TABLE_MSG }, { status: 503 });
    return serverError(e);
  }
}

/** สร้างงานแจ้งโปรเจกต์ใหม่ใน Asana — ไม่ throw (ห้ามทำให้การสร้างโปรเจกต์ล้ม) และไม่ติดตามงานนี้ */
async function createAsanaTask(
  ctx: { orgId: string; userId: string; userName: string },
  opt: { projectGid?: unknown; assigneeId?: unknown },
  name: string,
  clientName: string,
): Promise<{ ok: boolean; url?: string; error?: string; assigneeDropped?: boolean }> {
  try {
    const config = await prisma.blmAsanaConfig.findUnique({ where: { organizationId: ctx.orgId } });
    const token = resolveToken(config);
    if (!config || !token) return { ok: false, error: "ยังไม่ได้เชื่อม Asana" };
    const gid = typeof opt.projectGid === "string" ? opt.projectGid.trim() : "";
    const projectGid = /^\d{1,32}$/.test(gid) ? gid : config.projectGid;
    if (!projectGid) return { ok: false, error: "ยังไม่ได้เลือกโปรเจกต์ Asana" };
    let assigneeEmail: string | null = null;
    if (typeof opt.assigneeId === "string" && opt.assigneeId) {
      const u = await prisma.user.findFirst({ where: { id: opt.assigneeId, organizationId: ctx.orgId }, select: { email: true } });
      assigneeEmail = u?.email ?? null;
    }
    const notes = [
      `ชื่อโปรเจกต์: ${name}`,
      clientName ? `ลูกค้า: ${clientName}` : "",
      `สร้างโดย: ${ctx.userName}`,
      "สร้างจาก MarsOS Backlink Management",
    ].filter(Boolean).join("\n");
    const t = await createTask(token, { projectGid, name: `[Backlink] โปรเจกต์ใหม่: ${name}`, notes, assigneeEmail });
    return { ok: true, url: t.permalink_url || undefined, ...(t.assigneeDropped ? { assigneeDropped: true } : {}) };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}
