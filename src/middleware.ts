import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { IDLE_COOKIE, IDLE_LIMIT_MS, IDLE_TOUCH_MS, setActiveCookie } from "@/lib/idle-session";

/**
 * Auth middleware (Supabase — user pool เดียวกับ plasai)
 * - refresh session cookie ทุก request
 * - ไม่มี session → หน้า UI redirect ไป /login, API ตอบ 401
 * - เส้นทางสาธารณะ: /login, /share/[id] (ลิงก์ส่งลูกค้า)
 * - ถ้า env Supabase ไม่ครบ (local dev) → ผ่านหมด (โหมดไม่มี login เหมือนเดิม)
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

  if (!url || !key) return withCtx();

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
  const isPublic = pathname === "/login" || pathname.startsWith("/share/") || pathname.startsWith("/auth/");
  const isApi = pathname.startsWith("/api/");

  // idle logout — เว้น /auth/* (กำลัง login อยู่ ห้ามลบ code verifier) และ /share/* (ลิงก์สาธารณะ)
  if (user && !pathname.startsWith("/auth/") && !pathname.startsWith("/share/")) {
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
      } else if (pathname === "/login" && request.nextUrl.searchParams.get("reason") === "idle") {
        out = response;
      } else {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = "/login";
        loginUrl.search = "";
        const next = pathname === "/login" ? request.nextUrl.searchParams.get("next") : pathname + request.nextUrl.search;
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
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (user && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  // เว้น static assets ทั้งหมด — ที่เหลือผ่าน middleware หมดรวม /api
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};
