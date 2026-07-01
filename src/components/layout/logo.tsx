import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-gray-900", className)}
    >
      {/* Sunburst / asterisk logo matching the reference screenshot */}
      <line x1="16" y1="2"  x2="16" y2="8"  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="16" y1="24" x2="16" y2="30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="2"  y1="16" x2="8"  y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="24" y1="16" x2="30" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="6.1"  y1="6.1"  x2="10.3" y2="10.3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="21.7" y1="21.7" x2="25.9" y2="25.9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="25.9" y1="6.1"  x2="21.7" y2="10.3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="10.3" y1="21.7" x2="6.1"  y2="25.9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}
