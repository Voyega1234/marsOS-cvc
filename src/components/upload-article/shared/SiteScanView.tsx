"use client";

/**
 * ส่วนแสดงผล/ปุ่มสแกนเว็บปลายทางแบบละเอียด (ไม่ผูก endpoint) — ใช้ร่วมกันระหว่าง Upload Article (SiteScanPanel)
 * และ Article Lab ของ SEO SME (sme-style/SmeStyleSettings) ผู้เรียกส่งฟังก์ชัน onRun ที่ยิง API ของตัวเอง
 */
import { useState } from "react";
import { Loader2, ScanSearch, ChevronDown, ChevronRight, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UploadComponentFinding, UploadSiteScan, UploadTheme, UploadThemeDetail } from "@/lib/upload-article/types";

export const COMPONENT_LABEL: Record<"toc" | "faq" | "cta", string> = { toc: "สารบัญ (TOC)", faq: "FAQ", cta: "CTA" };

function statusOf(f: UploadComponentFinding): { text: string; cls: string } {
  if (f.where === "auto") return { text: "ปลั๊กอิน/ธีมใส่ให้ทุกบทความเอง — ไม่ใส่ของเราซ้ำ", cls: "bg-rose-50 text-rose-700 border-rose-200" };
  if (f.where === "some-posts") return { text: "ผู้เขียนเขียนเองในเนื้อหา (ไม่ใช่ปลั๊กอิน) — ใส่ของเราตามปกติ", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  if (f.where === "site") return { text: "เจอนอกบทความ (เช่น หน้าแรก/เมนู) — ใส่ของเราตามปกติ", cls: "bg-gray-50 text-gray-600 border-gray-200" };
  return { text: "ไม่พบ — ใส่ของเราตามปกติ", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
}

export default function SiteScanView({
  initialUrl, initialSampleUrl = "", scan, onRun, onApplyTheme, title = "สแกนเว็บปลายทาง (ละเอียด)",
}: {
  initialUrl: string;
  initialSampleUrl?: string;
  scan?: UploadSiteScan;
  /** คืน true เมื่อสแกนสำเร็จ */
  onRun: (url: string, sampleUrl: string) => Promise<boolean>;
  onApplyTheme?: (theme: Partial<UploadTheme>, detail: UploadThemeDetail | null) => void;
  title?: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [sampleUrl, setSampleUrl] = useState(initialSampleUrl);
  const [busy, setBusy] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  async function run() {
    setBusy(true);
    try { await onRun(url.trim(), sampleUrl.trim()); } finally { setBusy(false); }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-brand-navy flex items-center gap-1.5"><ScanSearch size={14} /> {title}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          ดูว่าเว็บใช้ธีม/ปลั๊กอินอะไร มีปลั๊กอิน/ธีมใส่สารบัญ FAQ CTA ให้ทุกบทความเองไหม (ถ้ามี ระบบไม่ใส่ของเราซ้ำ — ที่ผู้เขียนเขียนเองยังใส่ตามปกติ) และสี/หน้าตาบทความของเว็บ
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
        <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://เว็บปลายทาง.com" className="text-xs" />
        <Input value={sampleUrl} onChange={e => setSampleUrl(e.target.value)} placeholder="ลิงก์บทความตัวอย่างบนเว็บ (ไม่บังคับ — แม่นขึ้น)" className="text-xs" />
        <Button variant="outline" size="sm" disabled={busy} onClick={run} className="h-9">
          {busy ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <ScanSearch size={13} className="mr-1.5" />}
          {busy ? "กำลังสแกน... (~1 นาที)" : scan ? "สแกนใหม่" : "สแกนเว็บ"}
        </Button>
      </div>

      {scan && (
        <div className="space-y-3 text-xs">
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-1.5">
            <p className="text-[11px] text-gray-400">
              ผลสแกน {scan.target} · {new Date(scan.scannedAt).toLocaleString("th-TH")} · ดู {scan.checked.join(", ")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div><span className="text-gray-500">ระบบเว็บ:</span> <b>{scan.platform.cms}</b></div>
              <div>
                <span className="text-gray-500">ธีม:</span> <b>{scan.platform.theme || "ไม่ทราบ"}</b>
                {scan.platform.childTheme && <span className="text-gray-500"> (child: {scan.platform.childTheme})</span>}
              </div>
              <div><span className="text-gray-500">ตัวสร้างหน้า:</span> <b>{scan.platform.builders.join(", ") || "—"}</b></div>
            </div>
            {scan.platform.plugins.length > 0 && (
              <div>
                <button onClick={() => setShowPlugins(v => !v)} className="text-gray-500 hover:text-brand-navy flex items-center gap-1">
                  {showPlugins ? <ChevronDown size={11} /> : <ChevronRight size={11} />} ปลั๊กอินที่เห็นจากหน้าเว็บ ({scan.platform.plugins.length})
                </button>
                {showPlugins && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {scan.platform.plugins.map(p => (
                      <span key={p} className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] text-gray-600">{p}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            {(["toc", "faq", "cta"] as const).map(k => {
              const f = scan.components[k];
              const st = statusOf(f);
              return (
                <div key={k} className="border border-gray-100 rounded-lg">
                  <button onClick={() => setOpen(o => ({ ...o, [k]: !o[k] }))} className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
                    {open[k] ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
                    <span className="font-semibold text-brand-navy w-24 shrink-0">{COMPONENT_LABEL[k]}</span>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${st.cls}`}>{st.text}</span>
                    {f.source && <span className="text-gray-500 truncate">· {f.source}</span>}
                  </button>
                  {open[k] && f.evidence.length > 0 && (
                    <ul className="px-8 pb-2 list-disc text-[11px] text-gray-500 space-y-0.5">
                      {f.evidence.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {scan.faqSummary && (
            <div className="rounded-lg border border-brand-blue/20 bg-brand-mist/30 p-3">
              <p className="font-semibold text-brand-navy mb-1">หน้าตา FAQ / บทความบนเว็บนี้</p>
              <p className="text-gray-600 leading-relaxed">{scan.faqSummary}</p>
              {scan.detail?.source && <p className="text-[10px] text-gray-400 mt-1">อ้างอิง: {scan.detail.source}</p>}
            </div>
          )}

          {scan.warnings.length > 0 && (
            <ul className="text-[11px] text-amber-700 list-disc pl-4 space-y-0.5">
              {scan.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          {onApplyTheme && (scan.suggestedTheme || scan.detail) && (
            <Button size="sm" variant="outline" onClick={() => onApplyTheme(scan.suggestedTheme || {}, scan.detail || null)}>
              <Palette size={12} className="mr-1.5" /> ใช้ธีม + หน้าตา FAQ จากเว็บนี้
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
