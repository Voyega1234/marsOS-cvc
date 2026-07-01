"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconChevronDown, IconLogout, IconSettings } from "@tabler/icons-react";

interface Props {
  user: {
    name: string;
    email: string;
    avatar?: string;
  };
}

export function NavFooter({ user }: Props) {
  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <SidebarFooter className="border-t border-gray-100 px-2 py-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="gap-3 hover:bg-gray-100 data-[state=open]:bg-gray-100 px-2"
              >
                {user.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-7 h-7 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[11px] font-semibold text-gray-600 shrink-0">
                    {initials}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-900 truncate">{user.name}</p>
                  <p className="text-[11px] text-gray-400 truncate">{user.email}</p>
                </div>
                <IconChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-52 mb-1">
              <DropdownMenuItem asChild>
                <Link href="/settings" className="flex items-center gap-2 text-[13px]">
                  <IconSettings className="h-4 w-4" /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 focus:text-red-700 focus:bg-red-50 text-[13px]"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <IconLogout className="h-4 w-4" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
