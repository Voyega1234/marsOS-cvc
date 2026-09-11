"use client";

import { useState } from "react";
import { Check, Globe, Loader2, ScanSearch } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { BusinessSkillDraft, BusinessSkillScanResult } from "@/lib/business-skill-scan";
import { BUSINESS_SKILL_CARDS, RISK_OPTIONS } from "./constants";
import type { BusinessSkillData, FieldValues } from "./types";

export type ScanMergeMode = "fill-empty" | "overwrite";

const NEW_NAME = "Business Skill ใหม่";

function isBlank(v: unknown) {
  return typeof v !== "string" || !v.trim();
}

/** คีย์หลักของแถวในการ์ดที่เพิ่มแถวได้ ใช้กันแถวซ้ำตอนเติมต่อท้าย */
function rowKey(cardKey: string, row: FieldValues) {
  const card = BUSINESS_SKILL_CARDS.find((c) => c.key === cardKey);
  const first = card?.fields[0]?.key;
  return first ? (row[first] ?? "").trim().toLowerCase() : "";
}

/**
 * รวมผลสแกนเข้ากับฟอร์มปัจจุบัน
 * - fill-empty: เติมเฉพาะช่องที่ยังว่าง การ์ดแบบหลายแถวเติมต่อท้ายเฉพาะแถวที่ยังไม่มี
 *   Risk Level ขยับขึ้นได้อย่างเดียว ไม่ลดความเสี่ยงที่ทีมตั้งไว้
 * - overwrite: ใช้ค่าจากเว็บทับช่องที่สแกนเจอ ช่องที่สแกนไม่เจอยังเก็บค่าเดิมไว้
 *   การ์ดแบบหลายแถวแทนที่ทั้งชุดเมื่อสแกนเจออย่างน้อยหนึ่งแถว
 * Status ของชุดไม่แตะเสมอ
 */
export function mergeScanIntoSkill(
  current: BusinessSkillData,
  scanned: BusinessSkillDraft,
  mode: ScanMergeMode
): BusinessSkillData {
  const next: BusinessSkillData = { ...current };
  const overwrite = mode === "overwrite";

  if (scanned.industry && (overwrite || isBlank(current.industry))) next.industry = scanned.industry;
  if (overwrite) next.riskLevel = scanned.riskLevel;
  else if (RISK_OPTIONS.indexOf(scanned.riskLevel) > RISK_OPTIONS.indexOf(current.riskLevel)) {
    next.riskLevel = scanned.riskLevel;
  }

  for (const card of BUSINESS_SKILL_CARDS) {
    const key = card.key as keyof BusinessSkillDraft;
    if (card.repeatable) {
      const have = ((current as any)[key] ?? []) as FieldValues[];
      const got = ((scanned as any)[key] ?? []) as FieldValues[];
      if (got.length === 0) continue;
      if (overwrite || have.length === 0) {
        (next as any)[key] = got.map((r) => ({ ...r }));
      } else {
        const seen = new Set(have.map((r) => rowKey(card.key, r)).filter(Boolean));
        const extra = got.filter((r) => {
          const k = rowKey(card.key, r);
          return k && !seen.has(k);
        });
        (next as any)[key] = [...have, ...extra.map((r) => ({ ...r }))];
      }
    } else {
      const have = ((current as any)[key] ?? {}) as FieldValues;
      const got = ((scanned as any)[key] ?? {}) as FieldValues;
      const merged: FieldValues = { ...have };
      for (const [k, v] of Object.entries(got)) {
        if (isBlank(v)) continue;
        if (overwrite || isBlank(have[k])) merged[k] = v;
      }
      (next as any)[key] = merged;
    }
  }
  return next;
}

/** ชื่อ/คำอธิบายชุด — เปลี่ยนให้เฉพาะตอนที่ยังเป็นค่าตั้งต้น */
export function suggestNaming(
  name: string,
  description: string,
  scan: BusinessSkillScanResult
): { name: string; description: string } {
  const blankName = !name.trim() || name.trim() === NEW_NAME;
  return {
    name: blankName && scan.businessName ? `Business Skill — ${scan.businessName}` : name,
    description: !description.trim() && scan.summary ? scan.summary : description,
  };
}

function countFilled(d: BusinessSkillDraft) {
  let fields = 0;
  let rows = 0;
  for (const card of BUSINESS_SKILL_CARDS) {
    const v = (d as any)[card.key];
    if (card.repeatable) rows += (v as FieldValues[]).length;
    else fields += Object.keys(v as FieldValues).length;
  }
  return { fields, rows };
}

/**
 * วางลิงก์เว็บลูกค้า → ระบบอ่านเว็บแล้วร่างฟอร์ม Business Skill ให้
 * ผลเป็นร่าง ทีมเลือกวิธีรวมแล้วแก้ต่อได้ทุกช่องก่อนกดบันทึก
 */
export function BusinessSkillScanCard({
  projectId,
  initialUrl,
  onApply,
}: {
  /** null = ขอบเขต Studio (ต้องวางลิงก์เอง) */
  projectId: string | null;
  initialUrl?: string;
  onApply: (scan: BusinessSkillScanResult, mode: ScanMergeMode) => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BusinessSkillScanResult | null>(null);
  const [mode, setMode] = useState<ScanMergeMode>("fill-empty");
  const [showDetail, setShowDetail] = useState(false);

  async function scan() {
    if (!url.trim() && !projectId) {
      toast.error("วางลิงก์เว็บไซต์ก่อนสแกน");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/prompts/business-skill-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() || undefined, projectId: projectId ?? undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setResult(body as BusinessSkillScanResult);
      if (!url.trim()) setUrl((body as BusinessSkillScanResult).url);
      toast.success("สแกนเสร็จแล้ว — ตรวจแล้วกดนำไปใส่ในฟอร์ม");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    onApply(result, mode);
    toast.success("ใส่ข้อมูลลงฟอร์มแล้ว — ตรวจ แก้ได้ทุกช่อง แล้วกดบันทึก");
  }

  const filled = result ? countFilled(result.draft) : null;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex items-center gap-2">
        <ScanSearch className="size-3.5 text-indigo-500" />
        <span className="text-sm font-semibold text-brand-navy">กรอกอัตโนมัติจากเว็บไซต์</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        วางลิงก์เว็บลูกค้า ระบบจะอ่านหน้าแรก เกี่ยวกับเรา บริการ ติดต่อ แล้วร่างฟอร์มด้านล่างให้ แก้ต่อได้ทุกช่อง
        {projectId && " — เว้นว่างไว้ = ใช้เว็บที่ตั้งไว้ในโปรเจกต์"}
      </p>

      <div className="mt-2 flex gap-2">
        <div className="relative flex-1">
          <Globe className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && scan()}
            placeholder="https://example.com"
            className="h-9 w-full rounded-md border border-gray-200 bg-white pl-8 pr-2 text-sm focus:border-indigo-300 focus:outline-none"
          />
        </div>
        <Button size="sm" className="h-9 gap-1.5" disabled={busy} onClick={scan}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
          {busy ? "กำลังสแกน" : "สแกน"}
        </Button>
      </div>
      {busy && <p className="mt-2 text-xs text-gray-400">กำลังอ่านเว็บและร่างข้อมูล ใช้เวลาประมาณ 1-3 นาที</p>}

      {result && filled && (
        <div className="mt-3 space-y-2 border-t border-indigo-100 pt-3">
          <div className="text-sm font-medium text-brand-navy">
            {result.businessName || "ไม่ระบุชื่อธุรกิจ"}
            {result.draft.industry && <span className="text-xs font-normal text-gray-400"> · {result.draft.industry}</span>}
          </div>
          {result.summary && <p className="text-xs text-gray-600">{result.summary}</p>}
          <p className="text-xs text-gray-500">
            ร่างได้ {filled.fields} ช่อง + {filled.rows} แถว (บริการ {result.draft.productsServices.length} ·
            claim {result.draft.approvedClaims.length} · ข้อห้าม {result.draft.prohibitedClaims.length} ·
            แหล่งอ้างอิง {result.draft.officialSources.length}) · Risk {result.draft.riskLevel}
          </p>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "fill-empty"} onChange={() => setMode("fill-empty")} />
              เติมเฉพาะช่องที่ยังว่าง (แนะนำ)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} />
              ทับด้วยข้อมูลจากเว็บ
            </label>
          </div>

          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
            Claim และแหล่งอ้างอิงที่ร่างให้เป็นสถานะ Draft ทุกแถว — ต้องตรวจกับเว็บจริงและให้ผู้รับผิดชอบอนุมัติก่อนใช้
          </p>

          {result.warnings.length > 0 && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700">ข้อควรทราบ: {result.warnings.join(" · ")}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={apply}>
              <Check className="size-3.5" /> นำไปใส่ในฟอร์ม
            </Button>
            <button type="button" onClick={() => setShowDetail((v) => !v)} className="text-xs text-gray-400 hover:text-gray-600">
              {showDetail ? "ซ่อนหน้าที่อ่าน" : "ดูหน้าที่อ่าน"}
            </button>
          </div>

          {showDetail && (
            <div className="space-y-1 rounded-md bg-white p-2 text-xs text-gray-600">
              <ul className="space-y-0.5">
                {result.evidence.pages.map((p) => (
                  <li key={p.url} className="truncate">
                    · {p.title || p.url} {p.words > 0 && <span className="text-gray-400">({p.words} คำ)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
