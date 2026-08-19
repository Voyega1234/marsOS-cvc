import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Supabase server client — ใช้ใน Server Component / Route Handler
 * โปรเจกต์ Supabase เดียวกับ plasai (auth.users ร่วมกัน) — DB app แยก schema
 * ถ้า env ไม่ครบ (เช่น local dev) คืน null — getSession จะ fallback โหมดไม่มี login
 */
export function createSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component เรียก set ไม่ได้ — middleware เป็นคน refresh cookie ให้แทน
        }
      },
    },
  });
}
