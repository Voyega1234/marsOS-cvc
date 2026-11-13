"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeModeMenu } from "@/components/layout/theme";

/**
 * เมนูผู้ใช้: เลือกโหมดแสดงผล (สว่าง / มืด / ตามระบบ) + ออกจากระบบ
 * ใช้ทั้งฝั่งทีม (ท้าย sidebar) และฝั่งลูกค้า (แถบบน) — ไม่เรียก API ใด ๆ เอง
 * children = ปุ่มที่กดเปิดเมนู (ต้องเป็น element เดียวที่รับ ref ได้ เช่น <button>)
 */
export function UserMenu({
  children, name, detail, onLogout, side = "top", align = "start",
}: {
  children: React.ReactNode;
  name: string;
  detail?: string;
  onLogout: () => void | Promise<void>;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={side} align={align} sideOffset={10} className="w-60 rounded-2xl p-2 shadow-xl">
        <div className="px-3 pb-2 pt-1.5">
          <p className="truncate text-[13px] font-semibold text-brand-navy">{name}</p>
          {detail && <p className="truncate text-[11px] text-gray-500">{detail}</p>}
        </div>
        <div className="my-1 h-px bg-gray-200/80" />
        <ThemeModeMenu />
        <div className="my-1 h-px bg-gray-200/80" />
        <button
          type="button"
          onClick={() => { setOpen(false); void onLogout(); }}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <LogOut size={15} className="shrink-0" />
          ออกจากระบบ
        </button>
      </PopoverContent>
    </Popover>
  );
}
