"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Team {
  id: string;
  name: string;
  plan: string;
  logo?: React.ElementType;
}

interface Props {
  teams: Team[];
}

export function TeamSwitcher({ teams }: Props) {
  const [selected, setSelected] = useState(teams[0]);

  if (!selected) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-gray-100 transition-colors">
          {/* Team avatar */}
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-900 text-[10px] font-bold text-white">
            {selected.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-gray-900 truncate">{selected.name}</p>
            <p className="text-[11px] text-gray-400 truncate">{selected.plan}</p>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-52 mb-1">
        {teams.map((team) => (
          <DropdownMenuItem
            key={team.id}
            onClick={() => setSelected(team)}
            className="flex items-center gap-2.5 text-[13px]"
          >
            <div className="flex h-5 w-5 items-center justify-center rounded bg-gray-800 text-[9px] font-bold text-white shrink-0">
              {team.name[0]}
            </div>
            <span className="flex-1 truncate">{team.name}</span>
            {selected.id === team.id && <Check className="h-3.5 w-3.5 text-gray-500" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="flex items-center gap-2 text-[13px] text-gray-500">
          <Plus className="h-3.5 w-3.5" />
          New organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
