"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { FunnelBadge } from "@/components/ui/FunnelBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDistanceToNow } from "date-fns";

type ArticleKeyword = {
  id: string;
  keyword: string;
  funnelStage: string;
} | null;

type Article = {
  id: string;
  title: string;
  slug: string;
  status: string;
  funnelStage: string;
  searchIntent: string;
  updatedAt: Date;
  keyword: ArticleKeyword;
  assignedTo: { name: string | null } | null;
};

type Project = {
  id: string;
  name: string;
};

type Props = {
  project: Project;
  articles: Article[];
  userId: string;
};

const STATUS_OPTIONS = [
  "ALL", "NEW", "OUTLINE_DONE", "OUTLINE_APPROVED",
  "ARTICLE_GENERATING", "ARTICLE_DONE", "SEO_REVIEW",
  "REVISION_REQUIRED", "APPROVED", "WORDPRESS_DRAFTED", "POSTED", "ERROR",
];

const FUNNEL_OPTIONS = ["ALL", "TOFU", "MOFU", "BOFU"];

export default function ProjectArticlesClient({ project, articles: initialArticles, userId }: Props) {
  const router = useRouter();
  const [articles] = useState(initialArticles);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [funnelFilter, setFunnelFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [generatingOutline, setGeneratingOutline] = useState<string | null>(null);
  const [generatingArticle, setGeneratingArticle] = useState<string | null>(null);

  const filtered = articles.filter((a) => {
    const matchStatus = statusFilter === "ALL" || a.status === statusFilter;
    const matchFunnel = funnelFilter === "ALL" || a.funnelStage === funnelFilter;
    const matchSearch = a.title.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchFunnel && matchSearch;
  });

  async function generateOutline(articleId: string) {
    setGeneratingOutline(articleId);
    try {
      await fetch("/api/ai/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId, userId }),
      });
      router.refresh();
    } finally {
      setGeneratingOutline(null);
    }
  }

  async function generateArticle(articleId: string) {
    setGeneratingArticle(articleId);
    try {
      await fetch("/api/ai/article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId, userId }),
      });
      router.refresh();
    } finally {
      setGeneratingArticle(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border p-5">
        <div className="text-sm text-gray-500 mb-2">
          <Link href="/dashboard" className="hover:text-green-600">Projects</Link>
          {" / "}
          <Link href={`/projects/${project.id}`} className="hover:text-green-600">{project.name}</Link>
          {" / "}
          <span className="text-gray-900">Articles</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Articles</h1>
            <p className="text-sm text-gray-500 mt-1">{articles.length} article{articles.length !== 1 ? "s" : ""}</p>
          </div>
          <Link
            href={`/articles/new?projectId=${project.id}`}
            className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Article
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === "ALL" ? "All Statuses" : s.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select
          value={funnelFilter}
          onChange={(e) => setFunnelFilter(e.target.value)}
          className="px-3 py-2 border border-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
        >
          {FUNNEL_OPTIONS.map((f) => (
            <option key={f} value={f}>{f === "ALL" ? "All Funnels" : f}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search articles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="📝"
          title="No articles found"
          description="Create your first article or adjust filters."
        />
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Title</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Keyword</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Funnel</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Writer</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Updated</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((article) => (
                  <tr key={article.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${project.id}/articles/${article.id}`}
                        className="font-medium text-gray-900 hover:text-green-700 line-clamp-2 max-w-xs"
                      >
                        {article.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-500">
                        {article.keyword?.keyword ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <FunnelBadge stage={article.funnelStage} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={article.status} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-500">
                        {article.assignedTo?.name ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(article.updatedAt), { addSuffix: true })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/projects/${project.id}/articles/${article.id}`}
                          className="text-xs text-green-600 hover:text-green-700 font-medium"
                        >
                          Open
                        </Link>
                        <button
                          onClick={() => generateOutline(article.id)}
                          disabled={generatingOutline === article.id}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                        >
                          {generatingOutline === article.id ? "..." : "Outline"}
                        </button>
                        <button
                          onClick={() => generateArticle(article.id)}
                          disabled={generatingArticle === article.id}
                          className="text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50"
                        >
                          {generatingArticle === article.id ? "..." : "Article"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
