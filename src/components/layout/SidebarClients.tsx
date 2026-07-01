"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type ClientItem = {
  id: string;
  name: string;
  clientName: string | null;
  businessType: string;
  industry: string | null;
  logoUrl: string | null;
  status: string;
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}

function avatarColor(name: string) {
  const colors = [
    "bg-blue-500","bg-emerald-500","bg-violet-500","bg-rose-500",
    "bg-amber-500","bg-cyan-500","bg-pink-500","bg-indigo-500",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

export default function SidebarClients({ collapsed }: { collapsed: boolean }) {
  const [clients, setClients] = useState<ClientItem[]>([]);
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/projects")
      .then(r => r.ok ? r.json() : [])
      .then((data: ClientItem[]) => {
        setClients(data.filter(p => p.status !== "ARCHIVED").slice(0, 20));
      })
      .catch(() => {});
  }, []);

  if (!clients.length) return null;

  return (
    <div className="mt-2 border-t border-gray-100 pt-3">
      {!collapsed && (
        <p className="px-3 mb-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Client</p>
      )}
      <div className="space-y-0.5">
        {clients.map(c => {
          const displayName = c.clientName || c.name;
          const isActive = pathname.startsWith(`/projects/${c.id}`);
          return (
            <Link key={c.id} href={`/projects/${c.id}`}
              className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors group ${isActive ? "bg-gray-100" : "hover:bg-gray-100"}`}>
              {/* Avatar / Logo */}
              <div className={`shrink-0 flex items-center justify-center rounded-full text-white font-bold text-[11px] overflow-hidden ${collapsed ? "w-7 h-7" : "w-7 h-7"} ${c.logoUrl ? "" : avatarColor(displayName)}`}>
                {c.logoUrl
                  ? <img src={c.logoUrl} alt={displayName} className="w-full h-full object-cover rounded-full" />
                  : initials(displayName)
                }
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-gray-800 truncate leading-tight">{displayName}</p>
                  <p className="text-[10px] text-gray-400 truncate">{c.industry || c.businessType}</p>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
