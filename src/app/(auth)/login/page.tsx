"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

/**
 * หน้า Login — Supabase Auth (บัญชีเดียวกับ plasai)
 * Brand CI: CVC — Convert Blue #1d48f3, Secure Navy #000E3F, Tech Cyan #4ff5e9 (highlight)
 * ชื่อระบบคงเป็น MarsOS ตามกฎ brand lock
 */
function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setError(null);
    const supabase = createSupabaseBrowser();
    const next = searchParams.get("next");
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback${next && next.startsWith("/") ? `?next=${encodeURIComponent(next)}` : ""}`,
      },
    });
    if (err) setError(`เข้าสู่ระบบด้วย Google ไม่สำเร็จ: ${err.message}`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-navy relative overflow-hidden">
      {/* พื้นหลัง Secure Navy + แสง Convert Blue จาง ๆ */}
      <div className="absolute -top-40 -right-40 w-[480px] h-[480px] rounded-full bg-brand-blue/20 blur-3xl" />
      <div className="absolute -bottom-52 -left-40 w-[520px] h-[520px] rounded-full bg-brand-deep/25 blur-3xl" />

      <div className="relative w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">MarsOS</h1>
          <p className="mt-1.5 text-[13px] text-brand-gray/70">SEO Automation Platform</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-7 space-y-4">
          {/* ทางหลัก: Google — ทีมใช้ Gmail ไม่ต้องจำรหัส */}
          <button
            type="button" onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-2.5 rounded-lg border border-brand-gray hover:bg-brand-mist text-brand-navy text-sm font-semibold py-2.5 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34 5.9 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34 5.9 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 40.1 44 35 44 24c0-1.3-.1-2.6-.4-3.9z"/>
            </svg>
            เข้าสู่ระบบด้วย Google
          </button>

          {error && (
            <p className="text-[12px] text-addon-crimson bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}



        </div>

        <p className="mt-6 text-center text-[11px] text-brand-gray/50">
          © Convert Cake · ทีมเท่านั้น — ติดต่อแอดมินเพื่อขอสิทธิ์
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
