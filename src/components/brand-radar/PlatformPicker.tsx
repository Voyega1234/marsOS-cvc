"use client";

import { useEffect, useId, useState } from "react";
import { Check } from "lucide-react";
import { Chip } from "@/components/ds";
import { PROVIDERS, PROVIDER_KEYS, type CollectionMethod, type ProviderKey } from "@/lib/brand-radar/types";
import { ProviderLogo } from "./ProviderLogo";
import { providerShort } from "./shared";

type PlatformMode = "all" | "custom";

// Grouped by how the answer is collected, so the team sees which platforms return the real product's answer
const GROUPS: Array<{ method: CollectionMethod; title: string }> = [
  { method: "observed_chat", title: "AI chat (คำตอบจริงจากแอป)" },
  { method: "api_simulated", title: "AI chat (ผ่าน API + ค้นเว็บ)" },
  { method: "observed_serp", title: "Google Search (อ่านจากหน้าผลค้นหาจริง)" },
];

function holdsAll(v: ProviderKey[]): boolean {
  return PROVIDER_KEYS.every((k) => v.includes(k));
}

/** Two cards: every platform, or a hand-picked list. Selection is always an array of provider keys. */
export function PlatformChooser({ value, onChange, disabled, connected }: {
  value: ProviderKey[];
  onChange: (next: ProviderKey[]) => void;
  disabled?: boolean;
  connected?: Partial<Record<ProviderKey, boolean>>;
}) {
  const uid = useId();
  const [mode, setMode] = useState<PlatformMode>(holdsAll(value) ? "all" : "custom");

  // Sync from outside only when the value no longer fits the mode. Custom stays custom even when every box is ticked.
  useEffect(() => {
    if (mode === "all" && !holdsAll(value)) setMode("custom");
  }, [value, mode]);

  const total = PROVIDER_KEYS.length;
  const count = PROVIDER_KEYS.filter((k) => value.includes(k)).length;
  const isAll = mode === "all";
  // A chosen platform whose key is missing on the server is skipped by the scan (runner filters on credentials).
  const skipped = connected ? PROVIDER_KEYS.filter((k) => value.includes(k) && connected[k] === false) : [];

  function pickAll() {
    if (disabled) return;
    setMode("all");
    onChange([...PROVIDER_KEYS]);
  }
  function pickCustom() {
    if (disabled) return;
    setMode("custom");
  }
  function toggle(key: ProviderKey, on: boolean) {
    const set = new Set(value);
    if (on) set.add(key); else set.delete(key);
    onChange(PROVIDER_KEYS.filter((k) => set.has(k)));
  }

  const cardBase =
    "relative flex min-w-0 flex-col gap-3 rounded-2xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2";
  const cardOn = "border-brand-navy bg-brand-mist/40 ring-1 ring-brand-navy";
  const cardOff = "border-gray-200 bg-white/70 hover:border-gray-300";
  const check = (
    <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-navy text-white" aria-hidden="true">
      <Check className="h-3 w-3" />
    </span>
  );

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="AI platform ที่จะติดตาม" className="grid gap-3 md:grid-cols-2">
        <div
          role="radio"
          aria-checked={isAll}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          onClick={pickAll}
          onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); pickAll(); } }}
          className={`${cardBase} cursor-pointer ${isAll ? cardOn : cardOff} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          {isAll && check}
          <div className="pr-7">
            <div className="text-sm font-semibold text-brand-navy">ทุก platform</div>
            <p className="mt-0.5 text-xs text-gray-500">ติดตามทุก AI ที่ระบบรองรับ ({total} platform)</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PROVIDER_KEYS.map((k) => (
              <span key={k} className="rounded-full bg-brand-mist px-2.5 py-1 text-xs text-brand-navy"><ProviderLogo provider={k} size={14} withName /></span>
            ))}
          </div>
        </div>

        <div
          role="radio"
          aria-checked={!isAll}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          onClick={(e) => {
            // clicks on the checkbox list must not re-trigger the card
            if ((e.target as HTMLElement).closest("[data-platform-list]")) return;
            pickCustom();
          }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === " " || e.key === "Enter") { e.preventDefault(); pickCustom(); }
          }}
          className={`${cardBase} ${isAll ? cardOff : cardOn} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        >
          {!isAll && check}
          <div className="pr-7">
            <div className="text-sm font-semibold text-brand-navy">เลือกเอง</div>
            <p className="mt-0.5 text-xs text-gray-500">เลือกเฉพาะ AI ที่อยากให้คนเจอแบรนด์</p>
          </div>
          <div data-platform-list className={`space-y-3 ${isAll ? "opacity-50" : ""}`} onClick={() => { if (isAll) pickCustom(); }}>
            {GROUPS.map((g) => (
              <fieldset key={g.method} className="min-w-0" disabled={disabled || isAll}>
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.title}</legend>
                <ul className="space-y-0.5">
                  {PROVIDER_KEYS.filter((k) => PROVIDERS[k].method === g.method).map((k) => {
                    const id = `${uid}-${k}`;
                    const conn = connected?.[k];
                    return (
                      <li key={k}>
                        <label htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl px-1.5 py-1 hover:bg-gray-50">
                          <input
                            id={id}
                            type="checkbox"
                            className="h-4 w-4 shrink-0"
                            checked={value.includes(k)}
                            disabled={disabled || isAll}
                            onChange={(e) => toggle(k, e.target.checked)}
                          />
                          <ProviderLogo provider={k} size={20} title={providerShort(k)} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-gray-800">{providerShort(k)}</span>
                            <span className="block truncate text-xs text-gray-500">{PROVIDERS[k].vendor} · {PROVIDERS[k].label}</span>
                          </span>
                          {connected && (
                            <Chip tone={conn ? "ok" : "muted"} dot>{conn ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ"}</Chip>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
            {!isAll && count === 0 && <p role="alert" className="text-xs text-red-600">เลือกอย่างน้อย 1 platform</p>}
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-500">เลือกแล้ว {count} จาก {total} platform · ยิ่งเลือกมาก ค่าใช้จ่ายต่อรอบสแกนยิ่งสูง</p>
      {skipped.length > 0 && (
        <p className="text-xs text-amber-700">
          ยังไม่เชื่อมต่อ {skipped.length} platform ({skipped.map((k) => providerShort(k)).join(", ")}) — รอบสแกนจะข้ามไปก่อนจนกว่าจะเชื่อมต่อ
        </p>
      )}
    </div>
  );
}
