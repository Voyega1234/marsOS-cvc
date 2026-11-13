"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Chip, EmptyState, Panel, SearchPill } from "@/components/ds";
import { LINK_TYPES } from "@/lib/backlink-management/types";
import { api, money, selectCls, type Vendor } from "./shared";

const EMPTY = { domain: "", siteUrl: "", category: "", price: "", domainRating: "", traffic: "", linkType: "dofollow", contactName: "", contactChannel: "", notes: "", status: "ACTIVE" };

function VendorDialog({ open, onOpenChange, edit, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; edit: Vendor | null; onSaved: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    if (!open) return;
    setF(edit ? {
      domain: edit.domain, siteUrl: edit.siteUrl, category: edit.category, price: String(edit.price),
      domainRating: edit.domainRating === null ? "" : String(edit.domainRating), traffic: edit.traffic === null ? "" : String(edit.traffic),
      linkType: edit.linkType, contactName: edit.contactName, contactChannel: edit.contactChannel, notes: edit.notes, status: edit.status,
    } : EMPTY);
  }, [open, edit]);

  async function save() {
    setSaving(true);
    try {
      const json = { ...f, price: f.price === "" ? 0 : Number(f.price), domainRating: f.domainRating === "" ? null : Number(f.domainRating), traffic: f.traffic === "" ? null : Number(f.traffic) };
      if (edit) await api(`/api/backlink-management/vendors/${edit.id}`, { method: "PATCH", json });
      else await api("/api/backlink-management/vendors", { method: "POST", json });
      toast.success("บันทึกแล้ว");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{edit ? "แก้ไขเว็บ" : "เพิ่มเว็บในคลัง"}</DialogTitle><DialogDescription>เว็บที่ซื้อหรือฝาก backlink ได้</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>โดเมน</Label><Input value={f.domain} onChange={(e) => set("domain", e.target.value)} placeholder="example.com" /></div>
            <div><Label>หมวด</Label><Input value={f.category} onChange={(e) => set("category", e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><Label>ราคา (บาท)</Label><Input type="number" min={0} value={f.price} onChange={(e) => set("price", e.target.value)} /></div>
            <div><Label>DR</Label><Input type="number" min={0} max={100} value={f.domainRating} onChange={(e) => set("domainRating", e.target.value)} /></div>
            <div><Label>Traffic/เดือน</Label><Input type="number" min={0} value={f.traffic} onChange={(e) => set("traffic", e.target.value)} /></div>
            <div>
              <Label>ประเภทลิงก์</Label>
              <select className={selectCls} value={f.linkType} onChange={(e) => set("linkType", e.target.value)}>{LINK_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>ผู้ติดต่อ</Label><Input value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></div>
            <div><Label>ช่องทางติดต่อ</Label><Input value={f.contactChannel} onChange={(e) => set("contactChannel", e.target.value)} placeholder="อีเมล / LINE / เบอร์" /></div>
          </div>
          <div>
            <Label>สถานะ</Label>
            <select className={selectCls} value={f.status} onChange={(e) => set("status", e.target.value)}><option value="ACTIVE">ใช้งาน</option><option value="INACTIVE">ไม่ใช้งาน</option></select>
          </div>
          <div><Label>หมายเหตุ</Label><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}บันทึก</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: { line: string; reason: string }[] } | null>(null);
  useEffect(() => { if (open) { setText(""); setResult(null); } }, [open]);
  async function submit() {
    setBusy(true);
    try {
      const d = await api<{ created: number; updated: number; skipped: { line: string; reason: string }[] }>("/api/backlink-management/vendors/bulk", { method: "POST", json: { text } });
      setResult(d);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>วางรายการเว็บหลายแถว</DialogTitle>
          <DialogDescription>หนึ่งเว็บต่อบรรทัด: domain, ราคา, DR, traffic, หมวด (คั่นด้วย comma หรือ tab, สูงสุด 500 บรรทัด) — โดเมนที่มีอยู่แล้วจะถูกอัปเดต</DialogDescription>
        </DialogHeader>
        <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"example.com,1500,45,12000,ข่าว\nblog.co.th\t800\t30"} />
        {result ? (
          <div className="space-y-1 rounded-xl bg-brand-mist/50 p-3 text-sm">
            <div>เพิ่มใหม่ {result.created} · อัปเดต {result.updated} · ข้าม {result.skipped.length}</div>
            {result.skipped.slice(0, 10).map((s, i) => <div key={i} className="truncate text-xs text-gray-500">{s.line} — {s.reason}</div>)}
          </div>
        ) : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>ปิด</Button>
          <Button onClick={submit} disabled={busy || !text.trim()}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}นำเข้า</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VendorsTab() {
  const [rows, setRows] = useState<Vendor[] | null>(null);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [dlg, setDlg] = useState<{ open: boolean; edit: Vendor | null }>({ open: false, edit: null });
  const [bulk, setBulk] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (dq) p.set("q", dq);
      if (status) p.set("status", status);
      if (category) p.set("category", category);
      const d = await api<{ vendors: Vendor[] }>(`/api/backlink-management/vendors?${p}`);
      setRows(d.vendors);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
      setRows([]);
    }
  }, [dq, status, category]);
  useEffect(() => { void load(); }, [load]);

  async function remove(v: Vendor) {
    if (!confirm(`ลบ ${v.domain}?`)) return;
    try {
      const d = await api<{ message: string }>(`/api/backlink-management/vendors/${v.id}`, { method: "DELETE" });
      toast.success(d.message);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  return (
    <Panel
      title="คลังเว็บ"
      subtitle={rows ? `${rows.length.toLocaleString()} เว็บ` : undefined}
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setBulk(true)}><Upload className="mr-1 h-4 w-4" /> วางหลายแถว</Button>
          <Button size="sm" onClick={() => setDlg({ open: true, edit: null })}><Plus className="mr-1 h-4 w-4" /> เพิ่มเว็บ</Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchPill value={q} onChange={setQ} placeholder="ค้นหาโดเมน" className="w-full sm:w-64" />
        <Input className="w-full sm:w-40" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="หมวด (ตรงตัว)" />
        <select className={`${selectCls} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="กรองสถานะ">
          <option value="">ทุกสถานะ</option><option value="ACTIVE">ใช้งาน</option><option value="INACTIVE">ไม่ใช้งาน</option>
        </select>
      </div>
      {rows === null ? (
        <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="ยังไม่มีเว็บในคลัง" description="เพิ่มทีละเว็บ หรือวางหลายแถวจาก Excel" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
          <table className="tbl w-full text-xs">
            <thead>
              <tr>
                <th className="text-left">โดเมน</th><th className="text-left">หมวด</th><th className="num">ราคา</th><th className="num">DR</th>
                <th className="num">Traffic</th><th className="text-left">ประเภท</th><th className="text-left">ติดต่อ</th><th className="text-left">สถานะ</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="whitespace-nowrap font-medium">{v.domain}</td>
                  <td>{v.category || "—"}</td>
                  <td className="num whitespace-nowrap">{money(v.price)}</td>
                  <td className="num">{v.domainRating ?? "—"}</td>
                  <td className="num">{v.traffic?.toLocaleString() ?? "—"}</td>
                  <td>{v.linkType}</td>
                  <td className="max-w-[160px] truncate" title={v.contactChannel}>{v.contactName || v.contactChannel || "—"}</td>
                  <td><Chip tone={v.status === "ACTIVE" ? "ok" : "muted"}>{v.status === "ACTIVE" ? "ใช้งาน" : "ไม่ใช้งาน"}</Chip></td>
                  <td className="whitespace-nowrap">
                    <button type="button" aria-label="แก้ไข" className="p-1 text-gray-500 hover:text-brand-navy" onClick={() => setDlg({ open: true, edit: v })}><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label="ลบ" className="p-1 text-gray-500 hover:text-red-600" onClick={() => remove(v)}><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <VendorDialog open={dlg.open} onOpenChange={(o) => setDlg((p) => ({ ...p, open: o }))} edit={dlg.edit} onSaved={() => void load()} />
      <BulkDialog open={bulk} onOpenChange={setBulk} onSaved={() => void load()} />
    </Panel>
  );
}
