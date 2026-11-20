import type { ReactNode } from "react";
import NextImage from "next/image";

/** The card both login pages share (team: /login, customers: /client-login). */
export function LoginShell({ children, footer }: { children: ReactNode; footer: ReactNode }) {
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

          <div className="mt-8 space-y-4">{children}</div>
        </div>

        <div className="mt-5 space-y-1.5 text-center text-xs text-gray-500">{footer}</div>
      </div>
    </div>
  );
}

/** "ไม่ได้ใช้งานเกิน 12 ชั่วโมง" (the middleware adds ?reason=idle) and the sign-in error, one at a time. */
export function LoginNotices({ idle, error }: { idle: boolean; error: string | null }) {
  return (
    <>
      {idle && !error && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ไม่ได้ใช้งานเกิน 12 ชั่วโมง ระบบออกจากระบบให้อัตโนมัติ — กรุณาเข้าสู่ระบบใหม่
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </>
  );
}
