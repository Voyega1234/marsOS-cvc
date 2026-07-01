import { cn } from "@/lib/utils";
import { ROLE_CONFIG } from "@/types";
import type { Role } from "@/types";

interface UserRoleBadgeProps {
  role: Role;
  className?: string;
}

export function UserRoleBadge({ role, className }: UserRoleBadgeProps) {
  const cfg = ROLE_CONFIG[role] ?? { label: role, color: "text-gray-600" };
  return (
    <span className={cn("inline-flex items-center text-xs font-medium", cfg.color, className)}>
      {cfg.label}
    </span>
  );
}
