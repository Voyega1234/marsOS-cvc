import { NextRequest, NextResponse } from "next/server";

import { getSession, getSessionRaw } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, maskKey } from "@/lib/crypto";
import { checkCredentialUrl } from "@/lib/upload-article/safe-fetch";
import { normalizeSavedWpUrl } from "@/lib/upload-article/wp-push";

export async function GET(_req: NextRequest) {
  // role CLIENT ไม่มีสิทธิ์ใน endpoint นี้ (route เดิมไม่ได้ปิดเคส session ว่าง)
  if ((await getSessionRaw())?.user?.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
  // role CLIENT ไม่มีสิทธิ์ใน endpoint นี้ (route เดิมไม่ได้ปิดเคส session ว่าง)
  if ((await getSessionRaw())?.user?.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const session = await getSession();
  

  const { name, siteUrl, username, appPassword } = await req.json();
  if (!name || !siteUrl || !username || !appPassword) {
    return NextResponse.json({ error: "กรุณากรอกข้อมูลให้ครบ" }, { status: 400 });
  }

  const orgId = session!.user.organizationId ?? "";

  const cleanUrl = normalizeSavedWpUrl(String(siteUrl));
  const urlErr = await checkCredentialUrl(cleanUrl);
  if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 });

  const connection = await prisma.wordPressConnection.create({
    data: {
      organizationId: orgId,
      name,
      siteUrl: cleanUrl,
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
