"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RULE_TYPE_LABEL, SEVERITIES, SEVERITY_LABEL, type RuleLite } from "@/lib/compliance/types";
import { api, fmtDateTime, type IndustryOpt } from "./shared";

interface VersionRow { id: string; version: number; changeNote: string; changedBy: string; createdAt: string }

const NEW_INDUSTRY = "__new__";
const SELECT_CLS = "h-10 w-full rounded-full border border-gray-200 bg-white px-3 text-sm";

export default function RuleDialog({ rule, industries, defaultIndustry, onClose, onSaved }: {
  rule: RuleLite | null;
  industries: IndustryOpt[];
  defaultIndustry: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!rule;
  const [industrySel, setIndustrySel] = useState(rule?.industry ?? (defaultIndustry || industries[0]?.key || NEW_INDUSTRY));
  const [industryNew, setIndustryNew] = useState("");
  const [code, setCode] = useState(rule?.code ?? "");
  const [title, setTitle] = useState(rule?.title ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [ruleType, setRuleType] = useState<string>(rule?.ruleType ?? "PROHIBITED_TERM");
  const [severity, setSeverity] = useState<string>(rule?.severity ?? "MEDIUM");
  const [terms, setTerms] = useState((rule?.terms ?? []).join("\n"));
  const [guidance, setGuidance] = useState(rule?.guidance ?? "");
  const [sourceName, setSourceName] = useState(rule?.sourceName ?? "");
  const [sourceRef, setSourceRef] = useState(rule?.sourceRef ?? "");
  const [sourceUrl, setSourceUrl] = useState(rule?.sourceUrl ?? "");
  const [effectiveDate, setEffectiveDate] = useState(rule?.effectiveDate ?? "");
  const [changeNote, setChangeNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);

  useEffect(() => {
    if (!rule) return;
    void (async () => {
      const { ok, data } = await api<{ versions: VersionRow[] }>(`/api/compliance/rules/${rule.id}`);
      if (ok && Array.isArray(data.versions)) setVersions(data.versions);
    })();
  }, [rule]);

  async function save() {
    const industry = industrySel === NEW_INDUSTRY ? industryNew.trim() : industrySel;
    if (!industry) { toast.error("ต้องระบุอุตสาหกรรม"); return; }
    if (!title.trim()) { toast.error("ต้องระบุชื่อกฎ"); return; }
    setSaving(true);
    const body = {
      industry, code, title, description, ruleType, severity, terms, guidance, sourceName, sourceRef, sourceUrl,
      effectiveDate: effectiveDate || null,
      ...(editing ? { changeNote } : {}),
    };
    const { ok, data } = await api(editing ? `/api/compliance/rules/${rule!.id}` : "/api/compliance/rules", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!ok) {
      const problems = Array.isArray(data.problems) && data.problems.length ? `\n• ${data.problems.join("\n• ")}` : "";
      toast.error(`${data.error || "บันทึกไม่สำเร็จ"}${problems}`, { duration: 9000 });
      return;
    }
    toast.success(editing ? "บันทึกเวอร์ชันใหม่แล้ว" : "เพิ่มกฎเป็นฉบับร่างแล้ว");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? `แก้ไขกฎ ${rule!.code}` : "เพิ่มกฎ"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rd-industry">อุตสาหกรรม</Label>
            <select id="rd-industry" className={SELECT_CLS} value={industrySel} onChange={(e) => setIndustrySel(e.target.value)}>
              {industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
              {rule && !industries.some((i) => i.key === rule.industry) && <option value={rule.industry}>{rule.industry}</option>}
              <option value={NEW_INDUSTRY}>อุตสาหกรรมใหม่…</option>
            </select>
            {industrySel === NEW_INDUSTRY && (
              <Input value={industryNew} onChange={(e) => setIndustryNew(e.target.value)} placeholder="อุตสาหกรรมใหม่ (a-z, 0-9, _) เช่น insurance" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rd-code">รหัสกฎ</Label>
            <Input id="rd-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น BC-010" maxLength={40} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rd-title">ชื่อกฎ</Label>
            <Input id="rd-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rd-type">ประเภท</Label>
            <select id="rd-type" className={SELECT_CLS} value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
              {Object.entries(RULE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rd-sev">ความรุนแรง</Label>
            <select id="rd-sev" className={SELECT_CLS} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rd-desc">คำอธิบาย (กฎห้ามอะไร / ทำไม)</Label>
            <Textarea id="rd-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rd-terms">คำ/วลีที่ต้องจับ (หนึ่งคำต่อบรรทัด — ประเภทตามบริบทเว้นว่างได้)</Label>
            <Textarea id="rd-terms" rows={5} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rd-guide">แนวทางที่ควรเขียนแทน</Label>
            <Textarea id="rd-guide" rows={3} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rd-src">แหล่งอ้างอิง (ชื่อประกาศ/กฎหมาย)</Label>
            <Input id="rd-src" value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rd-ref">ข้อ/มาตรา</Label>
            <Input id="rd-ref" value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rd-date">วันที่มีผลบังคับใช้</Label>
            <Input id="rd-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rd-url">ลิงก์แหล่งอ้างอิง</Label>
            <Input id="rd-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" />
          </div>
          {editing && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rd-note">หมายเหตุการแก้ไข</Label>
              <Input id="rd-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={500} placeholder="แก้อะไรและทำไม" />
            </div>
          )}
        </div>

        {editing && versions.length > 0 && (
          <div className="rounded-2xl border border-gray-100 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-600">ประวัติเวอร์ชัน</p>
            <ul className="space-y-1 text-xs text-gray-600">
              {versions.map((v) => (
                <li key={v.id}>v{v.version} · {fmtDateTime(v.createdAt)} · {v.changedBy || "—"}{v.changeNote ? ` — ${v.changeNote}` : ""}</li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>ยกเลิก</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {editing ? "บันทึก (เวอร์ชันใหม่)" : "เพิ่มกฎ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
