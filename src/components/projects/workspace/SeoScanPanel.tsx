"use client";

/**
 * SeoScanPanel — ปุ่มสแกนเว็บไซต์บนหน้า On-Page SEO / Technical SEO / Indexing
 *
 * สแกนครั้งเดียวได้ผลครบทั้งสามด้าน (ดู src/lib/seo-audit.ts) ผลถูกเก็บไว้ใน
 * แคชระดับโมดูล ทั้งสามหน้าจึงใช้ผลชุดเดียวกันโดยไม่ยิงซ้ำ ทีมเลือกได้ว่าจะ
 * สร้างข้อไหนเป็นงานจริง และยังเพิ่มงานเองได้เหมือนเดิม
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  ScanSearch,
  Wrench,
} from "lucide-react";

import type { SeoCheckCategory, SeoTaskArea, SeoTaskPriority } from "@/lib/seo-check-templates";
import { notifySeoTaskChange } from "./useSeoTaskSync";

interface Finding {
  id: string;
  area: SeoTaskArea;
  category: string;
  title: string;
  detail: string;
  evidence: string;
  priority: SeoTaskPriority;
  severity: "fail" | "warn";
  url?: string;
  count: number;
}

interface ScanResult {
  website: string;
  scannedAt: string;
  pages: Array<{ url: string; wordCount: number }>;
  findings: Finding[];
  passed: Array<{ area: SeoTaskArea; category: string; label: string; evidence: string }>;
  needsTools: Array<{ label: string; reason: string }>;
  warnings: string[];
  stats: { pagesScanned: number; linksChecked: number; brokenLinks: number; durationMs: number };
}

// แคชผลสแกนล่าสุดต่อโปรเจกต์ — สแกนที่หน้าไหนก็ใช้ได้ทั้งสามหน้า
const scanCache = new Map<string, ScanResult>();
const CHANNEL = "seo-scan:done";

const PRIORITY_META: Record<SeoTaskPriority, { label: string; badge: string }> = {
  LOW: { label: "ต่ำ", badge: "bg-gray-100 text-gray-600" },
  MEDIUM: { label: "ปานกลาง", badge: "bg-blue-100 text-blue-700" },
  HIGH: { label: "สูง", badge: "bg-amber-100 text-amber-700" },
  CRITICAL: { label: "วิกฤต", badge: "bg-red-100 text-red-700" },
};

interface Props {
  projectId: string;
  area: SeoTaskArea;
  categories: SeoCheckCategory[];
  readOnly: boolean;
}

export function SeoScanPanel({ projectId, area, categories, readOnly }: Props) {
  const [result, setResult] = useState<ScanResult | null>(() => scanCache.get(projectId) ?? null);
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openEvidence, setOpenEvidence] = useState<Set<string>>(new Set());
  const [showPassed, setShowPassed] = useState(false);

  // หน้าอื่นสแกนเสร็จ — หยิบผลชุดเดียวกันมาแสดงโดยไม่ต้องสแกนซ้ำ
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (detail?.projectId !== projectId) return;
      const cached = scanCache.get(projectId);
      if (cached) setResult(cached);
    };
    window.addEventListener(CHANNEL, handler);
    return () => window.removeEventListener(CHANNEL, handler);
  }, [projectId]);

  const categoryLabel = useCallback(
    (id: string) => categories.find((c) => c.id === id)?.label ?? id,
    [categories]
  );

  const findings = useMemo(
    () => (result?.findings ?? []).filter((f) => f.area === area),
    [result, area]
  );
  const passed = useMemo(
    () => (result?.passed ?? []).filter((p) => p.area === area),
    [result, area]
  );

  async function scan() {
    setScanning(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/seo-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      const data = body as ScanResult;
      scanCache.set(projectId, data);
      setResult(data);
      setSelected(new Set(data.findings.filter((f) => f.area === area).map((f) => f.id)));
      window.dispatchEvent(new CustomEvent(CHANNEL, { detail: { projectId } }));
      toast.success(`สแกนเสร็จ — อ่าน ${data.stats.pagesScanned} หน้า พบ ${data.findings.length} เรื่องที่ควรแก้`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  async function createTasks() {
    const picked = findings.filter((f) => selected.has(f.id));
    if (!picked.length) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/seo-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: picked.map((f) => ({
            area: f.area,
            category: f.category,
            title: f.title,
            detail: f.detail,
            url: f.url ?? null,
            priority: f.priority,
            evidence: f.evidence,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      notifySeoTaskChange(projectId);
      setSelected(new Set());
      toast.success(`สร้างงานจากผลสแกนแล้ว ${body.count ?? picked.length} งาน`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-indigo-500" />
            <h3 className="text-sm font-semibold text-brand-navy">สแกนเว็บไซต์หาสิ่งที่ต้องแก้</h3>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            ระบบ crawl หน้าเว็บจริง อ่าน robots.txt sitemap.xml ตรวจลิงก์เสีย และเรียก PageSpeed Insights
            แล้วบอกว่าต้องแก้อะไรพร้อมหลักฐาน ทีมยังเพิ่มงานเองได้ตามปกติ
          </p>
        </div>
        <button
          onClick={scan}
          disabled={scanning || readOnly}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
          {scanning ? "กำลังสแกน" : result ? "สแกนใหม่" : "สแกนเว็บไซต์"}
        </button>
      </div>

      {scanning && (
        <p className="mt-3 text-xs text-gray-400">
          กำลังไล่อ่านหน้าเว็บและตรวจลิงก์ ใช้เวลาประมาณ 1-3 นาที อย่าปิดหน้านี้
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
            <span>เว็บ {result.website}</span>
            <span>อ่าน {result.stats.pagesScanned} หน้า</span>
            <span>ตรวจลิงก์ {result.stats.linksChecked} ลิงก์</span>
            <span>ใช้เวลา {Math.round(result.stats.durationMs / 1000)} วินาที</span>
            <span>สแกนเมื่อ {new Date(result.scannedAt).toLocaleString("th-TH")}</span>
          </div>

          {findings.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              ด้านนี้ไม่พบปัญหาจากการสแกน
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-gray-600">
                  พบ <span className="font-semibold text-brand-navy">{findings.length}</span> เรื่องที่ควรแก้ในด้านนี้
                  <button
                    onClick={() =>
                      setSelected(selected.size === findings.length ? new Set() : new Set(findings.map((f) => f.id)))
                    }
                    className="ml-3 text-xs text-indigo-600 hover:underline"
                  >
                    {selected.size === findings.length ? "ล้างที่เลือก" : "เลือกทั้งหมด"}
                  </button>
                </div>
                {!readOnly && (
                  <button
                    onClick={createTasks}
                    disabled={creating || selected.size === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    สร้างเป็นงาน ({selected.size})
                  </button>
                )}
              </div>

              <ul className="space-y-2">
                {findings.map((f) => {
                  const open = openEvidence.has(f.id);
                  return (
                    <li key={f.id} className="rounded-xl border border-gray-200 p-3">
                      <div className="flex items-start gap-3">
                        {!readOnly && (
                          <input
                            type="checkbox"
                            checked={selected.has(f.id)}
                            onChange={() => setSelected((s) => toggle(s, f.id))}
                            className="mt-1"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_META[f.priority].badge}`}>
                              {PRIORITY_META[f.priority].label}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                              {categoryLabel(f.category)}
                            </span>
                            {f.severity === "fail" ? (
                              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                            ) : null}
                            <span className="text-sm font-medium text-brand-navy">{f.title}</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">{f.detail}</p>
                          <button
                            onClick={() => setOpenEvidence((s) => toggle(s, f.id))}
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline"
                          >
                            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            หลักฐาน
                          </button>
                          {open && (
                            <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-600">
                              {f.evidence}
                            </pre>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {passed.length > 0 && (
            <div>
              <button
                onClick={() => setShowPassed((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              >
                {showPassed ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                ตรวจแล้วผ่าน {passed.length} ข้อ
              </button>
              {showPassed && (
                <ul className="mt-2 space-y-1">
                  {passed.map((p) => (
                    <li key={`${p.category}-${p.label}`} className="flex items-start gap-2 text-xs text-gray-600">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                      <span>
                        <span className="font-medium">{p.label}</span> — {p.evidence}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {result.needsTools.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <Wrench className="h-3.5 w-3.5" />
                ต้องต่อเครื่องมือเพิ่มถึงจะตรวจได้
              </div>
              <ul className="mt-1.5 space-y-1 text-[11px] text-amber-800">
                {result.needsTools.map((t) => (
                  <li key={t.label}>
                    <span className="font-medium">{t.label}</span> — {t.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.warnings.length > 0 && (
            <p className="text-[11px] text-gray-400">ข้อควรทราบ: {result.warnings.join(" · ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
