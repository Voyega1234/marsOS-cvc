import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await prisma.siteConnection.findFirst({
    where: { id: params.id, organizationId: orgId },
  });
  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { status, name } = await req.json();
  const updated = await prisma.siteConnection.update({
    where: { id: params.id },
    data: { ...(status && { status }), ...(name && { name }) },
    select: {
      id: true, name: true, platform: true, siteUrl: true,
      credentialMasked: true, extraConfig: true, status: true, createdAt: true,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await prisma.siteConnection.findFirst({
    where: { id: params.id, organizationId: orgId },
  });
  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.siteConnection.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
