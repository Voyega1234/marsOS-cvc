"use client";

import { useSession, signOut } from "next-auth/react";
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
  BookOpen,
  Calendar,
  CheckSquare,
  Database,
  FileText,
  FolderOpen,
  Globe,
  Home,
  Image,
  Layers,
  LogOut,
  Network,
  RefreshCw,
  Search,
  Settings,
  Users,
  Zap,
  ClipboardCheck,
  KeyRound,
  ScrollText,
  Sun,
  ListTodo,
  LineChart,
  FlaskConical,
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

  const base: Route[] = [
    {
      id: "overview",
      title: "Home",
      icon: <Home className="size-4" />,
      link: "/dashboard",
    },
    {
      id: "morning-brief",
      title: "Morning Brief",
      icon: <Sun className="size-4" />,
      link: "/morning-brief",
      badge: briefBadge,
      badgeVariant: "red" as const,
    },
    {
      id: "todos",
      title: "Todos",
      icon: <ListTodo className="size-4" />,
      link: "/todos",
      badge: todosBadge,
      badgeVariant: "black" as const,
    },
    {
      id: "projects",
      title: "Clients",
      icon: <FolderOpen className="size-4" />,
      link: "/projects",
    },
    {
      id: "content",
      title: "Articles",
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
        { title: "Content Refresh", link: "/refresh",        icon: <RefreshCw className="size-3.5" /> },
        { title: "Content Studio",  link: "/content-studio", icon: <Search    className="size-3.5" /> },
        { title: "Image Studio",    link: "/image-studio",   icon: <Image     className="size-3.5" /> },
        { title: "SEO Report",      link: "/ai-seo-report",  icon: <BarChart2 className="size-3.5" /> },
      ],
    },
    {
      id: "backlink",
      title: "Backlink",
      icon: <Network className="size-4" />,
      link: "/backlink-assistant",
    },
    {
      id: "report",
      title: "Report",
      icon: <LineChart className="size-4" />,
      link: "/report",
    },
    {
      id: "ai-tools",
      title: "AI",
      icon: <Zap className="size-4" />,
      link: "/ai-jobs",
    },
    {
      id: "seo-intelligence-lab",
      title: "SEO Intelligence Lab",
      icon: <FlaskConical className="size-4" />,
      link: "/seo-intelligence-lab",
    },
  ];

  // ADMIN only: Website Connect + Settings (including AI Connect, Team, Users)
  if (role === "ADMIN") {
    base.push(
      {
        id: "publish",
        title: "Website Connect",
        icon: <Globe className="size-4" />,
        link: "/website-connect",
      },
      {
        id: "settings",
        title: "Settings",
        icon: <Settings className="size-4" />,
        link: "/settings",
        subs: [
          { title: "AI Connect",       link: "/ai-connect",        icon: <KeyRound   className="size-3.5" /> },
          { title: "Prompts & Skills", link: "/settings/prompts",  icon: <FileText   className="size-3.5" /> },
          { title: "Activity Logs",  link: "/activity-logs",  icon: <ScrollText className="size-3.5" /> },
          { title: "จัดการ Users",    link: "/admin/users",    icon: <Users      className="size-3.5" /> },
        ],
      }
    );
  }

  return base;
}

const teams = [
  { id: "1", name: "Mars", plan: "Pro" },
];

function SidebarInner() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { data: session } = useSession();
  const [cmdOpen, setCmdOpen] = useState(false);

  const orgName  = "Mars";
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
          {/* Name only — no logo */}
          <a href="/dashboard" className="flex items-center">
            {!isCollapsed && (
              <span className="font-semibold text-gray-900">Mars</span>
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
          {/* User info + logout */}
          {!isCollapsed ? (
            <div className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-100 group">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-800 text-[11px] font-bold text-white">
                {(session?.user?.name ?? session?.user?.email ?? "U")[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-gray-900 truncate">
                  {session?.user?.name ?? session?.user?.email ?? "User"}
                </p>
                <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", roleBadge)}>
                  {userRole}
                </span>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-200"
                title="ออกจากระบบ"
              >
                <LogOut className="size-3.5 text-gray-500" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex w-full items-center justify-center p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700"
              title="ออกจากระบบ"
            >
              <LogOut className="size-4" />
            </button>
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
