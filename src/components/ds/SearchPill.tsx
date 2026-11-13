"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** ช่องค้นหาทรงเม็ดยา มีปุ่มล้างเมื่อมีข้อความ */
export function SearchPill({ value, onChange, placeholder, className, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className={cn("search-pill", className)}>
      <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange("")}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-brand-navy"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </label>
  );
}
