import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { currentPeriod } from "@/lib/backlink-management/budget";
import { listAllProjects } from "@/lib/backlink-management/projects";
import { isApprover } from "@/lib/backlink-management/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const [projects, users] = await Promise.all([
      listAllProjects(ctx.orgId),
      prisma.user.findMany({
        where: { organizationId: ctx.orgId, role: { not: "CLIENT" }, status: "ACTIVE" },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return NextResponse.json({
      projects: projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName, manual: p.manual })),
      users: users.map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email, role: u.role })),
      me: { id: ctx.userId, role: ctx.role, canApprove: isApprover(ctx.role) },
      period: currentPeriod(),
    });
  } catch (e) {
    return serverError(e);
  }
}
