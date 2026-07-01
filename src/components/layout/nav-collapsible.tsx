"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarGroup } from "@/components/ui/sidebar";
import type { CollapsibleItem, FavoriteItem } from "./types";

// ── Section wrapper with collapse toggle ──────────────────────────────────────

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <SidebarGroup className="px-3 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-1 text-[12px] font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        {title}
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      {open && <div className="mt-1 space-y-0.5">{children}</div>}
    </SidebarGroup>
  );
}

// ── Row variants ──────────────────────────────────────────────────────────────

function DotRow({ item }: { item: FavoriteItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] text-gray-700 hover:bg-gray-100 transition-colors"
    >
      <span className={cn("h-[10px] w-[10px] rounded-full shrink-0", item.color)} />
      {item.title}
    </Link>
  );
}

function IconRow({ item }: { item: CollapsibleItem }) {
  const inner = (
    <>
      <item.icon className="h-[18px] w-[18px] shrink-0 text-gray-500" aria-hidden />
      {item.title}
    </>
  );
  if (item.href) {
    return (
      <Link href={item.href} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] text-gray-700 hover:bg-gray-100 transition-colors">
        {inner}
      </Link>
    );
  }
  return (
    <button className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-[13px] text-gray-700 hover:bg-gray-100 transition-colors">
      {inner}
    </button>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  favorites: FavoriteItem[];
  teams: CollapsibleItem[];
  topics: CollapsibleItem[];
}

export function NavCollapsible({ favorites, teams, topics }: Props) {
  return (
    <>
      <CollapsibleSection title="Favorites" defaultOpen>
        {favorites.map((item) => (
          <DotRow key={item.id} item={item} />
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="Teams" defaultOpen={false}>
        {teams.map((item) => (
          <IconRow key={item.id} item={item} />
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="Topics" defaultOpen={false}>
        {topics.map((item) => (
          <IconRow key={item.id} item={item} />
        ))}
      </CollapsibleSection>
    </>
  );
}
