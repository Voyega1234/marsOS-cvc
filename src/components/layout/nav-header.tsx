"use client";

import { Search } from "lucide-react";
import { SidebarHeader } from "@/components/ui/sidebar";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { SidebarData } from "./types";

interface Props {
  data: SidebarData;
  onSearchClick?: () => void;
}

export function NavHeader({ data, onSearchClick }: Props) {
  return (
    <SidebarHeader className="px-3 pt-4 pb-2">
      {/* Search bar — matches screenshot exactly */}
      <button
        onClick={onSearchClick}
        className="flex w-full items-center gap-2 rounded-md border border-gray-100 bg-white px-3 py-1.5 text-sm text-gray-400 shadow-none hover:bg-gray-50 transition-colors"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left text-[13px]">Search</span>
        <KbdGroup className="flex items-center gap-px">
          <Kbd className="text-[10px] border-gray-100 bg-gray-100 text-gray-400">⌘</Kbd>
          <Kbd className="text-[10px] border-gray-100 bg-gray-100 text-gray-400">K</Kbd>
        </KbdGroup>
      </button>
    </SidebarHeader>
  );
}
