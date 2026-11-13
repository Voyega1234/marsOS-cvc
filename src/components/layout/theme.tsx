"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Toaster } from "sonner";
import { THEME_EVENT, THEME_STORAGE_KEY, isAlwaysLightPath, isThemeMode, type ThemeMode } from "@/lib/theme-script";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : "light";
  } catch {
    return "light"; // localStorage ถูกปิด (โหมดส่วนตัวบางเบราว์เซอร์)
  }
}

function systemIsDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** ใส่/ถอด class "dark" บน <html> — ตรรกะเดียวกับ THEME_SCRIPT */
function applyTheme(mode: ThemeMode, pathname: string) {
  const dark = !isAlwaysLightPath(pathname) && (mode === "dark" || (mode === "system" && systemIsDark()));
  document.documentElement.classList.toggle("dark", dark);
}

export function setThemeMode(mode: ThemeMode) {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, mode); } catch { /* จำค่าไม่ได้ก็ยังสลับให้ในหน้านี้ */ }
  applyTheme(mode, window.location.pathname);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: mode }));
}

function subscribe(onChange: () => void) {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange); // เปลี่ยนจากแท็บอื่น
  media?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    media?.removeEventListener("change", onChange);
  };
}

// snapshot เป็น string เพื่อให้ useSyncExternalStore เทียบค่าได้: "<mode>:<resolved>"
function getSnapshot(): string {
  const mode = readMode();
  const dark = mode === "dark" || (mode === "system" && systemIsDark());
  return `${mode}:${dark ? "dark" : "light"}`;
}
const getServerSnapshot = () => "light:light";

export function useThemeMode(): { mode: ThemeMode; resolved: "light" | "dark"; setMode: (mode: ThemeMode) => void } {
  const [mode, resolved] = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot).split(":") as [ThemeMode, "light" | "dark"];
  return { mode, resolved, setMode: setThemeMode };
}

/** วางครั้งเดียวใน root layout: ตาม class ให้ตรงเมื่อเปลี่ยนหน้า / ระบบสลับโหมด / เปลี่ยนจากแท็บอื่น + กล่องแจ้งเตือนตามโหมด */
export function ThemeRuntime() {
  const pathname = usePathname() ?? "/";
  const { mode, resolved } = useThemeMode();
  useEffect(() => { applyTheme(mode, pathname); }, [mode, resolved, pathname]);
  const toastTheme = isAlwaysLightPath(pathname) ? "light" : resolved;
  return <Toaster position="top-right" richColors closeButton theme={toastTheme} />;
}

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "สว่าง", icon: Sun },
  { value: "dark", label: "มืด", icon: Moon },
  { value: "system", label: "ตามระบบ", icon: Monitor },
];

/** รายการเลือกโหมด ใช้ในเมนูผู้ใช้ (ทีม + ลูกค้า) */
export function ThemeModeMenu({ onPick }: { onPick?: () => void }) {
  const { mode, setMode } = useThemeMode();
  return (
    <div role="radiogroup" aria-label="โหมดแสดงผล">
      <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">โหมดแสดงผล</p>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => { setMode(value); onPick?.(); }}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${
              active ? "bg-brand-blue/10 font-semibold text-brand-blue" : "text-gray-600 hover:bg-gray-100 hover:text-brand-navy"
            }`}
          >
            <Icon size={15} className="shrink-0" />
            <span className="flex-1">{label}</span>
            {active && <Check size={14} className="shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

/** ตัวเลือกโหมดแบบแถบ (หน้า Settings) */
export function ThemeModeSegmented() {
  const { mode, setMode } = useThemeMode();
  return (
    <div className="seg" role="radiogroup" aria-label="โหมดแสดงผล">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button key={value} type="button" role="radio" aria-checked={mode === value} data-active={mode === value} onClick={() => setMode(value)} className="seg-item">
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
