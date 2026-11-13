"use client";

import NextImage from "next/image";
import { LogOut } from "lucide-react";
import { useSession } from "@/components/layout/SessionProvider";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { UserMenu } from "@/components/layout/UserMenu";

/**
 * แถบบนของลูกค้า (CLIENT) — ไม่มีเมนูทีม ไม่มีตัวเลือกโปรเจกต์ ไม่เรียก API ของทีม
 * (ProTopBar ของทีมยิง /api/projects และ /api/ai/status ซึ่งลูกค้าไม่มีสิทธิ์)
 */
export function ClientTopBar() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? session?.user?.email ?? "";
  const email = session?.user?.email ?? "";

  async function logout() {
    // จด "ออกจากระบบ" ลง Activity Log ก่อน session หาย (เหมือนฝั่งทีม)
    await fetch("/api/activity-logs/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "logout" }) }).catch(() => {});
    try { await createSupabaseBrowser().auth.signOut(); } catch { /* env ไม่ครบ (dev) */ }
    window.location.href = "/login";
  }

  return (
    <div className="sticky top-2 z-30 mx-2 mt-2 flex items-center gap-3 px-3 py-2 md:top-3 md:mx-6 md:mt-3 md:px-4">
      <div aria-hidden className="glass absolute inset-0 -z-10 rounded-[22px]" />
      <NextImage src="/logos/convertcake-mark-96.png" alt="Convert Cake" width={32} height={32} unoptimized className="h-8 w-8 shrink-0 object-contain" />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-brand-navy">MarsOS</p>
        <p className="truncate text-[11px] text-gray-500">Client Portal</p>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {name && (
          <>
            <span className="hidden min-w-0 truncate text-sm text-gray-600 sm:inline">{name}</span>
            {/* กดที่วงกลมชื่อย่อ: เลือกโหมดแสดงผล (สว่าง / มืด / ตามระบบ) */}
            <UserMenu name={name} detail={email && email !== name ? email : undefined} onLogout={logout} side="bottom" align="end">
              <button
                type="button"
                aria-label="เมนูผู้ใช้"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-navy text-[12px] font-semibold text-white transition-shadow hover:ring-2 hover:ring-brand-blue/40"
              >
                {name[0]?.toUpperCase()}
              </button>
            </UserMenu>
          </>
        )}
        <button
          type="button"
          onClick={logout}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white bg-white/70 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-white hover:text-brand-navy"
        >
          <LogOut size={13} />
          <span className="hidden sm:inline">ออกจากระบบ</span>
          <span className="sr-only sm:hidden">ออกจากระบบ</span>
        </button>
      </div>
    </div>
  );
}
