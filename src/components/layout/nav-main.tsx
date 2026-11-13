"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface SubRoute {
  title: string;
  link: string;
  icon?: React.ReactNode;
}

export interface Route {
  id: string;
  title: string;
  icon: React.ReactNode;
  link: string;
  subs?: SubRoute[];
  badge?: number;
  badgeVariant?: "red" | "black";
}

interface Props {
  routes: Route[];
}

// เมนูที่เลือกอยู่ = เม็ดยา Convert Blue ตัวอักษรขาว
const ACTIVE_PILL = "bg-brand-blue text-white shadow-[0_10px_22px_-12px_rgba(29,72,243,0.9)]";
const IDLE_ITEM = "text-gray-600 hover:text-brand-navy hover:bg-white/80";

const isOnPath = (pathname: string, link: string) => link !== "#" && (pathname === link || pathname.startsWith(link + "/"));

/**
 * เมนูกลุ่ม (Article / Studio / Setting) บนจอใหญ่: เมนูย่อยลอยออกทางขวาของ sidebar
 * - ชี้เมาส์หรือกดเพื่อเปิด, ออกนอกเมนู / กด Esc / เปลี่ยนหน้า = ปิด
 * - ใช้ได้ทั้งตอน sidebar กางและตอนพับเหลือไอคอน (เดิมตอนพับเข้าเมนูย่อยไม่ได้)
 * ลิงก์ปลายทางทุกตัวเหมือนเดิม
 */
function FlyoutNavItem({ route, collapsed }: { route: Route; collapsed: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = route.subs!.some((s) => isOnPath(pathname, s.link));

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const openNow = () => { cancelClose(); setOpen(true); };
  // หน่วงสั้น ๆ ให้ลากเมาส์ข้ามช่องว่างจากปุ่มไปเมนูย่อยได้
  const closeSoon = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 160); };

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => cancelClose, []);

  return (
    <Popover open={open} onOpenChange={(next) => { cancelClose(); setOpen(next); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={collapsed ? route.title : undefined}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
          // กดแล้ว "เปิด" เสมอ (ไม่สลับปิด) — เมาส์ที่ชี้อยู่เปิดไว้แล้ว ถ้าสลับจะกลายเป็นปิด
          onClick={(e) => { e.preventDefault(); openNow(); }}
          className={
            collapsed
              ? cn(
                  "relative mx-auto flex h-11 w-11 items-center justify-center rounded-2xl transition-colors",
                  active ? ACTIVE_PILL : "text-gray-500 hover:text-brand-navy hover:bg-white/80",
                  open && !active && "bg-white/80 text-brand-navy"
                )
              : cn(
                  "flex w-full items-center gap-3 rounded-full px-3.5 py-2.5 text-[13.5px] transition-colors",
                  active ? cn(ACTIVE_PILL, "font-medium") : cn(IDLE_ITEM, "font-normal"),
                  open && !active && "bg-white/80 text-brand-navy"
                )
          }
        >
          {collapsed ? (
            route.icon
          ) : (
            <>
              <span className={cn("shrink-0", active ? "text-white" : "text-gray-500")}>{route.icon}</span>
              <span className="flex-1 text-left">{route.title}</span>
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-200", active ? "text-white/80" : "text-gray-400", open && "translate-x-0.5")} />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={collapsed ? 18 : 22}
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-52 rounded-2xl p-2 shadow-xl"
      >
        <p className="px-3 pb-1.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">{route.title}</p>
        <div className="space-y-0.5">
          {route.subs!.map((sub) => {
            const subActive = isOnPath(pathname, sub.link);
            return (
              <Link
                key={sub.title}
                href={sub.link}
                aria-current={subActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-full px-3 py-2 text-[13px] transition-colors",
                  subActive ? cn(ACTIVE_PILL, "font-medium") : "text-gray-600 hover:bg-gray-100 hover:text-brand-navy"
                )}
              >
                {sub.icon && <span className="shrink-0">{sub.icon}</span>}
                {sub.title}
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NavItem({ route }: { route: Route }) {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" && !isMobile;
  const hasSubs = !!route.subs?.length;

  const isActive =
    route.link !== "#" &&
    (pathname === route.link || pathname.startsWith(route.link + "/"));

  const anySubActive = route.subs?.some(
    (s) => s.link !== "#" && (pathname === s.link || pathname.startsWith(s.link + "/"))
  );

  const [open, setOpen] = useState(isActive || !!anySubActive);

  // จอใหญ่: เมนูกลุ่มใช้เมนูย่อยลอย (มือถือยังเป็นแบบกางลงในลิ้นชักเหมือนเดิม)
  if (hasSubs && !isMobile) return <FlyoutNavItem route={route} collapsed={isCollapsed} />;

  // โหมดพับ (icon-only): แสดงแค่ไอคอน จัดกึ่งกลาง ไม่มีข้อความ/ซับเมนู, มี tooltip ตอน hover
  if (isCollapsed) {
    const active = isActive || !!anySubActive;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={route.link}
            className={cn(
              "relative mx-auto flex h-11 w-11 items-center justify-center rounded-2xl transition-colors",
              active ? ACTIVE_PILL : "text-gray-500 hover:text-brand-navy hover:bg-white/80"
            )}
          >
            {route.icon}
            {route.badge !== undefined && route.badge > 0 && (
              <span
                className={cn(
                  "absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-white",
                  route.badgeVariant === "red" ? "bg-red-500" : "bg-brand-blue"
                )}
              />
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" align="center">
          {route.title}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (hasSubs) {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex w-full items-center gap-3 rounded-full px-3.5 py-2.5 text-[13.5px] transition-colors",
            anySubActive
              ? "text-brand-navy font-semibold"
              : cn(IDLE_ITEM, "font-normal")
          )}
        >
          <span className={cn("shrink-0", anySubActive ? "text-brand-blue" : "text-gray-500")}>{route.icon}</span>
          <span className="flex-1 text-left">{route.title}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-gray-400 transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="ml-5 mt-0.5 space-y-0.5 border-l border-gray-200/80 pl-2.5 pb-1">
                {route.subs!.map((sub) => {
                  const subActive =
                    sub.link !== "#" &&
                    (pathname === sub.link || pathname.startsWith(sub.link + "/"));
                  return (
                    <Link
                      key={sub.title}
                      href={sub.link}
                      className={cn(
                        "flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] transition-colors",
                        subActive
                          ? cn(ACTIVE_PILL, "font-medium")
                          : "text-gray-500 hover:text-brand-navy hover:bg-white/80"
                      )}
                    >
                      {sub.icon && <span className="shrink-0">{sub.icon}</span>}
                      {sub.title}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <Link
      href={route.link}
      className={cn(
        "flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[13.5px] transition-colors",
        isActive ? cn(ACTIVE_PILL, "font-medium") : cn(IDLE_ITEM, "font-normal")
      )}
    >
      <span className={cn("shrink-0", isActive ? "text-white" : "text-gray-500")}>{route.icon}</span>
      <span className="flex-1">{route.title}</span>
      {route.badge !== undefined && route.badge > 0 && (
        <span className={cn(
          "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center tabular-nums",
          route.badgeVariant === "red"
            ? "bg-red-500 text-white"
            : isActive ? "bg-white text-brand-blue" : "bg-brand-blue text-white"
        )}>
          {route.badge}
        </span>
      )}
    </Link>
  );
}

export default function DashboardNavigation({ routes }: Props) {
  return (
    <nav className="space-y-1">
      {routes.map((route) => (
        <NavItem key={route.id} route={route} />
      ))}
    </nav>
  );
}
