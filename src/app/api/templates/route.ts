import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  

  const templates = await prisma.brandTemplate.findMany({
    where: { organizationId: session!.user.organizationId ?? "" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  

  const body = await req.json();
  const template = await prisma.brandTemplate.create({
    data: { ...body, organizationId: session!.user.organizationId! },
  });
  return NextResponse.json(template, { status: 201 });
}
