import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Auth middleware (Supabase — user pool เดียวกับ plasai)
 * - refresh session cookie ทุก request
 * - ไม่มี session → หน้า UI redirect ไป /login, API ตอบ 401
 * - เส้นทางสาธารณะ: /login, /share/[id] (ลิงก์ส่งลูกค้า)
 * - ถ้า env Supabase ไม่ครบ (local dev) → ผ่านหมด (โหมดไม่มี login เหมือนเดิม)
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();


  // ส่ง path + method ลงไปให้ฝั่ง server รู้ (getSession ใช้บังคับ allowlist ของ role CLIENT)
  const withCtx = () => {
    const headers = new Headers(request.headers);
    headers.set("x-pathname", request.nextUrl.pathname);
    headers.set("x-method", request.method);
    return NextResponse.next({ request: { headers } });
  };

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
