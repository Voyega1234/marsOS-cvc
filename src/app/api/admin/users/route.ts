import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { name, email, password, role, projectIds, orgId } = await req.json();

  if (!email || !password || !role) {
    return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "อีเมลนี้ถูกใช้แล้ว" }, { status: 400 });
  }

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name: name || null,
      email,
      password: hashed,
      passwordPlain: password,
      role,
      status: "ACTIVE",
      organizationId: orgId || session.user.organizationId,
    },
  });

  // For CLIENT role: create ClientProjectAccess rows
  if (role === "CLIENT" && Array.isArray(projectIds) && projectIds.length > 0) {
    await prisma.clientProjectAccess.createMany({
      data: projectIds.map((projectId: string) => ({ userId: user.id, projectId })),
    });
  }

  // Fetch with clientAccess for UI update
  const userWithAccess = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      clientAccess: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json({
    user: {
      id: userWithAccess!.id,
      name: userWithAccess!.name ?? "",
      email: userWithAccess!.email,
      role: userWithAccess!.role,
      status: userWithAccess!.status,
      createdAt: userWithAccess!.createdAt.toISOString(),
      passwordPlain: userWithAccess!.passwordPlain ?? null,
      clientProjects: userWithAccess!.clientAccess.map((a) => ({
        projectId: a.projectId,
        projectName: a.project.name,
      })),
    },
  });
}
