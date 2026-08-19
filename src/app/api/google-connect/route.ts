import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGoogleOauthClient, saveGoogleOauthClient } from "@/lib/googleOauthConfig";
import { getServiceIdentity } from "@/lib/google-auth";

// ─────────────────────────────────────────────────────────────────────────────
//  Google Data Connection — เชื่อม Gmail ที่ได้ access GSC/GA4 (เมล์กลาง
//  apps@convertcake.com) สำหรับ "ข้อมูลหน้า Report/Performance" เท่านั้น
//  *** ไม่ใช่ login ระบบ *** (login ระบบจะเป็น Supabase)
//
//  GET    → สถานะการเชื่อมต่อ { connected, email }
//  DELETE → ตัดการเชื่อมต่อ (ADMIN)
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // CLIENT เห็นได้แค่ว่าเชื่อมแล้วหรือยัง — ห้ามเห็นอีเมล/Service Account
  if (session.user.role === "CLIENT") {
    const has = await prisma.account.count({ where: { provider: "google", refresh_token: { not: null } } });
    return NextResponse.json({ connected: has > 0, email: null, configured: false, serviceEmail: null, serviceReady: false });
  }

  const account = await prisma.account.findFirst({
    where: { provider: "google", refresh_token: { not: null } },
    orderBy: { userId: "desc" },
    select: { user: { select: { email: true } } },
  });

  const oauthClient = await getGoogleOauthClient();
  const service = await getServiceIdentity();
  return NextResponse.json({
    connected: Boolean(account),
    email: account?.user?.email ?? null,
    configured: Boolean(oauthClient.clientId && oauthClient.clientSecret),
    configSource: oauthClient.source,
    // Service Email — ทางเชื่อมที่ไม่ต้องตั้ง OAuth: เอาเมล์นี้ไปเพิ่มใน GSC/GA4 ก็พอ
    serviceEmail: service.email || null,
    serviceReady: service.ready,
  });
}

// ตั้งค่า Google OAuth Client ผ่าน UI (ADMIN) — กรอกครั้งเดียวทั้งระบบ แทนการแก้ env
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clientId, clientSecret } = await req.json().catch(() => ({}));
  if (typeof clientId !== "string" || !clientId.trim().endsWith(".apps.googleusercontent.com")) {
    return NextResponse.json({ error: "Client ID ไม่ถูกต้อง — ต้องลงท้าย .apps.googleusercontent.com" }, { status: 400 });
  }
  if (typeof clientSecret !== "string" || clientSecret.trim().length < 10) {
    return NextResponse.json({ error: "Client Secret ไม่ถูกต้อง" }, { status: 400 });
  }
  await saveGoogleOauthClient(clientId, clientSecret);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.account.deleteMany({ where: { provider: "google" } });
  return NextResponse.json({ ok: true });
}
