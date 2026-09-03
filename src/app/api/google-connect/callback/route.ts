import { NextRequest, NextResponse } from "next/server";

import { getSession, getSessionRaw } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGoogleOauthClient } from "@/lib/googleOauthConfig";

// รับ code จาก Google → แลก token → เก็บ refresh_token ผูกกับอีเมลที่เชื่อม
// ใช้สำหรับดึงข้อมูล GSC/GA4 หน้า Report เท่านั้น (ไม่ใช่ login)
export async function GET(req: NextRequest) {
  // role CLIENT ไม่มีสิทธิ์ใน endpoint นี้ (route เดิมไม่ได้ปิดเคส session ว่าง)
  if ((await getSessionRaw())?.user?.role === 'CLIENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/morning-brief?gconn=forbidden", req.nextUrl.origin));
  }

  const base = process.env.NEXTAUTH_URL || req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("gconn_state")?.value;

  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL("/morning-brief?gconn=error", base));
  }

  try {
    // แลก authorization code เป็น tokens (client จาก env หรือที่ตั้งผ่าน UI)
    const oauthClient = await getGoogleOauthClient();
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: oauthClient.clientId,
        client_secret: oauthClient.clientSecret,
        redirect_uri: `${base}/api/google-connect/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}: ${await tokenRes.text()}`);
    const tokens: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      id_token?: string;
    } = await tokenRes.json();
    if (!tokens.refresh_token) throw new Error("no refresh_token returned");

    // อ่าน email + sub จาก id_token (payload เป็น base64)
    let email = "";
    let sub = "";
    if (tokens.id_token) {
      const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64").toString());
      email = String(payload.email ?? "").toLowerCase();
      sub = String(payload.sub ?? "");
    }
    if (!email) throw new Error("no email in id_token");

    // เก็บผูกกับ User ของอีเมลนั้น (สร้างเป็น data-holder ถ้ายังไม่มี — login ไม่ได้เพราะไม่มีรหัสผ่าน)
    const org = await prisma.organization.findFirst({ select: { id: true } });
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: `Google Data (${email})`,
        role: "SERVICE",
        status: "ACTIVE",
        organizationId: org?.id ?? null,
      },
    });

    // เก็บ token ชุดเดียวต่ออีเมล (ลบของเก่าก่อน)
    await prisma.account.deleteMany({ where: { provider: "google", userId: user.id } });
    await prisma.account.create({
      data: {
        userId: user.id,
        type: "oauth",
        provider: "google",
        providerAccountId: sub || email,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token ?? null,
        expires_at: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null,
        token_type: tokens.token_type ?? "Bearer",
        scope: tokens.scope ?? null,
        id_token: tokens.id_token ?? null,
      },
    });

    const rawReturn = req.cookies.get("gconn_return")?.value ?? "";
    const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/morning-brief";
    const sep = returnTo.includes("?") ? "&" : "?";
    const res = NextResponse.redirect(new URL(`${returnTo}${sep}gconn=ok&email=${encodeURIComponent(email)}`, base));
    res.cookies.delete("gconn_state");
    res.cookies.delete("gconn_return");
    return res;
  } catch (e) {
    console.error("[google-connect] callback error:", e);
    const rawReturn = req.cookies.get("gconn_return")?.value ?? "";
    const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/morning-brief";
    const sep = returnTo.includes("?") ? "&" : "?";
    return NextResponse.redirect(new URL(`${returnTo}${sep}gconn=error`, base));
  }
}
