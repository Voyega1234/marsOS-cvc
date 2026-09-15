"use client";

import { useState } from "react";
import { Check, Globe, Loader2, ScanSearch } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CELayerScanType, LayerScanResult } from "@/lib/ce-layer-scan";

interface Props {
  layer: CELayerScanType;
  /** null = ขอบเขต Studio (ต้องวางลิงก์เอง) */
  projectId: string | null;
  onApply: (fields: Record<string, string>) => void;
  disabled?: boolean;
  /** หัวข้อการ์ด — ปรับได้ต่อ layer เช่น Master Prompt ใช้ "สร้าง Master Prompt จากบทความตัวอย่าง" */
  title?: string;
  description?: string;
  urlPlaceholder?: string;
  textPlaceholder?: string;
}

/**
 * วางลิงก์หรือวางข้อความ → ระบบอ่านแล้วร่างฟอร์มของ layer นี้ให้
 * ผลเป็นร่าง ทีมกดรับแล้วแก้ต่อได้ทุกช่องก่อนกดบันทึก
 */
export function LayerScanCard({
  layer,
  projectId,
  onApply,
  disabled,
  title = "กรอกอัตโนมัติจากเว็บไซต์/ข้อความ",
  description = "วางลิงก์หรือวางข้อความ ระบบจะอ่านแล้วร่างฟอร์มด้านล่างให้ แก้ต่อได้ทุกช่อง",
  urlPlaceholder = "https://example.com",
  textPlaceholder = "หรือวางข้อความ/บทความตรงนี้แทน",
}: Props) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LayerScanResult | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  async function scan() {
    if (!url.trim() && !text.trim() && !projectId) {
      toast.error("วางลิงก์หรือวางข้อความก่อนสแกน");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/prompts/layer-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layer,
          url: url.trim() || undefined,
          text: text.trim() || undefined,
          projectId: projectId ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setResult(body as LayerScanResult);
      toast.success("สแกนเสร็จแล้ว — ตรวจแล้วกดนำไปใส่ในฟอร์ม");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    onApply(result.fields);
    toast.success("ใส่ข้อมูลลงฟอร์มแล้ว — ตรวจ แก้ได้ทุกช่อง แล้วกดบันทึก");
  }

  const filledCount = result ? Object.keys(result.fields).length : 0;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex items-center gap-2">
        <ScanSearch className="size-3.5 text-indigo-500" />
        <span className="text-sm font-semibold text-brand-navy">{title}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        {description}
        {projectId && " — เว้นว่างไว้ = ใช้เว็บที่ตั้งไว้ในโปรเจกต์"}
      </p>

      <div className="mt-2 flex gap-2">
        <div className="relative flex-1">
          <Globe className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={url}
            disabled={disabled}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && scan()}
            placeholder={urlPlaceholder}
            className="h-9 w-full rounded-md border border-gray-200 bg-white pl-8 pr-2 text-sm focus:border-indigo-300 focus:outline-none disabled:opacity-60"
          />
        </div>
        <Button size="sm" className="h-9 gap-1.5" disabled={busy || disabled} onClick={scan}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
          {busy ? "กำลังสแกน" : "สแกน"}
        </Button>
      </div>

      <Textarea
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        placeholder={textPlaceholder}
        className="mt-2 min-h-[80px] text-xs"
      />
      {busy && <p className="mt-2 text-xs text-gray-400">กำลังอ่านและร่างข้อมูล ใช้เวลาประมาณ 1-3 นาที</p>}

      {result && (
        <div className="mt-3 space-y-2 border-t border-indigo-100 pt-3">
          <p className="text-xs text-gray-500">
            ร่างได้ {filledCount} ช่อง · หลักฐานจาก{" "}
            {result.evidence.source === "text" ? "ข้อความที่วางมา" : result.evidence.source === "web_search" ? "ผลค้นหาเว็บ" : "เว็บไซต์"}
          </p>

          {result.warnings.length > 0 && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700">ข้อควรทราบ: {result.warnings.join(" · ")}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={apply}>
              <Check className="size-3.5" /> นำไปใส่ในฟอร์ม
            </Button>
            {result.evidence.pages.length > 0 && (
              <button type="button" onClick={() => setShowDetail((v) => !v)} className="text-xs text-gray-400 hover:text-gray-600">
                {showDetail ? "ซ่อนหน้าที่อ่าน" : "ดูหน้าที่อ่าน"}
              </button>
            )}
          </div>

          {showDetail && (
            <div className="space-y-1 rounded-md bg-white p-2 text-xs text-gray-600">
              <ul className="space-y-0.5">
                {result.evidence.pages.map((p) => (
                  <li key={p.url} className="truncate">
                    · {p.title || p.url}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
