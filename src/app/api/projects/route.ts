import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkCredentialUrl } from "@/lib/upload-article/safe-fetch";
import { normalizeSavedWpUrl } from "@/lib/upload-article/wp-push";
import { encryptProjectWpPassword } from "@/lib/project-wp-credentials";
import { maskProjectSecrets } from "@/lib/secret-mask";

export async function GET() {
  const session = await getSession();
  

  const organizationId = session!.user.organizationId ?? "";

  const projects = await prisma.project.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      clientName: true,
      businessType: true,
      industry: true,
      logoUrl: true,
      status: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const projectIds = projects.map((p) => p.id);
  const statusGroups = await prisma.article.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projectIds } },
    _count: true,
  });
  const statusMapByProject = new Map<string, Record<string, number>>();
  for (const g of statusGroups) {
    const map = statusMapByProject.get(g.projectId) ?? {};
    map[g.status] = g._count;
    statusMapByProject.set(g.projectId, map);
  }

  const result = projects.map((p) => ({ ...p, statusMap: statusMapByProject.get(p.id) ?? {} }));

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

  // wpUrl ที่บันทึกต้องเป็น https + โฮสต์สาธารณะ — ค่าว่างยังอนุญาต
  const wpUrlNorm = typeof wpUrl === "string" ? normalizeSavedWpUrl(wpUrl) : "";
  if (wpUrlNorm) {
    const urlErr = await checkCredentialUrl(wpUrlNorm);
    if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 });
  }
  let wpPassEnc: string | null = null;
  try {
    wpPassEnc = encryptProjectWpPassword(typeof wpAppPassword === "string" ? wpAppPassword : "");
  } catch {
    return NextResponse.json({ error: "เข้ารหัส Application Password ไม่สำเร็จ (ไม่มี WP_ENCRYPTION_KEY)" }, { status: 500 });
  }

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
      ...(wpUrlNorm     && { wpUrl: wpUrlNorm }),
      ...(wpUser        && { wpUser: wpUser.trim() }),
      ...(wpPassEnc     && { wpAppPassword: wpPassEnc }),
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

  return NextResponse.json(maskProjectSecrets(project), { status: 201 });
}
