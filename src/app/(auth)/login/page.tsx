"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/safe-redirect";
import { CLIENT_LOGIN_PATH } from "@/lib/login-paths";
import { LoginNotices, LoginShell } from "@/components/auth/LoginShell";

// ทีม: เข้าด้วย Google เท่านั้น (@convertcake.com) — ต้องเป็น user ที่มีในระบบ + สถานะ ACTIVE
// ลูกค้าเข้าที่หน้าแยก /client-login (ชื่อผู้ใช้ + รหัสผ่าน)
function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const next = safeNextPath(searchParams.get("next"));

  async function signInWithGoogle() {
    setError(null);
    const supabase = createSupabaseBrowser();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`,
      },
    });
    if (err) setError(`เข้าสู่ระบบด้วย Google ไม่สำเร็จ: ${err.message}`);
  }

  return (
    <LoginShell
      footer={
        <>
          <p>© Convert Cake · ติดต่อแอดมินเพื่อขอสิทธิ์เข้าใช้งาน</p>
          <p>
            <Link
              href={`${CLIENT_LOGIN_PATH}${next ? `?next=${encodeURIComponent(next)}` : ""}`}
              className="underline decoration-gray-300 underline-offset-2 transition-colors hover:text-brand-blue"
            >
              ลูกค้าเข้าสู่ระบบที่นี่
            </Link>
          </p>
        </>
      }
    >
      <button
        type="button"
        onClick={signInWithGoogle}
        className="flex w-full items-center justify-center gap-2.5 rounded-full border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-brand-navy shadow-sm transition-all hover:border-brand-blue/40 hover:shadow-md"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        เข้าสู่ระบบด้วย Google
      </button>

      <LoginNotices idle={searchParams.get("reason") === "idle"} error={error} />
    </LoginShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
