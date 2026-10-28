import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { getSession } from "@/lib/auth";
import { clientCanAccessProject } from "@/lib/client-access";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

// ทุกคอลัมน์ของ Article ยกเว้น htmlContent — คอลัมน์ใหม่ใน schema ตามมาเอง
const LIST_SCALARS = Object.fromEntries(
  Object.values(Prisma.ArticleScalarFieldEnum).filter(f => f !== "htmlContent").map(f => [f, true]),
) as { [K in Exclude<Prisma.ArticleScalarFieldEnum, "htmlContent">]: true };

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  // CLIENT ต้องระบุ projectId และต้องเป็นโปรเจกต์ของตัวเองเท่านั้น
  if (!(await clientCanAccessProject(session, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const where: Record<string, unknown> = { project: { organizationId: session.user.organizationId } };
  if (projectId) where.projectId = projectId;

  // htmlContent ไม่ส่งในรายการ (บทความละหลาย MB เมื่อมีรูปฝังในเนื้อหา) — ใครต้องใช้ดึงทีละบทความ (/by-title?id=&fields=html)
  //   hasHtml บอกแค่ว่ามีเนื้อหาใน DB
  const [articles, withHtml] = await Promise.all([prisma.article.findMany({
    where,
    select: {
      ...LIST_SCALARS,
      project: {
        select: {
          id: true,
          name: true,
          clientName: true,
          website: true,
          organizationId: true,
        },
      },
      keyword: true,
      assignedTo: { select: { id: true, name: true, email: true, image: true, role: true } },
    },
    orderBy: { updatedAt: "desc" },
  }), prisma.article.findMany({
    where: { ...where, htmlContent: { not: "" } },
    select: { id: true },
  })]);
  const hasHtml = new Set(withHtml.map(a => a.id));
  // ปกแบบ data URI (หลายร้อย KB ต่อบทความ) ไม่ส่งในรายการ — กัน response เกินเพดาน 4.5MB ของ Vercel
  //   ใครต้องใช้รูปปกดึงทีละบทความ (/api/articles/[id], /by-title) · hasDataCover บอกแค่ว่ามีปกใน DB
  return NextResponse.json(articles.map(a => {
    const dataCover = a.coverImageUrl?.startsWith("data:") === true;
    const row = { ...a, hasHtml: hasHtml.has(a.id) };
    return dataCover ? { ...row, coverImageUrl: null, hasDataCover: true } : row;
  }));
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.user.organizationId;
  const body = await req.json();
  const { title, projectId, funnelStage, searchIntent, brief, keywordId } = body;

  if (!projectId || !title) return NextResponse.json({ error: "title and projectId required" }, { status: 400 });

  // Verify project belongs to this org before creating article
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { id: true, organizationId: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const article = await prisma.article.create({
    data: {
      title,
      slug: slugify(title),
      projectId,
      funnelStage: funnelStage ?? "TOFU",
      searchIntent: searchIntent ?? "INFORMATIONAL",
      brief: brief ?? null,
      keywordId: keywordId ?? null,
      status: "NEW",
      createdById: session.user.id,
    },
  });

  await prisma.activityLog.create({
    data: {
      organizationId: orgId,
      userId: session.user.id,
      action: "CREATE",
      entityType: "Article",
      entityId: article.id,
      newValue: JSON.stringify({ title }),
    },
  });

  return NextResponse.json(article, { status: 201 });
}
