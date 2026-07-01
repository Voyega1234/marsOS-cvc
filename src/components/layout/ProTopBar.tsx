"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, Plus, ChevronDown, LogOut } from "lucide-react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { NotificationBell } from "./NotificationBell";
import { CommandMenu } from "./CommandMenu";
import { Kbd } from "@/components/ui/kbd";
import { useMars } from "@/lib/context/mars-context";
import { IconBolt } from "@tabler/icons-react";

const PAGE_LABELS: Record<string, string> = {
  "/dashboard":            "หน้าหลัก",
  "/my-tasks":             "งานของฉัน",
  "/calendar":             "ปฏิทิน",
  "/projects":             "Projects",
  "/articles":             "บทความ",
  "/review":               "รอ Review",
  "/content-studio":       "Content Studio",
  "/ai-jobs":              "งานที่กำลังทำ",
  "/prompts":              "Prompt Library",
  "/templates":            "Templates",
  "/backlink-assistant":   "Backlink",
  "/website-connect":      "เผยแพร่",
  "/ai-seo-report":        "SEO Report",
  "/ai-connect":           "เชื่อมต่อ AI",
  "/users":                "ทีมงาน",
  "/activity-logs":        "Activity Logs",
  "/setup":                "เริ่มใช้งาน",
  "/settings":             "ตั้งค่า",
  "/notifications":        "การแจ้งเตือน",
};

export function ProTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { enterFront } = useMars();
  const { data: session } = useSession();
  const isClient = session?.user?.role === 'CLIENT';
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("ALL");
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [demoDismissed, setDemoDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("mars_demo_dismissed") === "1";
  });

  function dismissDemo() {
    localStorage.setItem("mars_demo_dismissed", "1");
    setDemoDismissed(true);
  }

  const pageLabel =
    Object.entries(PAGE_LABELS).find(([k]) => pathname === k || (k !== "/dashboard" && pathname.startsWith(k)))?.[1] ?? "Console";

  // Global Cmd+K
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setProjects(data); })
      .catch(() => {});
  }, []);

  const selectedProjectName = projects.find((p) => p.id === selectedProject)?.name ?? "All Projects";

  return (
    <>
      <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />

      {/* Demo Mode banner — dismissable, hidden for CLIENT */}
      {!demoDismissed && !isClient && (
        <div className="bg-amber-50 border-b border-amber-100 px-5 py-1.5 flex items-center gap-2 text-xs text-amber-700">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="font-medium">Demo Mode</span>
          <span className="text-amber-500">— AI ยังไม่ได้ connect (mock output) · เชื่อมต่อจริงได้ที่</span>
          <Link href="/ai-connect" className="underline underline-offset-2 font-medium hover:text-amber-800">เชื่อมต่อ AI</Link>
          <button onClick={dismissDemo} className="ml-auto text-amber-400 hover:text-amber-700 transition-colors p-0.5 rounded" aria-label="ปิด">✕</button>
        </div>
      )}

      <div className="sticky top-0 z-30 bg-white border-b border-gray-100 px-5 py-2.5 flex items-center gap-3">
        {/* Mars back button */}
        <button
          onClick={enterFront}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors shrink-0 mr-1"
        >
          <IconBolt className="h-3.5 w-3.5" />
          Mars
        </button>
        <span className="text-gray-200 shrink-0">/</span>

        {/* Page Label */}
        <div className="flex-shrink-0">
          <h1 className="text-sm font-semibold text-gray-900">{pageLabel}</h1>
        </div>

        {/* Project Switcher — hidden for CLIENT */}
        {!isClient && projects.length > 0 && (
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowProjectPicker(!showProjectPicker)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span className="max-w-32 truncate text-gray-700">{selectedProjectName}</span>
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </button>
            {showProjectPicker && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-100 rounded-xl shadow-lg z-50 overflow-hidden">
                <button
                  onClick={() => { setSelectedProject("ALL"); setShowProjectPicker(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors ${selectedProject === "ALL" ? "text-green-700 font-medium bg-green-50" : "text-gray-700"}`}
                >
                  All Projects
                </button>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setSelectedProject(p.id); setShowProjectPicker(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors ${selectedProject === p.id ? "text-green-700 font-medium bg-green-50" : "text-gray-700"}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
            {showProjectPicker && (
              <div className="fixed inset-0 z-40" onClick={() => setShowProjectPicker(false)} />
            )}
          </div>
        )}

        {/* Search bar — hidden for CLIENT */}
        {!isClient && (
          <button
            onClick={() => setCmdOpen(true)}
            className="flex-1 max-w-md flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 text-left"
          >
            <Search className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1">ค้นหา หรือสั่งงาน...</span>
            <KbdGroup className="flex items-center gap-0.5">
              <Kbd>⌘</Kbd><Kbd>K</Kbd>
            </KbdGroup>
          </button>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {/* สร้างบทความ — hidden for CLIENT */}
          {!isClient && (
            <Link
              href="/articles/new"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              สร้างบทความ
            </Link>
          )}
          {!isClient && <NotificationBell />}
          {/* Logout button — CLIENT only */}
          {isClient && (
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              ออกจากระบบ
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// re-export KbdGroup locally to avoid unused import warning
function KbdGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={className}>{children}</span>;
}
