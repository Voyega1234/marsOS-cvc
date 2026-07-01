"use client";

import { useUIMode } from "@/contexts/UIModeContext";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppSidebar, SidebarProvider, SidebarTrigger } from "./AppSidebar";
import { TopNav } from "./TopNav";
import { ProTopBar } from "./ProTopBar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { mode: uiMode } = useUIMode();
  const pathname = usePathname();
  const { data: session } = useSession();
  const isChat = pathname === "/chat";
  const isClient = session?.user?.role === 'CLIENT';

  // Simple mode (wizard)
  if (uiMode === "simple") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50/60 to-slate-50">
        <TopNav />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">{children}</main>
      </div>
    );
  }

  // CLIENT — no sidebar, minimal top bar
  if (isClient) {
    return (
      <div className="relative flex flex-1 flex-col min-h-svh overflow-hidden bg-[#f7f7f6]">
        <ProTopBar />
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    );
  }

  // Professional — single unified layout (sidebar + content)
  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="relative flex flex-1 flex-col min-h-svh overflow-hidden rounded-xl border border-gray-200 bg-[#f7f7f6] shadow-sm m-2 ml-0">
        {!isChat && <ProTopBar />}
        <main className={isChat ? "flex-1 overflow-hidden" : "flex-1 p-6 overflow-auto"}>
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
