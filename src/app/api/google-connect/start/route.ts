import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { getSession } from "@/lib/auth";
import { getGoogleOauthClient } from "@/lib/googleOauthConfig";

// หน้า/route นี้ query DB ตอน request เท่านั้น — ห้าม prerender ตอน build (build ไม่ควรแตะ DB)
export const dynamic = 'force-dynamic'

// เริ่ม OAuth flow เชื่อม Gmail สำหรับข้อมูล Report (ADMIN เท่านั้น)
// scope: GSC + GA4 อ่านอย่างเดียว + email (ไว้โชว์ว่าเชื่อมเมล์ไหน)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { clientId, clientSecret } = await getGoogleOauthClient();
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่า Google OAuth Client — ตั้งได้ที่หน้า Report (ADMIN) หรือ env" },
      { status: 503 }
    );
  }

  const base = process.env.NEXTAUTH_URL || req.nextUrl.origin;
  const redirectUri = `${base}/api/google-connect/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/analytics.readonly",
    ].join(" "),
    access_type: "offline",
    prompt: "consent", // บังคับให้ได้ refresh_token ทุกครั้ง
    state,
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.cookies.set("gconn_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/google-connect",
  });
  // จำหน้าที่กดมา (เช่นแท็บ Report ของ client) เพื่อเด้งกลับหลังเชื่อมเสร็จ
  const returnTo = req.nextUrl.searchParams.get("returnTo");
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    res.cookies.set("gconn_return", returnTo, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/api/google-connect",
    });
  }
  return res;
}
