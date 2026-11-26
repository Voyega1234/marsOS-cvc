"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RULE_TYPE_LABEL, SEVERITIES, SEVERITY_LABEL, type RuleLite } from "@/lib/compliance/types";
import type { FillDroppedField, RuleFillSuggestion } from "@/lib/compliance/rule-fill";
import { readLegacyDocText } from "@/lib/doc-legacy";
import {
  RESTRICTION_FILE_ACCEPT, extractRestrictionFileText, isImageFile, readImageFileWithAI, readImagePagesWithAI,
} from "@/lib/restriction-file-client";
import { api, fmtDateTime, type IndustryOpt } from "./shared";
import { fmtCost } from "@/lib/ai-cost-format";

interface VersionRow { id: string; version: number; changeNote: string; changedBy: string; createdAt: string }

const NEW_INDUSTRY = "__new__";
const SELECT_CLS = "h-10 w-full rounded-full border border-gray-200 bg-white px-3 text-sm";

// ── ให้ AI อ่านลิงก์/ไฟล์แล้วกรอกฟอร์ม ────────────────────────────────────────
const FILL_FILE_ACCEPT = `${RESTRICTION_FILE_ACCEPT},.doc`;
/** ไฟล์อ่านในเบราว์เซอร์ ส่งไปเซิร์ฟเวอร์เฉพาะข้อความ (Vercel รับ body ได้ราว 4.5 MB) */
const FILL_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** เซิร์ฟเวอร์รับข้อความไม่เกิน 400,000 ตัวอักษร */
const FILL_SEND_MAX_CHARS = 380_000;
/** หน้าสแกนคิดค่า AI ต่อหน้า จึงจำกัดจำนวนหน้าต่อครั้ง */
const FILL_SCAN_PAGES_MAX = 15;
const DROPPED_LABEL: Record<FillDroppedField, string> = {
  sourceRef: "ข้อ/มาตรา",
  effectiveDate: "วันที่มีผลบังคับใช้",
  sourceUrl: "ลิงก์แหล่งอ้างอิง",
};

/** ค่าในฟอร์มของกฎหนึ่งข้อที่ AI เสนอ — เก็บแยกต่อข้อ สลับดูแล้วค่าที่แก้ไว้ไม่หาย */
interface Draft {
  industrySel: string; industryNew: string; code: string; title: string; description: string;
  ruleType: string; severity: string; terms: string; guidance: string;
  sourceName: string; sourceRef: string; sourceUrl: string; effectiveDate: string;
  dropped: FillDroppedField[];
}
interface FillResponse {
  rules?: RuleFillSuggestion[]; note?: string; truncated?: boolean;
  source?: { kind?: string; label?: string; url?: string }; costUsd?: number;
}
interface FillInfo { label: string; count: number; note: string; truncated: boolean; costUsd: number | null }

export default function RuleDialog({ rule, industries, defaultIndustry, onClose, onSaved, onCreated }: {
  rule: RuleLite | null;
  industries: IndustryOpt[];
  defaultIndustry: string;
  onClose: () => void;
  onSaved: () => void;
  /** เรียกเมื่อบันทึกกฎแล้วแต่หน้าต่างยังเปิดอยู่ (ยังเหลือกฎที่ AI เสนอจากเอกสารเดียวกัน) */
  onCreated?: () => void;
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

  const fileRef = useRef<HTMLInputElement>(null);
  const [aiUrl, setAiUrl] = useState("");
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState("");
  const [aiInfo, setAiInfo] = useState<FillInfo | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [savedIdx, setSavedIdx] = useState<number[]>([]);

  useEffect(() => {
    if (!rule) return;
    void (async () => {
      const { ok, data } = await api<{ versions: VersionRow[] }>(`/api/compliance/rules/${rule.id}`);
      if (ok && Array.isArray(data.versions)) setVersions(data.versions);
    })();
  }, [rule]);

  function currentDraft(dropped: FillDroppedField[]): Draft {
    return {
      industrySel, industryNew, code, title, description, ruleType, severity, terms, guidance,
      sourceName, sourceRef, sourceUrl, effectiveDate, dropped,
    };
  }

  function loadDraft(d: Draft) {
    setIndustrySel(d.industrySel); setIndustryNew(d.industryNew); setCode(d.code); setTitle(d.title);
    setDescription(d.description); setRuleType(d.ruleType); setSeverity(d.severity); setTerms(d.terms);
    setGuidance(d.guidance); setSourceName(d.sourceName); setSourceRef(d.sourceRef); setSourceUrl(d.sourceUrl);
    setEffectiveDate(d.effectiveDate);
  }

  /** สลับไปดูกฎข้ออื่นที่ AI เสนอ — เก็บค่าที่แก้ในฟอร์มของข้อปัจจุบันไว้ก่อน */
  function switchDraft(idx: number) {
    if (idx === activeIdx || !drafts[idx] || savedIdx.includes(idx)) return;
    const next = drafts.map((d, i) => (i === activeIdx && !savedIdx.includes(i) ? currentDraft(d.dropped) : d));
    setDrafts(next);
    setActiveIdx(idx);
    loadDraft(next[idx]);
  }

  function pickFile(file: File | null) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (file.size > FILL_FILE_MAX_BYTES) { toast.error("ไฟล์ใหญ่เกิน 25 MB"); return; }
    setAiFile(file);
  }

  /** ข้อความของไฟล์ อ่านในเบราว์เซอร์ · null = ผู้ใช้ไม่ให้ AI อ่านรูป และไฟล์ไม่มีข้อความอื่น */
  async function readFileText(file: File): Promise<string | null> {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (ext === "doc") return readLegacyDocText(new Uint8Array(await file.arrayBuffer()));
    if (isImageFile(file)) {
      if (!window.confirm(`"${file.name}" เป็นรูป ต้องให้ AI ถอดข้อความก่อน (มีค่าใช้จ่าย AI เพิ่ม 1 ครั้ง)\nให้ AI อ่านรูปนี้หรือไม่?`)) return null;
      setAiProgress(`AI กำลังอ่านรูป ${file.name}…`);
      return readImageFileWithAI(file, null);
    }
    const extracted = await extractRestrictionFileText(file);
    const imagePages = extracted.imagePages ?? [];
    if (!imagePages.length) return extracted.text;
    const pagesToRead = imagePages.slice(0, FILL_SCAN_PAGES_MAX);
    const askScan = `"${file.name}" มี ${imagePages.length} หน้าที่เนื้อหาอยู่ในรูป (สแกน)\n`
      + `ให้ AI ถอดข้อความ ${pagesToRead.length} หน้า${imagePages.length > pagesToRead.length ? "แรก" : ""}หรือไม่? (มีค่าใช้จ่าย AI ต่อหน้า)`
      + (extracted.text ? "\nกด Cancel = ใช้เฉพาะข้อความที่อ่านได้อยู่แล้ว" : "");
    if (!window.confirm(askScan)) return extracted.text || null;
    const { text, failedPages } = await readImagePagesWithAI({
      file, extracted, pagesToRead, projectId: null,
      onProgress: (done, total) => setAiProgress(`AI กำลังอ่านหน้าสแกน ${done}/${total} หน้า…`),
    });
    if (failedPages.length) toast.warning(`อ่านรูปหน้า ${failedPages.join(", ")} ไม่สำเร็จ ข้อความส่วนอื่นยังอยู่ครบ`);
    if (imagePages.length > pagesToRead.length) {
      toast.warning(`อ่านรูปเฉพาะ ${pagesToRead.length} หน้าแรก เหลือ ${imagePages.length - pagesToRead.length} หน้าที่ยังไม่ได้อ่าน`);
    }
    return text;
  }

  /** ให้ AI อ่านลิงก์หรือไฟล์ แล้วกรอกฟอร์ม — ยังไม่บันทึก คนต้องตรวจแล้วกดเพิ่มกฎเอง */
  async function runFill() {
    const link = aiUrl.trim();
    if (aiBusy || (!aiFile && !link)) return;
    setAiBusy(true);
    try {
      const industry = industrySel === NEW_INDUSTRY ? "" : industrySel;
      let payload: Record<string, string>;
      if (aiFile) {
        setAiProgress(`กำลังอ่าน ${aiFile.name}…`);
        const text = await readFileText(aiFile);
        if (text === null) return;
        if (text.trim().length < 30) {
          toast.error("อ่านข้อความจากไฟล์นี้ได้น้อยเกินไป — ถ้าเป็นไฟล์สแกน ให้กดอีกครั้งแล้วยอมให้ AI อ่านรูป");
          return;
        }
        payload = { text: text.slice(0, FILL_SEND_MAX_CHARS), fileName: aiFile.name, industry };
      } else {
        payload = { url: link, industry };
      }
      setAiProgress("AI กำลังอ่านและสรุปเป็นกฎ… (ราว 10–60 วินาที)");
      const { ok, data } = await api<FillResponse>("/api/compliance/rules/ai-fill", { method: "POST", body: JSON.stringify(payload) });
      if (!ok) { toast.error(data.error || "AI อ่านไม่สำเร็จ", { duration: 9000 }); return; }
      const rules = Array.isArray(data.rules) ? data.rules : [];
      setAiInfo({
        label: data.source?.label || aiFile?.name || link,
        count: rules.length,
        note: typeof data.note === "string" ? data.note : "",
        truncated: data.truncated === true,
        costUsd: typeof data.costUsd === "number" ? data.costUsd : null,
      });
      if (!rules.length) {
        toast.info("AI ไม่พบข้อกำหนดที่ทำเป็นกฎได้ในเอกสารนี้ — ฟอร์มไม่ถูกเปลี่ยน");
        return;
      }
      const next: Draft[] = rules.map((r) => ({
        industrySel: r.industry && industries.some((i) => i.key === r.industry) ? r.industry : industrySel,
        industryNew,
        code: r.code || "", title: r.title, description: r.description, ruleType: r.ruleType, severity: r.severity,
        terms: (r.terms ?? []).join("\n"), guidance: r.guidance, sourceName: r.sourceName, sourceRef: r.sourceRef,
        sourceUrl: r.sourceUrl, effectiveDate: r.effectiveDate, dropped: Array.isArray(r.dropped) ? r.dropped : [],
      }));
      setDrafts(next);
      setSavedIdx([]);
      setActiveIdx(0);
      loadDraft(next[0]);
      toast.success(next.length > 1 ? `AI กรอกให้แล้ว — พบ ${next.length} ข้อ ตรวจและบันทึกทีละข้อ` : "AI กรอกให้แล้ว — ตรวจก่อนกดเพิ่มกฎ");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "อ่านไฟล์ไม่สำเร็จ", { duration: 9000 });
    } finally {
      setAiBusy(false);
      setAiProgress("");
    }
  }

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
    // ยังเหลือกฎที่ AI เสนอจากเอกสารเดียวกัน → เปิดข้อถัดไปต่อ ไม่ปิดหน้าต่าง
    if (!editing && drafts.length) {
      const saved = savedIdx.includes(activeIdx) ? savedIdx : [...savedIdx, activeIdx];
      const nextIdx = drafts.findIndex((_, i) => !saved.includes(i));
      if (nextIdx >= 0) {
        setSavedIdx(saved);
        setActiveIdx(nextIdx);
        loadDraft(drafts[nextIdx]);
        onCreated?.();
        toast.success(`เพิ่มกฎเป็นฉบับร่างแล้ว — เหลืออีก ${drafts.length - saved.length} ข้อจากเอกสารนี้`);
        return;
      }
    }
    toast.success(editing ? "บันทึกเวอร์ชันใหม่แล้ว" : "เพิ่มกฎเป็นฉบับร่างแล้ว");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !aiBusy) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? `แก้ไขกฎ ${rule!.code}` : "เพิ่มกฎ"}</DialogTitle></DialogHeader>
        {!editing && (
          <div className="space-y-2.5 rounded-2xl border border-gray-100 bg-gray-50 p-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-navy">
                <Sparkles className="h-4 w-4" aria-hidden="true" />ให้ AI อ่านแล้วกรอกให้
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                วางลิงก์ประกาศ/กฎหมาย หรือแนบไฟล์ (PDF, Word, Excel, CSV, รูป) — AI เสนอค่าในฟอร์ม คุณตรวจแล้วกดเพิ่มกฎเอง
              </p>
            </div>
            {aiFile ? (
              <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                <Paperclip className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{aiFile.name}</span>
                <button
                  type="button" aria-label="เอาไฟล์ออก" disabled={aiBusy} onClick={() => setAiFile(null)}
                  className="shrink-0 rounded-full p-0.5 text-gray-500 hover:text-red-600 disabled:opacity-50"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <Input
                aria-label="ลิงก์ที่จะให้ AI อ่าน" value={aiUrl} disabled={aiBusy} maxLength={2000}
                onChange={(e) => setAiUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runFill(); } }}
                placeholder="วางลิงก์ประกาศหรือกฎหมาย เช่น https://…"
              />
            )}
            <input
              ref={fileRef} type="file" className="hidden" accept={FILL_FILE_ACCEPT}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={aiBusy} onClick={() => fileRef.current?.click()}>
                <Paperclip className="mr-1.5 h-4 w-4" aria-hidden="true" />{aiFile ? "เปลี่ยนไฟล์" : "แนบไฟล์"}
              </Button>
              <Button type="button" disabled={aiBusy || (!aiFile && !aiUrl.trim())} onClick={() => void runFill()}>
                {aiBusy
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                ให้ AI อ่านแล้วกรอก
              </Button>
            </div>
            <div aria-live="polite" className="space-y-1.5 text-xs">
              {aiBusy && aiProgress && <p className="text-gray-600">{aiProgress}</p>}
              {!aiBusy && aiInfo && (
                <>
                  <p className={aiInfo.count ? "text-emerald-700" : "text-amber-700"}>
                    {aiInfo.count
                      ? `อ่าน ${aiInfo.label} แล้ว — พบ ${aiInfo.count} ข้อ ตรวจทุกช่องก่อนบันทึก AI อาจสรุปคลาดเคลื่อนได้`
                      : `อ่าน ${aiInfo.label} แล้ว — ไม่พบข้อกำหนดที่ทำเป็นกฎได้`}
                    {aiInfo.costUsd !== null ? ` · ค่า AI รอบนี้ ≈ ${fmtCost(aiInfo.costUsd)}` : ""}
                  </p>
                  {aiInfo.note && <p className="text-gray-600">หมายเหตุจาก AI: {aiInfo.note}</p>}
                  {aiInfo.truncated && <p className="text-amber-700">เอกสารยาวเกิน AI อ่านเฉพาะช่วงต้น — กฎในช่วงท้ายอาจไม่ถูกเสนอ</p>}
                </>
              )}
              {!aiBusy && drafts[activeIdx] && drafts[activeIdx].dropped.length > 0 && !savedIdx.includes(activeIdx) && (
                <p className="text-amber-700">
                  ไม่ได้กรอก {drafts[activeIdx].dropped.map((f) => DROPPED_LABEL[f]).join(", ")} — ค่าที่ AI ตอบมาไม่พบในเอกสาร กรุณากรอกเอง
                </p>
              )}
            </div>
            {drafts.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="กฎที่ AI เสนอจากเอกสารนี้">
                {drafts.map((d, i) => {
                  const saved = savedIdx.includes(i);
                  const active = i === activeIdx;
                  return (
                    <button
                      key={i} type="button" disabled={saved || aiBusy || saving} aria-pressed={active}
                      onClick={() => switchDraft(i)} title={d.title}
                      className={`inline-flex max-w-[15rem] items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                        saved ? "border-gray-100 bg-gray-50 text-gray-500"
                          : active ? "border-brand-navy bg-white font-semibold text-brand-navy"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`}
                    >
                      {saved && <Check className="h-3 w-3 shrink-0 text-emerald-700" aria-hidden="true" />}
                      <span className="truncate">ข้อ {i + 1} · {(active && !saved ? title : d.title) || "ไม่มีชื่อ"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
          <Button variant="outline" onClick={onClose} disabled={saving || aiBusy}>{savedIdx.length ? "ปิด" : "ยกเลิก"}</Button>
          <Button onClick={save} disabled={saving || aiBusy}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {editing ? "บันทึก (เวอร์ชันใหม่)" : "เพิ่มกฎ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
