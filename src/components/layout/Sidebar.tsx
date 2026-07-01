"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, FolderKanban, Search, Map, FileText, ClipboardCheck,
  Cpu, BookOpen, Layers, Globe, Users, ScrollText, Settings, LogOut,
  ChevronRight, Sparkles, Zap, Network, BarChart2, PenLine, KeyRound,
  CheckSquare, CalendarDays, Bell, ImageIcon,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { useSession } from "next-auth/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ROLE_CONFIG } from "@/types";

type NavGroup = {
  label?: string;
  items: { href: string; label: string; icon: React.ElementType; badge?: string }[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/dashboard",      label: "Projects",       icon: FolderKanban },
      { href: "/my-tasks",       label: "My Tasks",       icon: CheckSquare },
      { href: "/calendar",       label: "Calendar",       icon: CalendarDays },
      { href: "/notifications",  label: "Notifications",  icon: Bell },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/review",     label: "Review Queue", icon: ClipboardCheck },
    ],
  },
  {
    label: "AI Tools",
    items: [
      { href: "/content-studio",      label: "Content Studio",     icon: PenLine },
      { href: "/image-studio",        label: "Image Studio",       icon: ImageIcon },
      { href: "/ai-jobs",             label: "AI Jobs",            icon: Cpu },
      { href: "/prompts",             label: "Prompt Library",     icon: BookOpen },
      { href: "/templates",           label: "Brand Templates",    icon: Layers },
      { href: "/backlink-assistant",  label: "Backlink Assistant", icon: Network },
      { href: "/ai-seo-report",       label: "AI SEO Report",      icon: BarChart2 },
    ],
  },
  {
    label: "Website Connect",
    items: [
      { href: "/website-connect", label: "Website Connect", icon: Globe },
    ],
  },
];

const ADMIN_GROUP: NavGroup = {
  label: "Admin",
  items: [
    { href: "/ai-connect",     label: "AI Connect",     icon: KeyRound },
    { href: "/setup",          label: "Setup Guide",    icon: Zap },
    { href: "/users",          label: "Users & Roles",  icon: Users },
    { href: "/activity-logs",  label: "Activity Logs",  icon: ScrollText },
    { href: "/settings",       label: "Settings",       icon: Settings },
  ],
};

function isActive(href: string, pathname: string): boolean {
  const clean = href.split("?")[0].split("#")[0];
  if (clean === "/dashboard") return pathname === "/dashboard";
  return pathname.startsWith(clean);
}

function NavItem({
  href, label, icon: Icon, badge, pathname,
}: { href: string; label: string; icon: React.ElementType; badge?: string; pathname: string }) {
  const active = isActive(href, pathname);
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all relative",
        active
          ? "bg-green-500/10 text-green-400"
          : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-green-500 rounded-r-full" />
      )}
      <Icon className={cn("h-4 w-4 flex-shrink-0", active ? "text-green-400" : "text-slate-500 group-hover:text-slate-300")} />
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-semibold">{badge}</span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "SEO_MANAGER";
  const roleLabel = ROLE_CONFIG[session?.user?.role as keyof typeof ROLE_CONFIG]?.label ?? session?.user?.role ?? "";

  const groups = isAdmin ? [...NAV_GROUPS, ADMIN_GROUP] : NAV_GROUPS;

  return (
    <aside className="w-60 min-h-screen bg-slate-950 border-r border-slate-800 flex flex-col flex-shrink-0">

      {/* Logo */}
      <div className="px-4 py-5 border-b border-slate-800">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shadow-sm flex-shrink-0">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm text-white leading-none">Mars</p>
            <p className="text-xs text-slate-500 mt-0.5">Pipeline Console</p>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="px-3 mb-1.5 text-xs font-semibold text-slate-600 uppercase tracking-widest">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem key={item.href} {...item} pathname={pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User Footer */}
      {session?.user && (
        <div className="px-3 py-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback className="bg-gradient-to-br from-green-500 to-emerald-600 text-white text-xs font-bold">
                {session.user.name?.[0]?.toUpperCase() ?? "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{session.user.name}</p>
              <p className="text-xs text-slate-500 truncate">{roleLabel}</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full mt-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
