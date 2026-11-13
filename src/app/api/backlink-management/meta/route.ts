import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff, isCtx, serverError } from "@/lib/backlink-management/server";
import { currentPeriod } from "@/lib/backlink-management/budget";
import { isApprover } from "@/lib/backlink-management/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireStaff();
  if (!isCtx(ctx)) return ctx;
  try {
    const [projects, users] = await Promise.all([
      prisma.project.findMany({
        where: { organizationId: ctx.orgId },
        select: { id: true, name: true, clientName: true },
        orderBy: { name: "asc" },
      }),
      prisma.user.findMany({
        where: { organizationId: ctx.orgId, role: { not: "CLIENT" }, status: "ACTIVE" },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return NextResponse.json({
      projects: projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName ?? "" })),
      users: users.map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email, role: u.role })),
      me: { id: ctx.userId, role: ctx.role, canApprove: isApprover(ctx.role) },
      period: currentPeriod(),
    });
  } catch (e) {
    return serverError(e);
  }
}
