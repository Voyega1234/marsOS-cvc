"use client";

/**
 * Brand Radar — help for a table heading. Rest the pointer on the heading for 2 seconds (or focus it with Tab)
 * to read what the column is, how it is calculated and when it is updated.
 * Text comes from the glossary in column-help.ts; it is written by us, never by an API.
 */
import type { ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { COLUMN_HELP, type ColumnHelpKey, type ColumnHelpText } from "./column-help";

const HOVER_DELAY_MS = 2000;

export function ColumnHelp({ k, help, children, align = "center" }: {
  /** key in the glossary */
  k?: ColumnHelpKey;
  /** one-off text for a heading that is not in the glossary */
  help?: ColumnHelpText;
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  const text = help ?? (k ? COLUMN_HELP[k] : undefined);
  if (!text) return <>{children}</>;
  return (
    <TooltipPrimitive.Provider delayDuration={HOVER_DELAY_MS} skipDelayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span tabIndex={0} className="cursor-help rounded-sm underline decoration-gray-300 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-brand-blue">
            {children}
          </span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            align={align}
            sideOffset={6}
            collisionPadding={12}
            className="z-[100] max-w-xs space-y-1.5 rounded-xl border bg-popover px-3 py-2.5 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground shadow-lg"
          >
            <p><b className="font-semibold">คืออะไร:</b> {text.what}</p>
            <p><b className="font-semibold">คิดยังไง:</b> {text.how}</p>
            <p><b className="font-semibold">อัปเดตตอนไหน:</b> {text.when}</p>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
