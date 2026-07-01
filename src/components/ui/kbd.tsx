import * as React from "react";
import { cn } from "@/lib/utils";

const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-gray-100 bg-gray-100 px-1 font-mono text-[11px] font-medium text-gray-500",
        className
      )}
      {...props}
    />
  )
);
Kbd.displayName = "Kbd";

const KbdGroup = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn("flex items-center gap-0.5", className)}
      {...props}
    />
  )
);
KbdGroup.displayName = "KbdGroup";

export { Kbd, KbdGroup };
