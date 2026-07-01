"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut } from "next-auth/react";
import { useSession } from "next-auth/react";
import {
  LayoutDashboard, FolderOpen, FileText, CheckSquare, Settings, LogOut, ChevronDown, Plus,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_CONFIG } from "@/types";

const navItems = [
  { href: "/dashboard", label: "โปรเจ็กต์",   icon: FolderOpen },
  { href: "/review",    label: "รอตรวจ",       icon: CheckSquare },
];

export function TopNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const roleLabel = ROLE_CONFIG[session?.user?.role as keyof typeof ROLE_CONFIG]?.label ?? session?.user?.role;

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-b border-gray-100lue-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center h-16 gap-4">

          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2.5 flex-shrink-0 mr-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-base">P</span>
            </div>
            <div className="hidden sm:block">
              <p className="font-bold text-gray-900 text-sm leading-none">Mars</p>
              <p className="text-xs text-gray-400 leading-none mt-0.5">Pipeline</p>
            </div>
          </Link>

          {/* Nav */}
          <nav className="flex items-center gap-0.5 flex-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all",
                    isActive
                      ? "bg-green-50 text-green-700 shadow-sm"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                  )}
                >
                  <item.icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-green-600" : "text-gray-400")} />
                  <span className="hidden md:inline">{item.label}</span>
                  {isActive && <span className="hidden md:block w-1.5 h-1.5 rounded-full bg-green-500 ml-0.5" />}
                </Link>
              );
            })}
          </nav>

          {/* Quick Create */}
          <Link
            href="/articles/new"
            className="hidden sm:flex items-center gap-1.5 px-4 py-2 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>สร้างบทความ</span>
          </Link>

          {/* Settings */}
          <Link href="/settings" className="p-2 rounded-xl text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors">
            <Settings className="h-4.5 w-4.5" />
          </Link>

          {/* User */}
          {session?.user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-gradient-to-br from-green-400 to-emerald-600 text-white text-xs font-bold">
                      {session.user.name?.[0]?.toUpperCase() ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden sm:block text-left">
                    <p className="text-sm font-semibold text-gray-900 leading-none">{session.user.name}</p>
                    <p className="text-xs text-gray-400 leading-none mt-1">{roleLabel}</p>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-gray-400 hidden sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 rounded-xl border-gray-100 shadow-lg">
                <div className="px-3 py-2 border-b border-gray-50">
                  <p className="text-sm font-semibold text-gray-900">{session.user.name}</p>
                  <p className="text-xs text-gray-400">{session.user.email}</p>
                </div>
                <DropdownMenuItem asChild className="rounded-lg mx-1 mt-1">
                  <Link href="/settings">ตั้งค่าบัญชี</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-red-600 rounded-lg mx-1 mb-1 focus:bg-red-50 focus:text-red-700"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  ออกจากระบบ
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
