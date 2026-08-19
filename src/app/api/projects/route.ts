import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  

  const organizationId = session!.user.organizationId ?? "";

  const projects = await prisma.project.findMany({
    where: { organizationId },
    include: {
      owner: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true } } } },
      _count: { select: { articles: true, keywords: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const result = await Promise.all(projects.map(async (p) => {
    const statusGroups = await prisma.article.groupBy({
      by: ["status"], where: { projectId: p.id }, _count: true,
    });
    const statusMap: Record<string, number> = {};
    statusGroups.forEach(g => { statusMap[g.status] = g._count; });
    return { ...p, statusMap };
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await getSession();

  const organizationId = session!.user.organizationId;
  if (!organizationId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  // Only admins and members can create projects — clients cannot
  const role = session!.user.role;
  if (role === "CLIENT") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, clientName, website, businessType, industry, targetAudience, language, market, notes, wpUrl, wpUser, wpAppPassword } = await req.json();

  const project = await prisma.project.create({
    data: {
      organizationId,
      name,
      clientName,
      website: website ?? "",
      businessType: businessType ?? "",
      industry,
      targetAudience: targetAudience ?? "",
      language: language ?? "th",
      market,
      notes,
      ownerId: session!.user.id,
      createdById: session!.user.id,
      ...(wpUrl         && { wpUrl: wpUrl.trim().replace(/\/$/, '') }),
      ...(wpUser        && { wpUser: wpUser.trim() }),
      ...(wpAppPassword && { wpAppPassword: wpAppPassword.trim() }),
    },
  });

  await prisma.projectMember.create({
    data: { projectId: project.id, userId: session!.user.id, role: "PROJECT_ADMIN" },
  });

  // ── Seed Content Engine ให้ client ใหม่ ─────────────────────────────────────
  //  กติกา CE: prompt ห้ามใช้ข้าม scope — client ใหม่จึงเกิดมา scope ว่างเปล่า
  //  แก้โดย "clone" default ที่ ACTIVE ของ Studio (projectId=null) เข้ามาเป็น
  //  ของ client คนละแถวกัน แก้ต่อได้อิสระ ไม่ใช่ fallback ข้าม scope ตอนเขียน
  const studioDefaults = await prisma.promptTemplate.findMany({
    where: {
      organizationId,
      projectId: null,
      isActive: true,
      type: { in: ["CE_BUSINESS_SKILL", "CE_MASTER_PROMPT", "CE_ARTICLE_BRIEF", "CE_VALIDATOR_PACK", "CE_IMAGE_PROMPT"] },
    },
    select: { name: true, description: true, promptText: true, type: true },
  });
  if (studioDefaults.length) {
    await prisma.promptTemplate.createMany({
      data: studioDefaults.map((d) => ({
        organizationId,
        projectId: project.id,
        name: d.name,
        description: d.description,
        promptText: d.promptText,
        type: d.type,
        isActive: true,
        createdById: session!.user.id,
      })),
    });
  }

  await prisma.activityLog.create({
    data: {
      organizationId,
      userId: session!.user.id,
      action: "CREATE",
      entityType: "Project",
      entityId: project.id,
      newValue: JSON.stringify({ name }),
    },
  });

  return NextResponse.json(project, { status: 201 });
}
