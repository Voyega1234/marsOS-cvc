"use client";

import { useSession } from "@/components/layout/SessionProvider";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { UserMenu } from "./UserMenu";
import NextImage from "next/image";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  BarChart2,
  Calendar,
  Cpu,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Layers,
  RefreshCw,
  Search,
  Settings,
  Users,
  ClipboardCheck,
  ScrollText,
  Sun,
  Newspaper,
  Upload,
  Network,
  SearchCheck,
  Link2,
  ShieldCheck,
} from "lucide-react";
import type { Route } from "./nav-main";
import DashboardNavigation from "./nav-main";
import SidebarClients from "./SidebarClients";
import { NotificationsPopover } from "./nav-notifications";
import { TeamSwitcher } from "./team-switcher";
import { CommandMenu } from "./CommandMenu";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";


type UserRole = "ADMIN" | "USER" | "CLIENT" | string;

function buildRoutes(briefBadge: number, role: UserRole): Route[] {
  // CLIENT: only show Clients (projects) — they access specific projects assigned by admin
  if (role === "CLIENT") {
    return [
      {
        id: "projects",
        title: "SEO SME",
        icon: <FolderOpen className="size-4" />,
        link: "/projects",
      },
    ];
  }

  // เมนูหลัก: News & Update / SEO SME / Upload Article / PBN Backlinks / Keyword Research / Article / Studio / Setting
  const base: Route[] = [
    {
      id: "morning-brief",
      title: "News & Update",
      icon: <Newspaper className="size-4" />,
      link: "/morning-brief",
      badge: briefBadge,
      badgeVariant: "red" as const,
    },
    {
      id: "projects",
      title: "SEO SME",
      icon: <FolderOpen className="size-4" />,
      link: "/projects",
    },
    {
      id: "upload-article",
      title: "Upload Article",
      icon: <Upload className="size-4" />,
      link: "/upload-article",
    },
    {
      id: "pbn-backlinks",
      title: "PBN Backlinks",
      icon: <Network className="size-4" />,
      link: "/pbn-backlinks",
    },
    // โมดูลเสริม (แยกตาราง/แยก API ของตัวเอง ไม่แตะระบบเดิม)
    {
      id: "backlink-management",
      title: "Backlink Management",
      icon: <Link2 className="size-4" />,
      link: "/backlink-management",
    },
    {
      id: "compliance",
      title: "Compliance Checker",
      icon: <ShieldCheck className="size-4" />,
      link: "/compliance",
    },
    {
      id: "keyword-research",
      title: "Keyword Research",
      icon: <SearchCheck className="size-4" />,
      link: "/keyword-research",
    },
    {
      id: "content",
      title: "Article",
      icon: <FileText className="size-4" />,
      link: "/articles",
      subs: [
        { title: "All Articles",  link: "/articles", icon: <FileText       className="size-3.5" /> },
        { title: "Review Queue",  link: "/review",   icon: <ClipboardCheck className="size-3.5" /> },
        { title: "Calendar",      link: "/calendar", icon: <Calendar       className="size-3.5" /> },
      ],
    },
    {
      id: "studio",
      title: "Studio",
      icon: <Layers className="size-4" />,
      link: "/content-studio",
      subs: [
        // Content Engine ของ Studio: ปรับ prompt สำหรับเครื่องมือใน Studio เท่านั้น (ชุด org-active)
        // (Content Refresh ย้ายไปอยู่ใน Clients ต่อโปรเจกต์แล้ว)
        { title: "Content Engine",  link: "/content-engine", icon: <Cpu       className="size-3.5" /> },
        { title: "Content Studio",  link: "/content-studio", icon: <Search    className="size-3.5" /> },
        { title: "Image Studio",    link: "/image-studio",   icon: <Image     className="size-3.5" /> },
      ],
    },
  ];

  // ADMIN only: Setting หน้า home — AI Cost + Activity Logs + Users เท่านั้น
  // (Content Engine อยู่ในฟันเฟืองของแต่ละ project และใน Studio)
  if (role === "ADMIN") {
    base.push({
      id: "settings",
      title: "Setting",
      icon: <Settings className="size-4" />,
      link: "/settings",
      subs: [
        { title: "AI Cost",       link: "/settings/ai-cost", icon: <BarChart2  className="size-3.5" /> },
        { title: "Activity Logs", link: "/activity-logs",    icon: <ScrollText className="size-3.5" /> },
        { title: "Users",         link: "/admin/users",      icon: <Users      className="size-3.5" /> },
      ],
    });
  }

  return base;
}

const teams = [
  { id: "1", name: "MarsOS", plan: "Pro" },
];

function SidebarInner() {
  const { state, isMobile, setOpen, setOpenMobile } = useSidebar();
  // มือถือเป็นลิ้นชักเต็มเสมอ — สถานะพับของเดสก์ท็อปห้ามทำให้ชื่อเมนูหาย
  const isCollapsed = state === "collapsed" && !isMobile;
  const pathname = usePathname();
  // เปลี่ยนหน้าแล้วปิดลิ้นชักบนมือถือ
  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  // แท็บเล็ต (768–1023px): เริ่มแบบพับเหลือไอคอน ให้เนื้อหามีที่พอ — กดเปิดเองได้
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (window.innerWidth >= 768 && window.innerWidth < 1024) setOpen(false); }, []);
  const { data: session } = useSession();
  const [cmdOpen, setCmdOpen] = useState(false);

  const orgName  = "MarsOS";
  const orgPlan  = "Pro";
  const orgTeams = [{ id: "1", name: orgName, plan: orgPlan }];

  const [briefBadge, setBriefBadge] = useState(0);

  useEffect(() => {
    // badge ใช้ endpoint เบา — ตัวเต็ม (/api/morning-brief) หนัก 6-7 วิ ห้ามเรียกทุกหน้า
    fetch('/api/morning-brief/badge').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.criticalCount != null) setBriefBadge(d.criticalCount);
    }).catch(() => {});
  }, []);

  const userRole = session?.user?.role ?? "USER";
  const dashboardRoutes = buildRoutes(briefBadge, userRole);

  const roleBadgeColor: Record<string, string> = {
    ADMIN: "bg-red-100 text-red-700",
    USER: "bg-blue-100 text-blue-700",
    CLIENT: "bg-teal-100 text-teal-700",
  };
  const roleBadge = roleBadgeColor[userRole] ?? "bg-gray-100 text-gray-600";
  const userName = session?.user?.name ?? session?.user?.email ?? "User";
  const userDetail = session?.user?.name && session?.user?.email ? session.user.email : undefined;

  async function logout() {
    // จด "ออกจากระบบ" ลง Activity Log ก่อน session หาย
    await fetch("/api/activity-logs/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "logout" }) }).catch(() => {});
    try { await createSupabaseBrowser().auth.signOut(); } catch { /* env ไม่ครบ (dev) */ }
    window.location.href = "/login";
  }

  return (
    <>
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <Sidebar variant="floating" collapsible="icon">
        <SidebarHeader
          className={cn(
            "flex md:pt-3",
            isCollapsed
              ? "flex-col items-center gap-3"
              : "flex-row items-center justify-between px-3"
          )}
        >
          {/* CVC Brand logo + name */}
          <a href="/morning-brief" className="flex min-w-0 items-center gap-2.5" title="MarsOS">
            {/* โลโก้ Convert Cake (เจ้าของสั่งใส่กลับ 2026-11-13) — ชื่อระบบคงเป็น MarsOS ตามกฎ brand lock */}
            <NextImage
              src="/logos/convertcake-mark-96.png"
              alt="Convert Cake"
              width={36}
              height={36}
              unoptimized
              className="h-9 w-9 shrink-0 object-contain"
            />
            {!isCollapsed && (
              <span className="truncate font-semibold text-brand-navy text-[17px] tracking-tight">MarsOS</span>
            )}
          </a>

          {/* Notification + trigger */}
          <motion.div
            key={isCollapsed ? "collapsed" : "expanded"}
            className={cn(
              "flex items-center gap-1",
              isCollapsed ? "flex-col-reverse" : "flex-row"
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <NotificationsPopover notifications={[]} />
            <SidebarTrigger className="h-8 w-8 text-gray-500 hover:text-brand-navy hover:bg-white/80 rounded-full" />
          </motion.div>
        </SidebarHeader>

        <SidebarContent className={cn("gap-0 py-3", isCollapsed ? "px-2" : "px-3")}>
          <DashboardNavigation routes={dashboardRoutes} />
        </SidebarContent>

        <SidebarFooter className={cn("pb-3 space-y-1", isCollapsed ? "px-2 items-center" : "px-3")}>
          {/* พับอยู่: โชว์แค่วงกลมชื่อย่อ — กดเปิดเมนูผู้ใช้ (โหมดแสดงผล + ออกจากระบบ) */}
          {isCollapsed && (
            <UserMenu name={userName} detail={userDetail} onLogout={logout} side="right" align="end">
              <button
                type="button"
                title={userName}
                aria-label="เมนูผู้ใช้"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-navy text-[12px] font-semibold text-white transition-shadow hover:ring-2 hover:ring-brand-blue/40"
              >
                {userName[0]?.toUpperCase()}
              </button>
            </UserMenu>
          )}
          {/* User info — กดที่การ์ดเปิดเมนูผู้ใช้, ปุ่มออกจากระบบแบบ hover ยังอยู่เหมือนเดิม */}
          {!isCollapsed && (
            <div className="flex items-center gap-1 pr-1.5 rounded-2xl bg-white/60 hover:bg-white/90 transition-colors group">
              <UserMenu name={userName} detail={userDetail} onLogout={logout}>
                <button type="button" aria-label="เมนูผู้ใช้" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-2 py-2 text-left">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-navy text-[12px] font-semibold text-white">
                    {userName[0]?.toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12px] font-medium text-brand-navy truncate">{userName}</span>
                    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", roleBadge)}>
                      {userRole}
                    </span>
                  </span>
                  <ChevronsUpDown size={13} className="shrink-0 text-gray-400" />
                </button>
              </UserMenu>
              <button
                title="ออกจากระบบ"
                onClick={logout}
                className="md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
              >
                <LogOut size={13} />
              </button>
            </div>
          )}
        </SidebarFooter>
      </Sidebar>
    </>
  );
}

export function AppSidebar() {
  return <SidebarInner />;
}

export { SidebarProvider, SidebarTrigger };
