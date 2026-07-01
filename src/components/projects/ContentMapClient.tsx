"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Zap, Loader2, CheckSquare, Square, FileText, Map,
  RefreshCw, ChevronDown, ChevronUp, Info,
} from "lucide-react";
import type { ContentMapOutput, ContentMapEntry } from "@/services/ai/types";

type Props = {
  project: { id: string; name: string; website: string };
  contentMap: ContentMapOutput | null;
  existingArticleTitles: string[];
  keywordList: string[];
};

const FUNNEL_CONFIG = {
  TOFU: { label: "TOFU — Top of Funnel", color: "bg-blue-50 border-blue-200", badge: "bg-blue-100 text-blue-700", dot: "bg-blue-400" },
  MOFU: { label: "MOFU — Middle of Funnel", color: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  BOFU: { label: "BOFU — Bottom of Funnel", color: "bg-green-50 border-green-200", badge: "bg-green-100 text-green-700", dot: "bg-green-400" },
} as const;

type FunnelKey = keyof typeof FUNNEL_CONFIG;

function TopicCard({
  entry,
  selected,
  alreadyExists,
  onToggle,
}: {
  entry: ContentMapEntry;
  selected: boolean;
  alreadyExists: boolean;
  onToggle: () => void;
}) {
  const config = FUNNEL_CONFIG[entry.funnelStage as FunnelKey];
  return (
    <div
      onClick={alreadyExists ? undefined : onToggle}
      className={`p-4 rounded-xl border-2 transition-all ${
        alreadyExists
          ? "opacity-50 cursor-not-allowed border-gray-100 bg-gray-50"
          : selected
          ? `cursor-pointer ${config.color} ring-2 ring-offset-1 ring-green-400`
          : `cursor-pointer border-gray-100 bg-white hover:${config.color}`
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">
          {alreadyExists ? (
            <div className="w-5 h-5 rounded bg-gray-200 flex items-center justify-center">
              <span className="text-xs text-gray-500">✓</span>
            </div>
          ) : selected ? (
            <CheckSquare className="w-5 h-5 text-green-600" />
          ) : (
            <Square className="w-5 h-5 text-gray-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm leading-snug">{entry.proposedTitle}</p>
          <p className="text-xs text-gray-500 mt-1">{entry.keyword}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge}`}>
              {entry.funnelStage}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {entry.contentType}
            </span>
            <span className="text-xs text-gray-400">~{entry.wordCountTarget.toLocaleString()} words</span>
            {alreadyExists && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">มีแล้ว</span>}
          </div>
          {entry.notes && (
            <p className="text-xs text-gray-400 mt-1.5 italic">{entry.notes}</p>
          )}
        </div>
        <div className="text-xs text-gray-300 font-medium flex-shrink-0">P{entry.priority}</div>
      </div>
    </div>
  );
}

export default function ContentMapClient({ project, contentMap: initialMap, existingArticleTitles, keywordList }: Props) {
  const router = useRouter();
  const [contentMap, setContentMap] = useState<ContentMapOutput | null>(initialMap);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedStages, setExpandedStages] = useState<Set<FunnelKey>>(new Set<FunnelKey>(["TOFU", "MOFU", "BOFU"]));

  // Build unique IDs for content map entries
  const allEntries = useMemo(() => {
    if (!contentMap) return [];
    return [
      ...(contentMap.tofu ?? []).map((e, i) => ({ ...e, _id: `TOFU-${i}` })),
      ...(contentMap.mofu ?? []).map((e, i) => ({ ...e, _id: `MOFU-${i}` })),
      ...(contentMap.bofu ?? []).map((e, i) => ({ ...e, _id: `BOFU-${i}` })),
    ];
  }, [contentMap]);

  const existingSet = useMemo(
    () => new Set(existingArticleTitles.map((t) => t.toLowerCase())),
    [existingArticleTitles]
  );

  function toggleEntry(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    const ids = allEntries
      .filter((e) => !existingSet.has(e.proposedTitle.toLowerCase()))
      .map((e) => e._id);
    setSelectedIds(new Set(ids));
  }

  function deselectAll() { setSelectedIds(new Set()); }

  function toggleStage(stage: FunnelKey) {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); else next.add(stage);
      return next;
    });
  }

  async function generateMap() {
    if (keywordList.length === 0) {
      toast.error("ยังไม่มี keyword — ไปเพิ่มที่หน้า Keywords ก่อน");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/content-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, keywords: keywordList }),
      });
      if (!res.ok) throw new Error();
      const { contentMap: cm } = await res.json();
      setContentMap(cm);
      setSelectedIds(new Set());
      toast.success("สร้าง Content Map ใหม่เรียบร้อย!");
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setGenerating(false);
    }
  }

  async function createSelectedArticles() {
    const toCreate = allEntries.filter((e) => selectedIds.has(e._id));
    if (toCreate.length === 0) return;
    setCreating(true);
    let createdCount = 0;
    let lastId: string | null = null;
    for (const entry of toCreate) {
      try {
        const res = await fetch("/api/articles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            title: entry.proposedTitle,
            slug: entry.proposedTitle.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "").slice(0, 80),
            funnelStage: entry.funnelStage,
            searchIntent: entry.intent,
          }),
        });
        if (res.ok) {
          const art = await res.json();
          lastId = art.id;
          createdCount++;
        }
      } catch {}
    }
    setCreating(false);
    if (createdCount > 0) {
      toast.success(`สร้าง ${createdCount} บทความเรียบร้อย!`);
      if (createdCount === 1 && lastId) {
        router.push(`/articles/${lastId}`);
      } else {
        router.push(`/projects/${project.id}`);
      }
    } else {
      toast.error("ไม่สามารถสร้างบทความได้");
    }
  }

  const stages: FunnelKey[] = ["TOFU", "MOFU", "BOFU"];
  const stageEntries = (stage: FunnelKey) =>
    allEntries.filter((e) => e.funnelStage === stage);
  const selectedCount = selectedIds.size;
  const totalNew = allEntries.filter((e) => !existingSet.has(e.proposedTitle.toLowerCase())).length;

  return (
    <div className="space-y-5 max-w-5xl">

      {/* Header */}
      <div>
        <div className="text-sm text-gray-400 mb-2 flex items-center gap-1.5">
          <Link href="/dashboard" className="hover:text-green-600">Projects</Link>
          <span>/</span>
          <Link href={`/projects/${project.id}`} className="hover:text-green-600">{project.name}</Link>
          <span>/</span>
          <span className="text-gray-700">Content Map</span>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Map className="h-6 w-6 text-green-600" />
              Content Map
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {contentMap ? `${contentMap.totalArticles} topics` : "ยังไม่ได้สร้าง"} · {project.website}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${project.id}/keywords`}
              className="flex items-center gap-2 px-4 py-2 border border-gray-100 rounded-xl text-sm font-medium text-gray-700 hover:border-green-500 hover:text-green-700 transition-colors"
            >
              Keywords ({keywordList.length})
            </Link>
            <button
              onClick={generateMap}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {generating
                ? <><Loader2 className="h-4 w-4 animate-spin" />กำลังสร้าง...</>
                : contentMap
                ? <><RefreshCw className="h-4 w-4" />Regenerate</>
                : <><Zap className="h-4 w-4" />Generate Content Map</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* No content map yet */}
      {!contentMap && (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <div className="text-5xl mb-4">🗺️</div>
          <h2 className="text-lg font-bold text-gray-900">ยังไม่มี Content Map</h2>
          <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
            {keywordList.length > 0
              ? `มี ${keywordList.length} keywords พร้อมแล้ว — กด "Generate Content Map" เพื่อให้ AI วางแผนหัวข้อบทความ TOFU/MOFU/BOFU`
              : "ยังไม่มี keyword — ไปเพิ่มที่หน้า Keywords ก่อนแล้วค่อยสร้าง Content Map"}
          </p>
          {keywordList.length === 0 && (
            <Link
              href={`/projects/${project.id}/keywords`}
              className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl"
            >
              ไปเพิ่ม Keywords
            </Link>
          )}
        </div>
      )}

      {/* Content map exists — selection bar + kanban */}
      {contentMap && (
        <>
          {/* Selection toolbar */}
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                เลือกแล้ว <strong>{selectedCount}</strong> / {totalNew} หัวข้อ
              </span>
              <button onClick={selectAll} className="text-xs text-green-600 hover:text-green-700 font-medium">เลือกทั้งหมด</button>
              <button onClick={deselectAll} className="text-xs text-gray-400 hover:text-gray-600 font-medium">ยกเลิก</button>
            </div>
            <button
              onClick={createSelectedArticles}
              disabled={selectedCount === 0 || creating}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-40"
            >
              {creating
                ? <><Loader2 className="h-4 w-4 animate-spin" />กำลังสร้าง...</>
                : <><FileText className="h-4 w-4" />สร้างบทความที่เลือก ({selectedCount})</>
              }
            </button>
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 px-1 text-xs text-gray-400">
            <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>บทความที่แสดง "มีแล้ว" คือสร้างไปแล้ว — ติ้กเลือกบทความใหม่แล้วกด "สร้างบทความที่เลือก"</span>
          </div>

          {/* Kanban columns */}
          <div className="space-y-4">
            {stages.map((stage) => {
              const entries = stageEntries(stage);
              const config = FUNNEL_CONFIG[stage];
              const isExpanded = expandedStages.has(stage);
              const stageSelected = entries.filter((e) => selectedIds.has(e._id)).length;

              return (
                <div key={stage} className={`rounded-2xl border-2 ${config.color}`}>
                  <button
                    onClick={() => toggleStage(stage)}
                    className="w-full flex items-center justify-between px-5 py-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${config.dot}`} />
                      <span className="font-bold text-gray-900">{config.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge}`}>
                        {entries.length} topics
                      </span>
                      {stageSelected > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                          เลือก {stageSelected}
                        </span>
                      )}
                    </div>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {entries.length === 0 ? (
                        <p className="text-sm text-gray-400 col-span-2 py-4 text-center">ไม่มีหัวข้อในระดับนี้</p>
                      ) : (
                        entries.map((entry) => (
                          <TopicCard
                            key={entry._id}
                            entry={entry}
                            selected={selectedIds.has(entry._id)}
                            alreadyExists={existingSet.has(entry.proposedTitle.toLowerCase())}
                            onToggle={() => toggleEntry(entry._id)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
