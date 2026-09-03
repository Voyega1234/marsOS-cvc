import { NextRequest, NextResponse } from "next/server";

import { getSession, getSessionRaw } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // role CLIENT ไม่มีสิทธิ์ใน endpoint นี้ (route เดิมไม่ได้ปิดเคส session ว่าง)
  if ((await getSessionRaw())?.user?.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const session = await getSession();
  

  const templates = await prisma.brandTemplate.findMany({
    where: { organizationId: session!.user.organizationId ?? "" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  // role CLIENT ไม่มีสิทธิ์ใน endpoint นี้ (route เดิมไม่ได้ปิดเคส session ว่าง)
  if ((await getSessionRaw())?.user?.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const session = await getSession();
  

  const body = await req.json();
  const template = await prisma.brandTemplate.create({
    data: { ...body, organizationId: session!.user.organizationId! },
  });
  return NextResponse.json(template, { status: 201 });
}
