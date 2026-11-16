"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SheetSourcesView } from "@/lib/backlink-management/quota-types";
import { api, fmtDateTime } from "./shared";

const BASE = "/api/backlink-management/sheet/sources";

/** ส่วน "ชีทโควต้า" ใน SheetDialog — เพิ่ม/ลบ/ดึงข้อมูลหลายลิงก์ */
export default function QuotaSources({ open, onSourcesChanged }: { open: boolean; onSourcesChanged?: () => void }) {
  const [view, setView] = useState<SheetSourcesView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setView(await api<SheetSourcesView>(BASE));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "โหลดลิงก์ชีทโควต้าไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    if (open) { setUrl(""); setLabel(""); void load(); }
  }, [open, load]);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(view?.serviceEmail ?? "");
      toast.success("คัดลอกอีเมลแล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  async function add() {
    setAdding(true);
    try {
      setView(await api<SheetSourcesView>(BASE, { method: "POST", json: { url: url.trim(), ...(label.trim() ? { label: label.trim() } : {}) } }));
      setUrl(""); setLabel("");
      toast.success("เพิ่มลิงก์ชีทโควต้าแล้ว");
      onSourcesChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "เพิ่มลิงก์ไม่สำเร็จ");
    } finally {
      setAdding(false);
    }
  }

  async function pull(id: string) {
    setRowBusy(id);
    try {
      setView(await api<SheetSourcesView>(`${BASE}/${id}/pull`, { method: "POST" }));
      toast.success("ดึงข้อมูลแล้ว");
      onSourcesChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ดึงข้อมูลไม่สำเร็จ");
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("ลบลิงก์นี้ออกจากระบบ? ข้อมูลในชีทไม่ถูกลบ แต่รายการจองในระบบของชีทนี้จะหายไป")) return;
    setRowBusy(id);
    try {
      setView(await api<SheetSourcesView>(`${BASE}/${id}`, { method: "DELETE" }));
      toast.success("ลบลิงก์แล้ว");
      onSourcesChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setRowBusy(null);
    }
  }

  const email = view?.serviceEmail ?? "";

  return (
    <section className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold text-brand-navy">ชีทโควต้า (ดึงข้อมูล + เขียนกลับ)</h3>
      {!view && !loadError ? <div className="flex justify-center py-3 text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /></div> : null}
      {loadError ? <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{loadError}</div> : null}
      {view?.tableMissing ? (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ยังไม่ได้สร้างตารางโควต้า — ให้ผู้ดูแลรัน scripts/sql/add-blm-quota-asana-tables.sql ใน Supabase
        </div>
      ) : view ? (
        <>
          {email ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span>แชร์ชีทให้</span>
              <code className="break-all rounded-lg bg-gray-100 px-2 py-1">{email}</code>
              <Button type="button" variant="outline" size="sm" onClick={copyEmail} aria-label="คัดลอกอีเมล"><Copy className="h-3.5 w-3.5" /></Button>
              <span>เป็น Editor ก่อน — ระบบจะอ่านและเขียนกลับทุกการแก้ไข</span>
            </div>
          ) : (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">ระบบยังไม่มี service account สำหรับ Google</p>
          )}

          {view.canEdit ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." aria-label="ลิงก์ Google Sheet" />
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ชื่อเรียก (ไม่บังคับ)" aria-label="ชื่อเรียก" />
              <Button onClick={add} disabled={adding || !url.trim()}>
                {adding ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}เพิ่มลิงก์
              </Button>
            </div>
          ) : (
            <p className="text-xs text-gray-500">เฉพาะ ADMIN / SEO Manager เท่านั้นที่เพิ่มหรือลบลิงก์ได้</p>
          )}

          {view.sources.length === 0 ? (
            <p className="text-xs text-gray-500">ยังไม่ได้เพิ่มลิงก์ชีทโควต้า</p>
          ) : (
            <ul className="space-y-2">
              {view.sources.map((s) => (
                <li key={s.id} className="rounded-xl border border-gray-200 bg-white/60 p-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <a href={s.spreadsheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-medium text-brand-navy underline">
                        {s.title || "เปิดชีท"} <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      {s.label ? <span className="ml-2 text-gray-500">({s.label})</span> : null}
                      <div className="mt-1 text-gray-500">
                        {s.tabs.length} แท็บ · {s.packageCount} แพ็กเกจ · ดึงล่าสุด {s.lastPulledAt ? fmtDateTime(s.lastPulledAt) : "ยังไม่เคยดึง"}
                      </div>
                      {s.lastError ? <div className="mt-1 text-red-600">{s.lastError}</div> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => pull(s.id)} disabled={rowBusy === s.id}>
                        {rowBusy === s.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}ดึงข้อมูล
                      </Button>
                      {view.canEdit ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => remove(s.id)} disabled={rowBusy === s.id} aria-label="ลบลิงก์">
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
