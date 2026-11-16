"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LINK_TYPES } from "@/lib/backlink-management/types";
import { PRICE_TYPES } from "@/lib/backlink-management/vendor-detail";
import { api, dateInput, selectCls, type BlmRow, type Meta, type Vendor } from "./shared";

/** สร้าง / แก้ไขคำขอ (edit: ส่งแถวเดิมมา) */
export default function RequestDialog({ open, onOpenChange, meta, edit, defaultProjectId, defaultPeriod, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meta: Meta | null;
  edit: BlmRow | null;
  defaultProjectId: string;
  defaultPeriod: string;
  onSaved: () => void;
}) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [f, setF] = useState({
    projectId: "", vendorSiteId: "", targetUrl: "", anchorText: "", keyword: "", linkType: "dofollow",
    quotedPrice: "", budgetPeriod: "", assigneeId: "", dueDate: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const locked = !!edit && edit.status !== "REQUESTED" && !meta?.me.canApprove;

  useEffect(() => {
    if (!open) return;
    api<{ vendors: Vendor[] }>("/api/backlink-management/vendors?status=ACTIVE").then((d) => setVendors(d.vendors)).catch(() => {});
    setF(edit ? {
      projectId: edit.projectId, vendorSiteId: edit.vendorSiteId ?? "", targetUrl: edit.targetUrl, anchorText: edit.anchorText,
      keyword: edit.keyword, linkType: edit.linkType, quotedPrice: String(edit.quotedPrice), budgetPeriod: edit.budgetPeriod,
      assigneeId: edit.assigneeId ?? "", dueDate: dateInput(edit.dueDate), notes: edit.notes,
    } : {
      projectId: defaultProjectId, vendorSiteId: "", targetUrl: "", anchorText: "", keyword: "", linkType: "dofollow",
      quotedPrice: "", budgetPeriod: defaultPeriod, assigneeId: "", dueDate: "", notes: "",
    });
  }, [open, edit, defaultProjectId, defaultPeriod]);

  // คลังเว็บ → ฟอร์มคำขอ: จัดกลุ่มตามหมวดเดียวกับหน้าคลังเว็บ และดึงราคาแยกประเภทของเว็บที่เลือกมาให้กดใช้
  const vendorGroups = useMemo(() => {
    const m = new Map<string, Vendor[]>();
    for (const v of vendors) { const k = v.category || "ไม่ระบุหมวด"; m.set(k, [...(m.get(k) ?? []), v]); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], "th"));
  }, [vendors]);
  const picked = vendors.find((x) => x.id === f.vendorSiteId) ?? null;
  const pickedPrices = picked ? PRICE_TYPES.filter((p) => typeof picked[p.key] === "number") : [];

  function pickVendor(id: string) {
    set("vendorSiteId", id);
    const v = vendors.find((x) => x.id === id);
    if (v && !edit) setF((p) => ({ ...p, vendorSiteId: id, quotedPrice: p.quotedPrice || String(v.price), linkType: v.linkType || p.linkType }));
  }

  async function save() {
    if (!f.projectId) return toast.error("กรุณาเลือกโปรเจกต์");
    if (!/^https?:\/\//i.test(f.targetUrl.trim())) return toast.error("URL หน้าลูกค้าต้องขึ้นต้นด้วย http:// หรือ https://");
    setSaving(true);
    try {
      if (edit) {
        await api(`/api/backlink-management/requests/${edit.id}`, {
          method: "PATCH",
          json: {
            targetUrl: f.targetUrl, anchorText: f.anchorText, keyword: f.keyword, linkType: f.linkType, notes: f.notes,
            assigneeId: f.assigneeId || null, dueDate: f.dueDate || null,
            ...(locked ? {} : { vendorSiteId: f.vendorSiteId || null, quotedPrice: Number(f.quotedPrice || 0), budgetPeriod: f.budgetPeriod }),
          },
        });
        toast.success("บันทึกแล้ว");
      } else {
        await api("/api/backlink-management/requests", {
          method: "POST",
          json: {
            projectId: f.projectId, vendorSiteId: f.vendorSiteId || undefined, targetUrl: f.targetUrl, anchorText: f.anchorText,
            keyword: f.keyword, linkType: f.linkType, quotedPrice: f.quotedPrice === "" ? undefined : Number(f.quotedPrice),
            budgetPeriod: f.budgetPeriod || undefined, assigneeId: f.assigneeId || undefined, dueDate: f.dueDate || undefined, notes: f.notes,
          },
        });
        toast.success("สร้างคำขอแล้ว");
      }
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
        <DialogHeader>
          <DialogTitle>{edit ? "แก้ไขคำขอ backlink" : "สร้างคำขอ backlink"}</DialogTitle>
          <DialogDescription>
            {locked ? "คำขอผ่านขั้นรออนุมัติแล้ว ราคา เดือนตัดงบ และเว็บ แก้ได้เฉพาะผู้อนุมัติ" : "ระบุหน้าลูกค้าที่ต้องการลิงก์ เว็บที่จะฝาก และราคา"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>โปรเจกต์</Label>
            <select className={selectCls} value={f.projectId} disabled={!!edit} onChange={(e) => set("projectId", e.target.value)}>
              <option value="">— เลือกโปรเจกต์ —</option>
              {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.manual ? " (เพิ่มเอง)" : ""}{p.clientName ? ` · ${p.clientName}` : ""}</option>)}
            </select>
          </div>
          <div>
            <Label>เว็บที่จะฝากลิงก์ (จากคลังเว็บ)</Label>
            <select className={selectCls} value={f.vendorSiteId} disabled={locked} onChange={(e) => pickVendor(e.target.value)}>
              <option value="">— ยังไม่เลือกเว็บ —</option>
              {vendorGroups.map(([cat, list]) => (
                <optgroup key={cat} label={`${cat} (${list.length})`}>
                  {list.map((v) => <option key={v.id} value={v.id}>{v.domain} · {v.price.toLocaleString("th-TH")} บาท</option>)}
                </optgroup>
              ))}
            </select>
            {picked && (pickedPrices.length > 0 || picked.contactChannel || picked.expiration) ? (
              <div className="mt-2 space-y-1.5 rounded-xl bg-brand-mist/40 p-2.5 text-xs text-gray-700">
                {pickedPrices.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-gray-500">ราคาในคลังเว็บ:</span>
                    {pickedPrices.map((p) => (
                      <button key={p.key} type="button" disabled={locked} onClick={() => set("quotedPrice", String(picked[p.key]))}
                        className="rounded-full border border-gray-200 bg-white px-2 py-0.5 hover:bg-brand-mist disabled:opacity-50"
                        title="กดเพื่อใช้ราคานี้">
                        {p.label} {(picked[p.key] as number).toLocaleString("th-TH")}
                      </button>
                    ))}
                  </div>
                ) : null}
                {picked.priceNote ? <div className="text-gray-500">หมายเหตุราคา: {picked.priceNote}</div> : null}
                {picked.expiration ? <div>อายุลิงก์: {picked.expiration}</div> : null}
                {picked.contactChannel ? <div className="line-clamp-3 whitespace-pre-line">ติดต่อ: {picked.contactName ? `${picked.contactName} · ` : ""}{picked.contactChannel}</div> : null}
              </div>
            ) : null}
          </div>
          <div>
            <Label>URL หน้าลูกค้าที่ลิงก์ต้องชี้มา</Label>
            <Input value={f.targetUrl} onChange={(e) => set("targetUrl", e.target.value)} placeholder="https://" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Anchor text</Label><Input value={f.anchorText} onChange={(e) => set("anchorText", e.target.value)} /></div>
            <div><Label>Keyword</Label><Input value={f.keyword} onChange={(e) => set("keyword", e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>ประเภทลิงก์</Label>
              <select className={selectCls} value={f.linkType} onChange={(e) => set("linkType", e.target.value)}>
                {LINK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label>ราคา (บาท)</Label>
              <Input type="number" min={0} value={f.quotedPrice} disabled={locked} onChange={(e) => set("quotedPrice", e.target.value)} placeholder="ใช้ราคาจากคลังเว็บ" />
            </div>
            <div>
              <Label>ตัดงบเดือน</Label>
              <Input type="month" value={f.budgetPeriod} disabled={locked} onChange={(e) => set("budgetPeriod", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>ผู้รับผิดชอบ</Label>
              <select className={selectCls} value={f.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
                <option value="">— ยังไม่มอบหมาย —</option>
                {meta?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div><Label>กำหนดส่ง</Label><Input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></div>
          </div>
          <div><Label>หมายเหตุ</Label><Textarea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}บันทึก</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
