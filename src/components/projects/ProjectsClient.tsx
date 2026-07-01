"use client";

import { useState } from "react";
import { Plus, Search, FolderKanban, TrendingUp, FileText, Clock } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import ProjectCard from "./ProjectCard";
import CreateProjectModal from "./CreateProjectModal";
import type { Role } from "@/types";

type ProjectWithStats = {
  id: string;
  name: string;
  clientName: string | null;
  website: string;
  businessType: string;
  industry: string | null;
  language: string;
  market: string | null;
  status: string;
  notes: string | null;
  updatedAt: Date;
  createdAt: Date;
  owner: { id: string; name: string | null } | null;
  _count: { articles: number; keywords: number; members: number };
  statusMap: Record<string, number>;
  monthlyTarget?: number | null;
};

type Props = {
  projects: ProjectWithStats[];
  userRole: Role;
};

const STATUS_OPTIONS = [
  { value: "ALL",       label: "ทุกสถานะ" },
  { value: "ACTIVE",    label: "Active — กำลังทำงาน" },
  { value: "PLANNING",  label: "Planning — เตรียมการ" },
  { value: "PAUSED",    label: "Paused — หยุดชั่วคราว" },
  { value: "COMPLETED", label: "Completed — เสร็จแล้ว" },
  { value: "ARCHIVED",  label: "Archived — เก็บแล้ว" },
];

function sum(map: Record<string, number>, keys: string[]) {
  return keys.reduce((s, k) => s + (map[k] ?? 0), 0);
}

export default function ProjectsClient({ projects, userRole }: Props) {
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showModal, setShowModal]     = useState(false);

  const canCreate = ["ADMIN", "SEO_MANAGER"].includes(userRole);

  const filtered = projects.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      p.name.toLowerCase().includes(q) ||
      (p.clientName ?? "").toLowerCase().includes(q) ||
      (p.website ?? "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "ALL" || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Workspace-wide totals for the summary bar
  const totalProjects  = projects.length;
  const totalArticles  = projects.reduce((s, p) => s + p._count.articles, 0);
  const totalInReview  = projects.reduce((s, p) => s + sum(p.statusMap, ["SEO_REVIEW", "REVISION_REQUIRED"]), 0);
  const totalApproved  = projects.reduce((s, p) => s + sum(p.statusMap, ["APPROVED", "WORDPRESS_DRAFTED", "POSTED"]), 0);

  return (
    <div className="space-y-6 pb-10">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-green-950 to-slate-900 text-white px-8 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-green-400 text-sm font-medium mb-1 tracking-wide uppercase">Mars</p>
            <h1 className="text-2xl font-bold leading-tight mb-2">Projects</h1>
            <p className="text-slate-300 text-base">
              เลือกโปรเจกต์ลูกค้าที่ต้องการทำงานต่อ
            </p>
            <p className="text-slate-400 text-sm mt-1">
              Manage SEO article workflows for each client or website
            </p>
          </div>
          {canCreate && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-500 hover:bg-green-400 active:bg-green-600 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-green-900/30 flex-shrink-0"
            >
              <Plus className="h-4 w-4" />
              สร้างโปรเจกต์ใหม่
            </button>
          )}
        </div>

        {/* Workspace stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-7 pt-6 border-t border-white/10">
          {[
            { icon: FolderKanban, value: totalProjects,  label: "โปรเจกต์ทั้งหมด", sub: "Projects" },
            { icon: FileText,     value: totalArticles,  label: "บทความทั้งหมด",   sub: "Total Articles" },
            { icon: Clock,        value: totalInReview,  label: "รอตรวจ SEO",       sub: "Awaiting Review" },
            { icon: TrendingUp,   value: totalApproved,  label: "อนุมัติแล้ว",       sub: "Approved & Published" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-sm text-green-300 font-medium">{s.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="ค้นหาโปรเจกต์ ชื่อลูกค้า หรือเว็บไซต์…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white min-w-[180px]"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Result count */}
      {(search || statusFilter !== "ALL") && (
        <p className="text-sm text-gray-500">
          พบ <span className="font-semibold text-gray-700">{filtered.length}</span> โปรเจกต์
          {search && ` สำหรับ "${search}"`}
        </p>
      )}

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="📁"
          title={search || statusFilter !== "ALL" ? "ไม่พบโปรเจกต์" : "ยังไม่มีโปรเจกต์"}
          description={
            search || statusFilter !== "ALL"
              ? "ลองเปลี่ยนคำค้นหาหรือตัวกรองดูครับ"
              : "เริ่มต้นสร้างโปรเจกต์แรกสำหรับลูกค้าของคุณได้เลย"
          }
          action={
            canCreate ? (
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm font-semibold rounded-xl transition-colors"
              >
                <Plus className="h-4 w-4" />
                สร้างโปรเจกต์ใหม่
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && <CreateProjectModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
