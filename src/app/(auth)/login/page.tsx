"use client";

import { Suspense, useState } from "react";
import NextImage from "next/image";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/safe-redirect";
import { clientLoginEmail } from "@/lib/client-login";

/** ข้อความเดียวทุกกรณีของทางรหัสผ่าน — ไม่บอกว่าชื่อผู้ใช้มีอยู่หรือไม่ */
const CLIENT_LOGIN_ERROR = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";

// ทีม: เข้าด้วย Google เท่านั้น (@convertcake.com) — ต้องเป็น user ที่มีในระบบ + สถานะ ACTIVE
// ลูกค้า: ชื่อผู้ใช้ + รหัสผ่านที่ทีมสร้างให้ในหน้า "จัดการ Users" (ตรวจซ้ำที่ /auth/password และ src/lib/auth.ts)
function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwLoading) return;
    const email = clientLoginEmail(username);
    if (!email || !password) {
      setError(CLIENT_LOGIN_ERROR);
      return;
    }
    setError(null);
    setPwLoading(true);
    const supabase = createSupabaseBrowser();
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      // ให้เซิร์ฟเวอร์ตรวจว่าเป็นบัญชีลูกค้าจริง + เริ่มนับเวลาใช้งาน ก่อนเข้าหน้าใด ๆ
      const res = await fetch("/auth/password", { method: "POST" });
      if (!res.ok) throw new Error("denied");
      window.location.assign(safeNextPath(searchParams.get("next")) ?? "/projects");
    } catch {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      setPassword("");
      setError(CLIENT_LOGIN_ERROR);
      setPwLoading(false);
    }
  }

  async function signInWithGoogle() {
    setError(null);
    const supabase = createSupabaseBrowser();
    const next = safeNextPath(searchParams.get("next"));
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`,
      },
    });
    if (err) setError(`เข้าสู่ระบบด้วย Google ไม่สำเร็จ: ${err.message}`);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* แสงฟุ้งสี Convert Cake ทับพื้นหลังรวมของระบบ */}
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-[30rem] w-[30rem] rounded-full bg-brand-blue/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[32rem] w-[32rem] rounded-full bg-brand-sky/20 blur-3xl" />

      <div className="relative z-10 w-full max-w-[400px]">
        <div className="glass-strong rounded-3xl px-7 py-9 sm:px-9">
          <div className="flex flex-col items-center text-center">
            <NextImage
              src="/logos/convertcake-mark.png"
              alt="Convert Cake"
              width={72}
              height={72}
              priority
              unoptimized
              className="h-[72px] w-[72px] object-contain"
            />
            <p className="page-eyebrow mb-0 mt-5">Convert Cake</p>
            <h1 className="mt-1.5 text-[32px] font-semibold leading-none tracking-tight text-brand-navy">MarsOS</h1>
            <p className="mt-2 text-sm text-gray-500">SEO Automation Platform</p>
          </div>

          <div className="mt-8 space-y-4">
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

            <div className="flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-gray-200" />
              <span className="text-[11px] font-medium text-gray-400">สำหรับลูกค้า</span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>

            <form onSubmit={signInWithPassword} className="space-y-2.5">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ชื่อผู้ใช้"
                aria-label="ชื่อผู้ใช้ (สำหรับลูกค้า)"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="w-full rounded-full border border-gray-200 bg-white px-4 py-3 text-sm text-brand-navy placeholder:text-gray-400 outline-none transition focus:border-brand-blue/60 focus:ring-2 focus:ring-brand-blue/15"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="รหัสผ่าน"
                aria-label="รหัสผ่าน (สำหรับลูกค้า)"
                autoComplete="current-password"
                className="w-full rounded-full border border-gray-200 bg-white px-4 py-3 text-sm text-brand-navy placeholder:text-gray-400 outline-none transition focus:border-brand-blue/60 focus:ring-2 focus:ring-brand-blue/15"
              />
              <button
                type="submit"
                disabled={pwLoading}
                className="w-full rounded-full bg-brand-blue px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
              >
                {pwLoading ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
              </button>
            </form>

            {searchParams.get("reason") === "idle" && !error && (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                ไม่ได้ใช้งานเกิน 12 ชั่วโมง ระบบออกจากระบบให้อัตโนมัติ — กรุณาเข้าสู่ระบบใหม่
              </div>
            )}

            {error && (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-gray-500">
          © Convert Cake · ติดต่อแอดมินเพื่อขอสิทธิ์เข้าใช้งาน
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
