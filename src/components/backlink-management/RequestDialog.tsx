"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LINK_TYPES } from "@/lib/backlink-management/types";
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
              {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.clientName ? ` · ${p.clientName}` : ""}</option>)}
            </select>
          </div>
          <div>
            <Label>เว็บที่จะฝากลิงก์ (จากคลังเว็บ)</Label>
            <select className={selectCls} value={f.vendorSiteId} disabled={locked} onChange={(e) => pickVendor(e.target.value)}>
              <option value="">— ยังไม่เลือกเว็บ —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.domain} · {v.price.toLocaleString("th-TH")} บาท</option>)}
            </select>
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
