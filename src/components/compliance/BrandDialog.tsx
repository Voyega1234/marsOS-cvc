"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BrandDetail } from "@/lib/compliance/brand";
import { api, type IndustryOpt } from "./shared";

const SELECT_CLS = "h-10 w-full rounded-full border border-gray-200 bg-white px-3 text-sm";

export default function BrandDialog({ brand, industries, onClose, onSaved }: {
  /** null = สร้างแบรนด์ใหม่ */
  brand: BrandDetail | null;
  industries: IndustryOpt[];
  onClose: () => void;
  onSaved: (brand: BrandDetail, created: boolean) => void;
}) {
  const editing = !!brand;
  const [name, setName] = useState(brand?.name ?? "");
  const [industry, setIndustry] = useState(brand?.industry ?? "");
  const [notes, setNotes] = useState(brand?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast.error("ต้องระบุชื่อลูกค้า / แบรนด์"); return; }
    setSaving(true);
    const { ok, data } = await api<{ brand: BrandDetail }>(
      editing ? `/api/compliance/brands/${brand!.id}` : "/api/compliance/brands",
      { method: editing ? "PATCH" : "POST", body: JSON.stringify({ name: name.trim(), industry, notes }) },
    );
    setSaving(false);
    if (!ok || !data.brand) { toast.error(data.error || "บันทึกไม่สำเร็จ", { duration: 9000 }); return; }
    toast.success(editing ? "บันทึกข้อมูลแบรนด์แล้ว" : "เพิ่มแบรนด์แล้ว");
    onSaved(data.brand, !editing);
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? "แก้ไขข้อมูลแบรนด์" : "เพิ่มแบรนด์"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bd-name">ชื่อลูกค้า / แบรนด์</Label>
            <Input id="bd-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bd-industry">อุตสาหกรรมหลัก</Label>
            <select id="bd-industry" className={SELECT_CLS} value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">ไม่ระบุ</option>
              {industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
              {industry && !industries.some((i) => i.key === industry) && <option value={industry}>{industry}</option>}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bd-notes">หมายเหตุ</Label>
            <Textarea id="bd-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>ยกเลิก</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {editing ? "บันทึก" : "เพิ่มแบรนด์"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
