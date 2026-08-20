"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import type {
  SeoCheckCategory,
  SeoCheckTemplateTask,
  SeoTaskArea,
  SeoTaskPriority,
} from "@/lib/seo-check-templates";
import { notifySeoTaskChange, useSeoTaskSync } from "./useSeoTaskSync";

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export type SeoTaskStatus = "TODO" | "IN_PROGRESS" | "WAITING_APPROVAL" | "DONE" | "IGNORED";

export interface SeoTask {
  id: string;
  area: SeoTaskArea;
  category: string;
  title: string;
  detail: string | null;
  url: string | null;
  status: SeoTaskStatus;
  priority: SeoTaskPriority;
  owner: { id: string; name: string | null } | null;
  dueDate: string | null;
  evidence: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeoTaskStats {
  total: number;
  done: number;
  open: number;
}

interface Props {
  projectId: string;
  area: SeoTaskArea;
  categories: SeoCheckCategory[];
  templates: Record<string, SeoCheckTemplateTask[]>;
  readOnly: boolean;
  onStatsChange?: (stats: SeoTaskStats) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Display metadata
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_META: Record<SeoTaskStatus, { label: string; badge: string; dot: string }> = {
  TODO: { label: "ยังไม่เริ่ม", badge: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
  IN_PROGRESS: { label: "กำลังทำ", badge: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  WAITING_APPROVAL: { label: "รออนุมัติ", badge: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  DONE: { label: "เสร็จแล้ว", badge: "bg-green-100 text-green-700", dot: "bg-green-500" },
  IGNORED: { label: "ข้าม", badge: "bg-gray-100 text-gray-400", dot: "bg-gray-300" },
};

const STATUS_ORDER: SeoTaskStatus[] = ["TODO", "IN_PROGRESS", "WAITING_APPROVAL", "DONE", "IGNORED"];

const PRIORITY_META: Record<SeoTaskPriority, { label: string; badge: string }> = {
  LOW: { label: "ต่ำ", badge: "bg-gray-100 text-gray-600" },
  MEDIUM: { label: "ปานกลาง", badge: "bg-blue-100 text-blue-700" },
  HIGH: { label: "สูง", badge: "bg-amber-100 text-amber-700" },
  CRITICAL: { label: "วิกฤต", badge: "bg-red-100 text-red-700" },
};

const PRIORITY_ORDER: SeoTaskPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function isOpen(status: SeoTaskStatus) {
  return status !== "DONE" && status !== "IGNORED";
}

// งานที่ถูกสร้างไว้ตอนที่ชุดหมวดยังเป็นเวอร์ชันก่อน จะไม่ตรงกับ categories ชุดใหม่
// เก็บไว้ในหมวดรวมแทนที่จะปล่อยให้หายไปจากหน้าจอทั้งที่ยังอยู่ใน DB
const LEGACY_CATEGORY_ID = "__legacy";

const LEGACY_CATEGORY: SeoCheckCategory = {
  id: LEGACY_CATEGORY_ID,
  label: "หมวดเดิม",
  desc: "งานที่สร้างไว้ก่อนปรับชุดหมวดตรวจ — ย้ายหรือปิดงานได้ตามต้องการ",
};

function formatDateTh(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

function toDateInputValue(iso: string | null) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main component
// ─────────────────────────────────────────────────────────────────────────────

export function SeoTaskChecklist({ projectId, area, categories, templates, readOnly, onStatsChange }: Props) {
  const [tasks, setTasks] = useState<SeoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("overview");
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [evidencePromptTask, setEvidencePromptTask] = useState<SeoTask | null>(null);
  const [seedingTemplates, setSeedingTemplates] = useState(false);
  const instanceId = useId(); // กันไม่ให้ตัวเอง refetch ซ้ำจาก event ที่ตัวเองแจ้ง

  const fetchTasks = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/seo-tasks?area=${area}`);
      if (!res.ok) throw new Error("โหลดรายการงานไม่สำเร็จ");
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : "โหลดรายการงานไม่สำเร็จ");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [projectId, area]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // sync ข้ามหน้า/แท็บ/หน้าต่าง — refetch เงียบ ๆ ไม่ให้ skeleton กระพริบ
  const quietRefetch = useCallback(() => fetchTasks(true), [fetchTasks]);
  useSeoTaskSync(projectId, quietRefetch, instanceId);

  const stats = useMemo<SeoTaskStats>(() => {
    const done = tasks.filter((t) => t.status === "DONE").length;
    const open = tasks.filter((t) => isOpen(t.status)).length;
    return { total: tasks.length, done, open };
  }, [tasks]);

  useEffect(() => {
    onStatsChange?.(stats);
  }, [stats, onStatsChange]);

  const knownCategoryIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);

  /** งานที่หมวดไม่อยู่ในชุดปัจจุบัน ให้ตกลงถังรวมแทนที่จะหายไปเงียบ ๆ */
  const bucketOf = useCallback(
    (task: SeoTask) => (knownCategoryIds.has(task.category) ? task.category : LEGACY_CATEGORY_ID),
    [knownCategoryIds]
  );

  const hasLegacyTasks = useMemo(() => tasks.some((t) => !knownCategoryIds.has(t.category)), [tasks, knownCategoryIds]);

  const displayCategories = useMemo(
    () => (hasLegacyTasks ? [...categories, LEGACY_CATEGORY] : categories),
    [categories, hasLegacyTasks]
  );

  const categoryOpenCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of displayCategories) map[c.id] = 0;
    for (const t of tasks) {
      const bucket = bucketOf(t);
      if (bucket in map && isOpen(t.status)) map[bucket] += 1;
    }
    return map;
  }, [tasks, displayCategories, bucketOf]);

  const categoryTotals = useMemo(() => {
    const map: Record<string, { total: number; done: number }> = {};
    for (const c of displayCategories) map[c.id] = { total: 0, done: 0 };
    for (const t of tasks) {
      const bucket = bucketOf(t);
      if (!(bucket in map)) continue;
      map[bucket].total += 1;
      if (t.status === "DONE") map[bucket].done += 1;
    }
    return map;
  }, [tasks, displayCategories, bucketOf]);

  const drawerTask = useMemo(() => tasks.find((t) => t.id === drawerTaskId) ?? null, [tasks, drawerTaskId]);

  // section อาจค้างอยู่ที่หมวดที่หายไปแล้ว (เช่นเคลียร์งานเดิมหมด) — ตกกลับไปหน้าภาพรวม
  const activeCategory = useMemo(
    () => (section === "overview" ? null : displayCategories.find((c) => c.id === section) ?? null),
    [section, displayCategories]
  );

  // ── mutations ──────────────────────────────────────────────────────────────

  async function createTask(payload: {
    category: string;
    title: string;
    detail?: string;
    url?: string;
    priority?: SeoTaskPriority;
  }) {
    try {
      const res = await fetch(`/api/projects/${projectId}/seo-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, ...payload }),
      });
      if (!res.ok) throw new Error("เพิ่มงานไม่สำเร็จ");
      toast.success("เพิ่มงานแล้ว");
      await fetchTasks();
      notifySeoTaskChange(projectId, instanceId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "เพิ่มงานไม่สำเร็จ");
    }
  }

  async function bulkCreate(items: Array<{ category: string; title: string; detail?: string; url?: string; priority?: SeoTaskPriority }>) {
    if (items.length === 0) {
      toast.info("มีงานครบตาม template แล้ว");
      return;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/seo-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: items.map((t) => ({ area, ...t })) }),
      });
      if (!res.ok) throw new Error("เพิ่มงานจาก template ไม่สำเร็จ");
      const data = await res.json();
      toast.success(`เพิ่มงานจาก template แล้ว ${data.count ?? items.length} รายการ`);
      await fetchTasks();
      notifySeoTaskChange(projectId, instanceId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "เพิ่มงานจาก template ไม่สำเร็จ");
    }
  }

  async function patchTask(taskId: string, patch: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/seo-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("บันทึกไม่สำเร็จ");
      const updated = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      notifySeoTaskChange(projectId, instanceId);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      return false;
    }
  }

  async function deleteTask(taskId: string) {
    try {
      const res = await fetch(`/api/seo-tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("ลบไม่สำเร็จ");
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (drawerTaskId === taskId) setDrawerTaskId(null);
      toast.success("ลบงานแล้ว");
      notifySeoTaskChange(projectId, instanceId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  function handleStatusChange(task: SeoTask, newStatus: SeoTaskStatus) {
    if (newStatus === "DONE" && task.status !== "DONE") {
      setEvidencePromptTask(task);
      return;
    }
    patchTask(task.id, { status: newStatus });
  }

  function handlePriorityCycle(task: SeoTask) {
    const idx = PRIORITY_ORDER.indexOf(task.priority);
    const next = PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length];
    patchTask(task.id, { priority: next });
  }

  async function seedAllTemplates() {
    const items: Array<{ category: string; title: string; detail?: string; url?: string; priority?: SeoTaskPriority }> = [];
    for (const cat of categories) {
      for (const tpl of templates[cat.id] ?? []) {
        items.push({ category: cat.id, title: tpl.title, detail: tpl.detail, priority: tpl.priority });
      }
    }
    setSeedingTemplates(true);
    await bulkCreate(items);
    setSeedingTemplates(false);
  }

  function seedCategoryTemplates(categoryId: string) {
    const existingTitles = new Set(
      tasks.filter((t) => t.category === categoryId).map((t) => t.title.trim().toLowerCase())
    );
    const missing = (templates[categoryId] ?? []).filter((tpl) => !existingTitles.has(tpl.title.trim().toLowerCase()));
    bulkCreate(missing.map((tpl) => ({ category: categoryId, title: tpl.title, detail: tpl.detail, priority: tpl.priority })));
  }

  // ── render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return <ChecklistSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
        <button
          type="button"
          onClick={() => fetchTasks()}
          className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {/* Left vertical rail */}
      <div className="w-[210px] shrink-0 space-y-1">
        <RailItem
          label="ภาพรวม"
          active={section === "overview"}
          badge={stats.open}
          onClick={() => setSection("overview")}
        />
        <div className="my-2 border-t border-gray-100" />
        {displayCategories.map((cat) => (
          <RailItem
            key={cat.id}
            label={cat.label}
            active={section === cat.id}
            badge={categoryOpenCount[cat.id] ?? 0}
            onClick={() => setSection(cat.id)}
          />
        ))}
      </div>

      {/* Right content */}
      <div className="min-w-0 flex-1">
        {activeCategory === null ? (
          <OverviewSection
            tasks={tasks}
            categories={displayCategories}
            categoryTotals={categoryTotals}
            stats={stats}
            readOnly={readOnly}
            seedingTemplates={seedingTemplates}
            onSeedAll={seedAllTemplates}
            onJumpToCategory={setSection}
            onOpenTask={setDrawerTaskId}
          />
        ) : (
          <CategorySection
            category={activeCategory}
            tasks={tasks.filter((t) => bucketOf(t) === activeCategory.id)}
            hasTemplates={(templates[activeCategory.id] ?? []).length > 0}
            readOnly={readOnly}
            // หมวดรวมของงานเดิมไม่ใช่หมวดจริง จึงสร้างงานใหม่เข้าไปไม่ได้
            canAdd={activeCategory.id !== LEGACY_CATEGORY_ID}
            onCreateTask={(payload) => createTask({ category: activeCategory.id, ...payload })}
            onSeedTemplates={() => seedCategoryTemplates(activeCategory.id)}
            onStatusChange={handleStatusChange}
            onPriorityCycle={handlePriorityCycle}
            onDelete={deleteTask}
            onOpenTask={setDrawerTaskId}
          />
        )}
      </div>

      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          readOnly={readOnly}
          onClose={() => setDrawerTaskId(null)}
          onSave={async (patch) => {
            const ok = await patchTask(drawerTask.id, patch);
            if (ok) setDrawerTaskId(null);
          }}
        />
      )}

      {evidencePromptTask && (
        <EvidencePromptModal
          onCancel={() => setEvidencePromptTask(null)}
          onSubmit={async (evidence) => {
            await patchTask(evidencePromptTask.id, { status: "DONE", ...(evidence ? { evidence } : {}) });
            setEvidencePromptTask(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Left rail item
// ─────────────────────────────────────────────────────────────────────────────

function RailItem({ label, active, badge, onClick }: { label: string; active: boolean; badge: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
        active ? "bg-indigo-50 font-semibold text-indigo-700" : "text-gray-600 hover:bg-gray-50"
      }`}
    >
      <span className="truncate">{label}</span>
      {badge > 0 && (
        <span
          className={`ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            active ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-500"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Overview section
// ─────────────────────────────────────────────────────────────────────────────

function OverviewSection({
  tasks,
  categories,
  categoryTotals,
  stats,
  readOnly,
  seedingTemplates,
  onSeedAll,
  onJumpToCategory,
  onOpenTask,
}: {
  tasks: SeoTask[];
  categories: SeoCheckCategory[];
  categoryTotals: Record<string, { total: number; done: number }>;
  stats: SeoTaskStats;
  readOnly: boolean;
  seedingTemplates: boolean;
  onSeedAll: () => void;
  onJumpToCategory: (id: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const nonIgnoredTotal = tasks.filter((t) => t.status !== "IGNORED").length;
  const pct = nonIgnoredTotal > 0 ? Math.round((stats.done / nonIgnoredTotal) * 100) : 0;

  const statusCounts = useMemoStatusCounts(tasks);

  const urgentTasks = tasks
    .filter((t) => isOpen(t.status) && (t.priority === "CRITICAL" || t.priority === "HIGH"))
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "CRITICAL" ? -1 : 1));

  if (stats.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <ListChecks className="mb-3 h-10 w-10 text-gray-300" />
        <p className="text-sm font-medium text-gray-700">ยังไม่มีงานในรายการนี้</p>
        <p className="mt-1 text-xs text-gray-400">เริ่มต้นได้เร็วขึ้นด้วย checklist ต้นแบบที่เตรียมไว้ให้</p>
        {!readOnly && (
          <button
            type="button"
            onClick={onSeedAll}
            disabled={seedingTemplates}
            className="mt-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {seedingTemplates ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            เริ่มต้นจาก Template Checklist
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:col-span-1">
          <ProgressRing pct={pct} />
          <div>
            <p className="text-2xl font-bold text-brand-navy">{pct}%</p>
            <p className="text-xs text-gray-500">เสร็จแล้ว {stats.done} จาก {nonIgnoredTotal} งาน</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:col-span-2 md:grid-cols-5">
          {STATUS_ORDER.map((s) => (
            <div key={s} className="rounded-2xl border border-gray-200 bg-white p-3 text-center shadow-sm">
              <p className="text-lg font-bold text-brand-navy">{statusCounts[s] ?? 0}</p>
              <p className="mt-0.5 text-[11px] text-gray-500">{STATUS_META[s].label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-brand-navy">ความคืบหน้าตามหมวด</p>
        <div className="space-y-2">
          {categories.map((cat) => {
            const t = categoryTotals[cat.id] ?? { total: 0, done: 0 };
            const catPct = t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onJumpToCategory(cat.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-gray-50"
              >
                <span className="w-36 shrink-0 truncate text-xs text-gray-600">{cat.label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${catPct}%` }} />
                </span>
                <span className="w-14 shrink-0 text-right text-xs text-gray-500">{t.done}/{t.total}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-brand-navy">งานสำคัญที่ยังไม่เสร็จ (สูง/วิกฤต)</p>
        {urgentTasks.length === 0 ? (
          <p className="text-xs text-gray-400">ไม่มีงานสำคัญค้างอยู่ในตอนนี้</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {urgentTasks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOpenTask(t.id)}
                  className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{t.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_META[t.priority].badge}`}>
                    {PRIORITY_META[t.priority].label}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_META[t.status].badge}`}>
                    {STATUS_META[t.status].label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function useMemoStatusCounts(tasks: SeoTask[]) {
  return useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of STATUS_ORDER) map[s] = 0;
    for (const t of tasks) map[t.status] = (map[t.status] ?? 0) + 1;
    return map;
  }, [tasks]);
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="#4f46e5"
        strokeWidth="6"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Category section
// ─────────────────────────────────────────────────────────────────────────────

function CategorySection({
  category,
  tasks,
  hasTemplates,
  readOnly,
  canAdd = true,
  onCreateTask,
  onSeedTemplates,
  onStatusChange,
  onPriorityCycle,
  onDelete,
  onOpenTask,
}: {
  category: SeoCheckCategory;
  tasks: SeoTask[];
  hasTemplates: boolean;
  readOnly: boolean;
  canAdd?: boolean;
  onCreateTask: (payload: { title: string; detail?: string; url?: string; priority?: SeoTaskPriority }) => void;
  onSeedTemplates: () => void;
  onStatusChange: (task: SeoTask, status: SeoTaskStatus) => void;
  onPriorityCycle: (task: SeoTask) => void;
  onDelete: (taskId: string) => void;
  onOpenTask: (id: string) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [url, setUrl] = useState("");
  const [priority, setPriority] = useState<SeoTaskPriority>("MEDIUM");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function submitAddForm() {
    if (!title.trim()) return;
    onCreateTask({ title: title.trim(), detail: detail.trim() || undefined, url: url.trim() || undefined, priority });
    setTitle("");
    setDetail("");
    setUrl("");
    setPriority("MEDIUM");
    setShowAddForm(false);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-brand-navy">{category.label}</p>
            <p className="mt-0.5 text-xs text-gray-500">{category.desc}</p>
          </div>
          {!readOnly && canAdd && (
            <div className="flex shrink-0 items-center gap-2">
              {hasTemplates && (
                <button
                  type="button"
                  onClick={onSeedTemplates}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  เพิ่มจาก template
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <Plus className="h-3.5 w-3.5" />
                เพิ่มงาน
              </button>
            </div>
          )}
        </div>

        {showAddForm && !readOnly && (
          <div className="mt-4 space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ชื่องาน"
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
            />
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="รายละเอียด (ไม่บังคับ)"
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="URL (ไม่บังคับ)"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
              />
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as SeoTaskPriority)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
              >
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>{PRIORITY_META[p].label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={submitAddForm}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                บันทึก
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        {tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            ยังไม่มีงานในหมวดนี้
            {!readOnly && canAdd && hasTemplates && (
              <button
                type="button"
                onClick={onSeedTemplates}
                className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                เพิ่มจาก template
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => onOpenTask(t.id)}
                  className="min-w-[180px] flex-1 text-left text-sm text-gray-800 hover:text-indigo-600"
                >
                  {t.title}
                  {t.url && (
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="ml-2 inline-flex items-center text-gray-400 hover:text-indigo-600"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </button>

                {t.dueDate && (
                  <span className="shrink-0 text-xs text-gray-400">{formatDateTh(t.dueDate)}</span>
                )}

                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => !readOnly && onPriorityCycle(t)}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_META[t.priority].badge} ${readOnly ? "" : "cursor-pointer hover:opacity-80"}`}
                >
                  {PRIORITY_META[t.priority].label}
                </button>

                <select
                  value={t.status}
                  disabled={readOnly}
                  onChange={(e) => onStatusChange(t, e.target.value as SeoTaskStatus)}
                  className={`shrink-0 rounded-full border-0 px-2 py-1 text-[11px] font-medium ${STATUS_META[t.status].badge} disabled:appearance-none`}
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>{STATUS_META[s].label}</option>
                  ))}
                </select>

                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(t.id)}
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirmDeleteId && (
        <ConfirmDeleteModal
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => {
            onDelete(confirmDeleteId);
            setConfirmDeleteId(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Task drawer
// ─────────────────────────────────────────────────────────────────────────────

function TaskDrawer({
  task,
  readOnly,
  onClose,
  onSave,
}: {
  task: SeoTask;
  readOnly: boolean;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [detail, setDetail] = useState(task.detail ?? "");
  const [url, setUrl] = useState(task.url ?? "");
  const [priority, setPriority] = useState<SeoTaskPriority>(task.priority);
  const [status, setStatus] = useState<SeoTaskStatus>(task.status);
  const [dueDate, setDueDate] = useState(toDateInputValue(task.dueDate));
  const [evidence, setEvidence] = useState(task.evidence ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDetail(task.detail ?? "");
    setUrl(task.url ?? "");
    setPriority(task.priority);
    setStatus(task.status);
    setDueDate(toDateInputValue(task.dueDate));
    setEvidence(task.evidence ?? "");
  }, [task]);

  async function handleSave() {
    setSaving(true);
    await onSave({
      title: title.trim() || task.title,
      detail: detail.trim() || null,
      url: url.trim() || null,
      priority,
      status,
      dueDate: dueDate || null,
      evidence: evidence.trim() || null,
    });
    setSaving(false);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h3 className="text-base font-semibold text-brand-navy">รายละเอียดงาน</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">ชื่องาน</label>
            <input
              type="text"
              value={title}
              disabled={readOnly}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">รายละเอียด</label>
            <textarea
              value={detail}
              disabled={readOnly}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">URL</label>
            <input
              type="text"
              value={url}
              disabled={readOnly}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">สถานะ</label>
              <select
                value={status}
                disabled={readOnly}
                onChange={(e) => setStatus(e.target.value as SeoTaskStatus)}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">ความสำคัญ</label>
              <select
                value={priority}
                disabled={readOnly}
                onChange={(e) => setPriority(e.target.value as SeoTaskPriority)}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
              >
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>{PRIORITY_META[p].label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">กำหนดส่ง</label>
            <input
              type="date"
              value={dueDate}
              disabled={readOnly}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">หลักฐาน / บันทึก</label>
            <textarea
              value={evidence}
              disabled={readOnly}
              onChange={(e) => setEvidence(e.target.value)}
              rows={2}
              placeholder="ลิงก์หรือบันทึกหลักฐานการแก้ไข"
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
            />
          </div>

          {task.owner && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">ผู้รับผิดชอบ</label>
              <p className="text-sm text-gray-800">{task.owner.name ?? "-"}</p>
            </div>
          )}

          {!readOnly && (
            <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Small modals
// ─────────────────────────────────────────────────────────────────────────────

function EvidencePromptModal({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (evidence: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
        <p className="text-sm font-semibold text-brand-navy">ทำเครื่องหมายว่าเสร็จแล้ว</p>
        <p className="mt-1 text-xs text-gray-500">แนบลิงก์หรือบันทึกหลักฐาน (ไม่บังคับ)</p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="URL หรือบันทึกหลักฐาน"
          className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSubmit(value.trim())}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            บันทึก
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
        <p className="text-sm font-semibold text-brand-navy">ลบงานนี้?</p>
        <p className="mt-1 text-xs text-gray-500">การลบไม่สามารถย้อนกลับได้</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
          >
            ลบ
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Skeleton
// ─────────────────────────────────────────────────────────────────────────────

function ChecklistSkeleton() {
  return (
    <div className="flex gap-4">
      <div className="w-[210px] shrink-0 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
      <div className="flex-1 space-y-4">
        <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
      </div>
    </div>
  );
}
