"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUIMode } from "@/contexts/UIModeContext";
import { SimpleArticleCards } from "@/components/simple/SimpleArticleCards";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FunnelBadge } from "@/components/shared/FunnelBadge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { Search, ExternalLink, Table as TableIcon, Kanban, PieChart, Zap, UserCheck, Trash2, CheckCircle, X, Loader2 } from "lucide-react";
import type { ArticleStatus, FunnelStage } from "@/types";
import { ArticleKanban } from "@/components/professional/ArticleKanban";
import { ArticleFunnelBoard } from "@/components/professional/ArticleFunnelBoard";
import { toast } from "sonner";

interface ArticleRow {
  id: string;
  title: string;
  status: string;
  funnelStage: string;
  updatedAt: Date;
  project: { id: string; name: string };
  keyword?: { keyword: string } | null;
  assignedTo?: { name: string | null } | null;
  reviewer?: { name: string | null } | null;
  createdBy?: { name: string | null } | null;
}

interface Props {
  articles: ArticleRow[];
  projects: { id: string; name: string }[];
  users?: { id: string; name: string | null }[];
}

const ALL_STATUSES: ArticleStatus[] = [
  "NEW","KEYWORD_RESEARCHING","KEYWORD_DONE","CONTENT_MAP_DONE","OUTLINE_GENERATING","OUTLINE_DONE",
  "OUTLINE_APPROVED","ARTICLE_GENERATING","ARTICLE_DONE","IMAGE_PROMPT_DONE","SEO_REVIEW",
  "REVISION_REQUIRED","APPROVED","WORDPRESS_DRAFTED","POSTED","ERROR",
];

type ProView = "table" | "kanban" | "funnel";

export function ArticlesTable({ articles, projects, users = [] }: Props) {
  const { mode } = useUIMode();
  const [proView, setProView] = useState<ProView>("table");

  if (mode === "simple") {
    return <SimpleArticleCards articles={articles} projects={projects} users={users} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: "table",  label: "Table",  icon: TableIcon },
          { key: "kanban", label: "Kanban", icon: Kanban },
          { key: "funnel", label: "Funnel", icon: PieChart },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setProView(key as ProView)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              proView === key ? "bg-green-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {proView === "table"  && <ProfessionalTable articles={articles} projects={projects} users={users} />}
      {proView === "kanban" && <ArticleKanban articles={articles} />}
      {proView === "funnel" && <ArticleFunnelBoard articles={articles} />}
    </div>
  );
}

function ProfessionalTable({
  articles,
  projects,
  users,
}: {
  articles: ArticleRow[];
  projects: { id: string; name: string }[];
  users: { id: string; name: string | null }[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [funnelFilter, setFunnelFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showAssignPicker, setShowAssignPicker] = useState(false);

  const filtered = useMemo(() => {
    return articles.filter((a) => {
      if (q && !a.title.toLowerCase().includes(q.toLowerCase())) return false;
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (funnelFilter !== "ALL" && a.funnelStage !== funnelFilter) return false;
      if (projectFilter !== "ALL" && a.project.id !== projectFilter) return false;
      return true;
    });
  }, [articles, q, statusFilter, funnelFilter, projectFilter]);

  const allChecked = filtered.length > 0 && filtered.every((a) => selected.has(a.id));
  const someChecked = selected.size > 0;

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function bulkAction(action: string, extra?: Record<string, unknown>) {
    setBulkLoading(true);
    try {
      const res = await fetch("/api/articles/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, articleIds: Array.from(selected), ...extra }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "เกิดข้อผิดพลาด"); return; }

      if (action === "auto-run") {
        const ok = data.results?.filter((r: { ok: boolean }) => r.ok).length ?? 0;
        toast.success(`Auto Run เสร็จ ${ok}/${selected.size} บทความ`);
      } else if (action === "delete") {
        toast.success(`ลบ ${data.deleted} บทความแล้ว`);
      } else if (action === "assign") {
        toast.success(`Assign แล้ว ${selected.size} บทความ`);
      } else {
        toast.success("ดำเนินการเสร็จแล้ว");
      }

      setSelected(new Set());
      router.refresh();
    } finally {
      setBulkLoading(false);
      setShowAssignPicker(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100">
      {/* Filters */}
      <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="ค้นหาบทความ..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="ทุกโปรเจ็กต์" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">ทุกโปรเจ็กต์</SelectItem>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={funnelFilter} onValueChange={setFunnelFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Funnel" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">ทุก Funnel</SelectItem>
            <SelectItem value="TOFU">TOFU</SelectItem>
            <SelectItem value="MOFU">MOFU</SelectItem>
            <SelectItem value="BOFU">BOFU</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="ทุกสถานะ" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">ทุกสถานะ</SelectItem>
            {ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="self-center text-sm text-gray-500">{filtered.length} รายการ</span>
      </div>

      {/* Bulk action bar */}
      {someChecked && (
        <div className="px-4 py-2.5 bg-gray-900 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-white">{selected.size} บทความที่เลือก</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button
              onClick={() => bulkAction("auto-run")}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {bulkLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Auto Run ทั้งหมด
            </button>
            <button
              onClick={() => bulkAction("approve-outline")}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approve Outline
            </button>
            <button
              onClick={() => bulkAction("approve-article")}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approve บทความ
            </button>

            {/* Assign picker */}
            <div className="relative">
              <button
                onClick={() => setShowAssignPicker((v) => !v)}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                <UserCheck className="h-3.5 w-3.5" />
                Assign
              </button>
              {showAssignPicker && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <p className="text-xs font-semibold text-gray-500">เลือกผู้รับผิดชอบ</p>
                  </div>
                  {users.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => bulkAction("assign", { assignedToId: u.id })}
                      className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      {u.name ?? u.id}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => { if (confirm(`ลบ ${selected.size} บทความ?`)) bulkAction("delete"); }}
              disabled={bulkLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              ลบ
            </button>
            <button onClick={() => setSelected(new Set())} className="text-gray-400 hover:text-white transition-colors ml-1">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
              />
            </TableHead>
            <TableHead>ชื่อบทความ</TableHead>
            <TableHead>โปรเจ็กต์</TableHead>
            <TableHead>Keyword</TableHead>
            <TableHead>Funnel</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead>ผู้เขียน</TableHead>
            <TableHead>อัปเดต</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12 text-gray-400">
                ไม่พบบทความที่ตรงกับการค้นหา
              </TableCell>
            </TableRow>
          )}
          {filtered.map((article) => (
            <TableRow
              key={article.id}
              className={`group ${selected.has(article.id) ? "bg-green-50" : ""}`}
            >
              <TableCell>
                <input
                  type="checkbox"
                  checked={selected.has(article.id)}
                  onChange={() => toggleOne(article.id)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                />
              </TableCell>
              <TableCell>
                <Link href={`/articles/${article.id}`} className="flex items-center gap-1.5 font-medium text-gray-900 hover:text-green-700 group-hover:underline max-w-xs">
                  <span className="truncate">{article.title}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-100" />
                </Link>
              </TableCell>
              <TableCell className="text-sm text-gray-600">{article.project.name}</TableCell>
              <TableCell className="text-sm text-gray-500 max-w-32 truncate">{article.keyword?.keyword ?? "—"}</TableCell>
              <TableCell><FunnelBadge stage={article.funnelStage as FunnelStage} /></TableCell>
              <TableCell><StatusBadge status={article.status as ArticleStatus} /></TableCell>
              <TableCell className="text-sm text-gray-600">{article.assignedTo?.name ?? "—"}</TableCell>
              <TableCell className="text-sm text-gray-400">{formatDate(article.updatedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
