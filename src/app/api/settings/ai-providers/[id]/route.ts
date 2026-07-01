import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["ADMIN", "SEO_MANAGER"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.aIProviderKey.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();

  // If setting as default, clear other defaults for same provider
  if (body.isDefault === true) {
    await prisma.aIProviderKey.updateMany({
      where: { organizationId: session.user.organizationId, provider: existing.provider },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.aIProviderKey.update({
    where: { id: params.id },
    data: {
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
      ...(body.displayName !== undefined && { displayName: body.displayName }),
    },
    select: {
      id: true,
      provider: true,
      displayName: true,
      keyMasked: true,
      isActive: true,
      isDefault: true,
      createdAt: true,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["ADMIN", "SEO_MANAGER"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.aIProviderKey.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.aIProviderKey.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}
