"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SubRoute {
  title: string;
  link: string;
  icon?: React.ReactNode;
}

export interface Route {
  id: string;
  title: string;
  icon: React.ReactNode;
  link: string;
  subs?: SubRoute[];
  badge?: number;
  badgeVariant?: "red" | "black";
}

interface Props {
  routes: Route[];
}

function NavItem({ route }: { route: Route }) {
  const pathname = usePathname();
  const hasSubs = !!route.subs?.length;

  const isActive =
    route.link !== "#" &&
    (pathname === route.link || pathname.startsWith(route.link + "/"));

  const anySubActive = route.subs?.some(
    (s) => s.link !== "#" && (pathname === s.link || pathname.startsWith(s.link + "/"))
  );

  const [open, setOpen] = useState(isActive || !!anySubActive);

  if (hasSubs) {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13.5px] transition-colors",
            anySubActive
              ? "text-gray-900 font-medium"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/60 font-normal"
          )}
        >
          <span className="shrink-0 text-gray-500">{route.icon}</span>
          <span className="flex-1 text-left">{route.title}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-gray-400 transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-gray-100 pl-3 pb-1">
                {route.subs!.map((sub) => {
                  const subActive =
                    sub.link !== "#" &&
                    (pathname === sub.link || pathname.startsWith(sub.link + "/"));
                  return (
                    <Link
                      key={sub.title}
                      href={sub.link}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                        subActive
                          ? "text-gray-900 font-medium bg-gray-100"
                          : "text-gray-500 hover:text-gray-800 hover:bg-gray-100/60"
                      )}
                    >
                      {sub.icon && <span className="shrink-0">{sub.icon}</span>}
                      {sub.title}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <Link
      href={route.link}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] transition-colors",
        isActive
          ? "text-gray-900 font-medium"
          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/60 font-normal"
      )}
    >
      <span className="shrink-0 text-gray-500">{route.icon}</span>
      <span className="flex-1">{route.title}</span>
      {route.badge !== undefined && route.badge > 0 && (
        <span className={cn(
          "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center tabular-nums",
          route.badgeVariant === "red"
            ? "bg-red-500 text-white"
            : "bg-gray-900 text-white"
        )}>
          {route.badge}
        </span>
      )}
    </Link>
  );
}

export default function DashboardNavigation({ routes }: Props) {
  return (
    <nav className="space-y-0.5">
      {routes.map((route) => (
        <NavItem key={route.id} route={route} />
      ))}
    </nav>
  );
}
