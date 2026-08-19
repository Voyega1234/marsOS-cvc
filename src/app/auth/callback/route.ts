import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** OAuth callback (Google) — แลก authorization code เป็น session cookie */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const dest = next && next.startsWith("/") ? next : "/";

  if (code) {
    const supabase = createSupabaseServer();
    if (supabase) await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(dest, url.origin));
}
