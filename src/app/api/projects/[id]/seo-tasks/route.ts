import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─── SEO Task checklist (On-Page / Technical) ────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const area = req.nextUrl.searchParams.get("area") ?? undefined; // ONPAGE | TECHNICAL
  const tasks = await prisma.seoTask.findMany({
    where: { projectId: params.id, organizationId: orgId, ...(area ? { area } : {}) },
    include: { owner: { select: { id: true, name: true } } },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session!.user.role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const project = await prisma.project.findFirst({ where: { id: params.id, organizationId: orgId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await req.json();
  const { area, category, title, detail, url, priority, ownerId, dueDate, tasks } = body;

  // รองรับสร้างเป็นชุด (เช่นกดเพิ่มจาก template checklist)
  if (Array.isArray(tasks)) {
    const created = await prisma.seoTask.createMany({
      data: tasks
        .filter((t: any) => t?.title?.trim() && t?.area && t?.category)
        .map((t: any) => ({
          organizationId: orgId,
          projectId: params.id,
          area: t.area,
          category: t.category,
          title: t.title.trim(),
          detail: t.detail ?? null,
          url: t.url ?? null,
          priority: t.priority ?? "MEDIUM",
        })),
    });
    return NextResponse.json({ count: created.count }, { status: 201 });
  }

  if (!area || !category || !title?.trim()) {
    return NextResponse.json({ error: "area, category, title are required" }, { status: 400 });
  }

  const task = await prisma.seoTask.create({
    data: {
      organizationId: orgId,
      projectId: params.id,
      area,
      category,
      title: title.trim(),
      detail: detail ?? null,
      url: url ?? null,
      priority: priority ?? "MEDIUM",
      ownerId: ownerId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
    include: { owner: { select: { id: true, name: true } } },
  });
  return NextResponse.json(task, { status: 201 });
}
