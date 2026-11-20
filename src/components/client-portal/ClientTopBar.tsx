"use client";

import NextImage from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { useSession } from "@/components/layout/SessionProvider";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { CLIENT_LOGIN_PATH } from "@/lib/login-paths";
import { UserMenu } from "@/components/layout/UserMenu";

/**
 * แถบบนของลูกค้า (CLIENT) — ไม่มีเมนูทีม ไม่มีตัวเลือกโปรเจกต์ ไม่เรียก API ของทีม
 * (ProTopBar ของทีมยิง /api/projects และ /api/ai/status ซึ่งลูกค้าไม่มีสิทธิ์)
 */
export function ClientTopBar({ nav }: { nav?: { articles: boolean; brandRadar: boolean } }) {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();
  const name = session?.user?.name ?? session?.user?.email ?? "";
  const email = session?.user?.email ?? "";

  async function logout() {
    // จด "ออกจากระบบ" ลง Activity Log ก่อน session หาย (เหมือนฝั่งทีม)
    await fetch("/api/activity-logs/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "logout" }) }).catch(() => {});
    try { await createSupabaseBrowser().auth.signOut(); } catch { /* env ไม่ครบ (dev) */ }
    window.location.href = CLIENT_LOGIN_PATH;
  }

  // Only brandRadar -> one item; both -> two items; otherwise no nav (as before)
  const radarActive = pathname.startsWith("/brand-radar");
  const items: { label: string; href: string; active: boolean }[] = [];
  if (nav?.brandRadar && !nav.articles) items.push({ label: "Brand Radar", href: "/brand-radar", active: true });
  else if (nav?.brandRadar && nav.articles) {
    items.push({ label: "รายงานบทความ", href: "/projects", active: !radarActive });
    items.push({ label: "Brand Radar", href: "/brand-radar", active: radarActive });
  }

  return (
    <div className="sticky top-2 z-30 mx-2 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 md:top-3 md:mx-6 md:mt-3 md:px-4">
      <div aria-hidden className="glass absolute inset-0 -z-10 rounded-[22px]" />
      <NextImage src="/logos/convertcake-mark-96.png" alt="Convert Cake" width={32} height={32} unoptimized className="h-8 w-8 shrink-0 object-contain" />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-brand-navy">MarsOS</p>
        <p className="truncate text-[11px] text-gray-500">Client Portal</p>
      </div>
      {items.length > 0 && (
        <nav aria-label="เมนูลูกค้า" className="order-last flex w-full min-w-0 items-center gap-1 overflow-x-auto md:order-none md:w-auto md:ml-4">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              aria-current={it.active ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${it.active ? "bg-brand-navy text-white" : "text-gray-600 hover:bg-white hover:text-brand-navy"}`}
            >
              {it.label}
            </Link>
          ))}
        </nav>
      )}
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
