"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Supabase browser client — ใช้ในหน้า login / ปุ่ม logout */
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
