"use client";

import { useSession } from "@/components/layout/SessionProvider";
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
} from "lucide-react";
import type { Route } from "./nav-main";
import DashboardNavigation from "./nav-main";
import SidebarClients from "./SidebarClients";
import { NotificationsPopover } from "./nav-notifications";
import { TeamSwitcher } from "./team-switcher";
import { CommandMenu } from "./CommandMenu";
import { useState, useEffect } from "react";


type UserRole = "ADMIN" | "USER" | "CLIENT" | string;

function buildRoutes(briefBadge: number, todosBadge: number, role: UserRole): Route[] {
  // CLIENT: only show Clients (projects) — they access specific projects assigned by admin
  if (role === "CLIENT") {
    return [
      {
        id: "projects",
        title: "Clients",
        icon: <FolderOpen className="size-4" />,
        link: "/projects",
      },
    ];
  }

  // เมนูหลักเหลือ 5 รายการ: SEO News & Update / Clients / Article / Studio / Setting
  const base: Route[] = [
    {
      id: "morning-brief",
      title: "SEO News & Update",
      icon: <Newspaper className="size-4" />,
      link: "/morning-brief",
      badge: briefBadge,
      badgeVariant: "red" as const,
    },
    {
      id: "projects",
      title: "Clients",
      icon: <FolderOpen className="size-4" />,
      link: "/projects",
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
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { data: session } = useSession();
  const [cmdOpen, setCmdOpen] = useState(false);

  const orgName  = "MarsOS";
  const orgPlan  = "Pro";
  const orgTeams = [{ id: "1", name: orgName, plan: orgPlan }];

  const [briefBadge, setBriefBadge] = useState(0);
  const [todosBadge, setTodosBadge] = useState(0);

  useEffect(() => {
    fetch('/api/morning-brief').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.criticalCount != null) setBriefBadge(d.criticalCount);
    }).catch(() => {});
    fetch('/api/todos').then(r => r.ok ? r.json() : null).then((tasks: any[]) => {
      if (Array.isArray(tasks)) {
        setTodosBadge(tasks.filter(t => t.status === 'todo' || t.status === 'in_progress' || t.status === 'blocked').length);
      }
    }).catch(() => {});
  }, []);

  const userRole = session?.user?.role ?? "USER";
  const dashboardRoutes = buildRoutes(briefBadge, todosBadge, userRole);

  const roleBadgeColor: Record<string, string> = {
    ADMIN: "bg-red-100 text-red-700",
    USER: "bg-blue-100 text-blue-700",
    CLIENT: "bg-teal-100 text-teal-700",
  };
  const roleBadge = roleBadgeColor[userRole] ?? "bg-gray-100 text-gray-600";

  return (
    <>
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader
          className={cn(
            "flex md:pt-3.5",
            isCollapsed
              ? "flex-row items-center justify-between gap-y-4 md:flex-col md:items-start md:justify-start"
              : "flex-row items-center justify-between"
          )}
        >
          {/* CVC Brand logo + name */}
          <a href="/morning-brief" className="flex items-center gap-2">
            {/* โลโก้รูปถูกถอดตามคำสั่งเจ้าของ 2026-08-19 — ใช้ชื่อ MarsOS อย่างเดียว */}
            {!isCollapsed && (
              <span className="font-bold text-brand-navy text-base tracking-tight">MarsOS</span>
            )}
          </a>

          {/* Notification + trigger */}
          <motion.div
            key={isCollapsed ? "collapsed" : "expanded"}
            className={cn(
              "flex items-center gap-1",
              isCollapsed ? "flex-row md:flex-col-reverse" : "flex-row"
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <NotificationsPopover notifications={[]} />
            <SidebarTrigger className="h-8 w-8 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md" />
          </motion.div>
        </SidebarHeader>

        <SidebarContent className="gap-0 px-2 py-3">
          <DashboardNavigation routes={dashboardRoutes} />
        </SidebarContent>

        <SidebarFooter className="px-2 pb-3 space-y-1">
          {/* User info */}
          {!isCollapsed && (
            <div className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-100 group">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-800 text-[11px] font-bold text-white">
                {(session?.user?.name ?? session?.user?.email ?? "U")[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-brand-navy truncate">
                  {session?.user?.name ?? session?.user?.email ?? "User"}
                </p>
                <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", roleBadge)}>
                  {userRole}
                </span>
              </div>
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
