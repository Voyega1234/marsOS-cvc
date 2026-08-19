"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";

/**
 * หน้า Login — Supabase Auth (บัญชีเดียวกับ plasai)
 * Brand CI: CVC — Convert Blue #1d48f3, Secure Navy #000E3F, Tech Cyan #4ff5e9 (highlight)
 * ชื่อระบบคงเป็น MarsOS ตามกฎ brand lock
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowser();
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) {
        setError(
          err.message === "Invalid login credentials"
            ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
            : `เข้าสู่ระบบไม่สำเร็จ: ${err.message}`,
        );
        return;
      }
      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-navy relative overflow-hidden">
      {/* พื้นหลัง Secure Navy + แสง Convert Blue จาง ๆ */}
      <div className="absolute -top-40 -right-40 w-[480px] h-[480px] rounded-full bg-brand-blue/20 blur-3xl" />
      <div className="absolute -bottom-52 -left-40 w-[520px] h-[520px] rounded-full bg-brand-deep/25 blur-3xl" />

      <div className="relative w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">MarsOS</h1>
          <p className="mt-1.5 text-[13px] text-brand-gray/70">SEO Content Platform</p>
        </div>

        <form onSubmit={onSubmit} className="bg-white rounded-2xl shadow-2xl p-7 space-y-4">
          <div>
            <label htmlFor="email" className="block text-[12px] font-semibold text-brand-navy mb-1.5">อีเมล</label>
            <input
              id="email" type="email" required autoComplete="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@convertcake.com"
              className="w-full rounded-lg border border-brand-gray px-3.5 py-2.5 text-sm text-brand-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-[12px] font-semibold text-brand-navy mb-1.5">รหัสผ่าน</label>
            <input
              id="password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-brand-gray px-3.5 py-2.5 text-sm text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-[12px] text-addon-crimson bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full rounded-lg bg-brand-blue hover:bg-brand-deep disabled:opacity-50 text-white text-sm font-semibold py-2.5 transition-colors"
          >
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>

          <p className="text-center text-[11px] text-gray-400 pt-1">
            ใช้บัญชีเดียวกับระบบ plasai ได้ทันที
          </p>
        </form>

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
