import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entry = await prisma.backlinkEntry.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
  });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const updated = await prisma.backlinkEntry.update({
    where: { id: params.id },
    data: {
      ...(body.status     !== undefined && { status: body.status }),
      ...(body.sourceUrl  !== undefined && { sourceUrl: body.sourceUrl }),
      ...(body.anchorText !== undefined && { anchorText: body.anchorText }),
      ...(body.domainRating !== undefined && { domainRating: body.domainRating ? Number(body.domainRating) : null }),
      ...(body.notes      !== undefined && { notes: body.notes }),
    },
    include: { project: { select: { id: true, name: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session?.user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entry = await prisma.backlinkEntry.findFirst({
    where: { id: params.id, organizationId: session.user.organizationId },
  });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.backlinkEntry.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
