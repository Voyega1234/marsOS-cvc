"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  classifyPasswordSignInError,
  clientLoginEmail,
  passwordSessionDeniedMessage,
  passwordSignInMessage,
} from "@/lib/client-login";
import { TEAM_LOGIN_PATH } from "@/lib/login-paths";
import { LoginNotices, LoginShell } from "@/components/auth/LoginShell";

/** ชื่อผู้ใช้หรือรหัสผ่านผิด — ข้อความเดียว ไม่บอกว่าชื่อผู้ใช้มีอยู่หรือไม่ (สาเหตุอื่นมีข้อความของตัวเองใน client-login.ts) */
const CLIENT_LOGIN_ERROR = passwordSignInMessage("credentials");

const INPUT_CLASS =
  "w-full rounded-full border border-gray-200 bg-white px-4 py-3 text-sm text-brand-navy placeholder:text-gray-400 outline-none transition focus:border-brand-blue/60 focus:ring-2 focus:ring-brand-blue/15";

// ลูกค้า: ชื่อผู้ใช้ + รหัสผ่านที่ทีมสร้างให้ในหน้า "จัดการ Users" (ตรวจซ้ำที่ /auth/password และ src/lib/auth.ts)
// ทีมเข้าที่ /login ด้วย Google
function ClientLoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const next = safeNextPath(searchParams.get("next"));

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
    // ข้อความแยกตามสาเหตุ — เดิมทุกกรณีขึ้นว่า "รหัสผ่านไม่ถูกต้อง" ทั้งที่บางกรณีลูกค้าพิมพ์ถูกแต่ระบบไม่ให้เข้า
    // message = ข้อความของขั้นที่กำลังทำอยู่ ถ้าขั้นนั้น throw จะได้ข้อความที่ตรงกับขั้น
    let message = passwordSignInMessage("unknown");
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        const kind = classifyPasswordSignInError(err);
        message = passwordSignInMessage(kind);
        if (kind !== "credentials") console.warn(`[login] password sign-in failed: ${kind} (${err.code ?? err.status ?? "no code"})`);
        throw err;
      }
      // ให้เซิร์ฟเวอร์ตรวจว่าเป็นบัญชีลูกค้าจริง + เริ่มนับเวลาใช้งาน ก่อนเข้าหน้าใด ๆ
      message = passwordSessionDeniedMessage(0);
      const res = await fetch("/auth/password", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
        message = passwordSessionDeniedMessage(res.status, body?.code);
        console.warn(`[login] /auth/password denied: ${res.status} ${typeof body?.code === "string" ? body.code : ""}`);
        throw new Error("denied");
      }
      window.location.assign(next ?? "/projects");
    } catch {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      setPassword("");
      setError(message);
      setPwLoading(false);
    }
  }

  return (
    <LoginShell
      footer={
        <>
          <p>© Convert Cake · ลืมรหัสผ่าน ติดต่อทีมงานที่ดูแลคุณ</p>
          <p>
            <Link
              href={`${TEAM_LOGIN_PATH}${next ? `?next=${encodeURIComponent(next)}` : ""}`}
              className="underline decoration-gray-300 underline-offset-2 transition-colors hover:text-brand-blue"
            >
              ทีมงาน Convert Cake เข้าสู่ระบบที่นี่
            </Link>
          </p>
        </>
      }
    >
      <p className="text-center text-sm font-medium text-brand-navy">เข้าสู่ระบบสำหรับลูกค้า</p>

      <form onSubmit={signInWithPassword} className="space-y-2.5">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="ชื่อผู้ใช้"
          aria-label="ชื่อผู้ใช้"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          className={INPUT_CLASS}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="รหัสผ่าน"
          aria-label="รหัสผ่าน"
          autoComplete="current-password"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={pwLoading}
          className="w-full rounded-full bg-brand-blue px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
        >
          {pwLoading ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
      </form>

      <LoginNotices idle={searchParams.get("reason") === "idle"} error={error} />
    </LoginShell>
  );
}

export default function ClientLoginPage() {
  return (
    <Suspense>
      <ClientLoginForm />
    </Suspense>
  );
}
