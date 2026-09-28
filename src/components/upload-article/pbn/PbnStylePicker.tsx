"use client";

/**
 * PBN Backlinks > Project Setting > สแกนเว็บปลายทาง / สไตล์บทความ — เลือกว่ากำลังแก้สไตล์ไหน
 * สไตล์หลัก = ใช้กับเว็บที่ยังไม่มีสไตล์ของตัวเอง, เลือกเว็บ = สไตล์ที่ตั้งชื่อตามเว็บนั้น (ใช้ตอนเขียนบทความที่จะ push ไปเว็บนั้น)
 */
import { useState } from "react";
import { toast } from "sonner";
import { Palette, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PbnSiteDTO } from "@/lib/upload-article/pbn";
import type { PbnStyle } from "@/lib/upload-article/pbn-sets";

export default function PbnStylePicker({
  sites, styles, siteId, onSelect, onStyleChange, onStyleDeleted,
}: {
  sites: PbnSiteDTO[];
  styles: Record<string, PbnStyle>;
  siteId: string | null;
  onSelect: (siteId: string | null) => void;
  onStyleChange: (s: PbnStyle) => void;
  onStyleDeleted: (siteId: string) => void;
}) {
  const style = siteId ? styles[siteId] : undefined;
  const site = siteId ? sites.find(s => s.id === siteId) : undefined;
  const [name, setName] = useState(style?.name || "");
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState(`${siteId}|${style?.name}`);
  if (lastKey !== `${siteId}|${style?.name}`) {
    setLastKey(`${siteId}|${style?.name}`);
    setName(style?.name || "");
  }

  async function rename() {
    if (!siteId || !name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/pbn-backlinks/styles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, name: name.trim(), theme: {} }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || "เปลี่ยนชื่อไม่สำเร็จ"); return; }
      onStyleChange(d.style);
      toast.success("เปลี่ยนชื่อสไตล์แล้ว");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!siteId || !style) return;
    if (!confirm(`ลบสไตล์ "${style.name}"? บทความที่จะ push ไปเว็บนี้จะกลับไปใช้สไตล์หลัก`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/pbn-backlinks/styles?siteId=${encodeURIComponent(siteId)}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || "ลบไม่สำเร็จ"); return; }
      onStyleDeleted(siteId);
      toast.success("ลบสไตล์แล้ว");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-violet-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Palette size={14} className="text-violet-600" />
        <p className="text-sm font-semibold text-brand-navy">กำลังแก้สไตล์บทความของ</p>
      </div>
      <select value={siteId ?? ""} onChange={e => onSelect(e.target.value || null)}
        className="w-full h-10 rounded-md border border-gray-200 px-3 text-sm bg-white">
        <option value="">สไตล์หลัก (ใช้กับเว็บที่ยังไม่มีสไตล์ของตัวเอง)</option>
        {sites.map(s => (
          <option key={s.id} value={s.id}>
            {styles[s.id] ? `${styles[s.id].name} — เว็บ ${s.name}` : `${s.name} — ยังไม่มีสไตล์ (ใช้สไตล์หลัก)`}
          </option>
        ))}
      </select>
      {sites.length === 0 && (
        <p className="text-[11px] text-gray-400">ยังไม่มีเว็บ PBN — เพิ่มเว็บที่เมนู “เว็บ PBN &amp; Connect” ก่อน แล้วสร้างสไตล์ตามเว็บได้</p>
      )}
      {siteId && !style && (
        <p className="text-[11px] text-gray-500">
          ยังไม่มีสไตล์ของเว็บ {site?.name} — สแกนเว็บ/แก้สีแล้วกดบันทึกที่แท็บ “สไตล์บทความ” = สร้างสไตล์ชื่อ “{site?.name}”
        </p>
      )}
      {siteId && style && (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} className="flex-1 min-w-[180px]" placeholder="ชื่อสไตล์" />
          <Button size="sm" variant="outline" disabled={busy || !name.trim() || name.trim() === style.name} onClick={rename}>เปลี่ยนชื่อ</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={remove}><Trash2 size={12} className="text-red-500 mr-1" /> ลบสไตล์</Button>
        </div>
      )}
      <p className="text-[11px] text-gray-400">ตอนเขียนบทความเลือกเว็บที่จะ push — บทความจะใช้สไตล์ของเว็บนั้นอัตโนมัติ</p>
    </div>
  );
}
