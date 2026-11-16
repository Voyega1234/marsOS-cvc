"use client";

/**
 * ตัวเลือกแบบพิมพ์ค้นหาได้ — ใช้แทน <select> เมื่อรายการยาว (โปรเจกต์ / ผู้รับผิดชอบ / โปรเจกต์ Asana)
 * ค่า value เป็น string เหมือน <select>; "" = ยังไม่เลือก (แสดง emptyLabel ถ้ามี)
 * รายการเปิดใน Popover ที่ลอยนอกกล่อง จึงไม่ถูกตัดเมื่ออยู่ใน Dialog
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { selectCls } from "./shared";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** ข้อความรองบรรทัดเล็ก เช่น ชื่อลูกค้า / อีเมล (ค้นหาได้ด้วย) */
  hint?: string;
  /** คำค้นเพิ่มเติมที่ไม่แสดงบนจอ */
  keywords?: string;
}

export interface SearchSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  /** ข้อความบนปุ่มเมื่อยังไม่มีค่าและไม่มี emptyLabel */
  placeholder?: string;
  /** ป้ายของตัวเลือกค่า "" เช่น "ทุกโปรเจกต์" — ไม่ส่ง = ไม่มีตัวเลือกค่าว่าง */
  emptyLabel?: string;
  disabled?: boolean;
  /** class เพิ่มของปุ่ม (ต่อท้าย selectCls) */
  className?: string;
  ariaLabel?: string;
  loading?: boolean;
  error?: string;
  /** เรียกทุกครั้งที่เปิดรายการ (ใช้โหลดข้อมูลตอนเปิดครั้งแรก) */
  onOpen?: () => void;
}

export default function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "เลือก…",
  emptyLabel,
  disabled,
  className,
  ariaLabel,
  loading,
  error,
  onOpen,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo<SearchSelectOption[]>(
    () => (emptyLabel !== undefined ? [{ value: "", label: emptyLabel }, ...options] : options),
    [emptyLabel, options],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((o) => `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(needle));
  }, [all, query]);
  const selected = all.find((o) => o.value === value);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setActive(Math.max(0, all.findIndex((o) => o.value === value)));
      onOpen?.();
    }
  };

  const pick = (option: SearchSelectOption) => {
    onChange(option.value);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filtered[active];
      if (option) pick(option);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(selectCls, "flex items-center justify-between gap-2 text-left", className)}
        >
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      {/* รายการลอยอยู่นอก Dialog (portal) — ตัวล็อกสกอลล์ของ Dialog จะกินล้อเมาส์/การปัดที่นี่
          จึงหยุด event ไว้ก่อนถึง document ให้รายการเลื่อนด้วยล้อเมาส์และนิ้วได้ */}
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 opacity-50" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="พิมพ์เพื่อค้นหา…"
            aria-label="ค้นหา"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-60" /> : null}
        </div>
        {error ? <p className="border-b px-3 py-2 text-xs text-red-600">{error}</p> : null}
        <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {loading ? "กำลังโหลด…" : "ไม่พบรายการ"}
            </p>
          ) : (
            filtered.map((option, i) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value || "__empty"}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(option)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                    i === active && "bg-accent text-accent-foreground",
                  )}
                >
                  <Check className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="block truncate text-xs text-muted-foreground">{option.hint}</span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
