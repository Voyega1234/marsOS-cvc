import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, maskKey } from "@/lib/crypto";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  

  const connections = await prisma.wordPressConnection.findMany({
    where: { organizationId: session!.user.organizationId ?? "" },
    select: {
      id: true,
      name: true,
      siteUrl: true,
      username: true,
      defaultStatus: true,
      createdAt: true,
      // never return appPasswordEncrypted
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(connections);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  

  const { name, siteUrl, username, appPassword } = await req.json();
  if (!name || !siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: "กรุณากรอกข้อมูลให้ครบ" }, { status: 400 });
  }

  const orgId = session!.user.organizationId ?? "";

  const connection = await prisma.wordPressConnection.create({
    data: {
      organizationId: orgId,
      name,
      siteUrl: siteUrl.replace(/\/$/, ""),
      username,
      appPasswordEncrypted: encrypt(appPassword),
      defaultStatus: "draft",
    },
    select: {
      id: true,
      name: true,
      siteUrl: true,
      username: true,
      defaultStatus: true,
      createdAt: true,
    },
  });

  return NextResponse.json(connection, { status: 201 });
}
