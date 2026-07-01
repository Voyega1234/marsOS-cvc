import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const members = await prisma.projectMember.findMany({
    where: {
      projectId: params.id,
      project: { organizationId: session.user.organizationId },
    },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  return NextResponse.json(members);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = session.user.role;
  if (role === "CLIENT" || role === "WRITER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify project belongs to this org
  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { userId, role: memberRole } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const member = await prisma.projectMember.create({
    data: { projectId: params.id, userId, role: memberRole ?? "WRITER" },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  return NextResponse.json(member, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = session.user.role;
  if (role === "CLIENT" || role === "WRITER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify project belongs to this org
  const project = await prisma.project.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  await prisma.projectMember.deleteMany({
    where: { projectId: params.id, userId },
  });
  return NextResponse.json({ ok: true });
}
