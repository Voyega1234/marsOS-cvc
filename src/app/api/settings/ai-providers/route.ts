import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, maskKey } from "@/lib/crypto";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await prisma.aIProviderKey.findMany({
    where: { organizationId: session.user.organizationId },
    select: {
      id: true,
      provider: true,
      displayName: true,
      keyMasked: true,
      isActive: true,
      isDefault: true,
      createdAt: true,
      // keyEncrypted is intentionally excluded — never sent to client
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(keys);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Only ADMIN / SEO_MANAGER can manage keys
  if (!["ADMIN", "SEO_MANAGER"].includes(session.user.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { provider, displayName, apiKey } = body as {
    provider: string;
    displayName: string;
    apiKey: string;
  };

  if (!provider || !displayName || !apiKey?.trim()) {
    return NextResponse.json({ error: "provider, displayName and apiKey are required" }, { status: 400 });
  }

  const keyEncrypted = encrypt(apiKey.trim());
  const keyMasked = maskKey(apiKey.trim());

  const created = await prisma.aIProviderKey.create({
    data: {
      organizationId: session.user.organizationId,
      provider,
      displayName,
      keyEncrypted,
      keyMasked,
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

  return NextResponse.json(created, { status: 201 });
}
