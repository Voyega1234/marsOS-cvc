"use client";

import { usePathname } from "next/navigation";
import { useSession } from "@/components/layout/SessionProvider";
import { AppSidebar, SidebarProvider, SidebarTrigger } from "./AppSidebar";
import { ProTopBar } from "./ProTopBar";
import { ClientTopBar } from "@/components/client-portal/ClientTopBar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isChat = pathname === "/chat";
  const isClient = session?.user?.role === 'CLIENT';

  // CLIENT — no sidebar, minimal top bar
  if (isClient) {
    return (
      <div className="relative flex flex-1 flex-col min-w-0 min-h-svh overflow-hidden">
        <ClientTopBar />
        <main className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 overflow-auto">{children}</main>
      </div>
    );
  }

  // Default — sidebar layout
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* มือถือ: เต็มจอไม่มีขอบ, เมนูซ้ายเป็นลิ้นชักเปิดจากปุ่ม ☰ บนแถบบน */}
      <div className="relative flex flex-1 flex-col min-w-0 min-h-svh overflow-hidden">
        {!isChat && <ProTopBar leading={<SidebarTrigger className="md:hidden h-8 w-8 shrink-0 -ml-1 text-gray-600" />} />}
        {isChat && (
          <SidebarTrigger className="md:hidden absolute left-2 top-2 z-40 h-9 w-9 rounded-full bg-white/90 shadow-sm text-gray-600" />
        )}
        <main className={isChat ? "flex-1 min-w-0 overflow-hidden" : "flex-1 min-w-0 p-3 sm:p-4 md:p-6 overflow-auto"}>
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
