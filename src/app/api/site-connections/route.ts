import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, maskKey } from "@/lib/crypto";

export async function GET() {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connections = await prisma.siteConnection.findMany({
    where: { organizationId: orgId },
    select: {
      id: true, name: true, platform: true, siteUrl: true,
      credentialMasked: true, extraConfig: true, status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(connections);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const orgId = session?.user?.organizationId;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, platform, siteUrl, credentials, extraConfig } = body as {
    name: string;
    platform: string;
    siteUrl: string;
    credentials: Record<string, string>;
    extraConfig?: Record<string, string>;
  };

  if (!name || !platform || !siteUrl || !credentials) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Encrypt credentials JSON
  const credJson = JSON.stringify(credentials);
  const credentialEncrypted = encrypt(credJson);

  // Build masked version — mask each secret value
  const credentialMasked = JSON.stringify(
    Object.fromEntries(
      Object.entries(credentials).map(([k, v]) => [k, maskKey(v)])
    )
  );

  const conn = await prisma.siteConnection.create({
    data: {
      organizationId: orgId,
      name,
      platform,
      siteUrl,
      credentialEncrypted,
      credentialMasked,
      extraConfig: extraConfig ? JSON.stringify(extraConfig) : "{}",
      status: "CONNECTED",
    },
    select: {
      id: true, name: true, platform: true, siteUrl: true,
      credentialMasked: true, extraConfig: true, status: true, createdAt: true,
    },
  });

  return NextResponse.json(conn, { status: 201 });
}
