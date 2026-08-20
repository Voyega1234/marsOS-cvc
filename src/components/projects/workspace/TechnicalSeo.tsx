"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";

import type { WorkspaceProject } from "./types";
import {
  TECHNICAL_CATEGORIES,
  TECHNICAL_TEMPLATES,
  type SeoTaskArea,
  type SeoTaskPriority,
} from "@/lib/seo-check-templates";
import { SeoTaskChecklist, type SeoTaskStats } from "./SeoTaskChecklist";
import { notifySeoTaskChange } from "./useSeoTaskSync";

interface Props {
  project: WorkspaceProject;
  userRole: string;
}

type CheckStatus = "pass" | "warn" | "fail";

interface TechCheckResultItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

interface TechCheckResponse {
  checkedAt: string;
  website: string;
  results: TechCheckResultItem[];
}

const EMPTY_STATS: SeoTaskStats = { total: 0, done: 0, open: 0 };

// แผนที่ผลตรวจ → หน้า + หมวดที่งานควรไปอยู่
// ผลตรวจบางข้อไม่ใช่เรื่อง Technical เช่น Title/H1 เป็น On-Page ส่วนเว็บล่ม
// หรือ www ไม่สอดคล้องเป็นเรื่อง Indexing & Crawling — ส่งไปหน้าที่รับผิดชอบจริง
const CHECK_TARGET_MAP: Record<string, { area: SeoTaskArea; category: string }> = {
  "site-reachable": { area: "INDEXING", category: "server-error-5xx" },
  "https-redirect": { area: "TECHNICAL", category: "https-security" },
  "robots-txt": { area: "TECHNICAL", category: "robots" },
  "sitemap-xml": { area: "TECHNICAL", category: "sitemap" },
  "www-consistency": { area: "INDEXING", category: "duplicate-without-canonical" },
  "html-title": { area: "ONPAGE", category: "title-meta" },
  "html-meta-description": { area: "ONPAGE", category: "title-meta" },
  "html-h1": { area: "ONPAGE", category: "heading" },
  "html-viewport": { area: "TECHNICAL", category: "pagespeed" },
  "html-canonical": { area: "TECHNICAL", category: "canonical" },
  "html-lang": { area: "TECHNICAL", category: "language-tag" },
  "html-noindex": { area: "TECHNICAL", category: "robots-tag" },
  "html-checks": { area: "INDEXING", category: "server-error-5xx" },
};

const FALLBACK_TARGET = { area: "TECHNICAL" as SeoTaskArea, category: "robots-tag" };

const AREA_LABELS: Record<SeoTaskArea, string> = {
  ONPAGE: "On-Page SEO",
  TECHNICAL: "Technical SEO",
  INDEXING: "Indexing & Crawling",
};

function priorityForCheck(check: TechCheckResultItem): SeoTaskPriority {
  if (check.id === "html-noindex" && check.status === "fail") return "CRITICAL";
  if (check.status === "fail") return "HIGH";
  return "MEDIUM";
}

const STATUS_STYLE: Record<CheckStatus, { icon: typeof CheckCircle2; badge: string; label: string }> = {
  pass: { icon: CheckCircle2, badge: "text-green-600", label: "ผ่าน" },
  warn: { icon: AlertTriangle, badge: "text-amber-600", label: "ควรแก้ไข" },
  fail: { icon: XCircle, badge: "text-red-600", label: "ไม่ผ่าน" },
};

export function TechnicalSeo({ project, userRole }: Props) {
  const readOnly = userRole === "CLIENT";
  const [stats, setStats] = useState<SeoTaskStats>(EMPTY_STATS);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<TechCheckResponse | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [creatingTasks, setCreatingTasks] = useState(false);
  const [checklistKey, setChecklistKey] = useState(0);
  const displayName = project.clientName ?? project.name;

  const handleStatsChange = useCallback((next: SeoTaskStats) => setStats(next), []);

  async function runCheck() {
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/tech-check`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "ตรวจสอบไม่สำเร็จ");
      }
      const data: TechCheckResponse = await res.json();
      setCheckResult(data);
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "ตรวจสอบไม่สำเร็จ");
    } finally {
      setChecking(false);
    }
  }

  async function createTasksFromCheck() {
    if (!checkResult) return;
    const toCreate = checkResult.results.filter((r) => r.status !== "pass");
    if (toCreate.length === 0) {
      toast.info("ไม่มีปัญหาที่ต้องสร้างงาน");
      return;
    }
    setCreatingTasks(true);
    try {
      const tasks = toCreate.map((r) => {
        const target = CHECK_TARGET_MAP[r.id] ?? FALLBACK_TARGET;
        return {
          area: target.area,
          category: target.category,
          title: `แก้: ${r.label}`,
          detail: r.detail,
          priority: priorityForCheck(r),
        };
      });
      const res = await fetch(`/api/projects/${project.id}/seo-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks }),
      });
      if (!res.ok) throw new Error("สร้างงานจากผลตรวจไม่สำเร็จ");
      const data = await res.json();

      // งานกระจายไปหลายหน้า — บอกให้ชัดว่าไปอยู่ที่ไหนบ้าง ไม่งั้นจะหาไม่เจอ
      const perArea = tasks.reduce<Record<string, number>>((acc, t) => {
        acc[t.area] = (acc[t.area] ?? 0) + 1;
        return acc;
      }, {});
      const breakdown = (Object.keys(AREA_LABELS) as SeoTaskArea[])
        .filter((a) => perArea[a])
        .map((a) => `${AREA_LABELS[a]} ${perArea[a]}`)
        .join(" · ");
      toast.success(`สร้างงานจากผลตรวจแล้ว ${data.count ?? tasks.length} รายการ — ${breakdown}`);
      setChecklistKey((k) => k + 1);
      // งานกระจายไปหลาย area — แจ้ง overview/timeline (รวมถึงแท็บ browser อื่น) ให้ตามทัน
      notifySeoTaskChange(project.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "สร้างงานจากผลตรวจไม่สำเร็จ");
    } finally {
      setCreatingTasks(false);
    }
  }

  const issueCount = checkResult ? checkResult.results.filter((r) => r.status !== "pass").length : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-brand-navy">Technical SEO</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span>{displayName}</span>
            {project.website && (
              <a
                href={project.website}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-indigo-600 hover:underline"
              >
                <Globe className="h-3.5 w-3.5" />
                {project.website}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-gray-500">
            <ListChecks className="h-4 w-4" />
            เปิดอยู่ <span className="font-semibold text-brand-navy">{stats.open}</span>
          </div>
          <div className="text-gray-500">
            เสร็จแล้ว <span className="font-semibold text-green-600">{stats.done}</span> / {stats.total}
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={runCheck}
              disabled={checking}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              ตรวจเว็บเบื้องต้น
            </button>
          )}
        </div>
      </div>

      {checkError && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {checkError}
        </div>
      )}

      {checkResult && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-brand-navy">ผลตรวจเว็บเบื้องต้น</p>
              <p className="text-xs text-gray-400">
                ตรวจล่าสุด {new Date(checkResult.checkedAt).toLocaleString("th-TH")} · {checkResult.website}
              </p>
            </div>
            {!readOnly && issueCount > 0 && (
              <button
                type="button"
                onClick={createTasksFromCheck}
                disabled={creatingTasks}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {creatingTasks ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                สร้างงานจากผลตรวจ ({issueCount})
              </button>
            )}
          </div>
          <ul className="divide-y divide-gray-100">
            {checkResult.results.map((r) => {
              const meta = STATUS_STYLE[r.status];
              const Icon = meta.icon;
              return (
                <li key={r.id} className="flex items-start gap-3 py-2.5">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.badge}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-brand-navy">{r.label}</p>
                    <p className="text-xs text-gray-500">{r.detail}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium ${meta.badge}`}>{meta.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <SeoTaskChecklist
        key={checklistKey}
        projectId={project.id}
        area="TECHNICAL"
        categories={TECHNICAL_CATEGORIES}
        templates={TECHNICAL_TEMPLATES}
        readOnly={readOnly}
        onStatsChange={handleStatsChange}
      />
    </div>
  );
}
