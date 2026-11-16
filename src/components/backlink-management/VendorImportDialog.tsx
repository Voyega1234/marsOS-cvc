"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Chip } from "@/components/ds";
import type { ImportParseResult } from "@/lib/backlink-management/vendor-import";
import { api, money } from "./shared";

type ParseResponse = ImportParseResult & { existing: string[]; detailsAvailable: boolean };
type ImportResult = { created: number; updated: number; skipped: number; detailsMissing: boolean };

const BATCH_SIZE = 250;
const MAX_BYTES =4 * 1024 * 1024;
const NOTICE = "ข้อมูลเสริม (ราคาแยกประเภท, Rate Card, อายุลิงก์ ฯลฯ) ยังใช้ไม่ได้ — ต้องรันไฟล์ scripts/sql/add-blm-vendor-detail-table.sql ใน Supabase โปรเจกต์ \"SEO PROJECT\" ก่อน ข้อมูลหลักของคลังเว็บใช้งานได้ตามปกติ";
const noticeCls = "rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800";

export default function VendorImportDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [onExisting, setOnExisting] = useState<"skip" | "update">("skip");
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null); setBusy(false); setParsed(null); setOnExisting("skip"); setResult(null);
  }, [open]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of parsed?.rows ?? []) m.set(r.category || "ไม่ระบุหมวด", (m.get(r.category || "ไม่ระบุหมวด") ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [parsed]);

  async function parse() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const d = await api<ParseResponse>("/api/backlink-management/vendors/import/parse", { method: "POST", body: fd });
      setParsed(d);
      setOnExisting("skip");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อ่านไฟล์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!parsed) return;
    setBusy(true);
    const total = { created: 0, updated: 0, skipped: 0, detailsMissing: false };
    const rows = parsed.rows.map((r) => {
      const { sheet: _sheet, ...rest } = r as typeof r & { sheet?: unknown };
      void _sheet;
      return rest;
    });
    let started = false;
    try {
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        setProgress(`${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
        const d = await api<ImportResult>("/api/backlink-management/vendors/import", { method: "POST", json: { rows: rows.slice(i, i + BATCH_SIZE), onExisting } });
        started = true;
        total.created += d.created;
        total.updated += d.updated;
        total.skipped += d.skipped;
        total.detailsMissing = total.detailsMissing || !!d.detailsMissing;
      }
      setResult(total);
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ";
      if (started) {
        toast.error(`นำเข้าไม่ครบ — บันทึกไปแล้ว ${total.created + total.updated} เว็บ: ${msg} (กดนำเข้าอีกครั้งได้ เว็บที่มีแล้วจะถูกข้าม)`);
        onSaved();
      } else {
        toast.error(msg);
      }
    } finally {
      setProgress("");
      setBusy(false);
    }
  }

  const fresh = parsed ? parsed.rows.length - parsed.existing.length : 0;
  const count = parsed ? (onExisting === "update" ? parsed.rows.length : fresh) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>นำเข้าคลังเว็บจากไฟล์</DialogTitle>
          <DialogDescription>รองรับ .xlsx และ .csv — อ่านทุกชีตที่มองเห็นและมีคอลัมน์ Domain โดยใช้ชีตย่อยรายหมวดเป็นหลัก ชีตรวมใช้เติมส่วนที่ขาด เว็บซ้ำระหว่างชีตถูกรวมเป็นแถวเดียว</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-brand-mist/50 p-3 text-sm">เพิ่มใหม่ {result.created} · อัปเดต {result.updated} · ข้าม {result.skipped}</div>
            {result.detailsMissing ? <div className={noticeCls}>{NOTICE}</div> : null}
          </div>
        ) : !parsed ? (
          <div className="space-y-3">
            <input
              type="file"
              id="blm-import-file"
              accept=".xlsx,.csv"
              aria-label="เลือกไฟล์ .xlsx หรือ .csv"
              className="block w-full rounded-xl border border-input bg-white/90 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-mist file:px-3 file:py-1 file:text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > MAX_BYTES) {
                  toast.error("ไฟล์ใหญ่เกิน 4 MB");
                  e.target.value = "";
                  setFile(null);
                  return;
                }
                setFile(f);
              }}
            />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div>พบ {parsed.rows.length} เว็บ จาก {parsed.sheets.length} ชีต · ใหม่ {fresh} · มีอยู่แล้ว {parsed.existing.length}</div>
            <div className="flex flex-wrap gap-1.5">
              {catCounts.map(([name, n]) => <Chip key={name} tone="muted">{name} ({n})</Chip>)}
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">ชีตที่อ่าน ({parsed.sheets.length})</summary>
              <ul className="mt-1 space-y-0.5 text-gray-600">
                {parsed.sheets.map((s) => (
                  <li key={s.name || "csv"}>{s.name || "ไฟล์ CSV"} · {s.count} เว็บ{s.rollup ? ` (ชีตรวม — เพิ่มเว็บที่ชีตย่อยไม่มี ${s.added} เว็บ)` : ""}</li>
                ))}
              </ul>
            </details>
            {parsed.truncated ? <div className={noticeCls}>ไฟล์มีเว็บเกิน 2,000 รายการ นำเข้าเฉพาะ 2,000 รายการแรก</div> : null}
            {!parsed.detailsAvailable ? (
              <div className={noticeCls}>
                <div>{NOTICE}</div>
                <div className="mt-1">จะนำเข้าเฉพาะข้อมูลหลัก (โดเมน, หมวด, ราคาเริ่มต้น, DR, Traffic, ติดต่อ, รายละเอียด)</div>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
              <table className="tbl w-full text-xs">
                <thead>
                  <tr><th className="text-left">โดเมน</th><th className="text-left">หมวด</th><th className="num">ราคาเริ่มต้น</th><th className="num">DR</th><th className="text-left">ติดต่อ</th></tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 8).map((r) => (
                    <tr key={r.domain}>
                      <td className="whitespace-nowrap font-medium">{r.domain}</td>
                      <td>{r.category || "—"}</td>
                      <td className="num whitespace-nowrap">{money(r.price)}</td>
                      <td className="num">{r.domainRating ?? "—"}</td>
                      <td className="max-w-[180px] truncate">{r.contactChannel.split("\n")[0] || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.skipped.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer font-medium">แถวที่ข้าม ({parsed.skipped.length})</summary>
                <ul className="mt-1 space-y-0.5 text-gray-600">
                  {parsed.skipped.map((s, i) => <li key={i}>{s.sheet} · แถว {s.row} · {s.text} — {s.reason}</li>)}
                </ul>
              </details>
            ) : null}
            {parsed.conflicts.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer font-medium">ข้อมูลไม่ตรงกันระหว่างชีต ({parsed.conflicts.length}) — ใช้ค่าจากชีตย่อย</summary>
                <ul className="mt-1 space-y-0.5 text-gray-600">
                  {parsed.conflicts.map((c, i) => <li key={i}>{c.domain} · {c.field}: {c.kept} ≠ {c.other} ({c.sheet})</li>)}
                </ul>
              </details>
            ) : null}
            {parsed.ignoredSheets.length > 0 ? (
              <details className="text-xs">
                <summary className="cursor-pointer font-medium">ชีตที่ไม่ได้อ่าน ({parsed.ignoredSheets.length})</summary>
                <ul className="mt-1 space-y-0.5 text-gray-600">
                  {parsed.ignoredSheets.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </details>
            ) : null}
            {parsed.existing.length > 0 ? (
              <fieldset className="space-y-1.5 rounded-xl border border-gray-200 p-3">
                <legend className="px-1 text-xs font-semibold text-gray-600">เว็บที่มีอยู่แล้ว {parsed.existing.length} เว็บ</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="blm-import-existing" value="skip" checked={onExisting === "skip"} onChange={() => setOnExisting("skip")} />
                  ข้าม ไม่แก้ข้อมูลเดิม
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="blm-import-existing" value="update" checked={onExisting === "update"} onChange={() => setOnExisting("update")} />
                  อัปเดตตามไฟล์ (ช่องที่ไฟล์ว่างจะคงค่าเดิม)
                </label>
              </fieldset>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2">
          {result ? (
            <Button onClick={() => onOpenChange(false)}>ปิด</Button>
          ) : !parsed ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
              <Button onClick={parse} disabled={!file || busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1 h-4 w-4" />}อ่านไฟล์
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => { setParsed(null); setFile(null); }} disabled={busy}>เลือกไฟล์ใหม่</Button>
              <Button onClick={run} disabled={count === 0 || busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{busy && progress ? `กำลังนำเข้า ${progress}` : `นำเข้า ${count} เว็บ`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
