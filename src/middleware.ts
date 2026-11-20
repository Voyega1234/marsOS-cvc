import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { IDLE_COOKIE, IDLE_LIMIT_MS, IDLE_TOUCH_MS, setActiveCookie } from "@/lib/idle-session";
import { LOGIN_KIND_COOKIE, isLoginPath, loginPathFor } from "@/lib/login-paths";
import { isLineTrackingPublicPath } from "@/lib/line-tracking/publicPaths";

/**
 * Auth middleware (Supabase — user pool เดียวกับ plasai)
 * - refresh session cookie ทุก request
 * - ไม่มี session → หน้า UI redirect ไปหน้า login (ทีม /login · ลูกค้า /client-login — ดู lib/login-paths.ts), API ตอบ 401
 * - เส้นทางสาธารณะ: /login, /client-login, /share/[id] (ลิงก์ส่งลูกค้า)
 * - เส้นทางที่ไม่มี cookie login แต่ route ตรวจสิทธิ์เอง: Asana webhook (POST), Brand Radar cron (GET + CRON_SECRET)
 * - เส้นทางสาธารณะของ LINE Tracking (ลิงก์ที่ลูกค้ากด, webhook ของ LINE, cron, Looker): รายการอยู่ที่ lib/line-tracking/publicPaths.ts
 * - ถ้า env Supabase ไม่ครบ: local dev → ผ่านหมด (โหมดไม่มี login เหมือนเดิม), บน Vercel → ปิดทั้งเว็บ (ห้ามเปิดโล่ง)
 * - ไม่ได้ใช้งานเกิน 12 ชม. → ออกจากระบบ ต้อง login ใหม่ (ดู lib/idle-session.ts)
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // ส่ง path + method ลงไปให้ฝั่ง server รู้ (getSession ใช้บังคับ allowlist ของ role CLIENT + จด Activity Logs)
  const withCtx = () => {
    const headers = new Headers(request.headers);
    headers.set("x-pathname", request.nextUrl.pathname);
    headers.set("x-method", request.method);
    return NextResponse.next({ request: { headers } });
  };

  if (!url || !key) {
    // บน Vercel ต้องมี login เสมอ — env หาย (เช่น Preview ที่ไม่ได้ตั้งค่า) ห้ามเปิดโล่งเป็น ADMIN
    if (process.env.VERCEL) return new NextResponse("Auth is not configured", { status: 503 });
    return withCtx();
  }

  // LINE Tracking public paths (ad-click links, the tracking script, the LINE webhook, cron,
  // Looker): none of them reads a login, so there is no session to refresh. Answering here
  // saves one call to Supabase Auth on every ad click and every webhook. The list matches
  // whole paths + methods only (lib/line-tracking/publicPaths.ts); every other path goes on
  // below exactly as before.
  if (isLineTrackingPublicPath(request.nextUrl.pathname, request.method)) return withCtx();

  let response = withCtx();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = withCtx();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // สำคัญ: ต้องเรียก getUser() เพื่อ refresh token — ห้ามใช้ getSession() ใน middleware
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // Asana webhook ของ Backlink Management: เปิดเฉพาะ POST + token 43 ตัวอักษรใน path (route ตรวจลายเซ็น HMAC เองอีกชั้น)
  const isAsanaHook =
    request.method === "POST" && /^\/api\/backlink-management\/asana\/webhook\/[A-Za-z0-9_-]{43}\/?$/.test(pathname);
  // Scheduled scan of Brand Radar (Vercel Cron has no login cookie): only GET on this exact path.
  // The route itself refuses every call that does not carry "Authorization: Bearer <CRON_SECRET>".
  const isBrandRadarCron = request.method === "GET" && pathname === "/api/brand-radar/cron";
  // หน้า login มี 2 หน้า (ตรงตัวเท่านั้น ไม่ใช่ prefix): /login ของทีม กับ /client-login ของลูกค้า
  const onLoginPage = isLoginPath(pathname);
  const loginHint = request.cookies.get(LOGIN_KIND_COOKIE)?.value;
  // LINE Tracking: exact paths + methods only (see lib/line-tracking/publicPaths.ts). Staff pages are not in the list.
  const isLineTrackingPublic = isLineTrackingPublicPath(pathname, request.method);
  const isPublic =
    onLoginPage ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/auth/") ||
    isAsanaHook ||
    isBrandRadarCron ||
    isLineTrackingPublic;
  const isApi = pathname.startsWith("/api/");

  // idle logout — เว้น /auth/* (กำลัง login อยู่ ห้ามลบ code verifier), /share/* และเส้นทางสาธารณะของ LINE Tracking (ลิงก์สาธารณะ)
  if (user && !pathname.startsWith("/auth/") && !pathname.startsWith("/share/") && !isLineTrackingPublic) {
    const now = Date.now();
    const last = Number(request.cookies.get(IDLE_COOKIE)?.value);
    // เวลาในอนาคต = cookie ถูกแก้มือ → นับเป็นหมดอายุ
    const idle = !Number.isFinite(last) || last <= 0 || last > now + 60_000 || now - last > IDLE_LIMIT_MS;
    if (idle) {
      // revoke session ฝั่ง Supabase + ล้าง cookie ของ session (setAll ใส่ลง response)
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      let out: NextResponse;
      if (isApi) {
        out = NextResponse.json({ error: "Session หมดอายุ — ไม่ได้ใช้งานเกิน 12 ชั่วโมง กรุณา login ใหม่" }, { status: 401 });
      } else if (onLoginPage && request.nextUrl.searchParams.get("reason") === "idle") {
        out = response;
      } else {
        const loginUrl = request.nextUrl.clone();
        // บัญชีลูกค้า (@mars.local) กลับไปหน้า login ของลูกค้า · ทีมกลับไปหน้า Google
        loginUrl.pathname = loginPathFor({ email: user.email, hint: loginHint, current: pathname });
        loginUrl.search = "";
        const next = onLoginPage ? request.nextUrl.searchParams.get("next") : pathname + request.nextUrl.search;
        if (next) loginUrl.searchParams.set("next", next);
        loginUrl.searchParams.set("reason", "idle");
        out = NextResponse.redirect(loginUrl);
      }
      if (out !== response) response.cookies.getAll().forEach((c) => out.cookies.set(c));
      // กันพลาด: หมดอายุ cookie session ของ Supabase ทุกตัว + cookie เวลาใช้งาน
      request.cookies.getAll().forEach((c) => {
        if (c.name.startsWith("sb-")) out.cookies.set(c.name, "", { path: "/", maxAge: 0 });
      });
      out.cookies.set(IDLE_COOKIE, "", { path: "/", maxAge: 0 });
      return out;
    }
    const isActivity = !isApi || request.method !== "GET";
    if (isActivity && now - last > IDLE_TOUCH_MS) setActiveCookie(response, now);
  }

  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized — ต้อง login ก่อน" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    // เบราว์เซอร์ที่ login เป็นลูกค้าครั้งล่าสุดกลับไปหน้า login ของลูกค้า (cookie บอกทางเท่านั้น ไม่ได้ให้สิทธิ์อะไร)
    loginUrl.pathname = loginPathFor({ hint: loginHint });
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (user && onLoginPage) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  // เว้น static assets ทั้งหมด — ที่เหลือผ่าน middleware หมดรวม /api
  // /api ทุก path ต้องผ่าน middleware เสมอ แม้ลงท้าย .png ฯลฯ — ไม่งั้น header x-pathname/x-method มาจากผู้ใช้ตรง ๆ
  // (getSession ใช้ header นี้บังคับ allowlist ของ CLIENT)
  // embed\\.js$ = เฉพาะ path /embed.js ตรงตัว (สคริปต์ LINE Tracking บนเว็บลูกค้า โหลดทุก page view ไม่ใช้ login)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|embed\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|mjs)$).*)", "/api/:path*"],
};
