"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Search, Plus, Loader2, Zap, Map, ChevronDown, ChevronUp, Trash2, FileText, ChevronRight,
} from "lucide-react";
import { FunnelBadge } from "@/components/ui/FunnelBadge";

type Keyword = {
  id: string;
  projectId: string;
  seedKeyword: string;
  keyword: string;
  relatedKeywords: string;
  intent: string;
  funnelStage: string;
  priority: number;
  volume: number | null;
  difficulty: number | null;
  status: string;
  createdAt: Date;
};

type Props = {
  project: { id: string; name: string };
  keywords: Keyword[];
  userId: string;
};

const INTENT_COLORS: Record<string, string> = {
  INFORMATIONAL: "bg-blue-100 text-blue-700",
  COMMERCIAL: "bg-amber-100 text-amber-700",
  TRANSACTIONAL: "bg-green-100 text-green-700",
  NAVIGATIONAL: "bg-gray-100 text-gray-600",
};

function DifficultyBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>;
  const color = value > 60 ? "text-red-600 font-semibold" : value > 35 ? "text-amber-600 font-semibold" : "text-green-600 font-semibold";
  const label = value > 60 ? "Hard" : value > 35 ? "Medium" : "Easy";
  return <span className={color}>{value} <span className="text-xs font-normal">({label})</span></span>;
}

// ─── Group keywords by seedKeyword ────────────────────────────────────────────
type KeywordGroup = {
  seed: string        // Page Title (H1)
  volume: number      // Highest SV in group
  keywords: Keyword[] // all members
  topIntent: string
  topFunnel: string
}

function groupKeywords(kws: Keyword[]): KeywordGroup[] {
  const map: Record<string, Keyword[]> = {}
  for (const kw of kws) {
    const key = kw.seedKeyword || kw.keyword
    if (!map[key]) map[key] = []
    map[key].push(kw)
  }
  return Object.entries(map).map(([seed, members]: [string, Keyword[]]) => {
    const maxVol = Math.max(0, ...members.map((k: Keyword) => k.volume ?? 0))
    const top = members.find((k: Keyword) => (k.volume ?? 0) === maxVol) ?? members[0]
    return {
      seed,
      volume: maxVol,
      keywords: members,
      topIntent: top.intent,
      topFunnel: top.funnelStage,
    } as KeywordGroup
  }).sort((a: KeywordGroup, b: KeywordGroup) => b.volume - a.volume)
}

export default function KeywordsClient({ project, keywords: initialKeywords, userId }: Props) {
  const router = useRouter();
  const [keywords, setKeywords] = useState(initialKeywords);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(seed: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(seed)) next.delete(seed)
      else next.add(seed)
      return next
    })
  }

  // Single keyword input
  const [singleInput, setSingleInput] = useState("");
  const [singleAdding, setSingleAdding] = useState(false);

  // Bulk input
  const [bulkText, setBulkText] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

  // Content map generation
  const [generatingMap, setGeneratingMap] = useState(false);

  async function researchSingle(e: React.FormEvent) {
    e.preventDefault();
    const seed = singleInput.trim();
    if (!seed) return;
    setSingleAdding(true);
    try {
      const res = await fetch("/api/ai/keyword-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, seedKeyword: seed }),
      });
      if (!res.ok) throw new Error();
      const { keyword } = await res.json();
      setKeywords((prev) => [keyword, ...prev]);
      setSingleInput("");
      toast.success(`วิจัย "${keyword.keyword}" สำเร็จ`);
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setSingleAdding(false);
    }
  }

  async function runBulkResearch() {
    const seeds = bulkText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (seeds.length === 0) return;
    setBulkRunning(true);
    setBulkProgress({ current: 0, total: seeds.length });
    const newKeywords: Keyword[] = [];
    for (let i = 0; i < seeds.length; i++) {
      setBulkProgress({ current: i + 1, total: seeds.length });
      try {
        const res = await fetch("/api/ai/keyword-research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, seedKeyword: seeds[i] }),
        });
        if (res.ok) {
          const { keyword } = await res.json();
          newKeywords.push(keyword);
        }
      } catch {}
    }
    setKeywords((prev) => [...newKeywords, ...prev]);
    setBulkText("");
    setBulkOpen(false);
    setBulkRunning(false);
    toast.success(`เสร็จแล้ว ${newKeywords.length}/${seeds.length} keywords`);
    router.refresh();
  }

  async function createArticle(kw: Keyword) {
    const res = await fetch("/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        keywordId: kw.id,
        title: kw.keyword,
        slug: kw.keyword.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, ""),
        funnelStage: kw.funnelStage,
        searchIntent: kw.intent,
      }),
    });
    if (res.ok) {
      const art = await res.json();
      router.push(`/articles/${art.id}`);
    } else {
      toast.error("ไม่สามารถสร้างบทความได้");
    }
  }

  async function deleteKeyword(id: string) {
    const res = await fetch(`/api/keywords/${id}`, { method: "DELETE" });
    if (res.ok) {
      setKeywords((prev) => prev.filter((k) => k.id !== id));
      toast.success("ลบ keyword แล้ว");
    }
  }

  async function generateContentMap() {
    const researched = keywords.filter((k) => k.volume !== null || k.status !== "NEW");
    const kwList = researched.length > 0 ? researched.map((k) => k.keyword) : keywords.map((k) => k.keyword);
    if (kwList.length === 0) {
      toast.error("ยังไม่มี keyword — เพิ่มและวิจัยก่อน");
      return;
    }
    setGeneratingMap(true);
    try {
      const res = await fetch("/api/ai/content-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, keywords: kwList }),
      });
      if (!res.ok) throw new Error();
      toast.success("สร้าง Content Map สำเร็จ!");
      router.push(`/projects/${project.id}/content-map`);
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่");
      setGeneratingMap(false);
    }
  }

  const activeKeywords = keywords.filter((k) => k.status !== "EXCLUDED");
  const researchedCount = activeKeywords.filter((k) => k.volume !== null).length;
  const groups = groupKeywords(activeKeywords);

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Header ── */}
      <div>
        <div className="text-sm text-gray-400 mb-2 flex items-center gap-1.5">
          <Link href="/dashboard" className="hover:text-green-600">Projects</Link>
          <span>/</span>
          <Link href={`/projects/${project.id}`} className="hover:text-green-600">{project.name}</Link>
          <span>/</span>
          <span className="text-gray-700">Keywords</span>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Keyword Research</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {activeKeywords.length} keywords · {researchedCount} researched
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${project.id}/content-map`}
              className="flex items-center gap-2 px-4 py-2 border border-gray-100 rounded-xl text-sm font-medium text-gray-700 hover:border-green-500 hover:text-green-700 transition-colors"
            >
              <Map className="h-4 w-4" />
              Content Map
            </Link>
            <button
              onClick={generateContentMap}
              disabled={generatingMap || activeKeywords.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {generatingMap ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {generatingMap ? "กำลังสร้าง..." : "Generate Content Map"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Single keyword research ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-green-600" />
          วิจัย Keyword ใหม่
        </h2>
        <form onSubmit={researchSingle} className="flex gap-2">
          <input
            type="text"
            value={singleInput}
            onChange={(e) => setSingleInput(e.target.value)}
            placeholder="เช่น วีซ่าเชงเก้น, dental implant bangkok, ..."
            className="flex-1 px-4 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            type="submit"
            disabled={singleAdding || !singleInput.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {singleAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {singleAdding ? "วิจัย..." : "Research"}
          </button>
        </form>

        {/* Bulk toggle */}
        <button
          onClick={() => setBulkOpen((v) => !v)}
          className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 hover:text-green-600 transition-colors"
        >
          {bulkOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Bulk Research — วาง keywords หลายตัวพร้อมกัน
        </button>

        {bulkOpen && (
          <div className="mt-3 space-y-3 pt-3 border-t border-gray-100">
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={6}
              placeholder={`วาง seed keywords ทีละบรรทัด เช่น:\nวีซ่าเชงเก้น\nNAATI คืออะไร\nวีซ่าท่องเที่ยวออสเตรเลีย\nแปลเอกสาร NAATI ราคา`}
              className="w-full px-4 py-3 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono resize-y"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {bulkText.split("\n").filter((s) => s.trim()).length} keywords
              </span>
              <button
                onClick={runBulkResearch}
                disabled={bulkRunning || !bulkText.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
              >
                {bulkRunning
                  ? <><Loader2 className="h-4 w-4 animate-spin" />วิจัย {bulkProgress.current}/{bulkProgress.total}...</>
                  : <><Zap className="h-4 w-4" />Research All</>
                }
              </button>
            </div>
            {bulkRunning && (
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all"
                  style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Cannibalization + Cluster warning ── */}
      {activeKeywords.length >= 2 && (() => {
        // Group keywords that share significant overlap (simple: one contains the other)
        const clusters: { seed: string; members: string[] }[] = [];
        const assigned = new Set<string>();

        for (const kw of activeKeywords) {
          if (assigned.has(kw.keyword)) continue;
          const members = activeKeywords.filter((other) => {
            if (other.keyword === kw.keyword) return false;
            const a = kw.keyword.toLowerCase();
            const b = other.keyword.toLowerCase();
            return a.includes(b) || b.includes(a) || (a.split(" ").some((w) => w.length > 3 && b.includes(w)));
          });
          if (members.length > 0) {
            clusters.push({ seed: kw.keyword, members: members.map((m) => m.keyword) });
            assigned.add(kw.keyword);
            members.forEach((m) => assigned.add(m.keyword));
          }
        }

        if (clusters.length === 0) return null;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
            <div className="flex items-start gap-2 mb-3">
              <span className="text-amber-500 text-base mt-0.5">⚠</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">พบ Keyword Cannibalization ที่อาจเกิดขึ้น</p>
                <p className="text-xs text-amber-600 mt-0.5">keywords กลุ่มนี้คล้ายกันมาก อาจแข่งกันเองใน SERP — ควร merge เป็นบทความเดียวหรือแยก cluster ให้ชัด</p>
              </div>
            </div>
            <div className="space-y-2">
              {clusters.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold text-amber-800 bg-amber-100 px-2 py-1 rounded-lg">{c.seed}</span>
                  <span className="text-amber-500">←→</span>
                  {c.members.map((m) => (
                    <span key={m} className="text-amber-700 bg-white border border-amber-200 px-2 py-1 rounded-lg">{m}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Keywords table ── */}
      {activeKeywords.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <div className="text-4xl mb-3">🔑</div>
          <p className="text-gray-500 font-medium">ยังไม่มี keyword</p>
          <p className="text-sm text-gray-400 mt-1">เพิ่ม seed keyword ด้านบนเพื่อเริ่มต้น</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">{groups.length} Keyword Groups · {activeKeywords.length} Keywords</span>
            <span className="text-xs text-gray-400">{researchedCount} researched · {activeKeywords.length - researchedCount} pending</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-6"></th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Page Title (H1)</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Intent</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Funnel</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Highest SV</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">KWs</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {groups.map((group) => {
                  const isOpen = expandedGroups.has(group.seed)
                  const topKw = group.keywords.find(k => (k.volume ?? 0) === group.volume) ?? group.keywords[0]
                  return (
                    <>
                      {/* ── Group row ── */}
                      <tr
                        key={group.seed}
                        className="hover:bg-gray-50/60 transition-colors cursor-pointer group"
                        onClick={() => toggleGroup(group.seed)}
                      >
                        <td className="px-5 py-3.5 text-gray-400">
                          <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-gray-900">{group.seed}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{group.keywords.length} keyword{group.keywords.length > 1 ? 's' : ''} in group</p>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${INTENT_COLORS[group.topIntent] ?? "bg-gray-100 text-gray-600"}`}>
                            {group.topIntent}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          <FunnelBadge stage={group.topFunnel} />
                        </td>
                        <td className="px-4 py-3.5 text-right text-sm font-semibold text-gray-700">
                          {group.volume > 0 ? group.volume.toLocaleString() : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{group.keywords.length}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); createArticle(topKw) }}
                              className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-semibold"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Create Article
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* ── Expanded keywords in group ── */}
                      {isOpen && group.keywords.map((kw) => {
                        let related: string[] = []
                        try { related = JSON.parse(kw.relatedKeywords) } catch {}
                        return (
                          <tr key={kw.id} className="bg-gray-50/50 border-l-2 border-green-200 hover:bg-green-50/30 transition-colors group/kw">
                            <td className="px-5 py-2.5"></td>
                            <td className="px-4 py-2.5 pl-6">
                              <p className="text-sm text-gray-800">{kw.keyword}</p>
                              {related.length > 0 && (
                                <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[300px]" title={related.join(", ")}>
                                  {related.slice(0, 3).join(", ")}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${INTENT_COLORS[kw.intent] ?? "bg-gray-100 text-gray-600"}`}>
                                {kw.intent}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <FunnelBadge stage={kw.funnelStage} />
                            </td>
                            <td className="px-4 py-2.5 text-right text-sm text-gray-600">
                              {kw.volume !== null ? kw.volume.toLocaleString() : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <DifficultyBadge value={kw.difficulty} />
                            </td>
                            <td className="px-5 py-2.5">
                              <div className="flex items-center justify-end gap-2 opacity-0 group-hover/kw:opacity-100 transition-opacity">
                                <button
                                  onClick={() => createArticle(kw)}
                                  className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-semibold"
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                  Article
                                </button>
                                <span className="text-gray-200">|</span>
                                <button
                                  onClick={() => deleteKeyword(kw.id)}
                                  className="text-gray-300 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
