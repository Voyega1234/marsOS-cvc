"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Zap, CheckCircle2, AlertCircle, Info, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/shared/LoadingState";
import { safeJson } from "@/lib/utils";

interface AuditBreakdown {
  seo: number;
  aiSearch: number;
  eeat: number;
  ux: number;
  conversion: number;
}

interface AuditResults {
  scoreOutOf10: number;
  breakdown: AuditBreakdown;
  criticalGaps: string[];
  recommendations: string[];
  fixApplied?: boolean;
}

interface Props {
  articleId: string;
  auditScore?: number | null;
  auditResultsJson?: string | null;
  hasHtmlContent: boolean;
}

function ScoreRing({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 8 ? "#16a34a" : score >= 6 ? "#d97706" : "#dc2626";
  const radius = 40;
  const circ = 2 * Math.PI * radius;
  const dash = (pct / 100) * circ;

  return (
    <div className="relative w-28 h-28 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold" style={{ color }}>{score}</span>
        <span className="text-xs text-gray-400">/10</span>
      </div>
    </div>
  );
}

function BreakdownBar({ label, value, max = 2 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-24 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-8 text-right">{value.toFixed(1)}/{max}</span>
    </div>
  );
}

export function ArticleAuditPanel({ articleId, auditScore, auditResultsJson, hasHtmlContent }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState<"audit" | "fix" | null>(null);

  const audit = safeJson<AuditResults | null>(auditResultsJson, null);

  async function runAudit() {
    if (!hasHtmlContent) {
      toast.error("ต้องสร้างบทความก่อนถึงจะ Audit ได้");
      return;
    }
    setRunning("audit");
    try {
      const res = await fetch(`/api/articles/${articleId}/audit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Audit ไม่สำเร็จ");
        if (data.code === "NO_PROMPT") {
          toast.info("เพิ่ม Prompt ประเภท ARTICLE_AUDIT_PROMPT ใน Prompt Library ก่อน", { duration: 6000 });
        }
        return;
      }
      toast.success(`Audit เสร็จสิ้น — คะแนน ${data.audit?.scoreOutOf10}/10`);
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setRunning(null);
    }
  }

  async function runFix() {
    if (!audit) {
      toast.error("ต้อง Audit ก่อนถึงจะ Fix ได้");
      return;
    }
    setRunning("fix");
    try {
      const res = await fetch(`/api/articles/${articleId}/fix`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Fix ไม่สำเร็จ");
        if (data.code === "NO_PROMPT") {
          toast.info("เพิ่ม Prompt ประเภท ARTICLE_FIX_PROMPT ใน Prompt Library ก่อน", { duration: 6000 });
        }
        return;
      }
      toast.success("แก้ไขบทความเสร็จสิ้น — ได้คะแนน 10/10!");
      router.refresh();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900 text-base">AI Content Audit</h3>
          <p className="text-xs text-gray-500 mt-0.5">ตรวจสอบคุณภาพบทความและให้คะแนน 1-10 ตามมาตรฐาน SEO + E-E-A-T + AI Search</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={runAudit}
            disabled={running !== null || !hasHtmlContent}
            size="sm"
            className="bg-[#1A1A1A] hover:bg-[#2D2D2D] gap-1.5"
          >
            {running === "audit" ? <LoadingSpinner className="border-white" /> : <Sparkles className="h-3.5 w-3.5" />}
            {audit ? "Re-Audit" : "Run Audit"}
          </Button>
          {audit && !audit.fixApplied && (
            <Button
              onClick={runFix}
              disabled={running !== null}
              size="sm"
              className="bg-[#1A1A1A] hover:bg-[#2D2D2D] gap-1.5"
            >
              {running === "fix" ? <LoadingSpinner className="border-white" /> : <Zap className="h-3.5 w-3.5" />}
              Auto Fix to 10/10
            </Button>
          )}
          {audit?.fixApplied && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
              <CheckCircle2 className="h-3.5 w-3.5" />Fixed — 10/10
            </span>
          )}
        </div>
      </div>

      {!hasHtmlContent && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <Info className="h-4 w-4 flex-shrink-0" />
          สร้างบทความ HTML ก่อน แล้วค่อยรัน Audit
        </div>
      )}

      {/* Score + breakdown */}
      {audit && (
        <div className="border rounded-xl p-5 space-y-5">
          {/* Score row */}
          <div className="flex items-center gap-6">
            <ScoreRing score={audit.scoreOutOf10} />
            <div className="flex-1 space-y-3">
              <p className="text-sm font-semibold text-gray-700">คะแนนรวม: {audit.scoreOutOf10}/10</p>
              <BreakdownBar label="SEO Technical"       value={audit.breakdown.seo}        />
              <BreakdownBar label="AI Search Ready"     value={audit.breakdown.aiSearch}   />
              <BreakdownBar label="E-E-A-T Quality"     value={audit.breakdown.eeat}       />
              <BreakdownBar label="UX & Readability"    value={audit.breakdown.ux}         />
              <BreakdownBar label="Conversion & Intent" value={audit.breakdown.conversion} />
            </div>
          </div>

          {/* Gaps */}
          {audit.criticalGaps?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-red-400" />จุดที่ต้องแก้ไข
              </p>
              <ul className="space-y-1.5">
                {audit.criticalGaps.map((gap, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-red-400 mt-0.5 flex-shrink-0">✗</span>
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {audit.recommendations?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-green-500" />คำแนะนำ
              </p>
              <ul className="space-y-1.5">
                {audit.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">→</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!audit && hasHtmlContent && (
        <div className="border-2 border-dashed border-gray-100 rounded-xl p-10 text-center">
          <Sparkles className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-400 text-sm">กด "Run Audit" เพื่อตรวจสอบคุณภาพบทความ</p>
          <p className="text-gray-300 text-xs mt-1">AI จะให้คะแนน 1-10 พร้อมระบุจุดที่ต้องแก้ไข</p>
        </div>
      )}
    </div>
  );
}
