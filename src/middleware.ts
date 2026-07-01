import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;
    const pathname = req.nextUrl.pathname;
    const role = token?.role as string | undefined;

    // CLIENT: allowed routes
    if (role === "CLIENT") {
      const allowed =
        pathname.startsWith("/projects") ||
        pathname.startsWith("/seo-intelligence-lab") ||
        pathname.startsWith("/api/");
      if (!allowed) {
        return NextResponse.redirect(new URL("/projects", req.url));
      }
    }

    // USER: cannot access website-connect or ai-connect (settings pages)
    if (role === "USER") {
      const blocked =
        pathname.startsWith("/website-connect") ||
        pathname.startsWith("/ai-connect") ||
        pathname.startsWith("/admin");
      if (blocked) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    // Non-ADMIN cannot access /admin
    if (role !== "ADMIN" && pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon\\.ico|share).*)",
  ],
};
