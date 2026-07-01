import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  

  const body = await req.json();
  const template = await prisma.brandTemplate.update({ where: { id: params.id }, data: body });
  return NextResponse.json(template);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  

  await prisma.brandTemplate.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
