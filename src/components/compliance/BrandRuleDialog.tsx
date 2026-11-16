"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BrandDetail, BrandRuleView } from "@/lib/compliance/brand";
import { RULE_TYPE_LABEL, SEVERITIES, SEVERITY_LABEL } from "@/lib/compliance/types";
import { api } from "./shared";

const SELECT_CLS = "h-10 w-full rounded-full border border-gray-200 bg-white px-3 text-sm";

export default function BrandRuleDialog({ brandId, rule, onClose, onSaved }: {
  brandId: string;
  /** null = เพิ่มกฎใหม่ */
  rule: BrandRuleView | null;
  onClose: () => void;
  onSaved: (brand: BrandDetail) => void;
}) {
  const editing = !!rule;
  const [code, setCode] = useState(rule?.code ?? "");
  const [title, setTitle] = useState(rule?.title ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [ruleType, setRuleType] = useState<string>(rule?.ruleType ?? "PROHIBITED_TERM");
  const [severity, setSeverity] = useState<string>(rule?.severity ?? "MEDIUM");
  const [terms, setTerms] = useState((rule?.terms ?? []).join("\n"));
  const [guidance, setGuidance] = useState(rule?.guidance ?? "");
  const [sourceName, setSourceName] = useState(rule?.sourceName ?? "");
  const [saving, setSaving] = useState(false);

  const isContext = ruleType === "CONTEXT";

  async function save() {
    if (!title.trim()) { toast.error("ต้องระบุชื่อกฎ"); return; }
    const termList = terms.split(/[\n,]/).map((t) => t.trim()).filter(Boolean);
    if (!isContext && termList.length === 0) { toast.error("กฎประเภทคำต้องห้าม/คำเสี่ยง ต้องมีคำอย่างน้อย 1 คำ"); return; }
    if (isContext && !description.trim()) { toast.error("กฎประเภทตามบริบท ต้องมีคำอธิบายว่าห้าม/ต้องทำอะไร"); return; }
    setSaving(true);
    const body = { code, title, description, ruleType, severity, terms: termList, guidance, sourceName };
    const url = editing
      ? `/api/compliance/brands/${brandId}/rules/${rule!.id}`
      : `/api/compliance/brands/${brandId}/rules`;
    const { ok, data } = await api<{ brand: BrandDetail }>(url, { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!ok || !data.brand) { toast.error(data.error || "บันทึกไม่สำเร็จ", { duration: 9000 }); return; }
    toast.success(editing ? "บันทึกกฎแล้ว" : "เพิ่มกฎของแบรนด์แล้ว");
    onSaved(data.brand);
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? "แก้ไขกฎของแบรนด์" : "เพิ่มกฎของแบรนด์"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="br-code">รหัสกฎ (ไม่บังคับ)</Label>
            <Input id="br-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น BR-001" maxLength={40} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-title">ชื่อกฎ</Label>
            <Input id="br-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-type">ประเภท</Label>
            <select id="br-type" className={SELECT_CLS} value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
              {Object.entries(RULE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-sev">ความรุนแรง</Label>
            <select id="br-sev" className={SELECT_CLS} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="br-terms">
              {isContext ? "คำ/วลีที่ต้องจับ (ไม่บังคับสำหรับประเภทตามบริบท)" : "คำ/วลีที่ต้องจับ (หนึ่งคำต่อบรรทัด หรือคั่นด้วยจุลภาค)"}
            </Label>
            <Textarea id="br-terms" rows={5} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="br-desc">{isContext ? "คำอธิบาย (บังคับ — กฎห้าม/ต้องทำอะไร)" : "คำอธิบาย (กฎห้ามอะไร / ทำไม)"}</Label>
            <Textarea id="br-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="br-guide">แนวทางแก้ไข / ที่ควรเขียนแทน</Label>
            <Textarea id="br-guide" rows={3} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="br-src">แหล่งอ้างอิง (เช่น ชื่อ Brand guideline ของลูกค้า)</Label>
            <Input id="br-src" value={sourceName} onChange={(e) => setSourceName(e.target.value)} maxLength={500} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>ยกเลิก</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {editing ? "บันทึก" : "เพิ่มกฎ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
