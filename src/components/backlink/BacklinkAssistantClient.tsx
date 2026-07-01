"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Plus, Trash2, Pencil, Check, X,
  Link2, Globe, FileText, Clock, CheckCircle2, XCircle, AlertCircle,
  Filter, Shield, Zap, Database, Github, Upload, Search,
  TrendingUp, TrendingDown, RefreshCw, ChevronDown, ChevronUp,
  BarChart3, AlertTriangle, Sparkles, ArrowRight, Info,
  Target, Eye, Wrench, Users, ScanLine,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  website: string;
}

interface BacklinkEntry {
  id: string;
  projectId: string;
  targetUrl: string;
  sourceUrl: string | null;
  anchorText: string | null;
  domainRating: number | null;
  status: string;
  notes: string | null;
  createdAt: string | Date;
  project: { id: string; name: string };
}

interface Props {
  initialBacklinks: BacklinkEntry[];
  projects: Project[];
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  REQUESTED:   { label: "Requested",      color: "text-gray-600",    bg: "bg-gray-100",    icon: <Clock size={11} /> },
  NEGOTIATING: { label: "Negotiating",    color: "text-blue-700",    bg: "bg-blue-100",    icon: <AlertCircle size={11} /> },
  AGREED:      { label: "Agreed",         color: "text-amber-700",   bg: "bg-amber-100",   icon: <FileText size={11} /> },
  PUBLISHED:   { label: "Live",           color: "text-emerald-700", bg: "bg-emerald-100", icon: <CheckCircle2 size={11} /> },
  REJECTED:    { label: "Rejected",       color: "text-red-500",     bg: "bg-red-100",     icon: <XCircle size={11} /> },
  LOST:        { label: "Lost",           color: "text-gray-400",    bg: "bg-gray-100",    icon: <X size={11} /> },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

function StatusChip({ status }: { status: string }) {
  const s = STATUS_CONFIG[status] ?? STATUS_CONFIG.REQUESTED;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.bg} ${s.color}`}>
      {s.icon}{s.label}
    </span>
  );
}

// ─── Demo data ────────────────────────────────────────────────────────────────


const STATUS_COLOR: Record<string, string> = {
  "Live":           "bg-emerald-100 text-emerald-700",
  "Lost":           "bg-gray-100 text-gray-500",
  "Risk Review":    "bg-red-100 text-red-600",
  "Broken Target":  "bg-amber-100 text-amber-700",
  "Nofollow":       "bg-blue-100 text-blue-600",
  "Redirected":     "bg-purple-100 text-purple-600",
};

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = true, accent }:
  { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; accent?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left ${accent ?? ""}`}>
        <div className="flex items-center gap-2.5 font-bold text-gray-900 text-sm">{icon}{title}</div>
        {open ? <ChevronUp size={14} className="text-gray-400 shrink-0" /> : <ChevronDown size={14} className="text-gray-400 shrink-0" />}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, trend, color = "text-gray-900" }:
  { label: string; value: string | number; sub?: string; trend?: "up" | "down" | "neutral"; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      {sub && (
        <p className={`text-[11px] flex items-center gap-1 ${trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "text-gray-400"}`}>
          {trend === "up" && <TrendingUp size={10} />}
          {trend === "down" && <TrendingDown size={10} />}
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Source card ──────────────────────────────────────────────────────────────

function SourceCard({ icon, name, badge, badgeColor, use, limit }:
  { icon: React.ReactNode; name: string; badge: string; badgeColor: string; use: string; limit: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm">{icon}{name}</div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>{badge}</span>
      </div>
      <p className="text-xs text-gray-600"><b>ใช้สำหรับ:</b> {use}</p>
      <p className="text-[11px] text-gray-400 flex items-start gap-1"><Info size={10} className="mt-0.5 shrink-0" />{limit}</p>
    </div>
  );
}

// ─── Score bar ────────────────────────────────────────────────────────────────

function ScoreBar({ label, score, type }: { label: string; score: number; type: "quality" | "risk" }) {
  const color = type === "quality"
    ? score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-400" : "bg-gray-300"
    : score >= 70 ? "bg-red-500" : score >= 40 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-gray-600 w-40 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="font-bold text-gray-700 w-6 text-right">{score}</span>
    </div>
  );
}

// ─── Task card ────────────────────────────────────────────────────────────────

function TaskCard({ title, assignee, priority, reason, action }:
  { title: string; assignee: string; priority: "High" | "Medium" | "Low"; reason: string; action: string }) {
  const pColor = { High: "bg-red-100 text-red-700", Medium: "bg-amber-100 text-amber-700", Low: "bg-gray-100 text-gray-500" }[priority];
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-gray-900 text-sm">{title}</p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${pColor}`}>{priority}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <Users size={10} className="shrink-0" />
        <span>{assignee}</span>
      </div>
      <p className="text-xs text-gray-600"><b>เหตุผล:</b> {reason}</p>
      <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-1.5"><b>Action:</b> {action}</p>
    </div>
  );
}

// ─── Add form ─────────────────────────────────────────────────────────────────

function AddBacklinkForm({ projects, onAdd }: { projects: Project[]; onAdd: (entry: BacklinkEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    projectId: projects[0]?.id ?? "",
    targetUrl: "", sourceUrl: "", anchorText: "", domainRating: "", notes: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.projectId || !form.targetUrl) return;
    setSaving(true);
    try {
      const res = await fetch("/api/backlinks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, domainRating: form.domainRating ? Number(form.domainRating) : null }),
      });
      if (!res.ok) throw new Error(await res.text());
      const entry = await res.json();
      onAdd(entry);
      setOpen(false);
      setForm({ projectId: projects[0]?.id ?? "", targetUrl: "", sourceUrl: "", anchorText: "", domainRating: "", notes: "" });
      toast.success("เพิ่ม backlink แล้ว");
    } catch { toast.error("เกิดข้อผิดพลาด"); }
    finally { setSaving(false); }
  }

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900";

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 transition-colors">
      <Plus size={14} /> เพิ่ม Backlink
    </button>
  );

  return (
    <form onSubmit={submit} className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-sm">เพิ่ม Backlink ใหม่</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Client *</label>
          <select value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))} className={inputCls} required>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Target URL *</label>
          <input type="url" value={form.targetUrl} onChange={e => setForm(f => ({ ...f, targetUrl: e.target.value }))} placeholder="https://yoursite.com/page" className={inputCls} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Source URL</label>
          <input type="url" value={form.sourceUrl} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} placeholder="https://partner-site.com/article" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Anchor Text</label>
          <input value={form.anchorText} onChange={e => setForm(f => ({ ...f, anchorText: e.target.value }))} placeholder="คำที่ใช้ลิงก์" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Domain Rating (DR)</label>
          <input type="number" min="0" max="100" value={form.domainRating} onChange={e => setForm(f => ({ ...f, domainRating: e.target.value }))} placeholder="0–100" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">หมายเหตุ</label>
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="เพิ่มเติม..." className={inputCls} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900">ยกเลิก</button>
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors">
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </form>
  );
}

// ─── Backlink row (live data) ─────────────────────────────────────────────────

function BacklinkRow({ entry, onUpdate, onDelete }: {
  entry: BacklinkEntry; onUpdate: (u: BacklinkEntry) => void; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState({
    status: entry.status, sourceUrl: entry.sourceUrl ?? "",
    anchorText: entry.anchorText ?? "", domainRating: entry.domainRating?.toString() ?? "", notes: entry.notes ?? "",
  });

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/backlinks/${entry.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, domainRating: form.domainRating ? Number(form.domainRating) : null }),
      });
      if (!res.ok) throw new Error();
      onUpdate(await res.json());
      setEditing(false);
      toast.success("อัปเดตแล้ว");
    } catch { toast.error("เกิดข้อผิดพลาด"); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!confirm("ลบ backlink นี้?")) return;
    try {
      await fetch(`/api/backlinks/${entry.id}`, { method: "DELETE" });
      onDelete(entry.id);
      toast.success("ลบแล้ว");
    } catch { toast.error("เกิดข้อผิดพลาด"); }
  }

  const cellCls = "px-4 py-3";
  const inputCls = "w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900";

  if (editing) return (
    <tr className="bg-blue-50/30">
      <td className={`${cellCls} text-xs text-gray-500`}>{entry.project.name}</td>
      <td className={cellCls}><a href={entry.targetUrl} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline flex items-center gap-1 truncate max-w-[140px]"><Link2 size={10} />{entry.targetUrl}</a></td>
      <td className={cellCls}><input value={form.sourceUrl} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} className={inputCls} placeholder="https://..." /></td>
      <td className={cellCls}><input value={form.anchorText} onChange={e => setForm(f => ({ ...f, anchorText: e.target.value }))} className={inputCls} placeholder="anchor" /></td>
      <td className={cellCls}><input type="number" min="0" max="100" value={form.domainRating} onChange={e => setForm(f => ({ ...f, domainRating: e.target.value }))} className={`${inputCls} w-14`} /></td>
      <td className={cellCls}>
        <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={`${inputCls} w-auto`}>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
        </select>
      </td>
      <td className={cellCls}><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} placeholder="หมายเหตุ" /></td>
      <td className={cellCls}>
        <div className="flex gap-1">
          <button onClick={save} disabled={saving} className="p-1.5 rounded bg-gray-900 text-white hover:bg-gray-700"><Check size={12} /></button>
          <button onClick={() => setEditing(false)} className="p-1.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"><X size={12} /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <tr className="hover:bg-gray-50/50 transition-colors group">
      <td className={`${cellCls} text-xs text-gray-500 whitespace-nowrap`}>{entry.project.name}</td>
      <td className={`${cellCls} max-w-[140px]`}><a href={entry.targetUrl} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline flex items-center gap-1 truncate"><Link2 size={10} className="shrink-0" />{entry.targetUrl}</a></td>
      <td className={`${cellCls} max-w-[140px]`}>{entry.sourceUrl ? <a href={entry.sourceUrl} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline flex items-center gap-1 truncate"><Globe size={10} className="shrink-0" />{entry.sourceUrl}</a> : <span className="text-gray-300 text-xs">—</span>}</td>
      <td className={cellCls}><span className="text-xs text-gray-600">{entry.anchorText || <span className="text-gray-300">—</span>}</span></td>
      <td className={`${cellCls} text-center`}>{entry.domainRating != null ? <span className={`text-xs font-bold ${entry.domainRating >= 60 ? "text-emerald-600" : entry.domainRating >= 30 ? "text-amber-600" : "text-gray-400"}`}>{entry.domainRating}</span> : <span className="text-gray-300 text-xs">—</span>}</td>
      <td className={cellCls}><StatusChip status={entry.status} /></td>
      <td className={`${cellCls} max-w-[120px]`}><span className="text-xs text-gray-500 truncate block">{entry.notes || <span className="text-gray-300">—</span>}</span></td>
      <td className={cellCls}>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"><Pencil size={12} /></button>
          <button onClick={remove} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
        </div>
      </td>
    </tr>
  );
}

// ─── CSV Import Modal ─────────────────────────────────────────────────────────

function CSVImportModal({ projects, onImported, onClose }: {
  projects: Project[];
  onImported: (count: number) => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [file, setFile]           = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult]       = useState<{ imported: number; skipped: number; message: string } | null>(null);
  const [error, setError]         = useState<string | null>(null);

  async function upload() {
    if (!file || !projectId) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectId", projectId);
      const res = await fetch("/api/backlinks/import-csv", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Import failed"); return; }
      setResult(data);
      onImported(data.imported);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-900 text-sm flex items-center gap-2"><Upload size={14} /> Import CSV</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-[11px] text-gray-500 space-y-1">
          <p className="font-semibold text-gray-700">รองรับ format จาก:</p>
          <p>• <b>Ahrefs</b> — Referring Pages export (CSV)</p>
          <p>• <b>Semrush</b> — Backlinks report (CSV)</p>
          <p>• <b>Majestic</b> — Referring Domains/Pages (CSV)</p>
          <p>• <b>Generic</b> — ต้องมี column: source url, target url</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Client / Project</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">ไฟล์ CSV</label>
          <input type="file" accept=".csv,.tsv,.txt"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null); setError(null); }}
            className="w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-gray-900 file:text-white file:text-xs file:font-semibold hover:file:bg-gray-700" />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>
        )}

        {result && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs space-y-1">
            <p className="font-bold text-emerald-800">Import สำเร็จ</p>
            <p className="text-emerald-700">{result.message}</p>
            <p className="text-emerald-600">Imported: {result.imported} · Skipped: {result.skipped}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-900">ปิด</button>
          <button onClick={upload} disabled={!file || !projectId || uploading}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {uploading ? <><RefreshCw size={11} className="animate-spin" /> กำลัง import...</> : <><Upload size={11} /> Import</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Link Checker Panel ───────────────────────────────────────────────────────

function LinkCheckerPanel({ entries, onChecked, onClose }: {
  entries: BacklinkEntry[];
  onChecked: (updated: BacklinkEntry[]) => void;
  onClose: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [summary, setSummary]   = useState<Record<string, number> | null>(null);
  const [error, setError]       = useState<string | null>(null);

  async function runCheck(ids?: string[]) {
    setChecking(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/backlinks/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Check failed"); return; }
      setSummary(data.summary);
      // Refresh all entries from response
      const updatedIds = new Set((data.results as { id: string; status: string; httpCode: number | null }[]).map(r => r.id));
      const statusMap: Record<string, string> = {};
      (data.results as { id: string; status: string }[]).forEach(r => {
        const s = { LIVE: "PUBLISHED", LOST: "LOST", BROKEN_TARGET: "REJECTED", REDIRECTED: "PUBLISHED", NOFOLLOW: "PUBLISHED", ERROR: "REQUESTED" }[r.status] ?? "REQUESTED";
        statusMap[r.id] = s;
      });
      const updated = entries
        .filter(e => updatedIds.has(e.id))
        .map(e => ({ ...e, status: statusMap[e.id] ?? e.status }));
      onChecked(updated);
      toast.success(`ตรวจสอบแล้ว ${data.checked} links`);
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  }

  const liveCount = entries.filter(e => e.status === "PUBLISHED").length;
  const total = Math.min(entries.length, 50);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-900 text-sm flex items-center gap-2"><ScanLine size={14} /> Self Link Checker</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 space-y-1">
          <p className="font-semibold">ระบบจะตรวจสอบ:</p>
          <p>• Target URL ยังมีอยู่มั้ย (404/410 = Broken Target)</p>
          <p>• Source page ยังลิงก์มาอยู่มั้ย (ถ้าไม่มี = Lost)</p>
          <p>• Link มี rel=nofollow มั้ย</p>
          <p>• Target redirect ไปที่ไหน</p>
          <p className="text-blue-500 mt-1">จำกัด 50 links ต่อครั้ง — ใช้เวลาประมาณ {Math.ceil(total / 5) * 3}–{Math.ceil(total / 5) * 8} วินาที</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-center">
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
            <p className="text-2xl font-black text-gray-900">{entries.length}</p>
            <p className="text-gray-500">Total backlinks</p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
            <p className="text-2xl font-black text-gray-900">{Math.min(entries.length, 50)}</p>
            <p className="text-gray-500">จะตรวจสอบ</p>
          </div>
        </div>

        {summary && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs space-y-1.5">
            <p className="font-bold text-emerald-800">ผลลัพธ์:</p>
            <div className="grid grid-cols-3 gap-1 text-center">
              {Object.entries(summary).map(([k, v]) => (
                <div key={k} className="bg-white rounded-lg px-2 py-1.5 border border-emerald-100">
                  <p className="font-bold text-gray-900">{v as number}</p>
                  <p className="text-gray-500 capitalize">{k}</p>
                </div>
              ))}
            </div>
            <p className="text-emerald-600">Status ใน DB อัปเดตแล้ว</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-900">ปิด</button>
          <button onClick={() => runCheck()} disabled={checking || entries.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {checking
              ? <><RefreshCw size={11} className="animate-spin" /> กำลังตรวจสอบ...</>
              : <><ScanLine size={11} /> ตรวจสอบ {Math.min(entries.length, 50)} links</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stats types ──────────────────────────────────────────────────────────────

interface BacklinkStats {
  kpi: {
    total: number; domains: number; newThisWeek: number; newLastWeek: number;
    lostLinks: number; brokenTarget: number; riskReview: number;
    geminiEnrich: number; tasks: number;
  };
  reviewTable: {
    domain: string; target: string; anchor: string; status: string;
    quality: number; risk: number; ai: string; task: string;
  }[];
  tasks: { title: string; assignee: string; priority: "High"|"Medium"|"Low"; reason: string; action: string }[];
  qualityFactors: Record<string, number>;
  riskFactors: Record<string, number>;
  hasData: boolean;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function BacklinkAssistantClient({ initialBacklinks, projects }: Props) {
  const [entries, setEntries]       = useState<BacklinkEntry[]>(initialBacklinks);
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus]   = useState("all");
  const [showCSV, setShowCSV]       = useState(false);
  const [showChecker, setShowChecker] = useState(false);
  const [stats, setStats]           = useState<BacklinkStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Fetch live stats from DB
  useEffect(() => {
    fetch("/api/backlinks/stats")
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => {/* silently degrade */})
      .finally(() => setStatsLoading(false));
  }, [entries]); // re-fetch when entries change (after add/import/check)

  const counts = useMemo(() => ALL_STATUSES.reduce((acc, s) => {
    acc[s] = entries.filter(e => e.status === s).length;
    return acc;
  }, {} as Record<string, number>), [entries]);

  const filtered = useMemo(() => entries.filter(e => {
    if (filterProject !== "all" && e.projectId !== filterProject) return false;
    if (filterStatus  !== "all" && e.status    !== filterStatus)  return false;
    return true;
  }), [entries, filterProject, filterStatus]);

  return (
    <div className="space-y-5 max-w-6xl">

      {/* ── 1. Hero ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "Free-first",        bg: "bg-emerald-100 text-emerald-700" },
              { label: "Automated",         bg: "bg-blue-100 text-blue-700" },
              { label: "Gemini-assisted",   bg: "bg-purple-100 text-purple-700" },
              { label: "SEO Team Workflow", bg: "bg-amber-100 text-amber-700" },
            ].map(b => (
              <span key={b.label} className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${b.bg}`}>{b.label}</span>
            ))}
          </div>
          <h1 className="text-xl font-bold text-gray-900">Backlink Automation Lite</h1>
          <p className="text-sm text-gray-500 max-w-2xl">
            Free-first backlink monitoring and action system for SEO teams. Detect new links, lost links, risky links, broken backlinks, competitor gaps, and generate recommended SEO actions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowCSV(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors">
            <Upload size={13} /> Import CSV
          </button>
          <button onClick={() => setShowChecker(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors">
            <ScanLine size={13} /> Check Links
          </button>
          <AddBacklinkForm projects={projects} onAdd={e => setEntries(prev => [e, ...prev])} />
        </div>
      </div>

      {/* ── 2. KPI Cards ── */}
      {statsLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2 animate-pulse">
              <div className="h-2 bg-gray-100 rounded w-3/4" />
              <div className="h-7 bg-gray-100 rounded w-1/2" />
              <div className="h-2 bg-gray-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {(() => {
            const k = stats?.kpi;
            const newTrend = k ? (k.newThisWeek >= k.newLastWeek ? "up" : "down") : "neutral";
            return <>
              <KPICard label="Total Backlinks"    value={k?.total ?? 0}      sub={k?.newThisWeek ? `+${k.newThisWeek} this week` : "no data yet"} trend={k?.newThisWeek ? "up" : "neutral"} color="text-gray-900" />
              <KPICard label="Referring Domains"  value={k?.domains ?? 0}    sub="unique domains"           trend="neutral"  color="text-gray-900" />
              <KPICard label="New This Week"      value={k?.newThisWeek ?? 0} sub={k ? `vs ${k.newLastWeek} last week` : "—"} trend={newTrend} color="text-emerald-600" />
              <KPICard label="Lost Links"         value={k?.lostLinks ?? 0}  sub="status: LOST"             trend={k?.lostLinks ? "down" : "neutral"} color={k?.lostLinks ? "text-red-500" : "text-gray-400"} />
              <KPICard label="Broken Target URLs" value={k?.brokenTarget ?? 0} sub="needs fix"              trend="neutral"  color={k?.brokenTarget ? "text-amber-600" : "text-gray-400"} />
              <KPICard label="Risk Review"        value={k?.riskReview ?? 0} sub="risk score ≥ 60"          trend="neutral"  color={k?.riskReview ? "text-red-500" : "text-gray-400"} />
              <KPICard label="Gemini Candidates"  value={k?.geminiEnrich ?? 0} sub="eligible for AI enrich" trend="neutral"  color="text-purple-600" />
              <KPICard label="Tasks Created"      value={stats?.tasks.length ?? 0} sub="auto-generated"     trend="neutral"  color="text-gray-900" />
            </>;
          })()}
        </div>
      )}

      {/* ── 3. Free Data Sources ── */}
      <Section title="Free Data Sources" icon={<Database size={15} />} defaultOpen={false}>
        <p className="text-xs text-gray-500 mb-4">ระบบใช้ free-first sources — ไม่ต้องจ่ายค่า Ahrefs หรือ Semrush เพื่อเริ่มต้น</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SourceCard icon={<Globe size={13} className="text-blue-600" />}        name="Common Crawl"          badge="Free"          badgeColor="bg-emerald-100 text-emerald-700" use="Discover backlinks from web crawl index" limit="Requires processing — not real-time. Best for bulk discovery." />
          <SourceCard icon={<Search size={13} className="text-emerald-600" />}    name="Google Search Console" badge="Free"          badgeColor="bg-emerald-100 text-emerald-700" use="Official link data from Google — sampled" limit="GSC shows a sample, not all links. Use as verification source." />
          <SourceCard icon={<BarChart3 size={13} className="text-blue-500" />}    name="Bing Webmaster Tools"  badge="Free"          badgeColor="bg-emerald-100 text-emerald-700" use="Additional link signals from Bing's index" limit="Smaller index than Google but often finds links GSC misses." />
          <SourceCard icon={<Upload size={13} className="text-gray-600" />}       name="CSV Upload"            badge="Manual"        badgeColor="bg-gray-100 text-gray-600"       use="Import from Ahrefs, Semrush, Majestic export" limit="Fallback method — full control over what goes in." />
          <SourceCard icon={<RefreshCw size={13} className="text-amber-600" />}   name="Self Link Checker"     badge="Built-in"      badgeColor="bg-amber-100 text-amber-700"     use="Verify live/lost/nofollow/redirect/404 status" limit="Rate-limited to avoid IP blocks — checks in batches." />
          <SourceCard icon={<Database size={13} className="text-indigo-600" />}   name="Supabase Free"         badge="Free DB"       badgeColor="bg-indigo-100 text-indigo-700"   use="Store all backlink records, scores, history" limit="500MB free tier. Upgrade when dataset grows large." />
          <SourceCard icon={<Github size={13} className="text-gray-700" />}       name="GitHub Actions"        badge="Free CI"       badgeColor="bg-gray-100 text-gray-700"       use="Schedule nightly checks and imports automatically" limit="2,000 min/month free. Sufficient for most small agencies." />
          <SourceCard icon={<Sparkles size={13} className="text-purple-600" />}   name="Gemini Grounding"      badge="Optional AI"   badgeColor="bg-purple-100 text-purple-700"   use="AI analysis & classification — NOT the backlink index" limit="Cost-gated. Used only for high-value or uncertain links." />
        </div>
        <div className="mt-4 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 text-xs text-purple-800">
          <b>สำคัญ:</b> Gemini Grounding คือ AI analysis layer — ไม่ใช่ backlink database. ใช้สำหรับ classify, enrich, และ generate insights จาก links ที่ collect มาแล้วเท่านั้น
        </div>
      </Section>

      {/* ── 4. Automation Flow ── */}
      <Section title="Automation Flow" icon={<Zap size={15} />} defaultOpen={false}>
        <p className="text-xs text-gray-500 mb-5">ขั้นตอนการทำงานอัตโนมัติตั้งแต่ collect จนถึง report</p>
        <div className="flex flex-wrap gap-2 items-center">
          {[
            { step: "1", label: "Collect",      desc: "Common Crawl + GSC + Bing + CSV",              color: "bg-blue-50 border-blue-200 text-blue-800" },
            { step: "2", label: "Normalize",     desc: "Domain, URL, anchor text standardization",     color: "bg-indigo-50 border-indigo-200 text-indigo-800" },
            { step: "3", label: "Verify",        desc: "Live / Lost / Nofollow / Redirect / 404",     color: "bg-amber-50 border-amber-200 text-amber-800" },
            { step: "4", label: "Score",         desc: "Quality + Risk — rule-based logic",           color: "bg-emerald-50 border-emerald-200 text-emerald-800" },
            { step: "5", label: "Gemini Enrich", desc: "Only high-value / uncertain links",           color: "bg-purple-50 border-purple-200 text-purple-800" },
            { step: "6", label: "Create Tasks",  desc: "Auto SEO action items by category",          color: "bg-orange-50 border-orange-200 text-orange-800" },
            { step: "7", label: "Report",        desc: "Dashboard + CSV export to team",             color: "bg-gray-50 border-gray-200 text-gray-800" },
          ].map((s, i, arr) => (
            <div key={s.step} className="flex items-center gap-2">
              <div className={`border rounded-xl px-3 py-2.5 text-xs font-semibold min-w-[110px] ${s.color}`}>
                <div className="text-[10px] opacity-60 mb-0.5">Step {s.step}</div>
                <div className="font-bold">{s.label}</div>
                <div className="text-[10px] opacity-70 mt-0.5 font-normal leading-tight">{s.desc}</div>
              </div>
              {i < arr.length - 1 && <ArrowRight size={14} className="text-gray-300 shrink-0" />}
            </div>
          ))}
        </div>
      </Section>

      {/* ── 5. Gemini Guardrail ── */}
      <Section title="Gemini AI Guardrail" icon={<Shield size={15} />} defaultOpen={false}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5"><CheckCircle2 size={13} /> ใช้ Gemini เมื่อ</p>
            <ul className="text-xs text-emerald-700 space-y-1.5">
              {[
                "quality_score ≥ 70 — high-value link",
                "risk_score ≥ 60 — uncertain or risky",
                "Lost link ที่เคยมี DR สูง",
                "Competitor gap opportunity ที่ detect ได้",
                "Source domain ใหม่ที่ยังไม่เคย classify",
              ].map(i => <li key={i} className="flex gap-1.5"><span className="mt-0.5 shrink-0">•</span>{i}</li>)}
            </ul>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold text-red-800 flex items-center gap-1.5"><X size={13} /> ไม่ใช้ Gemini สำหรับ</p>
            <ul className="text-xs text-red-700 space-y-1.5">
              {[
                "ทุก backlink โดยไม่มีเงื่อนไข",
                "Obvious spam หรือ casino/adult links",
                "Duplicate domains ที่ classify ไปแล้ว",
                "Low-value nofollow links",
                "Links ที่ classified แล้วใน DB",
              ].map(i => <li key={i} className="flex gap-1.5"><span className="mt-0.5 shrink-0">•</span>{i}</li>)}
            </ul>
          </div>
        </div>
        <div className="mt-3 bg-gray-900 rounded-xl px-4 py-3 text-xs text-gray-300 flex items-start gap-2">
          <Sparkles size={12} className="text-purple-400 mt-0.5 shrink-0" />
          <span><b className="text-white">Cost Control:</b> AI enrichment is gated to avoid unnecessary API usage. Only ~5–10% of backlinks are sent to Gemini. The rest are scored by rule-based logic.</span>
        </div>
      </Section>

      {/* ── 6. Backlink Review Table — real data ── */}
      <Section title="Backlink Review Table" icon={<Eye size={15} />} defaultOpen>
        {!stats?.hasData ? (
          <div className="text-center py-10 bg-gray-50 rounded-xl border border-gray-100">
            <Eye size={24} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-500">ยังไม่มีข้อมูล</p>
            <p className="text-xs text-gray-400 mt-1">เพิ่ม backlink หรือ Import CSV เพื่อดู analysis</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-left min-w-[800px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["Source Domain", "Target URL", "Anchor", "Status", "Quality", "Risk", "AI Recommendation", "Suggested Task"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(stats?.reviewTable ?? []).map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-semibold text-gray-700 whitespace-nowrap">{row.domain}</td>
                    <td className="px-3 py-2.5 text-[11px] text-blue-600 truncate max-w-[120px]">{row.target}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[100px] truncate">{row.anchor}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[row.status] ?? "bg-gray-100 text-gray-500"}`}>{row.status}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-full rounded-full ${row.quality >= 70 ? "bg-emerald-500" : row.quality >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${row.quality}%` }} />
                        </div>
                        <span className="text-[11px] font-bold text-gray-700">{row.quality}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-full rounded-full ${row.risk >= 70 ? "bg-red-500" : row.risk >= 40 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${row.risk}%` }} />
                        </div>
                        <span className="text-[11px] font-bold text-gray-700">{row.risk}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-600 max-w-[160px]">{row.ai}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg whitespace-nowrap">{row.task}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── 7. Auto Task Board — real data ── */}
      <Section title={`Auto Task Board${stats?.tasks.length ? ` (${stats.tasks.length})` : ""}`} icon={<Target size={15} />} defaultOpen={false}>
        {!stats?.hasData ? (
          <div className="text-center py-8 bg-gray-50 rounded-xl border border-gray-100">
            <Target size={22} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-500">Tasks จะ generate อัตโนมัติหลังเพิ่มข้อมูล</p>
          </div>
        ) : stats?.tasks.length === 0 ? (
          <div className="text-center py-8 bg-emerald-50 rounded-xl border border-emerald-100">
            <CheckCircle2 size={22} className="text-emerald-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-emerald-700">ไม่มี action ที่จำเป็น — backlinks อยู่ในสถานะดี</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.tasks.map((t, i) => (
              <TaskCard key={i} title={t.title} assignee={t.assignee} priority={t.priority} reason={t.reason} action={t.action} />
            ))}
          </div>
        )}
      </Section>

      {/* ── 8. Scoring Logic — real aggregates ── */}
      <Section title="Scoring Logic" icon={<BarChart3 size={15} />} defaultOpen={false}>
        {!stats?.hasData ? (
          <p className="text-xs text-gray-400 text-center py-6">Score averages จะแสดงหลังเพิ่มข้อมูล backlinks</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-bold text-gray-700 mb-3 flex items-center gap-1.5"><TrendingUp size={13} className="text-emerald-600" /> Backlink Quality Score (avg)</p>
              <div className="space-y-2.5">
                <ScoreBar label="Topical relevance"         score={stats.qualityFactors.topicalRelevance   ?? 0} type="quality" />
                <ScoreBar label="Real website signals"      score={stats.qualityFactors.realWebsiteSignal  ?? 0} type="quality" />
                <ScoreBar label="Anchor naturalness"        score={stats.qualityFactors.anchorNaturalness  ?? 0} type="quality" />
                <ScoreBar label="Target page value"         score={stats.qualityFactors.targetPageValue    ?? 0} type="quality" />
                <ScoreBar label="Content placement"         score={stats.qualityFactors.contentPlacement   ?? 0} type="quality" />
                <ScoreBar label="Source trust signals"      score={stats.qualityFactors.sourceTrust        ?? 0} type="quality" />
                <ScoreBar label="Spam footprint (low=good)" score={stats.qualityFactors.spamFootprint      ?? 0} type="quality" />
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-700 mb-3 flex items-center gap-1.5"><AlertTriangle size={13} className="text-red-500" /> Backlink Risk Score (avg)</p>
              <div className="space-y-2.5">
                <ScoreBar label="Casino / adult / spam niche"  score={stats.riskFactors.spamNiche          ?? 0} type="risk" />
                <ScoreBar label="Unnatural exact match anchor" score={stats.riskFactors.unnaturalAnchor    ?? 0} type="risk" />
                <ScoreBar label="Scraper / PBN pattern"        score={stats.riskFactors.scraperPattern     ?? 0} type="risk" />
                <ScoreBar label="Unrelated content"            score={stats.riskFactors.unrelatedContent   ?? 0} type="risk" />
                <ScoreBar label="Suspicious outbound links"    score={stats.riskFactors.suspiciousOutbound ?? 0} type="risk" />
                <ScoreBar label="Sitewide / footer / sidebar"  score={stats.riskFactors.sitewideLink       ?? 0} type="risk" />
                <ScoreBar label="New domain < 6 months"        score={stats.riskFactors.newDomain          ?? 0} type="risk" />
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* ── Live data: Your Backlinks ── */}
      <Section title={`Your Tracked Backlinks (${entries.length})`} icon={<Link2 size={15} />} defaultOpen>
        {/* Summary chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setFilterStatus("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${filterStatus === "all" ? "bg-gray-900 text-white border-gray-900" : "bg-gray-100 text-gray-600 border-transparent hover:border-gray-200"}`}>
            ทั้งหมด <span className="opacity-60 ml-1">{entries.length}</span>
          </button>
          {ALL_STATUSES.map(s => {
            const cfg = STATUS_CONFIG[s];
            return (
              <button key={s} onClick={() => setFilterStatus(filterStatus === s ? "all" : s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${filterStatus === s ? "bg-gray-900 text-white border-gray-900" : `${cfg.bg} ${cfg.color} border-transparent hover:border-gray-200`}`}>
                {cfg.icon}{cfg.label}
                <span className="opacity-60 ml-0.5">{counts[s]}</span>
              </button>
            );
          })}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3 mb-4">
          <Filter size={13} className="text-gray-400" />
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
            <option value="all">ทุก Client</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="text-xs text-gray-400">{filtered.length} รายการ</span>
        </div>

        {filtered.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-left min-w-[700px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["Client", "Target URL", "Source URL", "Anchor", "DR", "Status", "หมายเหตุ", ""].map(h => (
                    <th key={h} className="px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(entry => (
                  <BacklinkRow key={entry.id} entry={entry}
                    onUpdate={u => setEntries(prev => prev.map(e => e.id === u.id ? u : e))}
                    onDelete={id => setEntries(prev => prev.filter(e => e.id !== id))} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 bg-gray-50 rounded-2xl border border-gray-100">
            <Link2 size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-gray-500 font-medium text-sm">ยังไม่มี backlink</p>
            <p className="text-gray-400 text-xs mt-1">กด "+ เพิ่ม Backlink" ที่ด้านบนเพื่อเริ่มติดตาม</p>
          </div>
        )}
      </Section>

      {/* ── 9. Free vs Limitations ── */}
      <Section title="Limitations & Honest Trade-offs" icon={<Info size={15} />} defaultOpen={false}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { icon: <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />, text: "Free backlink data จะไม่ครบเท่า Ahrefs, Semrush, หรือ Majestic — แต่เพียงพอสำหรับ monitoring และ prioritization" },
            { icon: <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />, text: "GSC แสดงเพียงส่วนหนึ่งของ links ทั้งหมด (sampled data) — ไม่ใช่ full backlink index" },
            { icon: <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />, text: "Common Crawl ต้องมีการ processing และ filtering ก่อนใช้งาน — ไม่ใช่ real-time API" },
            { icon: <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />, text: "Gemini Grounding ไม่ใช่ backlink database — เป็นเพียง AI layer สำหรับ enrich และ classify" },
            { icon: <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />, text: "Best MVP approach: เริ่มด้วย automation + prioritization — ไม่ต้องรอ perfect data coverage" },
            { icon: <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />, text: "ระบบนี้ช่วยทีม SEO ทำงานได้ faster โดยไม่จ่ายค่า tool subscription ตั้งแต่วันแรก" },
          ].map((item, i) => (
            <div key={i} className="flex gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
              {item.icon}{item.text}
            </div>
          ))}
        </div>
      </Section>

      {/* ── 10. Tech Stack ── */}
      <Section title="Suggested Tech Stack" icon={<Wrench size={15} />} defaultOpen={false}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Frontend",   value: "Next.js (this project)",       color: "bg-gray-50  border-gray-200" },
            { label: "Database",   value: "Supabase Free / PostgreSQL",    color: "bg-green-50 border-green-200" },
            { label: "Scheduler",  value: "GitHub Actions / cron",         color: "bg-gray-50  border-gray-200" },
            { label: "Link Check", value: "Python / Node worker",          color: "bg-blue-50  border-blue-200" },
            { label: "AI Layer",   value: "Gemini Grounding (optional)",   color: "bg-purple-50 border-purple-200" },
            { label: "Reporting",  value: "Dashboard + CSV export",        color: "bg-amber-50 border-amber-200" },
          ].map(s => (
            <div key={s.label} className={`border rounded-xl p-3 text-center ${s.color}`}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
              <p className="text-xs font-semibold text-gray-700 leading-tight">{s.value}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Modals ── */}
      {showCSV && (
        <CSVImportModal
          projects={projects}
          onImported={(count) => {
            if (count > 0) toast.success(`Import แล้ว ${count} backlinks — รีเฟรชหน้าเพื่อดูข้อมูลใหม่`);
            setShowCSV(false);
          }}
          onClose={() => setShowCSV(false)}
        />
      )}
      {showChecker && (
        <LinkCheckerPanel
          entries={entries}
          onChecked={(updated) => {
            setEntries(prev => {
              const map = new Map(updated.map(u => [u.id, u]));
              return prev.map(e => map.get(e.id) ?? e);
            });
          }}
          onClose={() => setShowChecker(false)}
        />
      )}
    </div>
  );
}
