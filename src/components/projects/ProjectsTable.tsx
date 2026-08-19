"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, PauseCircle, PlayCircle, ArchiveX, Search, CalendarDays, AlertTriangle, Eye, FileText, Wrench, CheckCircle2, UserCircle2 } from "lucide-react";

type TimelineStats = { total: number; writing: number; review: number; approved: number; pushed: number };
type UrgentItem = { title: string; kind: "article" | "task"; date: string; overdue: boolean };
type Workload = {
  dueToday: number; dueThisWeek: number; overdue: number; review: number;
  done: number; total: number; progressPct: number;
  statusCounts: { pushed: number; approved: number; review: number; writing: number; pending: number };
  urgentItems: UrgentItem[];
  nextDue: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  clientName: string | null;
  website: string;
  businessType: string;
  industry: string | null;
  logoUrl: string | null;
  status: string;
  updatedAt: Date;
  owner: { id: string; name: string | null } | null;
  timelineStats: TimelineStats;
  workload: Workload;
  userRole: string;
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}
function avatarColor(name: string) {
  const colors = ["bg-blue-500","bg-emerald-500","bg-violet-500","bg-rose-500","bg-amber-500","bg-cyan-500","bg-pink-500","bg-indigo-500"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

/** สีชิปผู้ดูแล — deterministic จากชื่อ โทนอ่อนตาม CI */
const OWNER_CHIP_COLORS = [
  "bg-brand-mist text-brand-blue border-brand-soft/50",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-violet-50 text-violet-700 border-violet-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-cyan-50 text-cyan-700 border-cyan-200",
];
function ownerChipColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return OWNER_CHIP_COLORS[h % OWNER_CHIP_COLORS.length];
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE:    "bg-green-100 text-green-700",
  PLANNING:  "bg-blue-100 text-blue-700",
  PAUSED:    "bg-yellow-100 text-yellow-700",
  COMPLETED: "bg-gray-100 text-gray-600",
  ARCHIVED:  "bg-red-50 text-red-400",
};

export default function ProjectsTable({ projects: initial, userRole }: { projects: ProjectRow[]; userRole: string }) {
  const [projects, setProjects] = useState(initial);
  const [updating, setUpdating] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  // ผู้ดูแล: 'ALL' | 'NONE' (ยังไม่มีผู้ดูแล) | userId
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [orgUsers, setOrgUsers] = useState<{ id: string; name: string | null }[]>([]);
  useEffect(() => {
    fetch("/api/users")
      .then(r => (r.ok ? r.json() : []))
      .then(list => { if (Array.isArray(list)) setOrgUsers(list.filter((u: { status?: string }) => u.status !== "INACTIVE")); })
      .catch(() => {});
  }, []);

  async function changeOwner(projectId: string, ownerId: string | null) {
    const owner = ownerId ? orgUsers.find(u => u.id === ownerId) ?? null : null;
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, owner: owner ? { id: owner.id, name: owner.name } : null } : p));
    await fetch(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId }),
    }).catch(() => {});
  }

  async function changeStatus(id: string, newStatus: string) {
    setUpdating(id);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) setProjects(prev => prev.map(p => p.id === id ? { ...p, status: newStatus } : p));
    } finally {
      setUpdating(null);
    }
  }

  const isAdmin = userRole === "ADMIN" || userRole === "USER";

  const matchOwner = (p: ProjectRow) =>
    ownerFilter === "ALL" ||
    (ownerFilter === "NONE" ? !p.owner : p.owner?.id === ownerFilter);

  const filtered = projects.filter(p => {
    const q = search.toLowerCase();
    const matchQ = !q || p.name.toLowerCase().includes(q) || (p.clientName ?? "").toLowerCase().includes(q) || p.website.toLowerCase().includes(q);
    const matchS = filterStatus === "ALL" || p.status === filterStatus;
    return matchQ && matchS && matchOwner(p);
  });

  // ชิป filter ผู้ดูแล — เฉพาะคนที่มีโปรเจกต์จริง + ช่อง "ยังไม่มีผู้ดูแล" ถ้ามี
  const ownerChips = useMemo(() => {
    const byOwner = new Map<string, { id: string; name: string; count: number }>();
    let none = 0;
    for (const p of projects) {
      if (p.status === "ARCHIVED") continue;
      if (!p.owner) { none++; continue; }
      const cur = byOwner.get(p.owner.id) ?? { id: p.owner.id, name: p.owner.name ?? "ไม่ทราบชื่อ", count: 0 };
      cur.count++;
      byOwner.set(p.owner.id, cur);
    }
    return { owners: Array.from(byOwner.values()).sort((a, b) => b.count - a.count), none };
  }, [projects]);

  const statusCounts = projects.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // ── Overview: รวมงานค้างทุกโปรเจกต์ (ไม่นับ ARCHIVED) ──
  const activeProjects = projects.filter(p => p.status !== "ARCHIVED" && matchOwner(p));
  const totals = activeProjects.reduce(
    (acc, p) => {
      acc.dueToday += p.workload.dueToday;
      acc.dueThisWeek += p.workload.dueThisWeek;
      acc.overdue += p.workload.overdue;
      acc.review += p.workload.review;
      acc.done += p.workload.done;
      acc.total += p.workload.total;
      return acc;
    },
    { dueToday: 0, dueThisWeek: 0, overdue: 0, review: 0, done: 0, total: 0 }
  );
  const progressProjects = activeProjects.filter(p => p.workload.total > 0);

  // งานที่ต้องเคลียร์ = เกินกำหนด + ครบกำหนดวันนี้ (เรียงเก่าสุดก่อน) พร้อมชื่อ client
  const urgentList = activeProjects
    .flatMap(p => p.workload.urgentItems.map(it => ({ ...it, client: p.clientName || p.name, projectId: p.id })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const urgentCount = totals.overdue + totals.dueToday;

  const thToday = new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" });
  const fmtDue = (d: string) => {
    const dt = new Date(`${d}T00:00:00+07:00`);
    return dt.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  };
  const overdueDays = (d: string) => {
    const ms = Date.now() - new Date(`${d}T00:00:00+07:00`).getTime();
    return Math.max(1, Math.floor(ms / 86400_000));
  };

  const SEGMENTS: Array<{ key: keyof Workload["statusCounts"]; label: string; bar: string; dot: string }> = [
    { key: "pushed",   label: "เผยแพร่แล้ว", bar: "bg-emerald-500", dot: "bg-emerald-500" },
    { key: "approved", label: "อนุมัติแล้ว",  bar: "bg-emerald-300", dot: "bg-emerald-300" },
    { key: "review",   label: "รอตรวจ",     bar: "bg-amber-400",   dot: "bg-amber-400" },
    { key: "writing",  label: "กำลังเขียน",  bar: "bg-brand-blue",  dot: "bg-brand-blue" },
    { key: "pending",  label: "ยังไม่เริ่ม",  bar: "bg-gray-200",    dot: "bg-gray-300" },
  ];

  return (
    <div className="space-y-4">
      {/* ── Filter ผู้ดูแล — กรองทั้งหน้า (overview + ตาราง) ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 mr-1">
          <UserCircle2 size={13} /> ผู้ดูแล:
        </span>
        <button onClick={() => setOwnerFilter("ALL")}
          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
            ownerFilter === "ALL" ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-gray-500 border-gray-200 hover:border-brand-soft"
          }`}>
          ทุกคน
        </button>
        {ownerChips.owners.map(o => (
          <button key={o.id} onClick={() => setOwnerFilter(ownerFilter === o.id ? "ALL" : o.id)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              ownerFilter === o.id ? "bg-brand-blue text-white border-brand-blue" : ownerChipColor(o.name) + " hover:opacity-80"
            }`}>
            {o.name} ({o.count})
          </button>
        ))}
        {ownerChips.none > 0 && (
          <button onClick={() => setOwnerFilter(ownerFilter === "NONE" ? "ALL" : "NONE")}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border border-dashed transition-colors ${
              ownerFilter === "NONE" ? "bg-brand-blue text-white border-brand-blue border-solid" : "bg-white text-gray-400 border-gray-300 hover:border-gray-400"
            }`}>
            ยังไม่มีผู้ดูแล ({ownerChips.none})
          </button>
        )}
      </div>

      {/* ── Overview band: งานวันนี้ (hero) + สถิติ ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">

        {/* Hero — งานที่ต้องเคลียร์วันนี้ (องค์ประกอบมืดเดียวของหน้า) */}
        <div className="lg:col-span-3 rounded-2xl bg-brand-navy text-white p-5 relative overflow-hidden">
          {/* เส้น accent Tech Cyan — สัดส่วนจิ๋วตาม CI */}
          <div className="absolute top-0 left-5 right-5 h-px bg-brand-cyan/60" />
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/50">{thToday}</p>
              <h2 className="text-lg font-bold mt-0.5">
                งานที่ต้องเคลียร์วันนี้
                <span className="ml-2 inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-lg bg-white/10 text-base tabular-nums align-middle">
                  {urgentCount}
                </span>
              </h2>
            </div>
            {totals.total > 0 && (
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold tabular-nums leading-7">
                  {Math.round((totals.done / totals.total) * 100)}<span className="text-sm font-semibold text-white/50">%</span>
                </div>
                <div className="text-[10px] text-white/40">เสร็จรวม {totals.done}/{totals.total} บทความ</div>
              </div>
            )}
          </div>

          {urgentList.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-white/5 px-4 py-3.5 text-sm text-white/70">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              วันนี้ไม่มีงานถึงกำหนด — งานถัดไปดูที่การ์ดโปรเจกต์ด้านล่าง
            </div>
          ) : (
            <ul className="space-y-1.5">
              {urgentList.slice(0, 5).map((it, i) => (
                <li key={i}>
                  <Link href={`/projects/${it.projectId}`}
                    className="group flex items-center gap-3 rounded-xl bg-white/5 hover:bg-white/10 px-3.5 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan">
                    {it.kind === "task"
                      ? <Wrench size={13} className="text-white/40 shrink-0" />
                      : <FileText size={13} className="text-white/40 shrink-0" />}
                    <span className="flex-1 min-w-0 text-[13px] font-medium truncate">{it.title}</span>
                    <span className="text-[10px] text-white/40 shrink-0 hidden sm:block">{it.client}</span>
                    {it.overdue ? (
                      <span className="shrink-0 text-[10px] font-bold text-red-300 bg-red-500/20 rounded-full px-2 py-0.5 tabular-nums">
                        ค้าง {overdueDays(it.date)} วัน
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] font-bold text-brand-cyan/90 bg-brand-cyan/10 rounded-full px-2 py-0.5">
                        วันนี้
                      </span>
                    )}
                    <ArrowRight size={12} className="text-white/20 group-hover:text-white/60 transition-colors shrink-0" />
                  </Link>
                </li>
              ))}
              {urgentList.length > 5 && (
                <li className="text-[11px] text-white/40 pl-1 pt-0.5">+ อีก {urgentList.length - 5} รายการ — ดูในแต่ละโปรเจกต์</li>
              )}
            </ul>
          )}
        </div>

        {/* สถิติรอง 3 ใบ */}
        <div className="lg:col-span-2 grid grid-cols-3 lg:grid-cols-1 gap-3">
          {[
            { label: "ครบกำหนดใน 7 วัน", value: totals.dueThisWeek, icon: <CalendarDays size={15} />, tone: "text-brand-blue bg-brand-mist", sub: `จาก ${progressProjects.length} โปรเจกต์ที่มีแผน` },
            { label: "เกินกำหนด", value: totals.overdue, icon: <AlertTriangle size={15} />, tone: totals.overdue > 0 ? "text-red-600 bg-red-50" : "text-gray-400 bg-gray-50", sub: totals.overdue > 0 ? "ต้องรีบเคลียร์ก่อน" : "ไม่มีงานค้าง" },
            { label: "รอตรวจ (Review)", value: totals.review, icon: <Eye size={15} />, tone: totals.review > 0 ? "text-amber-600 bg-amber-50" : "text-gray-400 bg-gray-50", sub: totals.review > 0 ? "รอทีมกดอนุมัติ" : "ไม่มีบทความรอตรวจ" },
          ].map(card => (
            <div key={card.label} className="flex lg:flex-row flex-col lg:items-center gap-2 lg:gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${card.tone}`}>
                {card.icon}
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-brand-navy tabular-nums leading-6">{card.value}</span>
                  <span className="text-[11px] font-medium text-gray-500 truncate">{card.label}</span>
                </div>
                <div className="text-[10px] text-gray-400 truncate hidden lg:block">{card.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── ความคืบหน้าแต่ละโปรเจกต์ — แท่งแบ่งตามสถานะ ── */}
      {progressProjects.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="text-[13px] font-bold text-brand-navy">ความคืบหน้าแต่ละโปรเจกต์</h2>
            <div className="flex items-center gap-3 flex-wrap">
              {SEGMENTS.map(seg => (
                <span key={seg.key} className="flex items-center gap-1 text-[10px] text-gray-400">
                  <span className={`w-2 h-2 rounded-full ${seg.dot}`} /> {seg.label}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {progressProjects.map(p => {
              const w = p.workload;
              return (
                <Link key={p.id} href={`/projects/${p.id}`}
                  className="group rounded-xl border border-gray-100 hover:border-brand-soft hover:shadow-sm p-3.5 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue">
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold overflow-hidden ${p.logoUrl ? "" : avatarColor(p.clientName || p.name)}`}>
                      {p.logoUrl
                        ? <img src={p.logoUrl} alt="" className="w-full h-full object-cover" />
                        : initials(p.clientName || p.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-semibold text-brand-navy truncate group-hover:text-brand-blue transition-colors">
                          {p.clientName || p.name}
                        </span>
                        {p.owner?.name && (
                          <span className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold ${ownerChipColor(p.owner.name)}`}>
                            {p.owner.name}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {w.nextDue ? `งานถัดไป ${fmtDue(w.nextDue)}` : "ไม่มีงานตามกำหนดแล้ว"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-brand-navy tabular-nums leading-4">{w.progressPct}%</div>
                      <div className="text-[9px] text-gray-400 tabular-nums">{w.done}/{w.total}</div>
                    </div>
                  </div>

                  {/* แท่งสถานะแบบแบ่งช่วง */}
                  <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-2.5">
                    {SEGMENTS.map(seg => {
                      const n = w.statusCounts[seg.key];
                      if (!n) return null;
                      return (
                        <div key={seg.key} className={`${seg.bar} transition-all duration-500`}
                          style={{ width: `${(n / w.total) * 100}%` }}
                          title={`${seg.label} ${n}`} />
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap text-[10px] min-h-[18px]">
                    {w.dueToday > 0 && (
                      <span className="font-semibold text-brand-blue bg-brand-mist rounded-full px-2 py-0.5">วันนี้ {w.dueToday}</span>
                    )}
                    {w.overdue > 0 && (
                      <span className="font-semibold text-red-600 bg-red-50 rounded-full px-2 py-0.5">ค้าง {w.overdue}</span>
                    )}
                    {w.review > 0 && (
                      <span className="font-semibold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5">รอตรวจ {w.review}</span>
                    )}
                    {w.dueToday === 0 && w.overdue === 0 && w.review === 0 && (
                      <span className="text-gray-300">ตามแผน — ไม่มีงานเร่ง</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ client, เว็บ..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
        </div>
        <div className="flex gap-1.5">
          {["ALL", "ACTIVE", "PAUSED", "ARCHIVED", "PLANNING", "COMPLETED"].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${filterStatus === s ? "bg-brand-blue text-white border-brand-blue" : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"}`}>
              {s === "ALL" ? `ทั้งหมด (${projects.length})` : `${s} (${statusCounts[s] ?? 0})`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {["#", "Client", "เว็บไซต์", "ประเภท", "บทความ", "ความคืบหน้า", "อัปเดต", "Status", isAdmin ? "Actions" : ""].filter(Boolean).map(h => (
                <th key={h} className="text-left px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">ไม่พบ client</td></tr>
            )}
            {filtered.map((p, i) => {
              const ts = p.timelineStats;
              const done = ts.approved + ts.pushed;
              const progress = ts.total > 0 ? Math.round((done / ts.total) * 100) : 0;
              const busy = updating === p.id;
              return (
                <tr key={p.id} className={`hover:bg-gray-50/80 transition-colors ${p.status === "ARCHIVED" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 text-gray-400 tabular-nums text-xs">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white text-[13px] font-bold overflow-hidden ${p.logoUrl ? '' : avatarColor(p.clientName || p.name)}`}>
                        {p.logoUrl
                          ? <img src={p.logoUrl} alt="" className="w-full h-full object-cover" />
                          : initials(p.clientName || p.name)
                        }
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-brand-navy truncate">{p.clientName || p.name}</div>
                        {p.industry && <div className="text-[11px] text-gray-400 truncate">{p.industry}</div>}
                        <div className="mt-1 flex items-center gap-1">
                          {isAdmin ? (
                            <label className={`relative inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold cursor-pointer transition-opacity hover:opacity-75 ${
                              p.owner?.name ? ownerChipColor(p.owner.name) : "bg-white text-gray-400 border-dashed border-gray-300"
                            }`} title="เปลี่ยนผู้ดูแล">
                              <UserCircle2 size={10} />
                              {p.owner?.name ?? "มอบหมายผู้ดูแล"}
                              <select
                                value={p.owner?.id ?? ""}
                                onChange={e => changeOwner(p.id, e.target.value || null)}
                                className="absolute inset-0 opacity-0 cursor-pointer">
                                <option value="">— ไม่มีผู้ดูแล —</option>
                                {orgUsers.map(u => <option key={u.id} value={u.id}>{u.name ?? u.id}</option>)}
                              </select>
                            </label>
                          ) : p.owner?.name ? (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ownerChipColor(p.owner.name)}`}>
                              <UserCircle2 size={10} /> {p.owner.name}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-blue-500 max-w-[160px]">
                    <span className="truncate block">{p.website}</span>
                    {p.industry && <span className="text-gray-400 block">{p.industry}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.businessType}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 text-xs tabular-nums">
                      <span className="text-gray-700 font-semibold">{ts.total}</span>
                      {ts.review > 0 && <span className="text-amber-600">รอตรวจ {ts.review}</span>}
                      {ts.writing > 0 && <span className="text-blue-500">เขียน {ts.writing}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 min-w-[100px]">
                    {ts.total > 0 ? (
                      <div>
                        <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                          <span>{done}/{ts.total}</span>
                          <span className="font-semibold">{progress}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {formatDistanceToNow(new Date(p.updatedAt), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${STATUS_BADGE[p.status] ?? "bg-gray-100 text-gray-500"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/projects/${p.id}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-brand-blue hover:bg-brand-deep rounded-lg transition-colors">
                        เปิด <ArrowRight size={11} />
                      </Link>
                      {isAdmin && (
                        <>
                          {p.status === "ACTIVE" || p.status === "PLANNING" ? (
                            <button onClick={() => changeStatus(p.id, "PAUSED")} disabled={busy}
                              className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40" title="ระงับ">
                              <PauseCircle size={14} />
                            </button>
                          ) : p.status === "PAUSED" ? (
                            <button onClick={() => changeStatus(p.id, "ACTIVE")} disabled={busy}
                              className="p-1.5 text-green-500 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-40" title="เปิดใช้งาน">
                              <PlayCircle size={14} />
                            </button>
                          ) : null}
                          {p.status !== "ARCHIVED" ? (
                            <button onClick={() => { if (confirm(`Archive "${p.name}"?`)) changeStatus(p.id, "ARCHIVED") }} disabled={busy}
                              className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="Archive">
                              <ArchiveX size={14} />
                            </button>
                          ) : (
                            <button onClick={() => changeStatus(p.id, "ACTIVE")} disabled={busy}
                              className="p-1.5 text-green-400 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-40" title="กู้คืน">
                              <PlayCircle size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
