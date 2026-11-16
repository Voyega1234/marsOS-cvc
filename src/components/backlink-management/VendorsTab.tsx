"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, FileSpreadsheet, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Chip, EmptyState, Panel, SearchPill } from "@/components/ds";
import { LINK_TYPES } from "@/lib/backlink-management/types";
import { DATA_STATUS_LABEL, DATA_STATUSES, PRICE_TYPES, type PriceKey } from "@/lib/backlink-management/vendor-detail";
import { api, money, selectCls, type Vendor } from "./shared";
import VendorImportDialog from "./VendorImportDialog";

const NO_CATEGORY = "ไม่ระบุหมวด";
const DETAILS_NOTICE = "ข้อมูลเสริม (ราคาแยกประเภท, Rate Card, อายุลิงก์ ฯลฯ) ยังใช้ไม่ได้ — ต้องรันไฟล์ scripts/sql/add-blm-vendor-detail-table.sql ใน Supabase โปรเจกต์ \"SEO PROJECT\" ก่อน ข้อมูลหลักของคลังเว็บใช้งานได้ตามปกติ";

const isHttp = (u: string) => u.startsWith("http://") || u.startsWith("https://");

const EMPTY = {
  domain: "", siteUrl: "", category: "", price: "", domainRating: "", traffic: "", linkType: "dofollow", contactName: "", contactChannel: "", notes: "", status: "ACTIVE",
  language: "", urlRating: "", priceBacklink: "", pricePublisherWeb: "", pricePublisherWebFb: "", priceCvcWeb: "", priceCvcWebFb: "", pricePr: "",
  priceNote: "", expiration: "", rateCardUrl: "", dataStatus: "", refId: "",
};

const numStr = (n: number | null) => (n === null ? "" : String(n));
const numOrNull = (s: string) => (s === "" ? null : Number(s));

function VendorDialog({ open, onOpenChange, edit, onSaved, detailsAvailable, categories }: {
  open: boolean; onOpenChange: (v: boolean) => void; edit: Vendor | null; onSaved: () => void; detailsAvailable: boolean; categories: string[];
}) {
  const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    if (!open) return;
    setF(edit ? {
      domain: edit.domain, siteUrl: edit.siteUrl, category: edit.category, price: String(edit.price),
      domainRating: numStr(edit.domainRating), traffic: numStr(edit.traffic),
      linkType: edit.linkType, contactName: edit.contactName, contactChannel: edit.contactChannel, notes: edit.notes, status: edit.status,
      language: edit.language ?? "", urlRating: numStr(edit.urlRating ?? null),
      priceBacklink: numStr(edit.priceBacklink ?? null), pricePublisherWeb: numStr(edit.pricePublisherWeb ?? null),
      pricePublisherWebFb: numStr(edit.pricePublisherWebFb ?? null), priceCvcWeb: numStr(edit.priceCvcWeb ?? null),
      priceCvcWebFb: numStr(edit.priceCvcWebFb ?? null), pricePr: numStr(edit.pricePr ?? null),
      priceNote: edit.priceNote ?? "", expiration: edit.expiration ?? "", rateCardUrl: edit.rateCardUrl ?? "",
      dataStatus: edit.dataStatus ?? "", refId: edit.refId ?? "",
    } : EMPTY);
  }, [open, edit]);

  async function save() {
    setSaving(true);
    try {
      const base = {
        domain: f.domain, siteUrl: f.siteUrl, category: f.category, linkType: f.linkType, contactName: f.contactName,
        contactChannel: f.contactChannel, notes: f.notes, status: f.status,
        price: f.price === "" ? 0 : Number(f.price), domainRating: numOrNull(f.domainRating), traffic: numOrNull(f.traffic),
      };
      const details = detailsAvailable ? {
        language: f.language, urlRating: numOrNull(f.urlRating),
        priceBacklink: numOrNull(f.priceBacklink), pricePublisherWeb: numOrNull(f.pricePublisherWeb), pricePublisherWebFb: numOrNull(f.pricePublisherWebFb),
        priceCvcWeb: numOrNull(f.priceCvcWeb), priceCvcWebFb: numOrNull(f.priceCvcWebFb), pricePr: numOrNull(f.pricePr),
        priceNote: f.priceNote, expiration: f.expiration, rateCardUrl: f.rateCardUrl, dataStatus: f.dataStatus, refId: f.refId,
      } : {};
      const json = { ...base, ...details };
      const d = edit
        ? await api<{ warning?: string }>(`/api/backlink-management/vendors/${edit.id}`, { method: "PATCH", json })
        : await api<{ warning?: string }>("/api/backlink-management/vendors", { method: "POST", json });
      toast.success("บันทึกแล้ว");
      if (d?.warning) toast.warning(d.warning);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const dis = !detailsAvailable;
  const secTitle = "text-xs font-semibold text-gray-500";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{edit ? "แก้ไขเว็บ" : "เพิ่มเว็บในคลัง"}</DialogTitle><DialogDescription>เว็บที่ซื้อหรือฝาก backlink ได้</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          {dis ? <p className="text-xs text-gray-500">ช่องข้อมูลเสริมถูกปิดไว้ — ต้องรันไฟล์ scripts/sql/add-blm-vendor-detail-table.sql ก่อน</p> : null}
          <div className={secTitle}>ข้อมูลเว็บ</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="blm-ven-domain">โดเมน</Label><Input id="blm-ven-domain" value={f.domain} onChange={(e) => set("domain", e.target.value)} placeholder="example.com" /></div>
            <div><Label htmlFor="blm-ven-siteUrl">URL เว็บ</Label><Input id="blm-ven-siteUrl" value={f.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} placeholder="https://…" /></div>
            <div>
              <Label htmlFor="blm-ven-category">หมวด</Label>
              <Input id="blm-ven-category" list="blm-vendor-categories" value={f.category} onChange={(e) => set("category", e.target.value)} />
              <datalist id="blm-vendor-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div><Label htmlFor="blm-ven-language">ภาษา</Label><Input id="blm-ven-language" disabled={dis} value={f.language} onChange={(e) => set("language", e.target.value)} placeholder="TH / EN" /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><Label htmlFor="blm-ven-domainRating">DR</Label><Input id="blm-ven-domainRating" type="number" min={0} max={100} value={f.domainRating} onChange={(e) => set("domainRating", e.target.value)} /></div>
            <div><Label htmlFor="blm-ven-urlRating">UR</Label><Input id="blm-ven-urlRating" type="number" min={0} max={100} step={0.1} disabled={dis} value={f.urlRating} onChange={(e) => set("urlRating", e.target.value)} /></div>
            <div><Label htmlFor="blm-ven-traffic">Traffic/เดือน</Label><Input id="blm-ven-traffic" type="number" min={0} value={f.traffic} onChange={(e) => set("traffic", e.target.value)} /></div>
            <div>
              <Label htmlFor="blm-ven-linkType">ประเภทลิงก์</Label>
              <select id="blm-ven-linkType" className={selectCls} value={f.linkType} onChange={(e) => set("linkType", e.target.value)}>{LINK_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="blm-ven-status">สถานะ</Label>
              <select id="blm-ven-status" className={selectCls} value={f.status} onChange={(e) => set("status", e.target.value)}><option value="ACTIVE">ใช้งาน</option><option value="INACTIVE">ไม่ใช้งาน</option></select>
            </div>
            <div>
              <Label htmlFor="blm-ven-dataStatus">สถานะข้อมูล</Label>
              <select id="blm-ven-dataStatus" className={selectCls} disabled={dis} value={f.dataStatus} onChange={(e) => set("dataStatus", e.target.value)}>
                {DATA_STATUSES.map((s) => <option key={s} value={s}>{DATA_STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div><Label htmlFor="blm-ven-refId">รหัสอ้างอิง</Label><Input id="blm-ven-refId" disabled={dis} value={f.refId} onChange={(e) => set("refId", e.target.value)} /></div>
          </div>

          <div className={secTitle}>ราคา (บาท)</div>
          <div>
            <Label htmlFor="blm-ven-price">ราคาเริ่มต้น</Label>
            <Input id="blm-ven-price" type="number" min={0} value={f.price} onChange={(e) => set("price", e.target.value)} />
            <p className="mt-1 text-[11px] text-gray-500">ราคาที่ฟอร์มคำขอ Backlink ดึงไปใช้ — เว้นว่างไว้ ระบบจะใช้ราคาแยกประเภทตัวแรกที่มี</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {PRICE_TYPES.map((p) => (
              <div key={p.key}>
                <Label htmlFor={`blm-ven-${p.key}`}>{p.label}</Label>
                <Input id={`blm-ven-${p.key}`} type="number" min={0} disabled={dis} value={f[p.key as PriceKey]} onChange={(e) => set(p.key, e.target.value)} />
              </div>
            ))}
          </div>
          <div><Label htmlFor="blm-ven-priceNote">หมายเหตุราคา</Label><Input id="blm-ven-priceNote" disabled={dis} value={f.priceNote} onChange={(e) => set("priceNote", e.target.value)} /></div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="blm-ven-expiration">อายุลิงก์</Label><Input id="blm-ven-expiration" disabled={dis} value={f.expiration} onChange={(e) => set("expiration", e.target.value)} /></div>
            <div><Label htmlFor="blm-ven-rateCardUrl">ลิงก์ Rate Card</Label><Input id="blm-ven-rateCardUrl" disabled={dis} value={f.rateCardUrl} onChange={(e) => set("rateCardUrl", e.target.value)} placeholder="https://…" /></div>
          </div>

          <div className={secTitle}>ติดต่อ</div>
          <div><Label htmlFor="blm-ven-contactName">ชื่อผู้ติดต่อ</Label><Input id="blm-ven-contactName" value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></div>
          <div><Label htmlFor="blm-ven-contactChannel">ข้อมูลติดต่อ</Label><Textarea id="blm-ven-contactChannel" rows={4} value={f.contactChannel} onChange={(e) => set("contactChannel", e.target.value)} placeholder="ชื่อ / เบอร์ / อีเมล / LINE" /></div>
          <div><Label htmlFor="blm-ven-notes">รายละเอียด / เงื่อนไข</Label><Textarea id="blm-ven-notes" rows={5} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-gray-500">{label}</div>
      <div className="whitespace-pre-line break-words text-xs">{children}</div>
    </div>
  );
}

export default function VendorsTab() {
  const [rows, setRows] = useState<Vendor[] | null>(null);
  const [detailsAvailable, setDetailsAvailable] = useState(true);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<{ open: boolean; edit: Vendor | null }>({ open: false, edit: null });
  const [bulk, setBulk] = useState(false);
  const [imp, setImp] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (dq) p.set("q", dq);
      if (status) p.set("status", status);
      const d = await api<{ vendors: Vendor[]; detailsAvailable: boolean }>(`/api/backlink-management/vendors?${p}`);
      setRows(d.vendors);
      setDetailsAvailable(d.detailsAvailable !== false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
      setRows([]);
    }
  }, [dq, status]);
  useEffect(() => { void load(); }, [load]);

  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of rows ?? []) m.set(v.category, (m.get(v.category) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);

  // หมวดที่เลือกหายไปหลังโหลดใหม่ → กลับไป "ทั้งหมด"
  useEffect(() => {
    if (category !== null && rows && !cats.some(([c]) => c === category)) setCategory(null);
  }, [cats, category, rows]);

  const groups = useMemo(() => {
    const byDomain = (a: Vendor, b: Vendor) => a.domain.localeCompare(b.domain);
    if (category !== null) return [{ name: category, items: (rows ?? []).filter((v) => v.category === category).sort(byDomain) }];
    return cats.map(([name]) => ({ name, items: (rows ?? []).filter((v) => v.category === name).sort(byDomain) }));
  }, [rows, cats, category]);

  const categoryNames = useMemo(() => cats.map(([c]) => c).filter(Boolean), [cats]);

  function toggle(id: string) {
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function copyContact(v: Vendor) {
    try {
      await navigator.clipboard.writeText([v.contactName, v.contactChannel].filter(Boolean).join("\n"));
      toast.success("คัดลอกแล้ว");
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

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

  const COLS = 10;
  const pill = "rounded-full border px-3 py-1 text-xs";

  return (
    <Panel
      title="คลังเว็บ"
      subtitle={rows ? `${rows.length.toLocaleString()} เว็บ` : undefined}
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setImp(true)}><FileSpreadsheet className="mr-1 h-4 w-4" /> นำเข้าไฟล์</Button>
          <Button size="sm" variant="outline" onClick={() => setBulk(true)}><Upload className="mr-1 h-4 w-4" /> วางหลายแถว</Button>
          <Button size="sm" onClick={() => setDlg({ open: true, edit: null })}><Plus className="mr-1 h-4 w-4" /> เพิ่มเว็บ</Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchPill value={q} onChange={setQ} placeholder="ค้นหาโดเมน / รายละเอียด" className="w-full sm:w-64" />
        <select className={`${selectCls} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="กรองสถานะ">
          <option value="">ทุกสถานะ</option><option value="ACTIVE">ใช้งาน</option><option value="INACTIVE">ไม่ใช้งาน</option>
        </select>
      </div>
      {rows && rows.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="แบ่งหมวด">
          <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}
            className={`${pill} ${category === null ? "border-brand-navy bg-brand-navy text-white" : "border-gray-200 bg-white/80 text-gray-600 hover:bg-brand-mist/60"}`}>
            ทั้งหมด ({rows.length})
          </button>
          {cats.map(([c, n]) => (
            <button key={c || "__none"} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
              className={`${pill} ${category === c ? "border-brand-navy bg-brand-navy text-white" : "border-gray-200 bg-white/80 text-gray-600 hover:bg-brand-mist/60"}`}>
              {c || NO_CATEGORY} ({n})
            </button>
          ))}
        </div>
      ) : null}
      {!detailsAvailable ? <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{DETAILS_NOTICE}</div> : null}
      {rows === null ? (
        <div className="flex justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="ยังไม่มีเว็บในคลัง" description="เพิ่มทีละเว็บ วางหลายแถว หรือนำเข้าไฟล์ Excel / CSV" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/80 bg-white/70 shadow-sm">
          <table className="tbl w-full text-xs">
            <thead>
              <tr>
                <th /><th className="text-left">โดเมน</th><th className="num">DR / UR</th><th className="num">Traffic</th><th className="num">ราคาเริ่มต้น</th>
                <th className="text-left">ราคาแยกประเภท</th><th className="text-left">ติดต่อ</th><th className="text-left">Rate Card</th><th className="text-left">สถานะ</th><th />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                renderGroup(g, category === null)
              ))}
            </tbody>
          </table>
        </div>
      )}
      <VendorDialog open={dlg.open} onOpenChange={(o) => setDlg((p) => ({ ...p, open: o }))} edit={dlg.edit} onSaved={() => void load()} detailsAvailable={detailsAvailable} categories={categoryNames} />
      <BulkDialog open={bulk} onOpenChange={setBulk} onSaved={() => void load()} />
      <VendorImportDialog open={imp} onOpenChange={setImp} onSaved={() => void load()} />
    </Panel>
  );

  function renderGroup(g: { name: string; items: Vendor[] }, showHeader: boolean) {
    return (
      <Fragment key={g.name || "__none"}>
        {showHeader ? (
          <tr><td colSpan={COLS} className="bg-brand-mist/50 font-semibold text-brand-navy">{g.name || NO_CATEGORY} ({g.items.length})</td></tr>
        ) : null}
        {g.items.map((v) => {
          const open = expanded.has(v.id);
          const prices = PRICE_TYPES.filter((p) => typeof v[p.key] === "number");
          return (
            renderVendor(v, open, prices)
          );
        })}
      </Fragment>
    );
  }

  function renderVendor(v: Vendor, open: boolean, prices: typeof PRICE_TYPES) {
    return (
      <Fragment key={v.id}>
        <tr>
          <td>
            <button type="button" aria-label="ดูรายละเอียด" aria-expanded={open} className="p-1 text-gray-500 hover:text-brand-navy" onClick={() => toggle(v.id)}>
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </td>
          <td className="whitespace-nowrap font-medium">
            {isHttp(v.siteUrl) ? <a href={v.siteUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{v.domain}</a> : v.domain}
            {v.language || v.dataStatus === "OUTDATED" ? (
              <div className="flex items-center gap-1 text-[11px] font-normal text-gray-500">
                {v.language ? <span>{v.language}</span> : null}
                {v.dataStatus === "OUTDATED" ? <Chip tone="muted">ข้อมูลเก่า</Chip> : null}
              </div>
            ) : null}
          </td>
          <td className="num whitespace-nowrap">{v.domainRating ?? "—"} / {v.urlRating ?? "—"}</td>
          <td className="num">{v.traffic?.toLocaleString() ?? "—"}</td>
          <td className="num whitespace-nowrap">{v.price > 0 ? money(v.price) : "—"}</td>
          <td>
            {prices.length === 0 ? "—" : prices.map((p) => (
              <div key={p.key} className="whitespace-nowrap text-[11px] leading-4">{p.label} {(v[p.key] as number).toLocaleString()}</div>
            ))}
          </td>
          <td className="max-w-[220px]" title={v.contactChannel}>
            <div className="line-clamp-2 whitespace-pre-line break-words">
              {v.contactName || v.contactChannel ? <>{v.contactName ? <b>{v.contactName}</b> : null}{v.contactName && v.contactChannel ? "\n" : ""}{v.contactChannel}</> : "—"}
            </div>
          </td>
          <td>
            {isHttp(v.rateCardUrl) ? (
              <a href={v.rateCardUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-navy hover:underline">เปิด <ExternalLink className="h-3 w-3" /></a>
            ) : "—"}
          </td>
          <td><Chip tone={v.status === "ACTIVE" ? "ok" : "muted"}>{v.status === "ACTIVE" ? "ใช้งาน" : "ไม่ใช้งาน"}</Chip></td>
          <td className="whitespace-nowrap">
            <button type="button" aria-label="แก้ไข" className="p-1 text-gray-500 hover:text-brand-navy" onClick={() => setDlg({ open: true, edit: v })}><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="ลบ" className="p-1 text-gray-500 hover:text-red-600" onClick={() => remove(v)}><Trash2 className="h-3.5 w-3.5" /></button>
          </td>
        </tr>
        {open ? (
          <tr>
            <td colSpan={COLS} className="bg-white/60">
              <div className="grid gap-3 p-2 sm:grid-cols-2">
                <Detail label="ข้อมูลติดต่อ">
                  {v.contactName || v.contactChannel ? (
                    <>
                      {v.contactName ? <b>{v.contactName}</b> : null}{v.contactName && v.contactChannel ? "\n" : ""}{v.contactChannel}
                      <div><button type="button" className="mt-1 rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-brand-mist/60" onClick={() => void copyContact(v)}>คัดลอก</button></div>
                    </>
                  ) : "—"}
                </Detail>
                <Detail label="รายละเอียด / เงื่อนไข">{v.notes || "—"}</Detail>
                <Detail label="อายุลิงก์">{v.expiration || "—"}</Detail>
                <Detail label="หมายเหตุราคา">{v.priceNote || "—"}</Detail>
                <Detail label="ประเภทลิงก์">{v.linkType || "—"}</Detail>
                <Detail label="รหัสอ้างอิง">{v.refId || "—"}</Detail>
                <Detail label="สถานะข้อมูล">{DATA_STATUS_LABEL[v.dataStatus ?? ""] ?? "—"}</Detail>
              </div>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  }
}
