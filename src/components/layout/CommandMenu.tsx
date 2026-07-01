"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  IconArrowRight,
  IconArticle,
  IconAt,
  IconCalendar,
  IconChartBar,
  IconCpu,
  IconDashboard,
  IconFileSearch,
  IconFolderOpen,
  IconKeyboard,
  IconLogout,
  IconMessage,
  IconNetwork,
  IconPlus,
  IconPrompt,
  IconSearch,
  IconSettings,
  IconSettingsCode,
  IconStack2,
  IconTemplate,
  IconUser,
  IconUsers,
  IconWorld,
} from "@tabler/icons-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CommandMenu({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function go(href: string) {
    onOpenChange(false);
    setValue("");
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Command Menu</DialogTitle>
        <DialogDescription>Navigate and run actions across the SEO pipeline.</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="gap-0 overflow-hidden rounded-xl border border-gray-100 p-0 shadow-2xl sm:max-w-lg [&>button]:hidden"
      >
        <Command className="flex h-full w-full flex-col overflow-hidden bg-white">
          {/* Search bar */}
          <div className="flex h-12 items-center gap-2 border-b border-gray-100 px-4">
            <CommandInput
              className="h-10 text-[15px]"
              onValueChange={setValue}
              placeholder="Search anything..."
              value={value}
            />
            <button
              className="flex shrink-0 items-center"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              <Kbd>Esc</Kbd>
            </button>
          </div>

          <CommandList className="max-h-[420px] py-2">
            <CommandEmpty>ไม่พบผลลัพธ์</CommandEmpty>

            {/* Quick actions */}
            <CommandGroup>
              <CommandItem className="mx-2 rounded-lg py-2.5" onSelect={() => go("/articles/new")}>
                <IconPlus aria-hidden />
                New Article
                <KbdGroup className="ml-auto"><Kbd>⌘</Kbd><Kbd>N</Kbd></KbdGroup>
              </CommandItem>
              <CommandItem className="mx-2 rounded-lg py-2.5" onSelect={() => go("/articles")}>
                <IconSearch aria-hidden />
                Search Articles...
                <KbdGroup className="ml-auto"><Kbd>⌘</Kbd><Kbd>F</Kbd></KbdGroup>
              </CommandItem>
              <CommandItem className="mx-2 rounded-lg py-2.5" onSelect={() => go("/content-studio")}>
                <IconPrompt aria-hidden />
                Open Content Studio
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/* Navigate */}
            <CommandGroup heading="Navigate">
              {[
                { label: "Dashboard",         href: "/dashboard",          icon: IconDashboard },
                { label: "Projects",          href: "/projects",           icon: IconFolderOpen },
                { label: "Articles",          href: "/articles",           icon: IconArticle },
                { label: "Review Queue",      href: "/review",             icon: IconFileSearch },
                { label: "Calendar",          href: "/calendar",           icon: IconCalendar },
                { label: "My Tasks",          href: "/my-tasks",           icon: IconUser },
                { label: "Content Studio",    href: "/content-studio",     icon: IconPrompt },
                { label: "AI Jobs",           href: "/ai-jobs",            icon: IconCpu },
                { label: "Prompt Library",    href: "/prompts",            icon: IconStack2 },
                { label: "Brand Templates",   href: "/templates",          icon: IconTemplate },
                { label: "Backlink Assistant",href: "/backlink-assistant", icon: IconNetwork },
                { label: "AI SEO Report",     href: "/ai-seo-report",      icon: IconChartBar },
                { label: "Website Connect",   href: "/website-connect",    icon: IconWorld },
                { label: "AI Connect",        href: "/ai-connect",         icon: IconSettingsCode },
                { label: "Users & Roles",     href: "/users",              icon: IconUsers },
                { label: "Activity Logs",     href: "/activity-logs",      icon: IconFileSearch },
                { label: "Settings",          href: "/settings",           icon: IconSettings },
                { label: "Setup Guide",       href: "/setup",              icon: IconSettingsCode },
              ].map(({ label, href, icon: Icon }) => (
                <CommandItem key={href} className="mx-2 rounded-lg py-2.5" onSelect={() => go(href)}>
                  <IconArrowRight aria-hidden />
                  <span>
                    Go to <strong className="font-semibold">{label}</strong>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />

            {/* Help */}
            <CommandGroup heading="Help">
              <CommandItem className="mx-2 rounded-lg py-2.5" onSelect={() => onOpenChange(false)}>
                <IconMessage aria-hidden />
                Send Feedback...
              </CommandItem>
              <CommandItem className="mx-2 rounded-lg py-2.5" onSelect={() => onOpenChange(false)}>
                <IconAt aria-hidden />
                Contact Support
              </CommandItem>
              <CommandItem className="mx-2 rounded-lg py-2.5" onSelect={() => onOpenChange(false)}>
                <IconKeyboard aria-hidden />
                Keyboard Shortcuts
                <KbdGroup className="ml-auto"><Kbd>⌘</Kbd><Kbd>/</Kbd></KbdGroup>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/* Account */}
            <CommandGroup>
              <CommandItem className="mx-2 rounded-lg py-2.5" onSelect={() => { onOpenChange(false); go("/settings"); }}>
                <IconSettings aria-hidden />
                Settings
                <KbdGroup className="ml-auto"><Kbd>⌘</Kbd><Kbd>,</Kbd></KbdGroup>
              </CommandItem>
              <CommandItem
                className="mx-2 rounded-lg py-2.5 text-red-600 aria-selected:bg-red-50 aria-selected:text-red-700 [&_svg]:text-red-400"
                onSelect={() => { onOpenChange(false); signOut({ callbackUrl: "/login" }); }}
              >
                <IconLogout aria-hidden />
                Log Out
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
