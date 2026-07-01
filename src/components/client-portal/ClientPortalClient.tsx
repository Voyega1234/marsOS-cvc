"use client";

import { useState } from "react";
import { ExternalLink, MessageCircle, CheckCircle2, Clock, FileText, Globe, Eye, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

type Comment = { id: string; body: string; createdAt: string | Date; user: { name: string | null; role: string } };
type Article = {
  id: string;
  title: string;
  slug: string;
  status: string;
  wordpressUrl: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  comments: Comment[];
};
type Project = {
  id: string;
  name: string;
  clientName: string | null;
  website: string | null | undefined;
  status: string;
  articles: Article[];
};

const STATUS_LABEL: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  POSTED:             { label: "เผยแพร่แล้ว",     color: "bg-emerald-100 text-emerald-700",  icon: <Globe size={12}/> },
  WORDPRESS_DRAFTED:  { label: "Draft ใน WP",      color: "bg-sky-100 text-sky-700",          icon: <FileText size={12}/> },
  APPROVED:           { label: "Approved",          color: "bg-teal-100 text-teal-700",        icon: <CheckCircle2 size={12}/> },
  SEO_REVIEW:         { label: "รอรีวิว",           color: "bg-amber-100 text-amber-700",      icon: <Eye size={12}/> },
  REVISION_REQUIRED:  { label: "แก้ไข",             color: "bg-orange-100 text-orange-700",    icon: <RefreshCw size={12}/> },
  ARTICLE_DONE:       { label: "เขียนเสร็จแล้ว",   color: "bg-blue-100 text-blue-700",        icon: <FileText size={12}/> },
  ARTICLE_GENERATING: { label: "กำลังเขียน...",    color: "bg-violet-100 text-violet-700",    icon: <RefreshCw size={12}/> },
  OUTLINE_APPROVED:   { label: "Outline OK",        color: "bg-indigo-100 text-indigo-700",    icon: <CheckCircle2 size={12}/> },
  OUTLINE_DONE:       { label: "มี Outline",        color: "bg-indigo-50 text-indigo-600",     icon: <FileText size={12}/> },
  NEW:                { label: "ใหม่",              color: "bg-gray-100 text-gray-600",        icon: <Clock size={12}/> },
  ERROR:              { label: "Error",             color: "bg-red-100 text-red-600",          icon: <RefreshCw size={12}/> },
};

function getStatus(s: string) {
  return STATUS_LABEL[s] ?? { label: s, color: "bg-gray-100 text-gray-500", icon: <Clock size={12}/> };
}

function articleGroup(articles: Article[]) {
  const published  = articles.filter(a => a.status === "POSTED" || a.status === "WORDPRESS_DRAFTED");
  const pending    = articles.filter(a => ["SEO_REVIEW", "APPROVED", "REVISION_REQUIRED"].includes(a.status));
  const inProgress = articles.filter(a => !published.includes(a) && !pending.includes(a));
  return { published, pending, inProgress };
}

export function ClientPortalClient({ projects, userName }: { projects: Project[]; userName: string }) {
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>(
    Object.fromEntries(projects.map(p => [p.id, true]))
  );

  const toggleProject = (id: string) =>
    setOpenProjects(prev => ({ ...prev, [id]: !prev[id] }));

  const totalArticles = projects.reduce((s, p) => s + p.articles.length, 0);
  const totalPublished = projects.reduce((s, p) => s + p.articles.filter(a => a.status === "POSTED" || a.status === "WORDPRESS_DRAFTED").length, 0);
  const totalReview = projects.reduce((s, p) => s + p.articles.filter(a => a.status === "SEO_REVIEW").length, 0);

  return (
    <div className="min-h-screen bg-[#f7f7f6]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <p className="text-2xl font-bold text-gray-900">สวัสดี, {userName} 👋</p>
        <p className="text-sm text-gray-500 mt-1">ภาพรวมบทความของคุณทั้งหมด</p>
      </div>

      <div className="px-8 py-6 space-y-6 max-w-6xl">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "บทความทั้งหมด",  value: totalArticles,  color: "bg-gray-900 text-white" },
            { label: "เผยแพร่แล้ว",    value: totalPublished, color: "bg-emerald-600 text-white" },
            { label: "รอรีวิว",        value: totalReview,    color: "bg-amber-500 text-white" },
          ].map((c, i) => (
            <div key={i} className={`${c.color} rounded-2xl px-6 py-5`}>
              <p className="text-4xl font-black">{c.value}</p>
              <p className="text-sm mt-1 opacity-80">{c.label}</p>
            </div>
          ))}
        </div>

        {projects.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 px-8 py-16 text-center">
            <p className="text-gray-400 text-sm">ยังไม่มีโปรเจกต์ที่ผูกกับบัญชีนี้</p>
            <p className="text-gray-300 text-xs mt-1">กรุณาติดต่อทีมงานเพื่อเพิ่มสิทธิ์</p>
          </div>
        ) : (
          projects.map(project => {
            const { published, pending, inProgress } = articleGroup(project.articles);
            const isOpen = openProjects[project.id] ?? true;

            return (
              <div key={project.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                {/* Project header */}
                <button
                  onClick={() => toggleProject(project.id)}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {isOpen ? <ChevronDown size={16} className="text-gray-400"/> : <ChevronRight size={16} className="text-gray-400"/>}
                    <div>
                      <p className="font-bold text-gray-900">{project.name}</p>
                      {project.website && (
                        <p className="text-xs text-gray-400">{project.website}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full font-medium">{published.length} เผยแพร่</span>
                    <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-full font-medium">{pending.length} รอรีวิว</span>
                    <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">{inProgress.length} กำลังทำ</span>
                  </div>
                </button>

                {isOpen && project.articles.length > 0 && (
                  <div>
                    {/* Group sections */}
                    {[
                      { label: "เผยแพร่แล้ว",   items: published,  accent: "border-l-emerald-500" },
                      { label: "รอรีวิว / Approve", items: pending, accent: "border-l-amber-500" },
                      { label: "กำลังดำเนินการ", items: inProgress, accent: "border-l-gray-300" },
                    ].map(group =>
                      group.items.length === 0 ? null : (
                        <div key={group.label} className="border-t border-gray-100">
                          <div className="px-6 pt-4 pb-2">
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{group.label}</p>
                          </div>
                          <div className="divide-y divide-gray-50">
                            {group.items.map(article => {
                              const st = getStatus(article.status);
                              const lastComment = article.comments[0];
                              return (
                                <div key={article.id} className={`flex items-start gap-4 px-6 py-4 border-l-2 ${group.accent}`}>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 truncate">{article.title}</p>
                                    {lastComment && (
                                      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-gray-500">
                                        <MessageCircle size={11} className="mt-0.5 shrink-0 text-gray-400"/>
                                        <span className="truncate">
                                          <span className="font-medium">{lastComment.user.name ?? "ทีมงาน"}:</span>{" "}
                                          {lastComment.body}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${st.color}`}>
                                      {st.icon}{st.label}
                                    </span>
                                    {article.wordpressUrl && (
                                      <a
                                        href={article.wordpressUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-gray-400 hover:text-blue-600 transition-colors"
                                        title="ดูบทความ"
                                      >
                                        <ExternalLink size={14}/>
                                      </a>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}

                {isOpen && project.articles.length === 0 && (
                  <div className="border-t border-gray-100 px-6 py-8 text-center text-sm text-gray-400">
                    ยังไม่มีบทความในโปรเจกต์นี้
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
